const express = require('express');
const router = express.Router();
const { magsQueries } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { cap } = require('../lib/constants');

router.use(requireAuth);

const MATERIALS = ['Polymer', 'Steel', 'Stainless Steel', 'Aluminum', 'Other'];

const PLATFORM_SUGGESTIONS = [
  'AR-15', 'AR-10', 'AK-47', 'AK-74',
  'MP5', 'Scorpion', 'PCC',
  'PDP', 'M&P Full Size', 'M&P Compact', 'M&P Shield',
  'Glock 17', 'Glock 19', 'Glock 26', 'Glock 43X',
  'P320', 'P365', '1911',
  'CZ 75', 'Beretta 92', 'SCAR', 'FAL', 'M1A',
];

function formLocals() {
  const dbPlatforms = magsQueries.distinctPlatforms();
  const allPlatforms = [...new Set([...PLATFORM_SUGGESTIONS, ...dbPlatforms])].sort();
  return {
    platforms:        allPlatforms,
    brands:           magsQueries.distinctBrands(),
    models:           magsQueries.distinctModels(),
    calibers:         magsQueries.distinctCalibers(),
    materials:        MATERIALS,
    baskets:          magsQueries.distinctBaskets(),
    storageLocations: magsQueries.distinctStorageLocations(),
  };
}

// List
router.get('/', (req, res) => {
  const q = req.query.q ? req.query.q.trim() : '';
  let mags = magsQueries.all();
  if (q) {
    const ql = q.toLowerCase();
    mags = mags.filter(m =>
      (m.platform || '').toLowerCase().includes(ql) ||
      (m.brand || '').toLowerCase().includes(ql) ||
      (m.model || '').toLowerCase().includes(ql) ||
      (m.caliber || '').toLowerCase().includes(ql) ||
      (m.color || '').toLowerCase().includes(ql) ||
      (m.material || '').toLowerCase().includes(ql) ||
      (m.basket || '').toLowerCase().includes(ql) ||
      (m.storage_location || '').toLowerCase().includes(ql) ||
      (m.notes || '').toLowerCase().includes(ql)
    );
  }
  const totalQty = mags.reduce((sum, m) => sum + (m.quantity || 1), 0);
  res.render('mags', { user: req.session.user, mags, q, totalQty });
});

// New form
router.get('/new', requireAdmin, (req, res) => {
  res.render('mag-form', { user: req.session.user, mag: null, error: null, ...formLocals() });
});

// Create
router.post('/new', requireAdmin, (req, res) => {
  if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
  const { platform, brand, model, color, capacity, caliber, material, quantity, basket, storage_location, notes } = req.body;
  if (!brand) {
    return res.render('mag-form', { user: req.session.user, mag: req.body, error: 'Brand is required.', ...formLocals() });
  }
  const id = magsQueries.create({
    platform:         cap(platform, 200) || null,
    brand:            cap(brand.trim(), 200),
    model:            cap(model, 200) || null,
    color:            cap(color, 100) || null,
    capacity:         parseInt(capacity, 10) || null,
    caliber:          cap(caliber, 100) || null,
    material:         MATERIALS.includes(material) ? material : null,
    quantity:         parseInt(quantity, 10) || 1,
    basket:           cap(basket, 200) || null,
    storage_location: cap(storage_location, 200) || null,
    notes:            cap(notes, 2000) || null,
  });
  res.redirect('/mags/' + id);
});

// Detail
router.get('/:id', (req, res) => {
  const mag = magsQueries.findById(req.params.id);
  if (!mag) return res.status(404).render('error', { message: 'Mag not found', user: req.session.user });
  res.render('mag-detail', { user: req.session.user, mag });
});

// Edit form
router.get('/:id/edit', requireAdmin, (req, res) => {
  const mag = magsQueries.findById(req.params.id);
  if (!mag) return res.status(404).render('error', { message: 'Mag not found', user: req.session.user });
  res.render('mag-form', { user: req.session.user, mag, error: null, ...formLocals() });
});

// Update
router.post('/:id/edit', requireAdmin, (req, res) => {
  if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
  const mag = magsQueries.findById(req.params.id);
  if (!mag) return res.status(404).render('error', { message: 'Mag not found', user: req.session.user });
  const { platform, brand, model, color, capacity, caliber, material, quantity, basket, storage_location, notes } = req.body;
  if (!brand) {
    return res.render('mag-form', { user: req.session.user, mag: { ...mag, ...req.body }, error: 'Brand is required.', ...formLocals() });
  }
  magsQueries.update(req.params.id, {
    platform:         cap(platform, 200) || null,
    brand:            cap(brand.trim(), 200),
    model:            cap(model, 200) || null,
    color:            cap(color, 100) || null,
    capacity:         parseInt(capacity, 10) || null,
    caliber:          cap(caliber, 100) || null,
    material:         MATERIALS.includes(material) ? material : null,
    quantity:         parseInt(quantity, 10) || 1,
    basket:           cap(basket, 200) || null,
    storage_location: cap(storage_location, 200) || null,
    notes:            cap(notes, 2000) || null,
  });
  res.redirect('/mags/' + req.params.id);
});

// Duplicate
router.post('/:id/duplicate', requireAdmin, (req, res) => {
  if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
  const mag = magsQueries.findById(req.params.id);
  if (!mag) return res.status(404).render('error', { message: 'Mag not found', user: req.session.user });
  const newId = magsQueries.create({
    platform:         mag.platform || null,
    brand:            mag.brand,
    model:            mag.model || null,
    color:            mag.color || null,
    capacity:         mag.capacity || null,
    caliber:          mag.caliber || null,
    material:         mag.material || null,
    quantity:         mag.quantity || 1,
    basket:           mag.basket || null,
    storage_location: mag.storage_location || null,
    notes:            mag.notes || null,
  });
  res.redirect('/mags/' + newId);
});

// Delete
router.post('/:id/delete', requireAdmin, (req, res) => {
  if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
  const mag = magsQueries.findById(req.params.id);
  if (!mag) return res.status(404).render('error', { message: 'Mag not found', user: req.session.user });
  magsQueries.delete(req.params.id);
  res.redirect('/mags');
});

module.exports = router;
