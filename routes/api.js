const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { DOC_DIR, PHOTO_DIR } = require('../middleware/upload');
const { firearmsQueries, trustQueries } = require('../db');

router.use(requireAuth);

// Serve a photo — authenticated; verify record exists in DB
router.get('/photo/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const photo = firearmsQueries.findPhotoByFilename(filename);
  if (!photo) return res.status(404).end();
  const filepath = path.join(PHOTO_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  res.sendFile(filepath);
});

// Download a trust document — authenticated; verify record exists in DB
router.get('/trust-document/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const doc = trustQueries.findDocumentByFilename(filename);
  if (!doc) return res.status(404).json({ error: 'File not found' });
  const filepath = path.join(DOC_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  res.download(filepath, doc.original_name || filename);
});

// Download a document — verify record exists in DB before serving
router.get('/document/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // sanitize
  const doc = firearmsQueries.findDocumentByFilename(filename);
  if (!doc) return res.status(404).json({ error: 'File not found' });
  const filepath = path.join(DOC_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  res.download(filepath, doc.original_name || filename);
});

module.exports = router;
