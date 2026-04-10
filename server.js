const express = require('express');
const session = require('express-session');
const BetterSqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { initDB } = require('./db');
const { csrfMiddleware } = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for correct client IP behind reverse proxies (nginx, Cloudflare, etc.)
// This ensures rate limiting and logging use the real client IP, not the proxy IP.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
}

// Init DB
initDB();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Generate CSP nonce per request (allows specific inline scripts without 'unsafe-inline')
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
      baseUri:    ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: null,
    }
  },
  // Only send HSTS in production (requires HTTPS to be effective)
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
}));

// Static files (CSS, JS, fonts only — uploads are served through authenticated API routes)
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session secret — fail loudly if not configured or if the known placeholder is still in use
const KNOWN_WEAK_SECRETS = [
  'replace-with-a-long-random-string-at-least-32-chars',
  'secret', 'changeme', 'password', 'armory', 'armory123',
];
let sessionSecret = process.env.SESSION_SECRET;
const isProd = process.env.NODE_ENV === 'production';
if (!sessionSecret) {
  if (isProd) {
    console.error('FATAL: SESSION_SECRET is not set. Refusing to start in production without a secret.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set — using ephemeral secret. Sessions will be lost on restart.');
} else if (KNOWN_WEAK_SECRETS.includes(sessionSecret) || sessionSecret.length < 32) {
  if (isProd) {
    console.error('FATAL: SESSION_SECRET is a known weak value or too short (< 32 chars). Refusing to start in production.');
    process.exit(1);
  }
  console.warn('WARNING: SESSION_SECRET is weak or too short. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

// Open sessions DB and migrate schema if it was created by the old connect-sqlite3
// library (which used column "expired") — better-sqlite3-session-store expects "expire".
const sessionDb = new Database(process.env.SESSION_DB_PATH || path.join(__dirname, 'data', 'sessions.db'));
(function migrateSessionSchema() {
  const cols = sessionDb.prepare("PRAGMA table_info('sessions')").all().map(c => c.name);
  if (cols.includes('expired') && !cols.includes('expire')) {
    console.log('Migrating sessions table from connect-sqlite3 schema to better-sqlite3-session-store schema...');
    sessionDb.exec('DROP TABLE sessions');
  }
})();

app.use(session({
  store: new BetterSqliteStore({
    client: sessionDb,
    expired: { clear: true, intervalMs: 15 * 60 * 1000 }
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

// CSRF protection (inject token into res.locals + validate on POST/PUT/DELETE)
app.use(csrfMiddleware);

// Login rate limiting — 10 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).render('login', { error: 'Too many login attempts. Please try again in 15 minutes.' });
  }
});
app.use('/login', loginLimiter);

// Rate limiting for sensitive write endpoints — 20 requests per 15 minutes
const sensitiveWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  handler: (req, res) => {
    res.status(429).render('error', { message: 'Too many requests. Please try again in 15 minutes.', user: req.session.user });
  }
});
app.use('/settings/change-password', sensitiveWriteLimiter);
app.use('/settings/add-user', sensitiveWriteLimiter);
app.use('/settings/import', sensitiveWriteLimiter);

// General API rate limiting — 300 requests per minute per IP
// Generous limit since photo/document serving is auth-gated already
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
});
app.use('/api', apiLimiter);
app.use('/search', apiLimiter);

// Export rate limiting — 5 exports per 15 minutes
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    res.status(429).render('error', { message: 'Too many export requests. Please try again later.', user: req.session.user });
  }
});
app.use('/settings/export', exportLimiter);

// Routes
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/settings'));
app.use('/search', require('./routes/search'));
app.use('/inventory', require('./routes/inventory'));
app.use('/trusts', require('./routes/trusts'));
app.use('/optics', require('./routes/optics'));
app.use('/mags', require('./routes/mags'));
app.use('/api', require('./routes/api'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found', user: req.session.user });
});

// Global error handler — catches errors forwarded via next(err) or thrown in async handlers
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    user: req.session?.user?.username || null,
  }));
  if (res.headersSent) return;
  res.status(status).render('error', {
    message: status === 500 ? 'An unexpected error occurred.' : err.message,
    user: req.session?.user,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Armory running on port ${PORT}`);
  });
}

module.exports = app;
