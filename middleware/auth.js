const { userQueries } = require('../db');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    // Re-validate session version on every request so that role changes and
    // other admin actions take effect immediately rather than at session expiry.
    const dbVersion = userQueries.getSessionVersion(req.session.user.id);
    if (dbVersion !== (req.session.user.session_version || 0)) {
      return req.session.destroy(() => res.redirect('/login'));
    }
    return next();
  }
  // Only save returnTo for page navigations, not subresource requests (images, etc.)
  const accept = req.headers['accept'] || '';
  if (accept.includes('text/html')) {
    req.session.returnTo = req.originalUrl;
  }
  // Prevent browsers from caching the 302 redirect (especially for images)
  res.set('Cache-Control', 'no-store');
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && !req.session.user.is_spouse_view) {
    return next();
  }
  res.status(403).render('error', { message: 'Access restricted.', user: req.session ? req.session.user : null });
}

module.exports = { requireAuth, requireAdmin };
