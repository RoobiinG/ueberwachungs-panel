const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');
const { ALL_KEYS, OPERATOR_PERMISSIONS, GUEST_PERMISSIONS } = require('./permissions');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data.db');
const db = new Database(DB_PATH);

// ─── SQLite Performance-Pragmas ──────────────────────────────────────────────
db.pragma('journal_mode = WAL');        // Concurrent reads + writes ohne Lock
db.pragma('synchronous  = NORMAL');     // Schneller als FULL, sicher mit WAL
db.pragma('cache_size   = -32000');     // 32 MB Seitencache
db.pragma('temp_store   = MEMORY');     // Temporäre Tabellen im RAM
db.pragma('mmap_size    = 268435456');  // 256 MB Memory-mapped I/O

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
// Username 'admin' → 'Admin' (Großschreibung)
try { db.exec("UPDATE users SET username = 'Admin' WHERE username = 'admin' AND role = 'admin'"); } catch {}
// Server-Zugriffskontrolle: Einschränkungsmodus pro Rolle
try { db.exec('ALTER TABLE roles ADD COLUMN restrict_agents INTEGER NOT NULL DEFAULT 0'); } catch {}
// Alerts: Remote-Agent-Unterstützung + History-Typ
try { db.exec('ALTER TABLE alert_rules ADD COLUMN agent_id INTEGER REFERENCES remote_agents(id) ON DELETE SET NULL'); } catch {}
try { db.exec("ALTER TABLE alert_history ADD COLUMN type TEXT NOT NULL DEFAULT 'fired'"); } catch {}
// Rollen: Lokalen Server für diese Rolle ausblenden
try { db.exec('ALTER TABLE roles ADD COLUMN hide_local INTEGER NOT NULL DEFAULT 0'); } catch {}
// Metrics: Netzwerk-Durchsatz-Spalten (Bytes/Sek)
try { db.exec('ALTER TABLE metrics ADD COLUMN net_rx_sec INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE metrics ADD COLUMN net_tx_sec INTEGER NOT NULL DEFAULT 0'); } catch {}
// Dashboard-Layouts pro User
db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_layouts (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    layout     TEXT    NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
  );
`);
// Metrics: server_id-Spalte für Multi-Server-Langzeit-Monitoring
try {
  const has = db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('metrics') WHERE name='server_id'").get().c > 0;
  if (!has) {
    db.exec(`
      CREATE TABLE metrics_new (
        ts         INTEGER NOT NULL,
        server_id  TEXT    NOT NULL DEFAULT 'local',
        cpu        REAL,
        mem_used   INTEGER,
        mem_total  INTEGER,
        disk_used  INTEGER,
        disk_total INTEGER,
        PRIMARY KEY (ts, server_id)
      );
      INSERT OR IGNORE INTO metrics_new (ts, server_id, cpu, mem_used, mem_total, disk_used, disk_total)
        SELECT ts, 'local', cpu, mem_used, mem_total, disk_used, disk_total FROM metrics;
      DROP TABLE metrics;
      ALTER TABLE metrics_new RENAME TO metrics;
      CREATE INDEX IF NOT EXISTS idx_metrics_ts        ON metrics(ts);
      CREATE INDEX IF NOT EXISTS idx_metrics_server_ts ON metrics(server_id, ts);
    `);
  }
} catch (e) { console.warn('Metrics-Migration fehlgeschlagen:', e.message); }
// Container-Spitznamen (panel-seitig, kein Agent nötig)
db.exec(`
  CREATE TABLE IF NOT EXISTS container_labels (
    server       TEXT NOT NULL,
    container_id TEXT NOT NULL,
    nickname     TEXT NOT NULL DEFAULT '',
    tag          TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (server, container_id)
  );
`);
// Audit-Log: Standort-Spalte (Stadt, Land via GeoIP)
try { db.exec('ALTER TABLE audit_log ADD COLUMN location TEXT'); } catch {}
// Dockhand-Integration: Environment-ID pro Remote-Agent
try { db.exec('ALTER TABLE remote_agents ADD COLUMN dockhand_env_id INTEGER'); } catch {}
// Panel-Logs: Frontend-Fehler + API-Fehler persistent speichern
db.exec(`
  CREATE TABLE IF NOT EXISTS panel_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    level      TEXT NOT NULL DEFAULT 'error',
    source     TEXT NOT NULL,
    message    TEXT NOT NULL,
    stack      TEXT,
    url        TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_panel_logs_ts ON panel_logs(created_at DESC);

  CREATE TABLE IF NOT EXISTS panel_log_shares (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    token        TEXT NOT NULL UNIQUE,
    log_ids      TEXT NOT NULL,
    label        TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    accessed_at  DATETIME,
    access_count INTEGER NOT NULL DEFAULT 0
  );
`);

// Audit-Log: alle sicherheitsrelevanten Aktionen protokollieren
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    username    TEXT NOT NULL DEFAULT 'System',
    action      TEXT NOT NULL,
    target_type TEXT,
    target_name TEXT,
    details     TEXT,
    ip          TEXT,
    user_agent  TEXT,
    location    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(username);
`);

// Tabelle für Server-Zuweisungen pro Rolle
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_grants (
    role_id  INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES remote_agents(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, agent_id)
  );
`);

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

// Permissions für bestehende System-Rollen nachpflegen (fügt fehlende hinzu, entfernt nichts)
const syncRolePermissions = db.transaction((name, permissions) => {
  const role = db.prepare('SELECT id FROM roles WHERE name = ? AND is_system = 1').get(name);
  if (!role) return;
  const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
  for (const key of permissions) ins.run(role.id, key);
});
syncRolePermissions('operator', OPERATOR_PERMISSIONS);
syncRolePermissions('guest', GUEST_PERMISSIONS);

// Frisch-Installation: Admin-Benutzer anlegen (Suche case-insensitiv)
const adminExists = db.prepare("SELECT id FROM users WHERE LOWER(username) = 'admin'").get();
if (!adminExists) {
  const adminPass = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
  const hash = bcrypt.hashSync(adminPass, 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('Admin', hash, 'admin');
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('╔══════════════════════════════════════════════════════════╗');
    console.warn('║  ADMIN-PASSWORT (einmalig – sofort notieren!)            ║');
    console.warn(`║  Benutzer:  Admin                                        ║`);
    console.warn(`║  Passwort:  ${adminPass}  ║`);
    console.warn('║  Passwort in den Einstellungen ändern!                   ║');
    console.warn('╚══════════════════════════════════════════════════════════╝');
  }
}

module.exports = db;
