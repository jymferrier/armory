const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const PHOTO_DIR = path.join(__dirname, '../uploads/photos');
const DOC_DIR = path.join(__dirname, '../uploads/documents');

[PHOTO_DIR, DOC_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOC_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const photoFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const extOk = /^\.(jpeg|jpg|png|gif|webp)$/.test(ext);
  // Accept explicit image MIME types (no SVG) or application/octet-stream as
  // a fallback for browsers that don't send the correct MIME type.
  const mimeOk = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype)
              || file.mimetype === 'application/octet-stream';
  if (extOk && mimeOk) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Please upload JPG, PNG, WEBP, or GIF.'));
  }
};

const docFilter = (req, file, cb) => {
  const allowed = /pdf|jpg|jpeg|png|gif|webp|doc|docx/;
  if (allowed.test(path.extname(file.originalname).toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported document format'));
  }
};

const uploadPhotos = multer({ storage: photoStorage, fileFilter: photoFilter, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadDocs = multer({ storage: docStorage, fileFilter: docFilter, limits: { fileSize: 50 * 1024 * 1024 } });

module.exports = { uploadPhotos, uploadDocs, PHOTO_DIR, DOC_DIR };
