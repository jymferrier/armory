const express = require('express');
const router = express.Router();
const { trustQueries } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// List
router.get('/', (req, res) => {
  const trusts = trustQueries.all();
  const allNames = trustQueries.distinctTrustNames();
  const knownNames = new Set(trusts.map(t => t.name));
  const unregistered = allNames.filter(n => !knownNames.has(n));
  res.render('trusts', { user: req.session.user, trusts, unregistered });
});

// New trust form
router.get('/new', (req, res) => {
  const suggestions = trustQueries.distinctTrustNames();
  res.render('trust-form', { user: req.session.user, trust: null, suggestions, error: null });
});

// Create trust
router.post('/new', (req, res) => {
  const { name, settlor_name, settlor_location, agreement_date } = req.body;
  try {
    trustQueries.create({ name: name.trim(), settlor_name: settlor_name || null, settlor_location: settlor_location || null, agreement_date: agreement_date || null });
    const trust = trustQueries.findByName(name.trim());
    res.redirect('/trusts/' + trust.id);
  } catch(e) {
    const suggestions = trustQueries.distinctTrustNames();
    res.render('trust-form', { user: req.session.user, trust: null, suggestions, error: 'A trust with that name already exists.' });
  }
});

// Detail
router.get('/:id', (req, res) => {
  const trust = trustQueries.findById(req.params.id);
  if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });
  const items = trustQueries.itemsForTrust(trust.name);
  res.render('trust-detail', { user: req.session.user, trust, items, saved: !!req.query.saved });
});

// Update metadata
router.post('/:id', (req, res) => {
  const trust = trustQueries.findById(req.params.id);
  if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });
  const { settlor_name, settlor_location, agreement_date } = req.body;
  trustQueries.update(req.params.id, { settlor_name: settlor_name || null, settlor_location: settlor_location || null, agreement_date: agreement_date || null });
  res.redirect('/trusts/' + req.params.id + '?saved=1');
});

// Print assignment document
router.get('/:id/assignment', (req, res) => {
  const trust = trustQueries.findById(req.params.id);
  if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });
  const allItems = trustQueries.itemsForTrust(trust.name);
  const rawIds = [].concat(req.query.items || []).map(Number).filter(Boolean);
  const items = rawIds.length > 0 ? allItems.filter(f => rawIds.includes(f.id)) : allItems;
  res.render('trust-print', { user: req.session.user, trust, items });
});

// Delete
router.post('/:id/delete', (req, res) => {
  trustQueries.delete(req.params.id);
  res.redirect('/trusts');
});

module.exports = router;
