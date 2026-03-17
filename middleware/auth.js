function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && !req.session.user.is_spouse_view) {
    return next();
  }
  res.status(403).render('error', { message: 'Access restricted.', user: req.session ? req.session.user : null });
}

module.exports = { requireAuth, requireAdmin };
