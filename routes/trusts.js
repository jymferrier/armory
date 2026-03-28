const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { trustQueries, firearmsQueries } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { uploadDocs, DOC_DIR } = require('../middleware/upload');

const trustDocUpload = uploadDocs.single('trust_doc');

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
router.get('/new', requireAdmin, (req, res) => {
  const suggestions = trustQueries.distinctTrustNames();
  res.render('trust-form', { user: req.session.user, trust: null, suggestions, error: null });
});

// Create trust
router.post('/new', requireAdmin, (req, res) => {
  const { name, settlor_name, settlor_location, agreement_date, notes } = req.body;
  try {
    trustQueries.create({ name: name.trim(), settlor_name: settlor_name || null, settlor_location: settlor_location || null, agreement_date: agreement_date || null, notes: notes || null });
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
  res.render('trust-detail', { user: req.session.user, trust, items, saved: !!req.query.saved, detailsRequired: req.query.details_required || null, docError: req.query.docError || null });
});

// Update metadata
router.post('/:id', requireAdmin, (req, res) => {
  const trust = trustQueries.findById(req.params.id);
  if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });
  const { settlor_name, settlor_location, agreement_date, notes } = req.body;
  trustQueries.update(req.params.id, { settlor_name: settlor_name || null, settlor_location: settlor_location || null, agreement_date: agreement_date || null, notes: notes || null });
  res.redirect('/trusts/' + req.params.id + '?saved=1');
});

// Print assignment document (HTML preview)
router.get('/:id/assignment', (req, res) => {
  const trust = trustQueries.findById(req.params.id);
  if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });

  const missing = [];
  if (!trust.settlor_name)     missing.push('Settlor Name');
  if (!trust.settlor_location) missing.push('Settlor Location');
  if (!trust.agreement_date)   missing.push('Trust Agreement Date');
  if (missing.length > 0) {
    return res.redirect('/trusts/' + req.params.id + '?details_required=' + encodeURIComponent(missing.join(', ')));
  }

  const allItems = trustQueries.itemsForTrust(trust.name);
  const rawIds = [].concat(req.query.items || []).map(Number).filter(Boolean);
  const items = rawIds.length > 0 ? allItems.filter(f => rawIds.includes(f.id)) : allItems;
  res.render('trust-print', { user: req.session.user, trust, items });
});

// Download assignment document as PDF
router.get('/:id/assignment/pdf', async (req, res) => {
  const trust = trustQueries.findById(req.params.id);
  if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });

  const missing = [];
  if (!trust.settlor_name)     missing.push('Settlor Name');
  if (!trust.settlor_location) missing.push('Settlor Location');
  if (!trust.agreement_date)   missing.push('Trust Agreement Date');
  if (missing.length > 0) {
    return res.redirect('/trusts/' + req.params.id + '?details_required=' + encodeURIComponent(missing.join(', ')));
  }

  const allItems = trustQueries.itemsForTrust(trust.name);
  const rawIds = [].concat(req.query.items || []).map(Number).filter(Boolean);
  const items = rawIds.length > 0 ? allItems.filter(f => rawIds.includes(f.id)) : allItems;

  let browser;
  try {
    const ejs = require('ejs');
    const puppeteer = require('puppeteer-core');

    const html = await ejs.renderFile(
      path.join(__dirname, '../views/trust-print.ejs'),
      { user: req.session.user, trust, items, pdfMode: true, cspNonce: '' },
      { async: true }
    );

    browser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.65in', right: '0.65in', bottom: '0.65in', left: '0.65in' }
    });

    const filename = 'Assignment to ' + trust.name.replace(/[^a-zA-Z0-9 _-]/g, '') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(pdf);
  } catch (e) {
    console.error('PDF generation error:', e);
    res.status(500).render('error', { message: 'PDF generation failed. Please try again.', user: req.session.user });
  } finally {
    if (browser) await browser.close();
  }
});

// Upload primary trust document (replaces existing)
router.post('/:id/trust-document', requireAdmin, (req, res) => {
  trustDocUpload(req, res, (err) => {
    if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
    const trust = trustQueries.findById(req.params.id);
    if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });
    if (err) return res.redirect(`/trusts/${req.params.id}?docError=${encodeURIComponent(err.message)}`);
    if (!req.file) return res.redirect(`/trusts/${req.params.id}`);
    // Delete old primary doc file if it exists
    const oldDocs = trustQueries.replaceTrustDoc(req.params.id, req.file.filename, req.file.originalname);
    oldDocs.forEach(doc => {
      const fp = path.join(DOC_DIR, doc.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    res.redirect(`/trusts/${req.params.id}`);
  });
});

// Upload additional trust document
router.post('/:id/documents', requireAdmin, (req, res) => {
  trustDocUpload(req, res, (err) => {
    if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
    const trust = trustQueries.findById(req.params.id);
    if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });
    if (err) return res.redirect(`/trusts/${req.params.id}?docError=${encodeURIComponent(err.message)}`);
    if (!req.file) return res.redirect(`/trusts/${req.params.id}`);
    trustQueries.addDocument(req.params.id, req.file.filename, req.file.originalname, 'additional');
    res.redirect(`/trusts/${req.params.id}`);
  });
});

// Delete trust document (primary or additional)
router.post('/:id/documents/:docId/delete', requireAdmin, (req, res) => {
  const doc = trustQueries.findDocumentById(req.params.docId);
  if (!doc || doc.trust_id !== parseInt(req.params.id, 10))
    return res.status(403).render('error', { message: 'Forbidden', user: req.session.user });
  trustQueries.deleteDocument(req.params.docId);
  const fp = path.join(DOC_DIR, doc.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.redirect(`/trusts/${req.params.id}`);
});

// Toggle trust_assigned flag on a firearm
router.post('/:id/firearms/:firearmsId/assign', requireAdmin, (req, res) => {
  const trust = trustQueries.findById(req.params.id);
  if (!trust) return res.status(404).render('error', { message: 'Trust not found', user: req.session.user });
  const firearm = firearmsQueries.findById(req.params.firearmsId);
  if (!firearm || firearm.nfa_trust_name !== trust.name)
    return res.status(403).render('error', { message: 'Forbidden', user: req.session.user });
  firearmsQueries.setTrustAssigned(req.params.firearmsId, !firearm.trust_assigned);
  res.redirect(`/trusts/${req.params.id}`);
});

// Delete
router.post('/:id/delete', requireAdmin, (req, res) => {
  trustQueries.delete(req.params.id);
  res.redirect('/trusts');
});

module.exports = router;
