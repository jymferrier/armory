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

  // Multipart/form-data: req.body is not yet populated (multer hasn't run).
  // Each multipart route validates the token itself after calling multer.
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/form-data')) return next();

  const token = req.query._csrf || req.body._csrf || req.headers['x-csrf-token'];
  if (!token || !req.session || token !== req.session.csrfToken) {
    return res.status(403).render('error', {
      message: 'Security token validation failed. Please go back and try again.',
      user: req.session ? req.session.user : null
    });
  }
  next();
}

// Call this inside multer callbacks after the body has been parsed.
function validateCsrf(req) {
  const token = req.body._csrf || req.headers['x-csrf-token'];
  return !!(token && req.session && token === req.session.csrfToken);
}

module.exports = { generateToken, csrfMiddleware, validateCsrf };
