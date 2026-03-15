const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { userQueries } = require('../db');
const { requireAuth } = require('../middleware/auth');

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
  const user = userQueries.findByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Invalid username or password' });
  }
  req.session.user = { id: user.id, username: user.username };
  const returnTo = req.session.returnTo || '/inventory';
  delete req.session.returnTo;
  res.redirect(returnTo);
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// User management (admin only - first user is admin)
router.get('/settings', requireAuth, (req, res) => {
  const users = userQueries.all();
  res.render('settings', { user: req.session.user, users, message: null });
});

router.post('/settings/add-user', requireAuth, (req, res) => {
  const { username, password } = req.body;
  try {
    userQueries.create(username, password);
    const users = userQueries.all();
    res.render('settings', { user: req.session.user, users, message: { type: 'success', text: `User "${username}" created` } });
  } catch (e) {
    const users = userQueries.all();
    res.render('settings', { user: req.session.user, users, message: { type: 'error', text: 'Username already exists' } });
  }
});

router.post('/settings/delete-user', requireAuth, (req, res) => {
  const { id } = req.body;
  if (parseInt(id) === req.session.user.id) {
    const users = userQueries.all();
    return res.render('settings', { user: req.session.user, users, message: { type: 'error', text: 'Cannot delete your own account' } });
  }
  userQueries.delete(id);
  res.redirect('/settings');
});

router.post('/settings/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = userQueries.findByUsername(req.session.user.username);
  const users = userQueries.all();
  if (!bcrypt.compareSync(current_password, user.password)) {
    return res.render('settings', { user: req.session.user, users, message: { type: 'error', text: 'Current password is incorrect' } });
  }
  userQueries.updatePassword(req.session.user.id, new_password);
  res.render('settings', { user: req.session.user, users, message: { type: 'success', text: 'Password updated successfully' } });
});

module.exports = router;
