const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'armory.db');
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
  `);

  // Migrate existing databases — safely add new columns if they don't exist
  const migrations = [
    "ALTER TABLE firearms ADD COLUMN barrel_length TEXT",
    "ALTER TABLE firearms ADD COLUMN date_acquired TEXT",
    "ALTER TABLE firearms ADD COLUMN nfa_form_number TEXT",
    "ALTER TABLE firearms ADD COLUMN nfa_submit_date TEXT",
    "ALTER TABLE firearms ADD COLUMN nfa_tax_stamp_serial TEXT",
    "ALTER TABLE firearms ADD COLUMN nfa_approve_date TEXT",
    "ALTER TABLE firearms ADD COLUMN nfa_trust_name TEXT",
    "ALTER TABLE firearms ADD COLUMN is_disposed INTEGER DEFAULT 0",
    "ALTER TABLE firearms ADD COLUMN date_disposed TEXT",
    "ALTER TABLE firearms ADD COLUMN disposal_method TEXT",
    "ALTER TABLE firearms ADD COLUMN overall_length TEXT",
    "ALTER TABLE firearms ADD COLUMN is_3d_printed INTEGER DEFAULT 0",
    "ALTER TABLE firearms ADD COLUMN nfa_form_type TEXT",
    "ALTER TABLE firearms ADD COLUMN nfa_fmi INTEGER DEFAULT 0",
    "ALTER TABLE firearms ADD COLUMN acquired_from TEXT",
    "ALTER TABLE firearms ADD COLUMN price_paid TEXT",
    "ALTER TABLE firearms ADD COLUMN transfer_date TEXT",
    "ALTER TABLE firearms ADD COLUMN ffl_transferred_from TEXT",
    "ALTER TABLE firearms ADD COLUMN round_count INTEGER DEFAULT 0",
    "ALTER TABLE firearms ADD COLUMN model_number TEXT",
    "ALTER TABLE firearms ADD COLUMN spouse_price TEXT",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Seed default admin user if none exists
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!existing) {
    const defaultUser = process.env.DEFAULT_USER || 'admin';
    const defaultPass = process.env.DEFAULT_PASS || 'armory123';
    const hash = bcrypt.hashSync(defaultPass, 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(defaultUser, hash);
    console.log(`Default user created: ${defaultUser} — override with DEFAULT_USER / DEFAULT_PASS env vars`);
  }
}

// User queries
const userQueries = {
  findByUsername: (username) => getDB().prepare('SELECT * FROM users WHERE username = ?').get(username),
  create: (username, password) => {
    const hash = bcrypt.hashSync(password, 10);
    return getDB().prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
  },
  all: () => getDB().prepare('SELECT id, username, created_at FROM users').all(),
  delete: (id) => getDB().prepare('DELETE FROM users WHERE id = ?').run(id),
  updatePassword: (id, password) => {
    const hash = bcrypt.hashSync(password, 10);
    return getDB().prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, id);
  }
};

// Firearm queries
const firearmsQueries = {
  all: () => {
    const firearms = getDB().prepare('SELECT * FROM firearms ORDER BY created_at DESC').all();
    return firearms.map(f => ({
      ...f,
      is_3d_printed: !!f.is_3d_printed,
      is_nfa: !!f.is_nfa,
      nfa_fmi: !!f.nfa_fmi,
      is_disposed: !!f.is_disposed,
      primary_photo: getDB().prepare('SELECT filename FROM firearm_photos WHERE firearm_id = ? AND is_primary = 1 LIMIT 1').get(f.id)
        || getDB().prepare('SELECT filename FROM firearm_photos WHERE firearm_id = ? LIMIT 1').get(f.id)
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
        is_disposed, date_disposed, disposal_method, notes, round_count
      ) VALUES (
        @manufacturer, @model, @model_number, @caliber, @serial, @barrel_length, @overall_length, @optics,
        @date_acquired, @acquired_from, @price_paid, @spouse_price, @transfer_date, @ffl_transferred_from,
        @is_3d_printed, @is_nfa, @nfa_type, @nfa_form_type, @nfa_form_number, @nfa_fmi, @nfa_submit_date, @nfa_tax_stamp_serial, @nfa_approve_date, @nfa_trust_name,
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
        is_disposed = @is_disposed, date_disposed = @date_disposed,
        disposal_method = @disposal_method, notes = @notes,
        round_count = @round_count, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...data, id });
  },
  delete: (id) => getDB().prepare('DELETE FROM firearms WHERE id = ?').run(id),
  addRounds: (id, count) => getDB().prepare('UPDATE firearms SET round_count = round_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(count, id),
  setRounds: (id, count) => getDB().prepare('UPDATE firearms SET round_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(count, id),
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
  findDocumentById: (id) => getDB().prepare('SELECT * FROM firearm_documents WHERE id = ?').get(id),
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
  search: (q) => {
    const like = `%${q}%`;
    return getDB().prepare(`
      SELECT f.*, fp.filename as primary_photo_filename
      FROM firearms f
      LEFT JOIN firearm_photos fp ON fp.firearm_id = f.id AND fp.is_primary = 1
      WHERE f.manufacturer LIKE ? OR f.model LIKE ? OR f.serial LIKE ? OR f.caliber LIKE ?
         OR f.optics LIKE ? OR f.notes LIKE ? OR f.nfa_type LIKE ?
      ORDER BY f.created_at DESC
    `).all(like, like, like, like, like, like, like);
  }
};

const trustQueries = {
  all: () => getDB().prepare('SELECT * FROM trusts ORDER BY name ASC').all(),
  findById: (id) => getDB().prepare('SELECT * FROM trusts WHERE id = ?').get(id),
  findByName: (name) => getDB().prepare('SELECT * FROM trusts WHERE name = ?').get(name),
  create: (data) => getDB().prepare('INSERT INTO trusts (name, settlor_name, settlor_location, agreement_date) VALUES (@name, @settlor_name, @settlor_location, @agreement_date)').run(data),
  update: (id, data) => getDB().prepare('UPDATE trusts SET settlor_name = @settlor_name, settlor_location = @settlor_location, agreement_date = @agreement_date WHERE id = @id').run({ ...data, id }),
  delete: (id) => getDB().prepare('DELETE FROM trusts WHERE id = ?').run(id),
  itemsForTrust: (name) => getDB().prepare("SELECT * FROM firearms WHERE nfa_trust_name = ? ORDER BY created_at DESC").all(name).map(f => ({ ...f, is_3d_printed: !!f.is_3d_printed, is_nfa: !!f.is_nfa, nfa_fmi: !!f.nfa_fmi })),
  distinctTrustNames: () => getDB().prepare("SELECT DISTINCT nfa_trust_name FROM firearms WHERE nfa_trust_name IS NOT NULL AND nfa_trust_name != '' ORDER BY nfa_trust_name ASC").all().map(r => r.nfa_trust_name),
};

module.exports = { initDB, userQueries, firearmsQueries, trustQueries };
