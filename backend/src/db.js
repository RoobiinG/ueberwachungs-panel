const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');
const { ALL_KEYS, OPERATOR_PERMISSIONS, GUEST_PERMISSIONS } = require('./permissions');

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

  CREATE TABLE IF NOT EXISTS alert_rules (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    metric           TEXT NOT NULL CHECK(metric IN ('cpu','memory','disk')),
    condition        TEXT NOT NULL CHECK(condition IN ('gt','lt')),
    threshold        REAL NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    cooldown_minutes INTEGER NOT NULL DEFAULT 30,
    webhook_id       INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS alert_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id      INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    value        REAL NOT NULL,
    message      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(rule_id, triggered_at);

  CREATE TABLE IF NOT EXISTS container_metrics (
    ts             INTEGER NOT NULL,
    container_id   TEXT NOT NULL,
    container_name TEXT NOT NULL,
    cpu_percent    REAL,
    mem_used       INTEGER,
    mem_limit      INTEGER,
    net_rx_sec     INTEGER,
    net_tx_sec     INTEGER,
    PRIMARY KEY (ts, container_id)
  );
  CREATE INDEX IF NOT EXISTS idx_cmets ON container_metrics(container_id, ts);

  CREATE TABLE IF NOT EXISTS passkeys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    public_key    TEXT NOT NULL,
    counter       INTEGER NOT NULL DEFAULT 0,
    device_type   TEXT,
    transports    TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

  CREATE TABLE IF NOT EXISTS ssh_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    public_key  TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_ssh_keys_user ON ssh_keys(user_id);

  CREATE TABLE IF NOT EXISTS ssh_hosts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    hostname   TEXT NOT NULL,
    port       INTEGER NOT NULL DEFAULT 22,
    username   TEXT NOT NULL,
    auth_type  TEXT NOT NULL DEFAULT 'key' CHECK(auth_type IN ('key','password')),
    ssh_key_id INTEGER REFERENCES ssh_keys(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_ssh_hosts_user ON ssh_hosts(user_id);

  CREATE TABLE IF NOT EXISTS roles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    is_system  INTEGER NOT NULL DEFAULT 0,
    is_admin   INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id        INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    PRIMARY KEY (role_id, permission_key)
  );
`);

// ─── Migrationen ─────────────────────────────────────────────────────────────
try { db.exec('ALTER TABLE remote_agents ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ""'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN reset_token TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN reset_expires INTEGER'); } catch {}
// Alte 'viewer'-Rolle auf 'guest' migrieren
try { db.exec("UPDATE users SET role = 'guest' WHERE role = 'viewer'"); } catch {}

// ─── Standard-Rollen seeden ───────────────────────────────────────────────────
const seedRole = db.transaction((name, label, isSystem, isAdmin, permissions) => {
  let role = db.prepare('SELECT id FROM roles WHERE name = ?').get(name);
  if (!role) {
    const res = db.prepare(
      'INSERT INTO roles (name, label, is_system, is_admin) VALUES (?, ?, ?, ?)'
    ).run(name, label, isSystem ? 1 : 0, isAdmin ? 1 : 0);
    role = { id: res.lastInsertRowid };
    const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const key of permissions) ins.run(role.id, key);
  }
});

seedRole('admin',    'Admin',        true,  true,  ALL_KEYS);
seedRole('operator', 'App-Betrieb',  true,  false, OPERATOR_PERMISSIONS);
seedRole('guest',    'Gast',         true,  false, GUEST_PERMISSIONS);

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
