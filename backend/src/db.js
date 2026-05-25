const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS remote_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    token TEXT NOT NULL DEFAULT '',
    fingerprint TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS metrics (
    ts        INTEGER PRIMARY KEY,
    cpu       REAL,
    mem_used  INTEGER,
    mem_total INTEGER,
    disk_used INTEGER,
    disk_total INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);
`);

// Migrationen für bestehende Datenbanken
try { db.exec('ALTER TABLE remote_agents ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ""'); } catch {}

const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  // Kein bekanntes Default-Passwort: ADMIN_PASSWORD-Env nutzen oder einmalig
  // ein zufälliges generieren und in den Logs ausgeben.
  const adminPass = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
  const hash = bcrypt.hashSync(adminPass, 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('╔══════════════════════════════════════════════════════════╗');
    console.warn('║  ADMIN-PASSWORT (einmalig – sofort notieren!)            ║');
    console.warn(`║  Benutzer:  admin                                        ║`);
    console.warn(`║  Passwort:  ${adminPass}  ║`);
    console.warn('║  Passwort in den Einstellungen ändern!                   ║');
    console.warn('╚══════════════════════════════════════════════════════════╝');
  }
}

module.exports = db;
