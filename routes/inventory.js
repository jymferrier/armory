const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { firearmsQueries } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uploadPhotos, uploadDocs, PHOTO_DIR, DOC_DIR } = require('../middleware/upload');

const sanitizePrice = (val) => {
  if (!val) return null;
  const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : String(n);
};

const NFA_TYPES = new Set([
  'Suppressor/Silencer',
  'Short Barrel Rifle (SBR)',
  'Short Barrel Shotgun (SBS)',
  'Machine Gun',
  'Destructive Device (DD)',
  'Any Other Weapon (AOW)'
]);

const photoUpload = uploadPhotos.array('photos', 20);
const docUpload = uploadDocs.fields([
  { name: 'atf_form', maxCount: 5 },
  { name: 'form5320', maxCount: 5 },
  { name: 'additional_docs', maxCount: 20 }
]);

router.use(requireAuth);

// List
router.get('/', (req, res) => {
  const { q } = req.query;
  let firearms;
  if (q) {
    firearms = firearmsQueries.search(q);
    firearms = firearms.map(f => ({ ...f, is_nfa: !!f.is_nfa }));
  } else {
    firearms = firearmsQueries.all();
  }
  res.render('inventory', { user: req.session.user, firearms, q: q || '' });
});

function getFormSuggestions() {
  return {
    manufacturers: firearmsQueries.distinctManufacturers(),
    models: firearmsQueries.distinctModels(),
    calibers: firearmsQueries.distinctCalibers(),
    barrelLengths: firearmsQueries.distinctBarrelLengths(),
    acquiredFromList: firearmsQueries.distinctAcquiredFrom(),
    fflList: firearmsQueries.distinctFflTransferredFrom(),
    opticsTags: firearmsQueries.distinctOpticsTags(),
  };
}

// New form
router.get('/new', (req, res) => {
  res.render('firearm-form', { user: req.session.user, firearm: null, error: null, ...getFormSuggestions() });
});

// Create
router.post('/new', (req, res) => {
  photoUpload(req, res, (err) => {
    const manufacturers = firearmsQueries.distinctManufacturers();
    if (err) return res.render('firearm-form', { user: req.session.user, firearm: null, error: err.message, ...getFormSuggestions() });

    const {
      manufacturer, model, model_number, caliber, serial, barrel_length, overall_length, optics, date_acquired,
      acquired_from, price_paid, spouse_price, transfer_date, ffl_transferred_from,
      is_3d_printed,
      item_type, nfa_form_type, nfa_form_number, nfa_fmi, nfa_submit_date, nfa_tax_stamp_serial, nfa_approve_date, nfa_trust_name,
      is_disposed, date_disposed, disposal_method, notes, round_count
    } = req.body;

    const isNfa = NFA_TYPES.has(item_type);
    const hasSbrSbs = item_type === 'Short Barrel Rifle (SBR)' || item_type === 'Short Barrel Shotgun (SBS)';

    const firearmsId = firearmsQueries.create({
      manufacturer, model, model_number: model_number || null,
      caliber: caliber || null,
      serial: serial || null,
      barrel_length: barrel_length || null,
      overall_length: hasSbrSbs ? (overall_length || null) : null,
      optics: optics || null,
      date_acquired: date_acquired || null,
      acquired_from: acquired_from || null,
      price_paid: sanitizePrice(price_paid),
      spouse_price: sanitizePrice(spouse_price),
      transfer_date: transfer_date || null,
      ffl_transferred_from: ffl_transferred_from || null,
      is_3d_printed: is_3d_printed ? 1 : 0,
      is_nfa: isNfa ? 1 : 0,
      nfa_type: item_type || null,
      nfa_form_type: isNfa ? (nfa_form_type || null) : null,
      nfa_form_number: isNfa ? (nfa_form_number || null) : null,
      nfa_fmi: isNfa ? (nfa_fmi ? 1 : 0) : 0,
      nfa_submit_date: isNfa ? (nfa_submit_date || null) : null,
      nfa_tax_stamp_serial: isNfa ? (nfa_tax_stamp_serial || null) : null,
      nfa_approve_date: isNfa ? (nfa_approve_date || null) : null,
      nfa_trust_name: nfa_trust_name || null,
      is_disposed: is_disposed ? 1 : 0,
      date_disposed: is_disposed ? (date_disposed || null) : null,
      disposal_method: is_disposed ? (disposal_method || null) : null,
      notes: notes || null,
      round_count: parseInt(round_count, 10) || 0
    });

    if (req.files && req.files.length > 0) {
      req.files.forEach((f, i) => {
        firearmsQueries.addPhoto(firearmsId, f.filename, f.originalname, i === 0);
      });
    }

    res.redirect(`/inventory/${firearmsId}`);
  });
});


// View
router.get('/:id', (req, res) => {
  const firearm = firearmsQueries.findById(req.params.id);
  if (!firearm) return res.status(404).render('error', { message: 'Firearm not found', user: req.session.user });
  res.render('firearm-detail', { user: req.session.user, firearm });
});

// Edit form
router.get('/:id/edit', (req, res) => {
  const firearm = firearmsQueries.findById(req.params.id);
  if (!firearm) return res.status(404).render('error', { message: 'Firearm not found', user: req.session.user });
  res.render('firearm-form', { user: req.session.user, firearm, error: null, ...getFormSuggestions() });
});

// Update
router.post('/:id/edit', (req, res) => {
  const {
    manufacturer, model, model_number, caliber, serial, barrel_length, overall_length, optics, date_acquired,
    acquired_from, price_paid, spouse_price, transfer_date, ffl_transferred_from,
    is_3d_printed,
    item_type, nfa_form_type, nfa_form_number, nfa_fmi, nfa_submit_date, nfa_tax_stamp_serial, nfa_approve_date, nfa_trust_name,
    is_disposed, date_disposed, disposal_method, notes, round_count
  } = req.body;

  const isNfa = NFA_TYPES.has(item_type);
  const hasSbrSbs = item_type === 'Short Barrel Rifle (SBR)' || item_type === 'Short Barrel Shotgun (SBS)';

  firearmsQueries.update(req.params.id, {
    manufacturer, model, model_number: model_number || null,
    caliber: caliber || null,
    serial: serial || null,
    barrel_length: barrel_length || null,
    overall_length: hasSbrSbs ? (overall_length || null) : null,
    optics: optics || null,
    date_acquired: date_acquired || null,
    acquired_from: acquired_from || null,
    price_paid: price_paid || null,
    spouse_price: spouse_price || null,
    transfer_date: transfer_date || null,
    ffl_transferred_from: ffl_transferred_from || null,
    is_3d_printed: is_3d_printed ? 1 : 0,
    is_nfa: isNfa ? 1 : 0,
    nfa_type: item_type || null,
    nfa_form_type: isNfa ? (nfa_form_type || null) : null,
    nfa_form_number: isNfa ? (nfa_form_number || null) : null,
    nfa_fmi: isNfa ? (nfa_fmi ? 1 : 0) : 0,
    nfa_submit_date: isNfa ? (nfa_submit_date || null) : null,
    nfa_tax_stamp_serial: isNfa ? (nfa_tax_stamp_serial || null) : null,
    nfa_approve_date: isNfa ? (nfa_approve_date || null) : null,
    nfa_trust_name: nfa_trust_name || null,
    is_disposed: is_disposed ? 1 : 0,
    date_disposed: is_disposed ? (date_disposed || null) : null,
    disposal_method: is_disposed ? (disposal_method || null) : null,
    notes: notes || null,
    round_count: parseInt(round_count, 10) || 0
  });
  res.redirect(`/inventory/${req.params.id}`);
});

// Log rounds fired
router.post('/:id/rounds', (req, res) => {
  const add = parseInt(req.body.add_rounds, 10);
  if (add > 0) firearmsQueries.addRounds(req.params.id, add);
  res.redirect(`/inventory/${req.params.id}`);
});

// Delete
router.post('/:id/delete', (req, res) => {
  const firearm = firearmsQueries.findById(req.params.id);
  if (firearm) {
    [...firearm.photos, ...firearm.documents].forEach(f => {
      const dir = f.doc_type ? DOC_DIR : PHOTO_DIR;
      const fp = path.join(dir, f.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    firearmsQueries.delete(req.params.id);
  }
  res.redirect('/inventory');
});

// Upload photos
router.post('/:id/photos', (req, res) => {
  photoUpload(req, res, (err) => {
    if (err) return res.redirect(`/inventory/${req.params.id}?photoError=${encodeURIComponent(err.message)}`);
    if (req.files && req.files.length > 0) {
      const existing = firearmsQueries.findById(req.params.id);
      const hasPrimary = existing && existing.photos.some(p => p.is_primary);
      req.files.forEach((f, i) => {
        firearmsQueries.addPhoto(req.params.id, f.filename, f.originalname, !hasPrimary && i === 0);
      });
    }
    res.redirect(`/inventory/${req.params.id}`);
  });
});

// Set primary photo
router.post('/:id/photos/:photoId/primary', (req, res) => {
  firearmsQueries.setPrimaryPhoto(req.params.photoId, req.params.id);
  res.redirect(`/inventory/${req.params.id}`);
});

// Delete photo
router.post('/:id/photos/:photoId/delete', (req, res) => {
  const photo = firearmsQueries.deletePhoto(req.params.photoId);
  if (photo) {
    const fp = path.join(PHOTO_DIR, photo.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  res.redirect(`/inventory/${req.params.id}`);
});

// Upload documents
router.post('/:id/documents', (req, res) => {
  docUpload(req, res, (err) => {
    if (err) return res.redirect(`/inventory/${req.params.id}?docError=${encodeURIComponent(err.message)}`);
    const fields = { atf_form: 'ATF Form', form5320: 'Form 5320', additional_docs: 'Additional Document' };
    Object.entries(fields).forEach(([field, label]) => {
      if (req.files && req.files[field]) {
        req.files[field].forEach(f => {
          firearmsQueries.addDocument(req.params.id, field, f.filename, f.originalname);
        });
      }
    });
    res.redirect(`/inventory/${req.params.id}`);
  });
});

// Delete document
router.post('/:id/documents/:docId/delete', (req, res) => {
  const doc = firearmsQueries.deleteDocument(req.params.docId);
  if (doc) {
    const fp = path.join(DOC_DIR, doc.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  res.redirect(`/inventory/${req.params.id}`);
});

module.exports = router;
