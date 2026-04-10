const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'armory.db');
let db;

function getDB() {
  if (!db) db = new Database(DB_PATH);
  return db;
}

function initDB() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS firearms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manufacturer TEXT NOT NULL,
      model TEXT NOT NULL,
      caliber TEXT,
      serial TEXT,
      barrel_length TEXT,
      overall_length TEXT,
      optics TEXT,
      date_acquired TEXT,
      acquired_from TEXT,
      price_paid TEXT,
      transfer_date TEXT,
      ffl_transferred_from TEXT,
      is_3d_printed INTEGER DEFAULT 0,
      is_nfa INTEGER DEFAULT 0,
      nfa_type TEXT,
      nfa_form_type TEXT,
      nfa_form_number TEXT,
      nfa_fmi INTEGER DEFAULT 0,
      nfa_submit_date TEXT,
      nfa_tax_stamp_serial TEXT,
      nfa_approve_date TEXT,
      nfa_trust_name TEXT,
      is_disposed INTEGER DEFAULT 0,
      date_disposed TEXT,
      disposal_method TEXT,
      notes TEXT,
      model_number TEXT,
      round_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS firearm_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firearm_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      is_primary INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS firearm_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firearm_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (firearm_id) REFERENCES firearms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trusts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      settlor_name TEXT,
      settlor_location TEXT,
      agreement_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trust_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trust_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trust_id) REFERENCES trusts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT,
      brand TEXT NOT NULL,
      model TEXT,
      color TEXT,
      capacity INTEGER,
      caliber TEXT,
      material TEXT,
      quantity INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS optics_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manufacturer TEXT NOT NULL,
      model TEXT NOT NULL,
      model_number TEXT,
      optic_type TEXT,
      magnification TEXT,
      acquired_from TEXT,
      date_acquired TEXT,
      price_paid TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS optics_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      optic_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      is_primary INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (optic_id) REFERENCES optics_items(id) ON DELETE CASCADE
    );
  `);

  // Migration tracking — each migration runs at most once and is recorded by name.
  // On first startup with the new tracking system, existing columns cause the ALTER TABLE
  // to fail; we still record the migration as applied so it is never retried.
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const migrations = [
    { name: '001_firearms_barrel_length',        sql: 'ALTER TABLE firearms ADD COLUMN barrel_length TEXT' },
    { name: '002_firearms_date_acquired',         sql: 'ALTER TABLE firearms ADD COLUMN date_acquired TEXT' },
    { name: '003_firearms_nfa_form_number',       sql: 'ALTER TABLE firearms ADD COLUMN nfa_form_number TEXT' },
    { name: '004_firearms_nfa_submit_date',       sql: 'ALTER TABLE firearms ADD COLUMN nfa_submit_date TEXT' },
    { name: '005_firearms_nfa_tax_stamp_serial',  sql: 'ALTER TABLE firearms ADD COLUMN nfa_tax_stamp_serial TEXT' },
    { name: '006_firearms_nfa_approve_date',      sql: 'ALTER TABLE firearms ADD COLUMN nfa_approve_date TEXT' },
    { name: '007_firearms_nfa_trust_name',        sql: 'ALTER TABLE firearms ADD COLUMN nfa_trust_name TEXT' },
    { name: '008_firearms_is_disposed',           sql: 'ALTER TABLE firearms ADD COLUMN is_disposed INTEGER DEFAULT 0' },
    { name: '009_firearms_date_disposed',         sql: 'ALTER TABLE firearms ADD COLUMN date_disposed TEXT' },
    { name: '010_firearms_disposal_method',       sql: 'ALTER TABLE firearms ADD COLUMN disposal_method TEXT' },
    { name: '011_firearms_overall_length',        sql: 'ALTER TABLE firearms ADD COLUMN overall_length TEXT' },
    { name: '012_firearms_is_3d_printed',         sql: 'ALTER TABLE firearms ADD COLUMN is_3d_printed INTEGER DEFAULT 0' },
    { name: '013_firearms_nfa_form_type',         sql: 'ALTER TABLE firearms ADD COLUMN nfa_form_type TEXT' },
    { name: '014_firearms_nfa_fmi',               sql: 'ALTER TABLE firearms ADD COLUMN nfa_fmi INTEGER DEFAULT 0' },
    { name: '015_firearms_acquired_from',         sql: 'ALTER TABLE firearms ADD COLUMN acquired_from TEXT' },
    { name: '016_firearms_price_paid',            sql: 'ALTER TABLE firearms ADD COLUMN price_paid TEXT' },
    { name: '017_firearms_transfer_date',         sql: 'ALTER TABLE firearms ADD COLUMN transfer_date TEXT' },
    { name: '018_firearms_ffl_transferred_from',  sql: 'ALTER TABLE firearms ADD COLUMN ffl_transferred_from TEXT' },
    { name: '019_firearms_round_count',           sql: 'ALTER TABLE firearms ADD COLUMN round_count INTEGER DEFAULT 0' },
    { name: '020_firearms_model_number',          sql: 'ALTER TABLE firearms ADD COLUMN model_number TEXT' },
    { name: '021_firearms_spouse_price',          sql: 'ALTER TABLE firearms ADD COLUMN spouse_price TEXT' },
    { name: '022_users_is_spouse_view',           sql: 'ALTER TABLE users ADD COLUMN is_spouse_view INTEGER DEFAULT 0' },
    { name: '023_firearms_spouse_visible',        sql: 'ALTER TABLE firearms ADD COLUMN spouse_visible INTEGER DEFAULT 0' },
    { name: '024_users_session_version',          sql: 'ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 0' },
    { name: '025_firearms_trust_assigned',        sql: 'ALTER TABLE firearms ADD COLUMN trust_assigned INTEGER DEFAULT 0' },
    { name: '026_trusts_notes',                   sql: 'ALTER TABLE trusts ADD COLUMN notes TEXT' },
    { name: '027_trust_documents_doc_type',       sql: "ALTER TABLE trust_documents ADD COLUMN doc_type TEXT DEFAULT 'additional'" },
    { name: '028_trusts_trust_type',              sql: "ALTER TABLE trusts ADD COLUMN trust_type TEXT DEFAULT 'NFA'" },
    { name: '029_firearms_non_nfa_trust_name',    sql: 'ALTER TABLE firearms ADD COLUMN non_nfa_trust_name TEXT' },
    { name: '030_firearms_non_nfa_trust_assigned',sql: 'ALTER TABLE firearms ADD COLUMN non_nfa_trust_assigned INTEGER DEFAULT 0' },
    { name: '031_firearms_nfa2_enabled',          sql: 'ALTER TABLE firearms ADD COLUMN nfa2_enabled INTEGER DEFAULT 0' },
    { name: '032_firearms_nfa2_form_type',        sql: 'ALTER TABLE firearms ADD COLUMN nfa2_form_type TEXT' },
    { name: '033_firearms_nfa2_form_number',      sql: 'ALTER TABLE firearms ADD COLUMN nfa2_form_number TEXT' },
    { name: '034_firearms_nfa2_fmi',              sql: 'ALTER TABLE firearms ADD COLUMN nfa2_fmi INTEGER DEFAULT 0' },
    { name: '035_firearms_nfa2_submit_date',      sql: 'ALTER TABLE firearms ADD COLUMN nfa2_submit_date TEXT' },
    { name: '036_firearms_nfa2_tax_stamp_serial', sql: 'ALTER TABLE firearms ADD COLUMN nfa2_tax_stamp_serial TEXT' },
    { name: '037_firearms_nfa2_approve_date',     sql: 'ALTER TABLE firearms ADD COLUMN nfa2_approve_date TEXT' },
    { name: '038_optics_serial',                  sql: 'ALTER TABLE optics_items ADD COLUMN serial TEXT' },
    { name: '039_optics_spouse_price',            sql: 'ALTER TABLE optics_items ADD COLUMN spouse_price TEXT' },
    { name: '040_optics_firearm_id',              sql: 'ALTER TABLE optics_items ADD COLUMN firearm_id INTEGER' },
    { name: '041_optics_reticle',                 sql: 'ALTER TABLE optics_items ADD COLUMN reticle TEXT' },
    { name: '042_optics_tube_size',               sql: 'ALTER TABLE optics_items ADD COLUMN tube_size TEXT' },
    { name: '043_optics_mount_type',              sql: 'ALTER TABLE optics_items ADD COLUMN mount_type TEXT' },
    { name: '044_optics_mount_brand',             sql: 'ALTER TABLE optics_items ADD COLUMN mount_brand TEXT' },
    { name: '045_optics_mount_model',             sql: 'ALTER TABLE optics_items ADD COLUMN mount_model TEXT' },
    { name: '046_optics_mount_cant',              sql: 'ALTER TABLE optics_items ADD COLUMN mount_cant TEXT' },
    { name: '047_optics_adjustment',              sql: 'ALTER TABLE optics_items ADD COLUMN adjustment TEXT' },
  ];

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name)
  );
  const recordApplied = db.prepare('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)');

  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    try {
      db.exec(m.sql);
    } catch (_) {
      // Column already exists — applied by the pre-tracking system; record and move on.
    }
    recordApplied.run(m.name);
  }

  // Indexes — idempotent, safe to run on every startup
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_firearms_manufacturer     ON firearms(manufacturer);
    CREATE INDEX IF NOT EXISTS idx_firearms_serial           ON firearms(serial);
    CREATE INDEX IF NOT EXISTS idx_firearms_is_disposed      ON firearms(is_disposed);
    CREATE INDEX IF NOT EXISTS idx_firearms_is_nfa           ON firearms(is_nfa);
    CREATE INDEX IF NOT EXISTS idx_firearms_nfa_trust        ON firearms(nfa_trust_name);
    CREATE INDEX IF NOT EXISTS idx_firearms_non_nfa_trust    ON firearms(non_nfa_trust_name);
    CREATE INDEX IF NOT EXISTS idx_firearm_photos_firearm    ON firearm_photos(firearm_id);
    CREATE INDEX IF NOT EXISTS idx_firearm_photos_primary    ON firearm_photos(firearm_id, is_primary);
    CREATE INDEX IF NOT EXISTS idx_firearm_docs_firearm      ON firearm_documents(firearm_id);
    CREATE INDEX IF NOT EXISTS idx_trust_docs_trust          ON trust_documents(trust_id);
    CREATE INDEX IF NOT EXISTS idx_optics_photos_optic       ON optics_photos(optic_id);
    CREATE INDEX IF NOT EXISTS idx_users_username            ON users(username);
  `);

  // Seed default admin user if none exists
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!existing) {
    const defaultUser = process.env.DEFAULT_USER || 'admin';
    const defaultPass = process.env.DEFAULT_PASS || crypto.randomBytes(16).toString('hex');
    console.log('=============================================================');
    console.log('ARMORY — INITIAL ADMIN ACCOUNT CREATED');
    console.log(`  Username : ${defaultUser}`);
    console.log(`  Password : ${defaultPass}`);
    console.log('  CHANGE THIS PASSWORD AFTER FIRST LOGIN.');
    console.log('=============================================================');
    const hash = bcrypt.hashSync(defaultPass, 12);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(defaultUser, hash);
  }
}

// User queries
const userQueries = {
  findByUsername: (username) => getDB().prepare('SELECT * FROM users WHERE username = ?').get(username),
  create: (username, password) => {
    const hash = bcrypt.hashSync(password, 12);
    return getDB().prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
  },
  all: () => getDB().prepare('SELECT id, username, is_spouse_view, created_at FROM users').all(),
  delete: (id) => getDB().prepare('DELETE FROM users WHERE id = ?').run(id),
  updatePassword: (id, password) => {
    const hash = bcrypt.hashSync(password, 12);
    return getDB().prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, id);
  },
  setSpouseView: (id, value) => getDB().prepare('UPDATE users SET is_spouse_view = ? WHERE id = ?').run(value ? 1 : 0, id),
  getSessionVersion: (id) => {
    const row = getDB().prepare('SELECT session_version FROM users WHERE id = ?').get(id);
    return row ? (row.session_version || 0) : 0;
  },
  incrementSessionVersion: (id) => getDB().prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(id),
};

// Firearm queries
const firearmsQueries = {
  all: () => {
    const firearms = getDB().prepare(`
      SELECT f.*, COALESCE(pp.filename, fp.filename) AS _photo_filename
      FROM firearms f
      LEFT JOIN firearm_photos pp ON pp.firearm_id = f.id AND pp.is_primary = 1
      LEFT JOIN (
        SELECT firearm_id, MIN(id) AS min_id, filename
        FROM firearm_photos GROUP BY firearm_id
      ) fp ON fp.firearm_id = f.id AND pp.id IS NULL
      ORDER BY f.created_at DESC
    `).all();
    return firearms.map(f => ({
      ...f,
      is_3d_printed: !!f.is_3d_printed,
      is_nfa: !!f.is_nfa,
      nfa_fmi: !!f.nfa_fmi,
      is_disposed: !!f.is_disposed,
      primary_photo: f._photo_filename ? { filename: f._photo_filename } : null,
      _photo_filename: undefined,
    }));
  },
  findById: (id) => {
    const f = getDB().prepare('SELECT * FROM firearms WHERE id = ?').get(id);
    if (!f) return null;
    return {
      ...f,
      is_3d_printed: !!f.is_3d_printed,
      is_nfa: !!f.is_nfa,
      nfa_fmi: !!f.nfa_fmi,
      is_disposed: !!f.is_disposed,
      photos: getDB().prepare('SELECT * FROM firearm_photos WHERE firearm_id = ? ORDER BY is_primary DESC, id ASC').all(id),
      documents: getDB().prepare('SELECT * FROM firearm_documents WHERE firearm_id = ? ORDER BY doc_type, id ASC').all(id)
    };
  },
  create: (data) => {
    const result = getDB().prepare(`
      INSERT INTO firearms (
        manufacturer, model, model_number, caliber, serial, barrel_length, overall_length, optics,
        date_acquired, acquired_from, price_paid, spouse_price, transfer_date, ffl_transferred_from,
        is_3d_printed, is_nfa, nfa_type, nfa_form_type, nfa_form_number, nfa_fmi, nfa_submit_date, nfa_tax_stamp_serial, nfa_approve_date, nfa_trust_name,
        nfa2_enabled, nfa2_form_type, nfa2_form_number, nfa2_fmi, nfa2_submit_date, nfa2_tax_stamp_serial, nfa2_approve_date,
        non_nfa_trust_name,
        is_disposed, date_disposed, disposal_method, notes, round_count
      ) VALUES (
        @manufacturer, @model, @model_number, @caliber, @serial, @barrel_length, @overall_length, @optics,
        @date_acquired, @acquired_from, @price_paid, @spouse_price, @transfer_date, @ffl_transferred_from,
        @is_3d_printed, @is_nfa, @nfa_type, @nfa_form_type, @nfa_form_number, @nfa_fmi, @nfa_submit_date, @nfa_tax_stamp_serial, @nfa_approve_date, @nfa_trust_name,
        @nfa2_enabled, @nfa2_form_type, @nfa2_form_number, @nfa2_fmi, @nfa2_submit_date, @nfa2_tax_stamp_serial, @nfa2_approve_date,
        @non_nfa_trust_name,
        @is_disposed, @date_disposed, @disposal_method, @notes, @round_count
      )
    `).run(data);
    return result.lastInsertRowid;
  },
  update: (id, data) => {
    getDB().prepare(`
      UPDATE firearms SET
        manufacturer = @manufacturer, model = @model, model_number = @model_number, caliber = @caliber,
        serial = @serial, barrel_length = @barrel_length, overall_length = @overall_length, optics = @optics,
        date_acquired = @date_acquired, acquired_from = @acquired_from,
        price_paid = @price_paid, spouse_price = @spouse_price, transfer_date = @transfer_date, ffl_transferred_from = @ffl_transferred_from,
        is_3d_printed = @is_3d_printed, is_nfa = @is_nfa, nfa_type = @nfa_type,
        nfa_form_type = @nfa_form_type, nfa_form_number = @nfa_form_number, nfa_fmi = @nfa_fmi,
        nfa_submit_date = @nfa_submit_date, nfa_tax_stamp_serial = @nfa_tax_stamp_serial,
        nfa_approve_date = @nfa_approve_date, nfa_trust_name = @nfa_trust_name,
        nfa2_enabled = @nfa2_enabled, nfa2_form_type = @nfa2_form_type, nfa2_form_number = @nfa2_form_number,
        nfa2_fmi = @nfa2_fmi, nfa2_submit_date = @nfa2_submit_date, nfa2_tax_stamp_serial = @nfa2_tax_stamp_serial,
        nfa2_approve_date = @nfa2_approve_date,
        non_nfa_trust_name = @non_nfa_trust_name,
        is_disposed = @is_disposed, date_disposed = @date_disposed,
        disposal_method = @disposal_method, notes = @notes,
        round_count = @round_count, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...data, id });
  },
  delete: (id) => getDB().prepare('DELETE FROM firearms WHERE id = ?').run(id),
  addRounds: (id, count) => getDB().prepare('UPDATE firearms SET round_count = round_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(count, id),
  setRounds: (id, count) => getDB().prepare('UPDATE firearms SET round_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(count, id),
  setAllSpouseVisible: (ids) => {
    const db = getDB();
    const clear = db.prepare('UPDATE firearms SET spouse_visible = 0');
    const set   = db.prepare('UPDATE firearms SET spouse_visible = 1 WHERE id = ?');
    db.transaction(() => { clear.run(); for (const id of ids) set.run(id); })();
  },
  addPhoto: (firearmId, filename, originalName, isPrimary) => {
    if (isPrimary) {
      getDB().prepare('UPDATE firearm_photos SET is_primary = 0 WHERE firearm_id = ?').run(firearmId);
    }
    return getDB().prepare('INSERT INTO firearm_photos (firearm_id, filename, original_name, is_primary) VALUES (?, ?, ?, ?)').run(firearmId, filename, originalName, isPrimary ? 1 : 0);
  },
  setPrimaryPhoto: (photoId, firearmId) => {
    getDB().prepare('UPDATE firearm_photos SET is_primary = 0 WHERE firearm_id = ?').run(firearmId);
    getDB().prepare('UPDATE firearm_photos SET is_primary = 1 WHERE id = ?').run(photoId);
  },
  deletePhoto: (id) => {
    const photo = getDB().prepare('SELECT * FROM firearm_photos WHERE id = ?').get(id);
    getDB().prepare('DELETE FROM firearm_photos WHERE id = ?').run(id);
    return photo;
  },
  addDocument: (firearmId, docType, filename, originalName) => {
    return getDB().prepare('INSERT INTO firearm_documents (firearm_id, doc_type, filename, original_name) VALUES (?, ?, ?, ?)').run(firearmId, docType, filename, originalName);
  },
  deleteDocument: (id) => {
    const doc = getDB().prepare('SELECT * FROM firearm_documents WHERE id = ?').get(id);
    getDB().prepare('DELETE FROM firearm_documents WHERE id = ?').run(id);
    return doc;
  },
  findPhotoById: (id) => getDB().prepare('SELECT * FROM firearm_photos WHERE id = ?').get(id),
  findPhotoByFilename: (filename) => getDB().prepare('SELECT * FROM firearm_photos WHERE filename = ?').get(filename),
  findDocumentById: (id) => getDB().prepare('SELECT * FROM firearm_documents WHERE id = ?').get(id),
  findDocumentByFilename: (filename) => getDB().prepare('SELECT * FROM firearm_documents WHERE filename = ?').get(filename),
  distinctManufacturers: () => getDB().prepare('SELECT DISTINCT manufacturer FROM firearms ORDER BY manufacturer ASC').all().map(r => r.manufacturer),
  distinctModels: () => getDB().prepare("SELECT DISTINCT model FROM firearms WHERE model IS NOT NULL AND model != '' ORDER BY model ASC").all().map(r => r.model),
  distinctCalibers: () => getDB().prepare("SELECT DISTINCT caliber FROM firearms WHERE caliber IS NOT NULL AND caliber != '' ORDER BY caliber ASC").all().map(r => r.caliber),
  distinctBarrelLengths: () => getDB().prepare("SELECT DISTINCT barrel_length FROM firearms WHERE barrel_length IS NOT NULL AND barrel_length != '' ORDER BY barrel_length ASC").all().map(r => r.barrel_length),
  distinctAcquiredFrom: () => getDB().prepare("SELECT DISTINCT acquired_from FROM firearms WHERE acquired_from IS NOT NULL AND acquired_from != '' ORDER BY acquired_from ASC").all().map(r => r.acquired_from),
  distinctFflTransferredFrom: () => getDB().prepare("SELECT DISTINCT ffl_transferred_from FROM firearms WHERE ffl_transferred_from IS NOT NULL AND ffl_transferred_from != '' ORDER BY ffl_transferred_from ASC").all().map(r => r.ffl_transferred_from),
  distinctOpticsTags: () => {
    const rows = getDB().prepare("SELECT optics FROM firearms WHERE optics IS NOT NULL AND optics != ''").all();
    const tags = new Set();
    rows.forEach(r => {
      try { const p = JSON.parse(r.optics); if (Array.isArray(p)) p.forEach(t => tags.add(t)); else tags.add(r.optics); }
      catch(e) { tags.add(r.optics); }
    });
    return [...tags].sort((a, b) => a.localeCompare(b));
  },
  allForDropdown: () => getDB().prepare("SELECT id, manufacturer, model, serial FROM firearms WHERE is_disposed = 0 ORDER BY manufacturer ASC, model ASC").all(),
  setTrustAssigned: (id, value) => getDB().prepare('UPDATE firearms SET trust_assigned = ? WHERE id = ?').run(value ? 1 : 0, id),
  search: (q) => {
    const like = `%${q}%`;
    const firearms = getDB().prepare(`
      SELECT f.*, COALESCE(pp.filename, fp.filename) AS _photo_filename
      FROM firearms f
      LEFT JOIN firearm_photos pp ON pp.firearm_id = f.id AND pp.is_primary = 1
      LEFT JOIN (
        SELECT firearm_id, MIN(id) AS min_id, filename
        FROM firearm_photos GROUP BY firearm_id
      ) fp ON fp.firearm_id = f.id AND pp.id IS NULL
      WHERE f.manufacturer LIKE ? OR f.model LIKE ? OR f.serial LIKE ? OR f.caliber LIKE ?
         OR f.optics LIKE ? OR f.notes LIKE ? OR f.nfa_type LIKE ?
         OR f.nfa_form_number LIKE ? OR f.nfa_tax_stamp_serial LIKE ?
         OR f.nfa_trust_name LIKE ? OR f.acquired_from LIKE ? OR f.model_number LIKE ?
      ORDER BY f.created_at DESC
    `).all(like, like, like, like, like, like, like, like, like, like, like, like);
    return firearms.map(f => ({
      ...f,
      is_3d_printed: !!f.is_3d_printed,
      is_nfa: !!f.is_nfa,
      nfa_fmi: !!f.nfa_fmi,
      is_disposed: !!f.is_disposed,
      primary_photo: f._photo_filename ? { filename: f._photo_filename } : null,
      _photo_filename: undefined,
    }));
  }
};

const trustQueries = {
  all: () => getDB().prepare('SELECT * FROM trusts ORDER BY name ASC').all(),
  findById: (id) => {
    const t = getDB().prepare('SELECT * FROM trusts WHERE id = ?').get(id);
    if (!t) return null;
    const docs = getDB().prepare('SELECT * FROM trust_documents WHERE trust_id = ? ORDER BY id ASC').all(id);
    return {
      ...t,
      trust_doc: docs.find(d => d.doc_type === 'trust_document') || null,
      additional_docs: docs.filter(d => d.doc_type !== 'trust_document'),
    };
  },
  findByName: (name) => getDB().prepare('SELECT * FROM trusts WHERE name = ?').get(name),
  create: (data) => getDB().prepare('INSERT INTO trusts (name, trust_type, settlor_name, settlor_location, agreement_date, notes) VALUES (@name, @trust_type, @settlor_name, @settlor_location, @agreement_date, @notes)').run(data),
  update: (id, data) => getDB().prepare('UPDATE trusts SET settlor_name = @settlor_name, settlor_location = @settlor_location, agreement_date = @agreement_date, notes = @notes WHERE id = @id').run({ ...data, id }),
  delete: (id) => getDB().prepare('DELETE FROM trusts WHERE id = ?').run(id),
  itemsForTrust: (name) => getDB().prepare(`
    SELECT f.*, COALESCE(pp.filename, fp.filename) AS _photo_filename
    FROM firearms f
    LEFT JOIN firearm_photos pp ON pp.firearm_id = f.id AND pp.is_primary = 1
    LEFT JOIN (
      SELECT firearm_id, MIN(id) AS min_id, filename
      FROM firearm_photos GROUP BY firearm_id
    ) fp ON fp.firearm_id = f.id AND pp.id IS NULL
    WHERE f.nfa_trust_name = ? COLLATE NOCASE ORDER BY f.created_at DESC
  `).all(name).map(f => ({
    ...f,
    is_3d_printed: !!f.is_3d_printed, is_nfa: !!f.is_nfa, nfa_fmi: !!f.nfa_fmi, trust_assigned: !!f.trust_assigned,
    primary_photo: f._photo_filename ? { filename: f._photo_filename } : null,
    _photo_filename: undefined,
  })),
  nonNfaItemsForTrust: (name) => getDB().prepare(`
    SELECT f.*, COALESCE(pp.filename, fp.filename) AS _photo_filename
    FROM firearms f
    LEFT JOIN firearm_photos pp ON pp.firearm_id = f.id AND pp.is_primary = 1
    LEFT JOIN (
      SELECT firearm_id, MIN(id) AS min_id, filename
      FROM firearm_photos GROUP BY firearm_id
    ) fp ON fp.firearm_id = f.id AND pp.id IS NULL
    WHERE f.non_nfa_trust_name = ? COLLATE NOCASE OR f.nfa_trust_name = ? COLLATE NOCASE ORDER BY f.created_at DESC
  `).all(name, name).map(f => ({
    ...f,
    is_3d_printed: !!f.is_3d_printed, is_nfa: !!f.is_nfa, nfa_fmi: !!f.nfa_fmi,
    non_nfa_trust_assigned: !!f.non_nfa_trust_assigned,
    primary_photo: f._photo_filename ? { filename: f._photo_filename } : null,
    _photo_filename: undefined,
  })),
  setNonNfaTrustAssigned: (id, value) => getDB().prepare('UPDATE firearms SET non_nfa_trust_assigned = ? WHERE id = ?').run(value ? 1 : 0, id),
  distinctTrustNames: () => getDB().prepare("SELECT DISTINCT nfa_trust_name FROM firearms WHERE nfa_trust_name IS NOT NULL AND nfa_trust_name != '' ORDER BY nfa_trust_name ASC").all().map(r => r.nfa_trust_name),
  distinctNonNfaTrustNames: () => getDB().prepare("SELECT DISTINCT non_nfa_trust_name FROM firearms WHERE non_nfa_trust_name IS NOT NULL AND non_nfa_trust_name != '' ORDER BY non_nfa_trust_name ASC").all().map(r => r.non_nfa_trust_name),
  addDocument: (trustId, filename, originalName, docType = 'additional') =>
    getDB().prepare('INSERT INTO trust_documents (trust_id, filename, original_name, doc_type) VALUES (?, ?, ?, ?)').run(trustId, filename, originalName, docType),
  replaceTrustDoc: (trustId, filename, originalName) => {
    // Delete any existing primary trust document records (files cleaned up by caller)
    const existing = getDB().prepare("SELECT * FROM trust_documents WHERE trust_id = ? AND doc_type = 'trust_document'").all(trustId);
    getDB().prepare("DELETE FROM trust_documents WHERE trust_id = ? AND doc_type = 'trust_document'").run(trustId);
    getDB().prepare("INSERT INTO trust_documents (trust_id, filename, original_name, doc_type) VALUES (?, ?, ?, 'trust_document')").run(trustId, filename, originalName);
    return existing;
  },
  findDocumentById: (id) => getDB().prepare('SELECT * FROM trust_documents WHERE id = ?').get(id),
  findDocumentByFilename: (filename) => getDB().prepare('SELECT * FROM trust_documents WHERE filename = ?').get(filename),
  deleteDocument: (id) => {
    const doc = getDB().prepare('SELECT * FROM trust_documents WHERE id = ?').get(id);
    getDB().prepare('DELETE FROM trust_documents WHERE id = ?').run(id);
    return doc;
  },
};

const opticsQueries = {
  all: () => {
    const items = getDB().prepare(`
      SELECT o.*, COALESCE(pp.filename, fp.filename) AS _photo_filename
      FROM optics_items o
      LEFT JOIN optics_photos pp ON pp.optic_id = o.id AND pp.is_primary = 1
      LEFT JOIN (
        SELECT optic_id, MIN(id) AS min_id, filename
        FROM optics_photos GROUP BY optic_id
      ) fp ON fp.optic_id = o.id AND pp.id IS NULL
      ORDER BY o.created_at DESC
    `).all();
    return items.map(o => ({
      ...o,
      primary_photo: o._photo_filename ? { filename: o._photo_filename } : null,
      _photo_filename: undefined,
    }));
  },
  findById: (id) => {
    const o = getDB().prepare('SELECT * FROM optics_items WHERE id = ?').get(id);
    if (!o) return null;
    return {
      ...o,
      photos: getDB().prepare('SELECT * FROM optics_photos WHERE optic_id = ? ORDER BY is_primary DESC, id ASC').all(id)
    };
  },
  create: (data) => {
    const result = getDB().prepare(`
      INSERT INTO optics_items (manufacturer, model, model_number, serial, optic_type, magnification, reticle, tube_size, adjustment, mount_type, mount_brand, mount_model, mount_cant, acquired_from, date_acquired, price_paid, spouse_price, firearm_id, notes)
      VALUES (@manufacturer, @model, @model_number, @serial, @optic_type, @magnification, @reticle, @tube_size, @adjustment, @mount_type, @mount_brand, @mount_model, @mount_cant, @acquired_from, @date_acquired, @price_paid, @spouse_price, @firearm_id, @notes)
    `).run(data);
    return result.lastInsertRowid;
  },
  update: (id, data) => {
    getDB().prepare(`
      UPDATE optics_items SET
        manufacturer = @manufacturer, model = @model, model_number = @model_number,
        serial = @serial, optic_type = @optic_type, magnification = @magnification, reticle = @reticle, tube_size = @tube_size, adjustment = @adjustment,
        mount_type = @mount_type, mount_brand = @mount_brand, mount_model = @mount_model, mount_cant = @mount_cant,
        acquired_from = @acquired_from, date_acquired = @date_acquired,
        price_paid = @price_paid, spouse_price = @spouse_price, firearm_id = @firearm_id,
        notes = @notes, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...data, id });
  },
  delete: (id) => getDB().prepare('DELETE FROM optics_items WHERE id = ?').run(id),
  addPhoto: (opticId, filename, originalName, isPrimary) => {
    if (isPrimary) {
      getDB().prepare('UPDATE optics_photos SET is_primary = 0 WHERE optic_id = ?').run(opticId);
    }
    return getDB().prepare('INSERT INTO optics_photos (optic_id, filename, original_name, is_primary) VALUES (?, ?, ?, ?)').run(opticId, filename, originalName, isPrimary ? 1 : 0);
  },
  setPrimaryPhoto: (photoId, opticId) => {
    getDB().prepare('UPDATE optics_photos SET is_primary = 0 WHERE optic_id = ?').run(opticId);
    getDB().prepare('UPDATE optics_photos SET is_primary = 1 WHERE id = ?').run(photoId);
  },
  deletePhoto: (id) => {
    const photo = getDB().prepare('SELECT * FROM optics_photos WHERE id = ?').get(id);
    getDB().prepare('DELETE FROM optics_photos WHERE id = ?').run(id);
    return photo;
  },
  findPhotoById: (id) => getDB().prepare('SELECT * FROM optics_photos WHERE id = ?').get(id),
  findPhotoByFilename: (filename) => getDB().prepare('SELECT * FROM optics_photos WHERE filename = ?').get(filename),
  distinctManufacturers: () => getDB().prepare("SELECT DISTINCT manufacturer FROM optics_items ORDER BY manufacturer ASC").all().map(r => r.manufacturer),
  distinctModels: () => getDB().prepare("SELECT DISTINCT model FROM optics_items WHERE model IS NOT NULL AND model != '' ORDER BY model ASC").all().map(r => r.model),
  distinctReticles: () => getDB().prepare("SELECT DISTINCT reticle FROM optics_items WHERE reticle IS NOT NULL AND reticle != '' ORDER BY reticle ASC").all().map(r => r.reticle),
  distinctAcquiredFrom: () => getDB().prepare("SELECT DISTINCT acquired_from FROM optics_items WHERE acquired_from IS NOT NULL AND acquired_from != '' ORDER BY acquired_from ASC").all().map(r => r.acquired_from),
  distinctMountBrands: () => getDB().prepare("SELECT DISTINCT mount_brand FROM optics_items WHERE mount_brand IS NOT NULL AND mount_brand != '' ORDER BY mount_brand ASC").all().map(r => r.mount_brand),
  distinctMountModels: () => getDB().prepare("SELECT DISTINCT mount_model FROM optics_items WHERE mount_model IS NOT NULL AND mount_model != '' ORDER BY mount_model ASC").all().map(r => r.mount_model),
  findByFirearmId: (firearmsId) => {
    const items = getDB().prepare(`
      SELECT o.*, COALESCE(pp.filename, fp.filename) AS _photo_filename
      FROM optics_items o
      LEFT JOIN optics_photos pp ON pp.optic_id = o.id AND pp.is_primary = 1
      LEFT JOIN (
        SELECT optic_id, MIN(id) AS min_id, filename
        FROM optics_photos GROUP BY optic_id
      ) fp ON fp.optic_id = o.id AND pp.id IS NULL
      WHERE o.firearm_id = ? ORDER BY o.created_at ASC
    `).all(firearmsId);
    return items.map(o => ({
      ...o,
      primary_photo: o._photo_filename ? { filename: o._photo_filename } : null,
      _photo_filename: undefined,
    }));
  },
  search: (q) => {
    const like = `%${q}%`;
    const items = getDB().prepare(`
      SELECT o.*, COALESCE(pp.filename, fp.filename) AS _photo_filename
      FROM optics_items o
      LEFT JOIN optics_photos pp ON pp.optic_id = o.id AND pp.is_primary = 1
      LEFT JOIN (
        SELECT optic_id, MIN(id) AS min_id, filename
        FROM optics_photos GROUP BY optic_id
      ) fp ON fp.optic_id = o.id AND pp.id IS NULL
      WHERE o.manufacturer LIKE ? OR o.model LIKE ? OR o.model_number LIKE ? OR o.serial LIKE ?
         OR o.optic_type LIKE ? OR o.magnification LIKE ? OR o.acquired_from LIKE ? OR o.notes LIKE ?
         OR o.reticle LIKE ? OR o.mount_type LIKE ? OR o.mount_brand LIKE ? OR o.mount_model LIKE ?
      ORDER BY o.created_at DESC
    `).all(like, like, like, like, like, like, like, like, like, like, like, like);
    return items.map(o => ({
      ...o,
      primary_photo: o._photo_filename ? { filename: o._photo_filename } : null,
      _photo_filename: undefined,
    }));
  },
};

const magsQueries = {
  all: () => getDB().prepare('SELECT * FROM mags ORDER BY platform ASC, brand ASC, model ASC').all(),
  findById: (id) => getDB().prepare('SELECT * FROM mags WHERE id = ?').get(id),
  create: (data) => {
    const result = getDB().prepare(`
      INSERT INTO mags (platform, brand, model, color, capacity, caliber, material, quantity, notes)
      VALUES (@platform, @brand, @model, @color, @capacity, @caliber, @material, @quantity, @notes)
    `).run(data);
    return result.lastInsertRowid;
  },
  update: (id, data) => {
    getDB().prepare(`
      UPDATE mags SET
        platform = @platform, brand = @brand, model = @model, color = @color,
        capacity = @capacity, caliber = @caliber, material = @material,
        quantity = @quantity, notes = @notes, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...data, id });
  },
  delete: (id) => getDB().prepare('DELETE FROM mags WHERE id = ?').run(id),
  distinctPlatforms: () => getDB().prepare("SELECT DISTINCT platform FROM mags WHERE platform IS NOT NULL AND platform != '' ORDER BY platform ASC").all().map(r => r.platform),
  distinctBrands: () => getDB().prepare("SELECT DISTINCT brand FROM mags WHERE brand IS NOT NULL AND brand != '' ORDER BY brand ASC").all().map(r => r.brand),
  distinctModels: () => getDB().prepare("SELECT DISTINCT model FROM mags WHERE model IS NOT NULL AND model != '' ORDER BY model ASC").all().map(r => r.model),
  distinctCalibers: () => getDB().prepare("SELECT DISTINCT caliber FROM mags WHERE caliber IS NOT NULL AND caliber != '' ORDER BY caliber ASC").all().map(r => r.caliber),
  search: (q) => {
    const like = `%${q}%`;
    return getDB().prepare(`
      SELECT * FROM mags
      WHERE platform LIKE ? OR brand LIKE ? OR model LIKE ? OR caliber LIKE ?
         OR color LIKE ? OR material LIKE ? OR notes LIKE ?
      ORDER BY platform ASC, brand ASC
    `).all(like, like, like, like, like, like, like);
  },
};

function closeDB() {
  if (db) { db.close(); db = null; }
}

module.exports = { initDB, closeDB, userQueries, firearmsQueries, trustQueries, opticsQueries, magsQueries };
