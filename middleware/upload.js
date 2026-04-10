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
  const mimeOk = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype);
  if (extOk && mimeOk) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Please upload JPG, PNG, WEBP, or GIF.'));
  }
};

const DOC_ALLOWED_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.doc', '.docx']);
const DOC_ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const docFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (DOC_ALLOWED_EXTS.has(ext) && DOC_ALLOWED_MIMES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported document format. Allowed: PDF, JPG, PNG, GIF, WEBP, DOC, DOCX.'));
  }
};

const uploadPhotos = multer({ storage: photoStorage, fileFilter: photoFilter, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadDocs = multer({ storage: docStorage, fileFilter: docFilter, limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * Delete any files multer wrote to disk during a request that is being
 * rejected (e.g. CSRF failure). Covers req.file (single), req.files (array),
 * and req.files (object of arrays from fields()). Memory-storage uploads
 * have no path set, so they're silently skipped.
 */
function cleanupUploadedFiles(req) {
  const unlink = (f) => { if (f && f.path) try { fs.unlinkSync(f.path); } catch (_) {} };
  if (req.file) unlink(req.file);
  if (Array.isArray(req.files)) req.files.forEach(unlink);
  else if (req.files && typeof req.files === 'object') {
    Object.values(req.files).forEach(arr => arr.forEach(unlink));
  }
}

module.exports = { uploadPhotos, uploadDocs, PHOTO_DIR, DOC_DIR, cleanupUploadedFiles };
