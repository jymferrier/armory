const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { opticsQueries, firearmsQueries } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { uploadPhotos, PHOTO_DIR } = require('../middleware/upload');

const photoUpload = uploadPhotos.array('photos', 20);

router.use(requireAuth);

const OPTIC_TYPES = [
  'Riflescope',
  'LPVO (Low Power Variable Optic)',
  'Red Dot / Reflex',
  'Holographic',
  'Prism',
  'Night Vision',
  'Thermal',
  'Laser / IR',
  'Magnifier',
  'Other',
];

const MOUNT_TYPES = [
  'Rings',
  'Fixed Mount',
  'QD (Quick Detach)',
  'Cantilever',
  'Offset',
  'Picatinny Riser',
  'Dovetail',
  'Integrated',
  'Other',
];

// Types that show the magnification field
const MAG_TYPES = new Set(['Riflescope', 'LPVO (Low Power Variable Optic)', 'Prism', 'Magnifier']);

// List
router.get('/', (req, res) => {
  const q = req.query.q ? req.query.q.trim() : '';
  let items = opticsQueries.all();
  if (q) {
    const ql = q.toLowerCase();
    items = items.filter(o =>
      (o.manufacturer || '').toLowerCase().includes(ql) ||
      (o.model || '').toLowerCase().includes(ql) ||
      (o.optic_type || '').toLowerCase().includes(ql) ||
      (o.magnification || '').toLowerCase().includes(ql) ||
      (o.reticle || '').toLowerCase().includes(ql) ||
      (o.mount_type || '').toLowerCase().includes(ql) ||
      (o.mount_brand || '').toLowerCase().includes(ql) ||
      (o.mount_model || '').toLowerCase().includes(ql) ||
      (o.acquired_from || '').toLowerCase().includes(ql) ||
      (o.notes || '').toLowerCase().includes(ql)
    );
  }
  res.render('optics', { user: req.session.user, items, q });
});

function formLocals() {
  return {
    manufacturers: opticsQueries.distinctManufacturers(),
    models: opticsQueries.distinctModels(),
    acquiredFromList: opticsQueries.distinctAcquiredFrom(),
    firearms: firearmsQueries.allForDropdown(),
    opticTypes: OPTIC_TYPES,
    reticles: opticsQueries.distinctReticles(),
    mountTypes: MOUNT_TYPES,
    mountBrands: opticsQueries.distinctMountBrands(),
    mountModels: opticsQueries.distinctMountModels(),
  };
}

// New form
router.get('/new', requireAdmin, (req, res) => {
  res.render('optic-form', { user: req.session.user, optic: null, error: null, ...formLocals() });
});

// Create
router.post('/new', requireAdmin, (req, res) => {
  photoUpload(req, res, (err) => {
    if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });

    if (err) return res.render('optic-form', { user: req.session.user, optic: null, error: err.message, ...formLocals() });

    const { manufacturer, model, model_number, serial, optic_type, magnification, reticle, tube_size, mount_type, mount_brand, mount_model, mount_cant, acquired_from, date_acquired, price_paid, spouse_price, firearm_id, notes } = req.body;

    if (!manufacturer || !model) {
      return res.render('optic-form', { user: req.session.user, optic: req.body, error: 'Manufacturer and model are required.', ...formLocals() });
    }

    const id = opticsQueries.create({
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      model_number: model_number || null,
      serial: serial || null,
      optic_type: optic_type || null,
      magnification: magnification || null,
      reticle: reticle || null,
      tube_size: tube_size || null,
      mount_type: mount_type || null,
      mount_brand: mount_brand || null,
      mount_model: mount_model || null,
      mount_cant: mount_cant || null,
      acquired_from: acquired_from || null,
      date_acquired: date_acquired || null,
      price_paid: price_paid || null,
      spouse_price: spouse_price || null,
      firearm_id: firearm_id ? parseInt(firearm_id, 10) : null,
      notes: notes || null,
    });

    if (req.files && req.files.length > 0) {
      req.files.forEach((f, i) => {
        opticsQueries.addPhoto(id, f.filename, f.originalname, i === 0);
      });
    }

    res.redirect('/optics/' + id);
  });
});

// Detail
router.get('/:id', (req, res) => {
  const optic = opticsQueries.findById(req.params.id);
  if (!optic) return res.status(404).render('error', { message: 'Optic not found', user: req.session.user });
  const assignedFirearm = optic.firearm_id ? firearmsQueries.findById(optic.firearm_id) : null;
  res.render('optic-detail', { user: req.session.user, optic, assignedFirearm });
});

// Edit form
router.get('/:id/edit', requireAdmin, (req, res) => {
  const optic = opticsQueries.findById(req.params.id);
  if (!optic) return res.status(404).render('error', { message: 'Optic not found', user: req.session.user });
  res.render('optic-form', { user: req.session.user, optic, error: null, ...formLocals() });
});

// Update
router.post('/:id/edit', requireAdmin, (req, res) => {
  if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
  const optic = opticsQueries.findById(req.params.id);
  if (!optic) return res.status(404).render('error', { message: 'Optic not found', user: req.session.user });
  const { manufacturer, model, model_number, serial, optic_type, magnification, reticle, mount_type, mount_brand, mount_model, mount_cant, acquired_from, date_acquired, price_paid, spouse_price, firearm_id, notes } = req.body;
  if (!manufacturer || !model) {
    return res.render('optic-form', { user: req.session.user, optic: { ...optic, ...req.body }, error: 'Manufacturer and model are required.', ...formLocals() });
  }
  opticsQueries.update(req.params.id, {
    manufacturer: manufacturer.trim(),
    model: model.trim(),
    model_number: model_number || null,
    serial: serial || null,
    optic_type: optic_type || null,
    magnification: magnification || null,
    reticle: reticle || null,
    mount_type: mount_type || null,
    mount_brand: mount_brand || null,
    mount_model: mount_model || null,
    mount_cant: mount_cant || null,
    acquired_from: acquired_from || null,
    date_acquired: date_acquired || null,
    price_paid: price_paid || null,
    spouse_price: spouse_price || null,
    firearm_id: firearm_id ? parseInt(firearm_id, 10) : null,
    notes: notes || null,
  });
  res.redirect('/optics/' + req.params.id);
});

// Duplicate
router.post('/:id/duplicate', requireAdmin, (req, res) => {
  const optic = opticsQueries.findById(req.params.id);
  if (!optic) return res.status(404).render('error', { message: 'Optic not found', user: req.session.user });
  const newId = opticsQueries.create({
    manufacturer: optic.manufacturer,
    model: optic.model,
    model_number: optic.model_number || null,
    serial: null,
    optic_type: optic.optic_type || null,
    magnification: optic.magnification || null,
    reticle: optic.reticle || null,
    tube_size: optic.tube_size || null,
    mount_type: optic.mount_type || null,
    mount_brand: optic.mount_brand || null,
    mount_model: optic.mount_model || null,
    mount_cant: optic.mount_cant || null,
    acquired_from: optic.acquired_from || null,
    date_acquired: optic.date_acquired || null,
    price_paid: optic.price_paid || null,
    spouse_price: optic.spouse_price || null,
    firearm_id: optic.firearm_id || null,
    notes: optic.notes || null,
  });
  res.redirect('/optics/' + newId);
});

// Upload photos
router.post('/:id/photos', requireAdmin, (req, res) => {
  photoUpload(req, res, (err) => {
    if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
    const optic = opticsQueries.findById(req.params.id);
    if (!optic) return res.status(404).render('error', { message: 'Optic not found', user: req.session.user });
    if (err) return res.redirect(`/optics/${req.params.id}?photoError=${encodeURIComponent(err.message)}`);
    if (req.files && req.files.length > 0) {
      const hasPhotos = optic.photos && optic.photos.length > 0;
      req.files.forEach((f, i) => {
        opticsQueries.addPhoto(optic.id, f.filename, f.originalname, !hasPhotos && i === 0);
      });
    }
    res.redirect('/optics/' + req.params.id);
  });
});

// Set primary photo
router.post('/:id/photos/:photoId/primary', requireAdmin, (req, res) => {
  const optic = opticsQueries.findById(req.params.id);
  if (!optic) return res.status(404).render('error', { message: 'Optic not found', user: req.session.user });
  const photo = opticsQueries.findPhotoById(req.params.photoId);
  if (!photo || photo.optic_id !== parseInt(req.params.id, 10))
    return res.status(403).render('error', { message: 'Forbidden', user: req.session.user });
  opticsQueries.setPrimaryPhoto(req.params.photoId, req.params.id);
  res.redirect('/optics/' + req.params.id);
});

// Delete photo
router.post('/:id/photos/:photoId/delete', requireAdmin, (req, res) => {
  const optic = opticsQueries.findById(req.params.id);
  if (!optic) return res.status(404).render('error', { message: 'Optic not found', user: req.session.user });
  const photo = opticsQueries.findPhotoById(req.params.photoId);
  if (!photo || photo.optic_id !== parseInt(req.params.id, 10))
    return res.status(403).render('error', { message: 'Forbidden', user: req.session.user });
  opticsQueries.deletePhoto(req.params.photoId);
  const fp = path.join(PHOTO_DIR, photo.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.redirect('/optics/' + req.params.id);
});

// Delete optic
router.post('/:id/delete', requireAdmin, (req, res) => {
  if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
  const optic = opticsQueries.findById(req.params.id);
  if (!optic) return res.status(404).render('error', { message: 'Optic not found', user: req.session.user });
  // Delete all photos from disk
  if (optic.photos) {
    optic.photos.forEach(p => {
      const fp = path.join(PHOTO_DIR, p.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
  }
  opticsQueries.delete(req.params.id);
  res.redirect('/optics');
});

module.exports = router;
