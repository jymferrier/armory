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
      optics TEXT,
      date_acquired TEXT,
      is_nfa INTEGER DEFAULT 0,
      nfa_type TEXT,
      nfa_form_number TEXT,
      nfa_submit_date TEXT,
      nfa_tax_stamp_serial TEXT,
      nfa_approve_date TEXT,
      nfa_trust_name TEXT,
      is_disposed INTEGER DEFAULT 0,
      date_disposed TEXT,
      disposal_method TEXT,
      notes TEXT,
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
    console.log(`Default user created: ${defaultUser} / ${defaultPass}`);
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
      is_nfa: !!f.is_nfa,
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
      is_nfa: !!f.is_nfa,
      is_disposed: !!f.is_disposed,
      photos: getDB().prepare('SELECT * FROM firearm_photos WHERE firearm_id = ? ORDER BY is_primary DESC, id ASC').all(id),
      documents: getDB().prepare('SELECT * FROM firearm_documents WHERE firearm_id = ? ORDER BY doc_type, id ASC').all(id)
    };
  },
  create: (data) => {
    const result = getDB().prepare(`
      INSERT INTO firearms (
        manufacturer, model, caliber, serial, barrel_length, optics, date_acquired,
        is_nfa, nfa_type, nfa_form_number, nfa_submit_date, nfa_tax_stamp_serial, nfa_approve_date, nfa_trust_name,
        is_disposed, date_disposed, disposal_method, notes
      ) VALUES (
        @manufacturer, @model, @caliber, @serial, @barrel_length, @optics, @date_acquired,
        @is_nfa, @nfa_type, @nfa_form_number, @nfa_submit_date, @nfa_tax_stamp_serial, @nfa_approve_date, @nfa_trust_name,
        @is_disposed, @date_disposed, @disposal_method, @notes
      )
    `).run(data);
    return result.lastInsertRowid;
  },
  update: (id, data) => {
    getDB().prepare(`
      UPDATE firearms SET
        manufacturer = @manufacturer, model = @model, caliber = @caliber,
        serial = @serial, barrel_length = @barrel_length, optics = @optics,
        date_acquired = @date_acquired,
        is_nfa = @is_nfa, nfa_type = @nfa_type,
        nfa_form_number = @nfa_form_number, nfa_submit_date = @nfa_submit_date,
        nfa_tax_stamp_serial = @nfa_tax_stamp_serial,
        nfa_approve_date = @nfa_approve_date, nfa_trust_name = @nfa_trust_name,
        is_disposed = @is_disposed, date_disposed = @date_disposed,
        disposal_method = @disposal_method, notes = @notes,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...data, id });
  },
  delete: (id) => getDB().prepare('DELETE FROM firearms WHERE id = ?').run(id),
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
  search: (q) => {
    const like = `%${q}%`;
    return getDB().prepare(`
      SELECT f.*, fp.filename as primary_photo_filename
      FROM firearms f
      LEFT JOIN firearm_photos fp ON fp.firearm_id = f.id AND fp.is_primary = 1
      WHERE f.manufacturer LIKE ? OR f.model LIKE ? OR f.serial LIKE ? OR f.caliber LIKE ?
      ORDER BY f.created_at DESC
    `).all(like, like, like, like);
  }
};

module.exports = { initDB, userQueries, firearmsQueries };
