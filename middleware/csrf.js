const crypto = require('crypto');

function generateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfMiddleware(req, res, next) {
  // Always inject token into res.locals so templates can use it
  if (req.session) {
    res.locals.csrfToken = generateToken(req);
  }

  // Only validate on state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const token = req.query._csrf || req.body._csrf || req.headers['x-csrf-token'];
  if (!token || !req.session || token !== req.session.csrfToken) {
    return res.status(403).render('error', {
      message: 'Security token validation failed. Please go back and try again.',
      user: req.session ? req.session.user : null
    });
  }
  next();
}

module.exports = { generateToken, csrfMiddleware };
