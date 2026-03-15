const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { DOC_DIR } = require('../middleware/upload');

router.use(requireAuth);

// Download a document
router.get('/document/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // sanitize
  const filepath = path.join(DOC_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  res.download(filepath);
});

module.exports = router;
