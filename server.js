const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
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

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    }
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.warn('WARNING: SESSION_SECRET env var is not set. Using insecure default — set SESSION_SECRET before exposing this app externally.');
}
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './data' }),
  secret: sessionSecret || 'armory-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
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

// Routes
app.use('/', require('./routes/auth'));
app.use('/inventory', require('./routes/inventory'));
app.use('/trusts', require('./routes/trusts'));
app.use('/api', require('./routes/api'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found', user: req.session.user });
});

app.listen(PORT, () => {
  console.log(`Armory running on port ${PORT}`);
});
