// Diagnostik-Report: sammelt den aktuellen Zustand des Panels (DB, Ressourcen,
// Agents, Hintergrund-Worker, SSL, Update-Stand, SMTP, Logs, Konfiguration) in
// einem JSON-Objekt. Jede Sektion ist einzeln fehlerisoliert — ein hängender
// oder werfender Check darf nie den ganzen Report zum Absturz bringen.
// Nach demselben Muster wie das Diagnose-Feature im Schwesterprojekt „mail-panel":
// immer live erzeugt, nie persistiert, Secrets werden grundsätzlich nur als
// „gesetzt"/„nicht gesetzt" ausgegeben.
const os   = require('os');
const fs   = require('fs');
const path = require('path');
const net  = require('net');

const db = require('../db');
const { agentClient } = require('./agentTls');
const { smtpConfigured, sendTestMail } = require('./smtpTest');

// SICHERHEIT: Vorfall vom 2026-09-21 — eine Blockliste "bekannter" Secret-Keys hatte
// mehrere echte Zugangsdaten übersehen (uptimeKumaPassword, uptimeKumaApiKey,
// dockhandApiToken, gemini_api_key, patchmonTokenSecret, pelicanToken landeten im
// Klartext im Report). Eine Blockliste kann per Definition nur Keys erfassen, die man
// beim Schreiben schon kannte — jedes neue Integrations-Setting fällt sonst automatisch
// durch. Deshalb jetzt umgekehrt: nur explizit als unbedenklich gelistete Keys erscheinen
// im Klartext, alles andere wird maskiert. Zusätzlich ein Namensmuster als zweites Netz,
// falls versehentlich doch ein sensibler Key auf die Positivliste gerät.
const SAFE_CONFIG_KEYS = new Set([
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_from', 'smtp_user',
  'mchost_username',
  'npm_host', 'npm_port', 'npm_email',
  'dockhandUrl', 'dockhandLocalEnvId', 'dockerEngine',
  'pelicanUrl',
  'patchmonUrl', 'patchmonLocalHostId',
  'uptimeKumaUrl', 'uptimeKumaUsername', 'uptimeKumaSlug',
  'action_notifications', 'action_webhook_id',
  'liveRefreshInterval',
  'gemini_model',
  'patchmonNotifyEnabled', 'patchmonNotifyWebhookId', 'patchmonNotifySecurityOnly',
  'panel_container',
  'enabled_modules',
  'migratedNotifyResolved',
  'report_email', 'report_weekly_enabled',
]);

// Zweites Netz: selbst ein versehentlich freigegebener Key wird maskiert, wenn sein
// Name nach einem Geheimnis aussieht.
const SECRET_KEY_PATTERN = /token|secret|password|_pass$|api[_-]?key|_key$|auth/i;

const istUnbedenklich = (key) => SAFE_CONFIG_KEYS.has(key) && !SECRET_KEY_PATTERN.test(key);

// ─── Redaction-Helfer ─────────────────────────────────────────────────────────

// Userinfo (user:pass@) und Query-String aus einer URL entfernen, Host/Pfad bleiben sichtbar.
function urlOhneZugang(wert) {
  const s = String(wert ?? '');
  try {
    const u = new URL(s);
    u.username = ''; u.password = ''; u.search = '';
    return u.toString();
  } catch {
    // Keine gültige absolute URL (z.B. nur ein Host:Port) — grob per Regex säubern.
    return s.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, '$1•••@');
  }
}

const maskSecret = (value) => (value ? 'gesetzt' : 'nicht gesetzt');

// ─── Fehlerisolation ──────────────────────────────────────────────────────────

async function versuch(was, fn) {
  try {
    return await fn();
  } catch (err) {
    return { fehler: `${was} nicht ermittelbar: ${err.message}` };
  }
}

// ─── Generischer TCP-Reachability-Probe ──────────────────────────────────────

function reachable(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.connect({ host, port: Number(port) });
    const finish = (ok, reason) => {
      socket.destroy();
      resolve({ host: `${host}:${port}`, ok, ms: Date.now() - start, ...(reason ? { reason } : {}) });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'Zeitlimit'));
    socket.once('error', (e) => finish(false, e.code || e.message));
  });
}

// ─── Einzelne Sektionen ───────────────────────────────────────────────────────

function panelInfo() {
  const versionFile = path.join(__dirname, '../../../version.json');
  let version = { version: 'unknown', build: 0, date: null };
  try { version = JSON.parse(fs.readFileSync(versionFile, 'utf8')); } catch {}
  return version;
}

function runtimeInfo() {
  return {
    nodeVersion: process.version,
    platform:    os.platform(),
    arch:        os.arch(),
    pid:         process.pid,
    uptimeSec:   Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  };
}

function hostResources() {
  const total = os.totalmem();
  const free  = os.freemem();
  const res = {
    loadavg:      os.loadavg().map(n => Math.round(n * 100) / 100),
    cpuCount:     os.cpus().length,
    memTotalMb:   Math.round(total / (1024 * 1024)),
    memUsedPct:   Math.round(((total - free) / total) * 1000) / 10,
  };
  try {
    const stat = fs.statfsSync(path.dirname(getDbPath()));
    const diskTotal = stat.blocks * stat.bsize;
    const diskFree  = stat.bfree  * stat.bsize;
    res.diskTotalGb = Math.round(diskTotal / (1024 ** 3) * 10) / 10;
    res.diskUsedPct = Math.round(((diskTotal - diskFree) / diskTotal) * 1000) / 10;
  } catch (e) {
    res.diskFehler = e.message;
  }
  return res;
}

function getDbPath() {
  return process.env.DB_PATH || path.join(__dirname, '../../data.db');
}

function databaseInfo() {
  const dbPath = getDbPath();
  const quickCheck = db.pragma('quick_check', { simple: true });
  const journalMode = db.pragma('journal_mode', { simple: true });
  const tables = ['users', 'remote_agents', 'metrics', 'panel_logs', 'alert_rules', 'ssl_monitors'];
  const rowCounts = {};
  for (const t of tables) {
    try { rowCounts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; }
    catch { rowCounts[t] = null; }
  }
  let sizeMb = null;
  try { sizeMb = Math.round(fs.statSync(dbPath).size / (1024 * 1024) * 10) / 10; } catch {}
  return {
    file:        path.basename(dbPath),
    sizeMb,
    journalMode,
    quickCheck,  // 'ok' oder eine Fehlerbeschreibung
    rowCounts,
  };
}

async function agentsReachability() {
  const agents = db.prepare('SELECT id, name, url, token, fingerprint FROM remote_agents ORDER BY name').all();
  const checks = agents.map(async (a) => {
    const start = Date.now();
    try {
      const { data } = await agentClient(a, 4000).get('/ping');
      return {
        name: a.name, ok: true, ms: Date.now() - start,
        tlsPinned: !!a.fingerprint,
        version: data?.version ?? null,
      };
    } catch (err) {
      return {
        name: a.name, ok: false, ms: Date.now() - start,
        tlsPinned: !!a.fingerprint,
        grund: err.response?.data?.error || err.code || err.message,
      };
    }
  });
  return Promise.all(checks);
}

function webSocketInfo() {
  const { getClientCount } = require('../websocket');
  return getClientCount();
}

function backgroundWorkers() {
  const safe = (modPath) => {
    try {
      const mod = require(modPath);
      return typeof mod.getStatus === 'function' ? mod.getStatus() : { unbekannt: true };
    } catch (e) {
      return { fehler: e.message };
    }
  };
  return {
    alertEvaluator:        safe('../alertEvaluator'),
    metricsAggregator:     safe('../metricsAggregator'),
    remoteMetricsRecorder: safe('../remoteMetricsRecorder'),
    dockerMetricsRecorder: safe('../dockerMetricsRecorder'),
    logCollector:          safe('../logCollector'),
    reportScheduler:       safe('../reportScheduler'),
    sslMonitor:            safe('./sslMonitor'),
    agentAutoUpdate:       safe('./agentAutoUpdate'),
    ipIntel:               safe('./ipIntel'),
    threatIntel:           safe('./threatIntel'),
    autoSperre:            safe('./autoSperre'),
  };
}

function sslMonitorSummary() {
  const { getStatus } = require('./sslMonitor');
  const bald = db.prepare(`
    SELECT domain, valid_to, days_remaining, status
    FROM ssl_monitors
    WHERE active = 1 AND (days_remaining IS NULL OR days_remaining <= 30)
    ORDER BY days_remaining ASC
  `).all();
  return { ...getStatus(), baldAblaufend: bald };
}

function updateCheckSummary() {
  const { getCache } = require('./updateCheck');
  return getCache();
}

async function smtpSummary(opt) {
  const info = smtpConfigured();
  if (opt.smtpTest && info.configured) {
    try {
      await sendTestMail(opt.smtpTestTo);
      info.testMail = { ok: true, to: opt.smtpTestTo };
    } catch (err) {
      info.testMail = { ok: false, fehler: err.message };
    }
  }
  return info;
}

function sanitizeLogMessage(msg) {
  if (!msg) return '';
  let s = String(msg);
  // E-Mail-Adressen durch <adresse> ersetzen
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<adresse>');
  // Bearer-Tokens, API-Keys in Text maskieren
  s = s.replace(/(bearer\s+|token[=:]\s*|api[_-]?key[=:]\s*)[a-zA-Z0-9_\-\.]{12,}/gi, '$1<token>');
  // Passwörter und Secrets maskieren
  s = s.replace(/(password|secret|pass)[=:]\s*[^\s&]+/gi, '$1=<geheimnis>');
  return s;
}

function panelLogsRecent(anzahl) {
  const rows = db.prepare('SELECT id, level, source, message, created_at FROM panel_logs ORDER BY id DESC LIMIT ?')
    .all(anzahl);
  return rows.map(r => ({ ...r, message: sanitizeLogMessage(r.message) }));
}

function configSummary() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) {
    if (!istUnbedenklich(r.key)) {
      out[r.key] = maskSecret(r.value);
      continue;
    }
    out[r.key] = (r.key.toLowerCase().includes('url') || r.key.toLowerCase().includes('host'))
      ? urlOhneZugang(r.value)
      : r.value;
  }
  return {
    settings: out,
    jwtSecret: maskSecret(process.env.JWT_SECRET),
    dbPath:    path.basename(getDbPath()),
    allowedOrigin: process.env.ALLOWED_ORIGIN || null,
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function erstellen(opt = {}) {
  const logAnzahl = Math.min(200, Math.max(10, Number(opt.logs) || 50));
  const smtpOpt = { smtpTest: !!opt.smtpTest, smtpTestTo: opt.smtpTestTo };

  const [
    panel, runtime, host, database, agents, webSocket,
    workers, ssl, updateCheck, smtp, logs, config,
  ] = await Promise.all([
    versuch('Panel',           () => panelInfo()),
    versuch('Runtime',         () => runtimeInfo()),
    versuch('Host-Ressourcen', () => hostResources()),
    versuch('Datenbank',       () => databaseInfo()),
    versuch('Agents',          () => agentsReachability()),
    versuch('WebSocket',       () => webSocketInfo()),
    versuch('Hintergrund-Worker', () => backgroundWorkers()),
    versuch('SSL-Monitor',     () => sslMonitorSummary()),
    versuch('Update-Check',    () => updateCheckSummary()),
    versuch('SMTP',            () => smtpSummary(smtpOpt)),
    versuch('Panel-Logs',      () => panelLogsRecent(logAnzahl)),
    versuch('Konfiguration',   () => configSummary()),
  ]);

  return {
    erstellt: new Date().toISOString(),
    panel, runtime, host, database, agents, webSocket,
    backgroundWorkers: workers, sslMonitor: ssl, updateCheck, smtp, logs, config,
  };
}

// ─── Markdown-Export ──────────────────────────────────────────────────────────

function alsText(bericht) {
  const zeilen = [`# Diagnose-Bericht — ${bericht.erstellt}`, ''];
  for (const [key, value] of Object.entries(bericht)) {
    if (key === 'erstellt') continue;
    zeilen.push(`## ${key}`, '```json', JSON.stringify(value, null, 2), '```', '');
  }
  return zeilen.join('\n');
}

module.exports = { erstellen, alsText, reachable, urlOhneZugang, maskSecret };
