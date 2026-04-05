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
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET env var is not set. Generated a random ephemeral secret — all sessions will be invalidated on restart. Set SESSION_SECRET to a strong random value.');
} else if (KNOWN_WEAK_SECRETS.includes(sessionSecret) || sessionSecret.length < 32) {
  console.warn('WARNING: SESSION_SECRET is a known placeholder or is too short (< 32 chars). Sessions may be forgeable. Generate a strong secret with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

// Open sessions DB and migrate schema if it was created by the old connect-sqlite3
// library (which used column "expired") — better-sqlite3-session-store expects "expire".
const sessionDb = new Database(path.join(__dirname, 'data', 'sessions.db'));
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

// Routes
app.use('/', require('./routes/auth'));
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

app.listen(PORT, () => {
  console.log(`Armory running on port ${PORT}`);
});
