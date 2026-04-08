const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { userQueries, firearmsQueries, trustQueries } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { PHOTO_DIR, DOC_DIR } = require('../middleware/upload');
const { audit } = require('../middleware/audit');

const archiver = require('archiver');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }).single('import_file');
const zipImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }).single('import_zip');

// Precomputed hash used for constant-time response when a username is not found,
// preventing timing-based username enumeration. Computed once at startup.
const DUMMY_HASH = bcrypt.hashSync('_armory_dummy_sentinel_', 12);

// ── Account lockout (in-memory; resets on restart) ──────────────────────────
const failedLogins = new Map();
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

function isLockedOut(username) {
  const entry = failedLogins.get(username.toLowerCase());
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil) failedLogins.delete(username.toLowerCase());
  return false;
}
function recordFailedLogin(username) {
  const key = username.toLowerCase();
  const entry = failedLogins.get(key) || { count: 0, lockedUntil: null };
  entry.count++;
  if (entry.count >= LOCKOUT_THRESHOLD) entry.lockedUntil = Date.now() + LOCKOUT_MS;
  failedLogins.set(key, entry);
}
function clearFailedLogins(username) { failedLogins.delete(username.toLowerCase()); }

// ── Password complexity ──────────────────────────────────────────────────────
function validatePasswordComplexity(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least one letter.';
  if (!/[0-9!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(password))
    return 'Password must contain at least one number or special character.';
  return null;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'ID', 'Manufacturer', 'Model', 'Caliber', 'Serial Number',
  'Barrel Length', 'Overall Length', 'Optics / Accessories',
  'Acquired Date', 'Acquired From', 'Price Paid', 'Transfer Date', 'FFL Transferred From',
  'Trust / Entity Name', '3D Printed', 'Is NFA', 'Item Type',
  'Form Type', 'Form Number', 'FMI',
  'Date Submitted to ATF', 'Tax Stamp / Form Serial', 'ATF Approval Date',
  'Is Disposed', 'Date Disposed', 'Disposal Method',
  'Notes', 'Date Added'
];

function csvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function parseOpticsToStr(raw) {
  if (!raw) return '';
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.join('; ') : raw; }
  catch (e) { return raw; }
}

function buildCsvRows(firearms) {
  return firearms.map(f => [
    f.id, f.manufacturer, f.model, f.caliber, f.serial,
    f.barrel_length, f.overall_length, parseOpticsToStr(f.optics),
    f.date_acquired, f.acquired_from, f.price_paid, f.transfer_date, f.ffl_transferred_from,
    f.nfa_trust_name, f.is_3d_printed ? 'Yes' : 'No',
    f.is_nfa ? 'Yes' : 'No', f.nfa_type,
    f.nfa_form_type, f.nfa_form_number, f.nfa_fmi ? 'Yes' : 'No',
    f.nfa_submit_date, f.nfa_tax_stamp_serial, f.nfa_approve_date,
    f.is_disposed ? 'Yes' : 'No', f.date_disposed, f.disposal_method,
    f.notes, f.created_at
  ].map(csvCell).join(','));
}

function parseCSV(text) {
  const lines = [];
  let current = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\r' && text[i + 1] === '\n') { current.push(field); if (current.some(Boolean) || lines.length) lines.push(current); current = []; field = ''; i++; }
      else if (ch === '\n') { current.push(field); if (current.some(Boolean) || lines.length) lines.push(current); current = []; field = ''; }
      else { field += ch; }
    }
  }
  if (field || current.length) { current.push(field); lines.push(current); }
  return lines;
}

// Sanitize imported records: cap string field lengths to prevent abuse
const FIELD_MAX_LEN = {
  manufacturer: 200, model: 200, caliber: 100, serial: 100,
  barrel_length: 50, overall_length: 50, optics: 2000,
  date_acquired: 20, acquired_from: 200, price_paid: 50,
  transfer_date: 20, ffl_transferred_from: 200,
  nfa_trust_name: 200, nfa_type: 100, nfa_form_type: 50,
  nfa_form_number: 100, nfa_submit_date: 20, nfa_tax_stamp_serial: 100,
  nfa_approve_date: 20, date_disposed: 20, disposal_method: 200,
  notes: 10000,
};
function sanitizeImportRecord(record) {
  for (const [key, maxLen] of Object.entries(FIELD_MAX_LEN)) {
    if (typeof record[key] === 'string' && record[key].length > maxLen) {
      record[key] = record[key].slice(0, maxLen);
    }
  }
  return record;
}

function csvRowToFirearm(headers, row) {
  const get = (col) => { const i = headers.indexOf(col); return i >= 0 ? (row[i] || '').trim() : ''; };
  const bool = (col) => get(col).toLowerCase() === 'yes';
  const opt = (col) => get(col) || null;
  const opticsRaw = get('Optics / Accessories');
  const opticsTags = opticsRaw ? opticsRaw.split(';').map(s => s.trim()).filter(Boolean) : [];
  const NFA_TYPES = new Set(['Suppressor/Silencer','Short Barrel Rifle (SBR)','Short Barrel Shotgun (SBS)','Machine Gun','Destructive Device (DD)','Any Other Weapon (AOW)']);
  const itemType = opt('Item Type');
  const isNfa = NFA_TYPES.has(itemType);
  return {
    manufacturer: get('Manufacturer') || 'Unknown',
    model: get('Model') || 'Unknown',
    caliber: opt('Caliber'), serial: opt('Serial Number'),
    barrel_length: opt('Barrel Length'), overall_length: opt('Overall Length'),
    optics: opticsTags.length ? JSON.stringify(opticsTags) : null,
    date_acquired: opt('Acquired Date'), acquired_from: opt('Acquired From'),
    price_paid: opt('Price Paid'), transfer_date: opt('Transfer Date'),
    ffl_transferred_from: opt('FFL Transferred From'),
    nfa_trust_name: opt('Trust / Entity Name'),
    is_3d_printed: bool('3D Printed') ? 1 : 0,
    is_nfa: isNfa ? 1 : 0, nfa_type: itemType,
    nfa_form_type: opt('Form Type'), nfa_form_number: opt('Form Number'),
    nfa_fmi: bool('FMI') ? 1 : 0,
    nfa_submit_date: opt('Date Submitted to ATF'),
    nfa_tax_stamp_serial: opt('Tax Stamp / Form Serial'),
    nfa_approve_date: opt('ATF Approval Date'),
    is_disposed: bool('Is Disposed') ? 1 : 0,
    date_disposed: opt('Date Disposed'), disposal_method: opt('Disposal Method'),
    notes: opt('Notes')
  };
}

function jsonRecordToFirearm(r) {
  const NFA_TYPES = new Set(['Suppressor/Silencer','Short Barrel Rifle (SBR)','Short Barrel Shotgun (SBS)','Machine Gun','Destructive Device (DD)','Any Other Weapon (AOW)']);
  const itemType = r.nfa_type || r.item_type || null;
  const isNfa = NFA_TYPES.has(itemType);
  const optics = Array.isArray(r.optics) ? JSON.stringify(r.optics) : (r.optics || null);
  return {
    manufacturer: r.manufacturer || 'Unknown',
    model: r.model || 'Unknown',
    caliber: r.caliber || null, serial: r.serial || null,
    barrel_length: r.barrel_length || null, overall_length: r.overall_length || null,
    optics,
    date_acquired: r.date_acquired || null, acquired_from: r.acquired_from || null,
    price_paid: r.price_paid || null, transfer_date: r.transfer_date || null,
    ffl_transferred_from: r.ffl_transferred_from || null,
    nfa_trust_name: r.nfa_trust_name || null,
    is_3d_printed: r.is_3d_printed ? 1 : 0,
    is_nfa: isNfa ? 1 : 0, nfa_type: itemType,
    nfa_form_type: r.nfa_form_type || null, nfa_form_number: r.nfa_form_number || null,
    nfa_fmi: r.nfa_fmi ? 1 : 0,
    nfa_submit_date: r.nfa_submit_date || null,
    nfa_tax_stamp_serial: r.nfa_tax_stamp_serial || null,
    nfa_approve_date: r.nfa_approve_date || null,
    is_disposed: r.is_disposed ? 1 : 0,
    date_disposed: r.date_disposed || null, disposal_method: r.disposal_method || null,
    notes: r.notes || null
  };
}

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

  if (isLockedOut(username)) {
    audit(req, 'LOGIN_LOCKED', username);
    return res.render('login', { error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
  }

  const user = userQueries.findByUsername(username);
  if (!user) {
    // Run a dummy compare so response time is indistinguishable from a wrong
    // password — prevents timing-based username enumeration.
    bcrypt.compareSync(password, DUMMY_HASH);
    recordFailedLogin(username);
    audit(req, 'LOGIN_FAILURE', username);
    return res.render('login', { error: 'Invalid username or password' });
  }
  if (!bcrypt.compareSync(password, user.password)) {
    recordFailedLogin(username);
    audit(req, 'LOGIN_FAILURE', username);
    return res.render('login', { error: 'Invalid username or password' });
  }

  clearFailedLogins(username);
  const returnTo = req.session.returnTo || '/inventory';
  // Regenerate session on login to prevent session fixation
  req.session.regenerate((err) => {
    if (err) return res.render('login', { error: 'Session error. Please try again.' });
    req.session.user = {
      id: user.id,
      username: user.username,
      is_spouse_view: !!user.is_spouse_view,
      session_version: user.session_version || 0
    };
    audit(req, 'LOGIN_SUCCESS', username);
    // Validate returnTo: resolve to a safe local path (prevents open redirects via //, /%2f, etc.)
    let safeTo = '/inventory';
    if (typeof returnTo === 'string' && returnTo.startsWith('/')) {
      try {
        const parsed = new URL(returnTo, 'http://localhost');
        // Only allow same-origin paths (no protocol-relative or absolute URLs)
        if (parsed.hostname === 'localhost' && parsed.pathname.startsWith('/')) {
          safeTo = parsed.pathname + parsed.search + parsed.hash;
        }
      } catch (_) { /* malformed URL — use default */ }
    }
    res.redirect(safeTo);
  });
});

router.get('/logout', (req, res) => {
  audit(req, 'LOGOUT', '');
  req.session.destroy(() => res.redirect('/login'));
});

// User management (admin only - first user is admin)
function settingsLocals(sessionUser) {
  return {
    user: sessionUser,
    users: userQueries.all(),
    allFirearms: firearmsQueries.all(),
  };
}

router.get('/settings', requireAuth, (req, res) => {
  res.render('settings', { ...settingsLocals(req.session.user), message: null });
});

router.post('/settings/add-user', requireAuth, requireAdmin, (req, res) => {
  const { username, password } = req.body;
  if (!username || !/^[a-zA-Z0-9_]{1,50}$/.test(username)) {
    return res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text: 'Username must be 1–50 characters: letters, numbers, and underscores only.' } });
  }
  const complexityError = validatePasswordComplexity(password);
  if (complexityError) {
    return res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text: complexityError } });
  }
  try {
    userQueries.create(username, password);
    audit(req, 'USER_CREATE', username);
    res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'success', text: `User "${username}" created` } });
  } catch (e) {
    res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text: 'Username already exists' } });
  }
});

router.post('/settings/delete-user', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.body;
  if (parseInt(id) === req.session.user.id) {
    return res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text: 'Cannot delete your own account' } });
  }
  const target = userQueries.all().find(u => u.id === parseInt(id));
  userQueries.delete(id);
  audit(req, 'USER_DELETE', target ? target.username : `id=${id}`);
  res.redirect('/settings');
});

router.post('/settings/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = userQueries.findByUsername(req.session.user.username);
  const complexityError = validatePasswordComplexity(new_password);
  if (complexityError) {
    return res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text: complexityError } });
  }
  if (!bcrypt.compareSync(current_password, user.password)) {
    audit(req, 'PASSWORD_CHANGE_FAIL', user.username);
    return res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text: 'Current password is incorrect' } });
  }
  userQueries.updatePassword(req.session.user.id, new_password);
  // Increment session_version to invalidate all other active sessions for this user
  userQueries.incrementSessionVersion(req.session.user.id);
  audit(req, 'PASSWORD_CHANGE', user.username);
  // Regenerate current session
  req.session.regenerate((err) => {
    if (err) return res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text: 'Password updated but session reset failed.' } });
    req.session.user = { id: user.id, username: user.username, is_spouse_view: !!user.is_spouse_view, session_version: (user.session_version || 0) + 1 };
    res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'success', text: 'Password updated successfully.' } });
  });
});

// Set/unset spouse view for a user (admin only)
router.post('/settings/set-spouse-view', requireAuth, requireAdmin, (req, res) => {
  const { id, is_spouse_view } = req.body;
  if (parseInt(id) === req.session.user.id) {
    return res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text: 'Cannot change your own account type.' } });
  }
  userQueries.setSpouseView(id, parseInt(is_spouse_view));
  // Bump session_version so the affected user's active sessions are invalidated immediately
  userQueries.incrementSessionVersion(id);
  const target = userQueries.all().find(u => u.id === parseInt(id));
  audit(req, 'ROLE_CHANGE', `${target ? target.username : 'id=' + id} spouse_view=${is_spouse_view}`);
  res.redirect('/settings');
});

// Save spouse-visible item selection (admin only)
router.post('/settings/spouse-items', requireAuth, requireAdmin, (req, res) => {
  const ids = [].concat(req.body.items || []).map(Number).filter(Boolean);
  firearmsQueries.setAllSpouseVisible(ids);
  res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'success', text: 'Spouse visibility updated.' } });
});

// Export CSV
router.get('/settings/export/csv', requireAuth, requireAdmin, (req, res) => {
  const firearms = firearmsQueries.all();
  audit(req, 'EXPORT_CSV', `${firearms.length} records`);
  const csv = [CSV_COLUMNS.map(csvCell).join(','), ...buildCsvRows(firearms)].join('\r\n');
  const filename = `armory-export-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// Export JSON
router.get('/settings/export/json', requireAuth, requireAdmin, (req, res) => {
  const firearms = firearmsQueries.all();
  audit(req, 'EXPORT_JSON', `${firearms.length} records`);
  const data = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    count: firearms.length,
    firearms: firearms.map(f => ({
      manufacturer: f.manufacturer, model: f.model,
      caliber: f.caliber, serial: f.serial,
      barrel_length: f.barrel_length, overall_length: f.overall_length,
      optics: (() => { try { const p = JSON.parse(f.optics); return Array.isArray(p) ? p : [f.optics]; } catch(e) { return f.optics ? [f.optics] : []; } })(),
      date_acquired: f.date_acquired, acquired_from: f.acquired_from,
      price_paid: f.price_paid, transfer_date: f.transfer_date,
      ffl_transferred_from: f.ffl_transferred_from,
      nfa_trust_name: f.nfa_trust_name,
      is_3d_printed: !!f.is_3d_printed,
      is_nfa: !!f.is_nfa, nfa_type: f.nfa_type,
      nfa_form_type: f.nfa_form_type, nfa_form_number: f.nfa_form_number,
      nfa_fmi: !!f.nfa_fmi,
      nfa_submit_date: f.nfa_submit_date,
      nfa_tax_stamp_serial: f.nfa_tax_stamp_serial,
      nfa_approve_date: f.nfa_approve_date,
      is_disposed: !!f.is_disposed,
      date_disposed: f.date_disposed, disposal_method: f.disposal_method,
      notes: f.notes
    }))
  };
  const filename = `armory-export-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(data, null, 2));
});

// Full export — one folder per item, all photos + docs, zipped
router.get('/settings/export/full', requireAuth, requireAdmin, (req, res) => {
  audit(req, 'EXPORT_FULL', '');
  const firearms = firearmsQueries.all().map(f => firearmsQueries.findById(f.id)); // get with photos + docs

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `armory-full-export-${dateStr}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { if (!res.headersSent) res.status(500).end(); });
  archive.pipe(res);

  const slug = (f) => {
    const safe = (s) => (s || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
    return String(f.id).padStart(4, '0') + '-' + safe(f.manufacturer) + '-' + safe(f.model);
  };

  firearms.forEach(f => {
    const dir = slug(f);

    // firearm.json — full metadata
    const meta = { ...f };
    delete meta.photos;
    delete meta.documents;
    try { meta.optics = JSON.parse(f.optics); } catch(e) {}
    archive.append(JSON.stringify(meta, null, 2), { name: `${dir}/firearm.json` });

    // photos
    if (f.photos && f.photos.length > 0) {
      f.photos.forEach(p => {
        const src = path.join(PHOTO_DIR, p.filename);
        if (fs.existsSync(src)) {
          const ext = path.extname(p.original_name || p.filename);
          const label = p.is_primary ? `primary${ext}` : p.original_name || p.filename;
          archive.file(src, { name: `${dir}/photos/${label}` });
        }
      });
    }

    // documents — stored under documents/{doc_type}/ for round-trip import
    if (f.documents && f.documents.length > 0) {
      f.documents.forEach(d => {
        const src = path.join(DOC_DIR, d.filename);
        if (fs.existsSync(src)) {
          archive.file(src, { name: `${dir}/documents/${d.doc_type}/${d.original_name || d.filename}` });
        }
      });
    }
  });

  archive.finalize();
});

// Import
router.post('/settings/import', requireAuth, requireAdmin, (req, res) => {
  importUpload(req, res, (err) => {
    const fail = (text) => res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text } });

    if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
    if (err) return fail('Upload error. Check the file and try again.');
    if (!req.file) return fail('No file selected.');

    const ext = path.extname(req.file.originalname).toLowerCase();
    const text = req.file.buffer.toString('utf8');
    let records = [];

    try {
      if (ext === '.json') {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : (parsed.firearms || []);
        if (!Array.isArray(arr) || arr.length === 0) return fail('JSON file contains no records.');
        records = arr.map(jsonRecordToFirearm).map(sanitizeImportRecord);
      } else if (ext === '.csv') {
        const rows = parseCSV(text);
        if (rows.length < 2) return fail('CSV file contains no data rows.');
        const headers = rows[0];
        records = rows.slice(1).filter(r => r.some(Boolean)).map(r => sanitizeImportRecord(csvRowToFirearm(headers, r)));
      } else {
        return fail('Unsupported file type. Please upload a .csv or .json file.');
      }
    } catch (e) {
      return fail('Failed to parse file. Ensure it is a valid CSV or JSON export.');
    }

    let imported = 0;
    for (const record of records) {
      try { firearmsQueries.create(record); imported++; } catch (e) { /* skip bad rows */ }
    }

    audit(req, 'IMPORT', `${imported}/${records.length} records`);
    res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'success', text: `Imported ${imported} of ${records.length} records.` } });
  });
});

// Import ZIP archive
router.post('/settings/import/zip', requireAuth, requireAdmin, (req, res) => {
  zipImportUpload(req, res, (err) => {
    const fail = (text) => res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text } });

    if (!validateCsrf(req)) return res.status(403).render('error', { message: 'Security token validation failed.', user: req.session.user });
    if (err) return fail('Upload error. Check the file and try again.');
    if (!req.file) return fail('No file selected.');

    let zip;
    try { zip = new AdmZip(req.file.buffer); }
    catch (e) { return fail('Invalid or corrupted ZIP file.'); }

    // Zip bomb protection
    const entries = zip.getEntries();
    const MAX_ENTRIES = 5000;
    const MAX_UNCOMPRESSED = 500 * 1024 * 1024; // 500 MB
    if (entries.length > MAX_ENTRIES) {
      return fail(`ZIP contains too many entries (${entries.length}). Maximum allowed is ${MAX_ENTRIES}.`);
    }
    // Measure actual decompressed size — e.header.size is user-controlled metadata
    // in the ZIP central directory and cannot be trusted for zip-bomb detection.
    let totalUncompressed = 0;
    for (const e of entries) {
      if (e.isDirectory) continue;
      totalUncompressed += e.getData().length;
      if (totalUncompressed > MAX_UNCOMPRESSED) {
        return fail('ZIP uncompressed content exceeds the 500 MB safety limit.');
      }
    }

    const VALID_DOC_TYPES = new Set(['atf_form', 'form5320', 'additional_docs']);

    // Group entries by top-level folder
    const folders = {};
    zip.getEntries().forEach(entry => {
      const parts = entry.entryName.split('/');
      if (parts.length < 2) return;
      const folder = parts[0];
      if (!folders[folder]) folders[folder] = [];
      folders[folder].push(entry);
    });

    let imported = 0, skipped = 0;

    for (const [folder, folderEntries] of Object.entries(folders)) {
      const metaEntry = folderEntries.find(e => e.entryName === `${folder}/firearm.json`);
      if (!metaEntry) { skipped++; continue; }

      let meta;
      try { meta = JSON.parse(metaEntry.getData().toString('utf8')); }
      catch (e) { skipped++; continue; }

      const data = sanitizeImportRecord({
        ...jsonRecordToFirearm(meta),
        model_number: meta.model_number || null,
        round_count: meta.round_count || 0,
        spouse_price: meta.spouse_price || null,
      });

      let firearmsId;
      try { firearmsId = firearmsQueries.create(data); }
      catch (e) { skipped++; continue; }

      // Import photos
      let primarySet = false;
      folderEntries
        .filter(e => e.entryName.startsWith(`${folder}/photos/`) && !e.isDirectory)
        .forEach(photoEntry => {
          const basename = path.basename(photoEntry.entryName);
          const ext = path.extname(basename);
          const newFilename = uuidv4() + ext;
          try {
            fs.writeFileSync(path.join(PHOTO_DIR, newFilename), photoEntry.getData());
            const isPrimary = basename.startsWith('primary') && !primarySet;
            if (isPrimary) primarySet = true;
            firearmsQueries.addPhoto(firearmsId, newFilename, basename, isPrimary);
          } catch (e) { /* skip bad photo */ }
        });

      // Import documents — subfolders are doc_type
      folderEntries
        .filter(e => e.entryName.startsWith(`${folder}/documents/`) && !e.isDirectory)
        .forEach(docEntry => {
          const parts = docEntry.entryName.split('/');
          // folder/documents/docType/filename (new format) or folder/documents/filename (legacy)
          let docType, basename;
          if (parts.length >= 4 && VALID_DOC_TYPES.has(parts[2])) {
            docType = parts[2];
            basename = path.basename(parts.slice(3).join('/'));
          } else {
            docType = 'additional_docs';
            basename = path.basename(parts[parts.length - 1]);
          }
          const ext = path.extname(basename);
          const newFilename = uuidv4() + ext;
          try {
            fs.writeFileSync(path.join(DOC_DIR, newFilename), docEntry.getData());
            firearmsQueries.addDocument(firearmsId, docType, newFilename, basename);
          } catch (e) { /* skip bad doc */ }
        });

      imported++;
    }

    const skippedNote = skipped ? `, ${skipped} folder${skipped !== 1 ? 's' : ''} skipped` : '';
    audit(req, 'IMPORT_ZIP', `${imported} items imported`);
    res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'success', text: `ZIP import complete: ${imported} item${imported !== 1 ? 's' : ''} imported${skippedNote}.` } });
  });
});

// Purge database
router.post('/settings/purge', requireAuth, requireAdmin, (req, res) => {
  const fail = (text) => res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'error', text } });

  if (req.body.confirm !== 'BOATING ACCIDENT') return fail('Incorrect confirmation. Type BOATING ACCIDENT exactly to proceed.');

  // Delete all photo and document files
  const firearms = firearmsQueries.all();
  for (const f of firearms) {
    if (f.primary_photo) {
      const fp = path.join(PHOTO_DIR, f.primary_photo.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  }
  // Wipe all files in upload dirs
  for (const dir of [PHOTO_DIR, DOC_DIR]) {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => {
        try { fs.unlinkSync(path.join(dir, file)); } catch (e) {}
      });
    }
  }

  // Delete all firearm records (cascade handles photos + documents)
  firearmsQueries.all().forEach(f => firearmsQueries.delete(f.id));

  // Delete all trust records
  trustQueries.all().forEach(t => trustQueries.delete(t.id));

  audit(req, 'PURGE', 'ALL INVENTORY AND TRUST DATA DELETED');
  res.render('settings', { ...settingsLocals(req.session.user), message: { type: 'success', text: 'All inventory and trust records have been purged.' } });
});

module.exports = router;
