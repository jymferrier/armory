const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { userQueries } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

// Precomputed hash for constant-time response when a username is not found —
// prevents timing-based username enumeration.
const DUMMY_HASH = bcrypt.hashSync('_armory_dummy_sentinel_', 12);

// ── Account lockout (in-memory; resets on restart) ──────────────────────────
const failedLogins = new Map();
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

function isLockedOut(username) {
  const entry = failedLogins.get(username.toLowerCase());
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil) failedLogins.delete(username.toLowerCase());
  return false;
}
function recordFailedLogin(username) {
  const key = username.toLowerCase();
  const entry = failedLogins.get(key) || { count: 0, lockedUntil: null };
  entry.count++;
  if (entry.count >= LOCKOUT_THRESHOLD) entry.lockedUntil = Date.now() + LOCKOUT_MS;
  failedLogins.set(key, entry);
}
function clearFailedLogins(username) { failedLogins.delete(username.toLowerCase()); }

// ── Routes ──────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/inventory');
  res.redirect('/login');
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/inventory');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (isLockedOut(username)) {
    audit(req, 'LOGIN_LOCKED', username);
    return res.render('login', { error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
  }

  const user = userQueries.findByUsername(username);
  if (!user) {
    bcrypt.compareSync(password, DUMMY_HASH);
    recordFailedLogin(username);
    audit(req, 'LOGIN_FAILURE', username);
    return res.render('login', { error: 'Invalid username or password' });
  }
  if (!bcrypt.compareSync(password, user.password)) {
    recordFailedLogin(username);
    audit(req, 'LOGIN_FAILURE', username);
    return res.render('login', { error: 'Invalid username or password' });
  }

  clearFailedLogins(username);
  const returnTo = req.session.returnTo || '/inventory';
  req.session.regenerate((err) => {
    if (err) return res.render('login', { error: 'Session error. Please try again.' });
    req.session.user = {
      id: user.id,
      username: user.username,
      is_spouse_view: !!user.is_spouse_view,
      session_version: user.session_version || 0
    };
    audit(req, 'LOGIN_SUCCESS', username);
    // Validate returnTo — prevent open redirects via //, /%2f, etc.
    let safeTo = '/inventory';
    if (typeof returnTo === 'string' && returnTo.startsWith('/')) {
      try {
        const parsed = new URL(returnTo, 'http://localhost');
        if (parsed.hostname === 'localhost' && parsed.pathname.startsWith('/')) {
          safeTo = parsed.pathname + parsed.search + parsed.hash;
        }
      } catch (_) {}
    }
    res.redirect(safeTo);
  });
});

router.get('/logout', requireAuth, (req, res) => {
  audit(req, 'LOGOUT', '');
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
