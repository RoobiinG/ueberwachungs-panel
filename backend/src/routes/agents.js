const router      = require('express').Router();
const axios       = require('axios');
const tls         = require('tls');
const fs          = require('fs');
const path        = require('path');
const crypto      = require('crypto');
const db          = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { validatePublicUrl } = require('../utils/validateUrl');
const { auditLog } = require('../utils/audit');
const { canAccessAgent } = require('../utils/agentAccess');
const { agentClient } = require('../utils/agentTls');
const terminalTickets = require('../utils/terminalTickets');
const statsCache      = require('../utils/statsCache');
const { zugangGesichert, warnung } = require('../utils/firewallSchutz');
const geoip           = require('geoip-lite');

const AGENT_RAW_URL = 'https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master/agent/panel-agent.js';

// Neueste GitHub-Version gecacht (1 Stunde TTL)
let _latestCache = { version: null, ts: 0 };
async function fetchLatestVersion() {
  if (Date.now() - _latestCache.ts < 3600000 && _latestCache.version) return _latestCache.version;
  try {
    const { data } = await axios.get(AGENT_RAW_URL, { timeout: 10000, responseType: 'text' });
    const m = data.match(/^const VERSION\s*=\s*['"]([^'"]+)['"]/m);
    _latestCache = { version: m?.[1] || null, ts: Date.now() };
    return _latestCache.version;
  } catch { return _latestCache.version; }
}

const getOne = (id) => db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(id);

const getSetting = k => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;

// canAccessAgent liegt in utils/agentAccess.js — der Terminal-WebSocket-Proxy in index.js
// braucht dieselbe Prüfung und kann keine Express-Middleware verwenden.

// TLS-Fingerprint eines HTTPS-Endpunkts abrufen (ohne Zertifikats-Validierung)
const fetchFingerprint = (urlStr) => new Promise((resolve, reject) => {
  const { hostname, port, protocol } = new URL(urlStr);
  if (protocol !== 'https:') return resolve(null);
  const socket = tls.connect(
    { host: hostname, port: parseInt(port) || 443, rejectUnauthorized: false },
    () => { resolve(socket.getPeerCertificate()?.fingerprint256 || null); socket.destroy(); }
  );
  socket.on('error', reject);
  setTimeout(() => { socket.destroy(); reject(new Error('TLS-Verbindungs-Timeout')); }, 6000);
});

// Axios-Instanz mit Fingerprint-Pinning für HTTPS-Agents (siehe utils/agentTls.js)
const agentApi = (agent) => agentClient(agent, 8000);

// Neueste verfügbare Agent-Version — aus lokalem Script (kein GitHub nötig)
router.get('/latest-version', requirePermission('agents.view'), (req, res) => {
  try {
    const scriptPath = path.resolve(__dirname, '../../../agent/panel-agent.js');
    const content    = fs.readFileSync(scriptPath, 'utf8');
    const m          = content.match(/^const VERSION\s*=\s*['"]([^'"]+)['"]/m);
    const version    = m?.[1] || null;
    res.json({ version });
  } catch {
    res.json({ version: null });
  }
});

// Agent-Script zum Herunterladen (für manuelle Recovery)
// curl -H "Authorization: Bearer TOKEN" PANEL_URL/api/agents/download-script -o panel-agent.js
router.get('/download-script', requirePermission('agents.update'), (req, res) => {
  try {
    const scriptPath = path.resolve(__dirname, '../../../agent/panel-agent.js');
    const content    = fs.readFileSync(scriptPath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="panel-agent.js"');
    res.send(content);
  } catch {
    res.status(500).json({ error: 'Agent-Script nicht gefunden (lokal).' });
  }
});

router.get('/', requirePermission('agents.view'), (req, res) => {
  const roleName = req.user?.role;
  const role = db.prepare('SELECT id, is_admin, restrict_agents FROM roles WHERE name = ?').get(roleName);
  const dockerEngine = getSetting('dockerEngine') || 'agents';

  let agents;
  if (!role || role.is_admin || !role.restrict_agents) {
    agents = db.prepare(
      'SELECT id, name, url, fingerprint, dockhand_env_id, patchmon_host_id, allowed_ports, created_at FROM remote_agents ORDER BY name'
    ).all();
  } else {
    agents = db.prepare(`
      SELECT ra.id, ra.name, ra.url, ra.fingerprint, ra.dockhand_env_id, ra.patchmon_host_id, ra.allowed_ports, ra.created_at
      FROM remote_agents ra
      INNER JOIN agent_grants ag ON ag.agent_id = ra.id
      WHERE ag.role_id = ?
      ORDER BY ra.name
    `).all(role.id);
  }

  res.json(agents.map(a => ({ ...a, docker_engine: dockerEngine })));
});

router.post('/', requirePermission('agents.add'), async (req, res) => {
  const { name, url, token = '', fingerprint: fpProvided = '' } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name und URL erforderlich' });
  try { validatePublicUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); }

  const cleanUrl = url.trim().replace(/\/$/, '');

  // Fingerprint automatisch holen falls HTTPS und noch keiner angegeben
  let fingerprint = fpProvided.trim();
  if (!fingerprint && cleanUrl.startsWith('https://')) {
    try { fingerprint = (await fetchFingerprint(cleanUrl)) || ''; }
    catch { fingerprint = ''; }
  }

  const result = db.prepare(
    'INSERT INTO remote_agents (name, url, token, fingerprint) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), cleanUrl, token.trim(), fingerprint);

  auditLog(req, 'agent.create', 'agent', name.trim(), { url: cleanUrl });
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), url: cleanUrl, fingerprint });
});

router.put('/:id', requirePermission('agents.edit'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  const { name, url, token, patchmon_host_id } = req.body;
  const newUrl = (url ?? agent.url).trim().replace(/\/$/, '');

  if (url && url !== agent.url) {
    try { validatePublicUrl(newUrl); } catch (e) { return res.status(400).json({ error: e.message }); }
  }

  // Neuen Fingerprint holen wenn URL geändert wurde. Schlägt der Abruf fehl (Netzwerk-
  // Hänger, Agent gerade im Neustart), darf das NICHT den bisher gepinnten Fingerprint
  // löschen — sonst nimmt der nächste Aufruf jedes beliebige Zertifikat an (TLS-Pinning
  // stillschweigend aus), ohne dass irgendwo eine Warnung erscheint. Stattdessen bleibt
  // der alte Pin stehen und die Anfrage schlägt sichtbar fehl.
  let fingerprint = agent.fingerprint;
  if (url && url !== agent.url && newUrl.startsWith('https://')) {
    try {
      const neu = await fetchFingerprint(newUrl);
      if (!neu) return res.status(502).json({ error: 'Kein Zertifikat von der neuen URL erhalten — Fingerprint (TLS-Pinning) bleibt auf dem alten Stand. Bitte erneut versuchen oder über „Repin" neu abrufen.' });
      fingerprint = neu;
    } catch (e) {
      return res.status(502).json({ error: `Zertifikat der neuen URL konnte nicht abgerufen werden (${e.message}) — Fingerprint (TLS-Pinning) bleibt auf dem alten Stand. Bitte erneut versuchen oder über „Repin" neu abrufen.` });
    }
  }

  // PatchMon-Verknüpfung: nur ändern wenn Feld im Body ist ('' → Verknüpfung entfernen)
  const pmHostId = ('patchmon_host_id' in req.body)
    ? (patchmon_host_id ? String(patchmon_host_id).trim() : null)
    : (agent.patchmon_host_id ?? null);

  const newAllowedPorts = ('allowed_ports' in req.body)
    ? (Array.isArray(req.body.allowed_ports) ? JSON.stringify(req.body.allowed_ports) : '[]')
    : (agent.allowed_ports ?? '[]');

  db.prepare(`
    UPDATE remote_agents SET
      name             = COALESCE(?, name),
      url              = ?,
      token            = COALESCE(?, token),
      fingerprint      = ?,
      patchmon_host_id = ?,
      allowed_ports    = ?
    WHERE id = ?
  `).run(name?.trim() ?? null, newUrl, token !== undefined ? token.trim() : null, fingerprint, pmHostId, newAllowedPorts, agent.id);

  auditLog(req, 'agent.edit', 'agent', agent.name, { newUrl });
  res.json({ success: true });
});

router.delete('/:id', requirePermission('agents.delete'), (req, res) => {
  const delAgent = getOne(req.params.id);
  if (!delAgent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(delAgent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  db.prepare('DELETE FROM remote_agents WHERE id = ?').run(req.params.id);
  
  // Clean up alert_rules agent_ids
  const rules = db.prepare('SELECT id, agent_ids FROM alert_rules').all();
  for (const rule of rules) {
    try {
      let ids = JSON.parse(rule.agent_ids || '[]');
      if (ids.includes(req.params.id) || ids.includes(String(req.params.id))) {
        ids = ids.filter(id => String(id) !== String(req.params.id));
        db.prepare('UPDATE alert_rules SET agent_ids = ? WHERE id = ?').run(JSON.stringify(ids), rule.id);
      }
    } catch {}
  }

  auditLog(req, 'agent.delete', 'agent', delAgent?.name || req.params.id);
  res.json({ success: true });
});

// Fingerprint neu abrufen und speichern (bei Zertifikats-Rotation)
router.post('/:id/repin', requirePermission('agents.edit'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  if (!agent.url.startsWith('https://')) return res.status(400).json({ error: 'Nur für HTTPS' });
  try {
    const fingerprint = await fetchFingerprint(agent.url);
    if (!fingerprint) return res.status(502).json({ error: 'Kein Zertifikat erhalten' });
    db.prepare('UPDATE remote_agents SET fingerprint = ? WHERE id = ?').run(fingerprint, agent.id);
    res.json({ fingerprint });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:id/ping', requirePermission('agents.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/ping');
    // `terminal` sagt, ob die Container-Konsole bereitsteht (ws + node-pty vorhanden).
    // Ältere Agenten melden es nicht — dann bleibt es undefined und das Panel versucht
    // es wie bisher einfach.
    res.json({ online: true, hostname: data.hostname, tls: data.tls, terminal: data.terminal });
  } catch (err) {
    const isMitm = err.message?.includes('Fingerprint');
    res.json({ online: false, mitm: isMitm, error: err.message });
  }
});

router.get('/:id/stats', requirePermission('metrics.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/stats');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:id/services', requirePermission('services.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/services');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.post('/:id/services/:name/:action', requirePermission('services.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  const { name, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Ungültige Aktion' });
  try {
    const { data } = await agentApi(agent).post(`/services/${encodeURIComponent(name)}/${action}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

// ── Prozesse ─────────────────────────────────────────────────────────────────

router.get('/:id/processes', requirePermission('agents.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/processes');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.post('/:id/processes/:pid/kill', requirePermission('agents.manage_processes'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  const { pid } = req.params;
  const { signal = 'SIGTERM' } = req.body || {};
  try {
    const { data } = await agentApi(agent).post(`/processes/${encodeURIComponent(pid)}/kill`, { signal });
    auditLog(req, 'agent.process.kill', 'process', `${pid} (${signal})`, { agentId: agent.id, server: agent.name });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

// ── Cron-Jobs ────────────────────────────────────────────────────────────────

router.get('/:id/cron/users', requirePermission('cron.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/cron/users');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.get('/:id/cron/jobs/:user', requirePermission('cron.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get(`/cron/jobs/${encodeURIComponent(req.params.user)}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.post('/:id/cron/jobs/:user', requirePermission('cron.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).post(`/cron/jobs/${encodeURIComponent(req.params.user)}`, req.body);
    auditLog(req, 'agent.cron.add', 'cron', `${req.params.user}: ${req.body.schedule}`, { agentId: agent.id, server: agent.name });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.delete('/:id/cron/jobs/:user/:index', requirePermission('cron.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).delete(`/cron/jobs/${encodeURIComponent(req.params.user)}/${encodeURIComponent(req.params.index)}`);
    auditLog(req, 'agent.cron.delete', 'cron', `User: ${req.params.user}, Index: ${req.params.index}`, { agentId: agent.id, server: agent.name });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

// ── Server-Notizbuch & Wartungsmodus (Modul 4) ───────────────────────────────

router.get('/:id/notes', requirePermission('agents.view'), (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const row = db.prepare('SELECT title, content_md, updated_at FROM server_notes WHERE server_id = ?').get(String(agent.id));
    res.json(row || { title: '', content_md: '', updated_at: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/notes', requirePermission('agents.edit'), (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  const { title = '', content_md = '' } = req.body || {};
  try {
    db.prepare(`
      INSERT INTO server_notes (server_id, title, content_md, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(server_id) DO UPDATE SET
        title = excluded.title,
        content_md = excluded.content_md,
        updated_at = CURRENT_TIMESTAMP
    `).run(String(agent.id), title, content_md);
    auditLog(req, 'agent.notes.update', 'agent', agent.name, { id: agent.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/maintenance', requirePermission('agents.view'), (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const row = db.prepare(`
      SELECT * FROM maintenance_windows
      WHERE server_id = ? AND CURRENT_TIMESTAMP BETWEEN start_time AND end_time
      ORDER BY end_time DESC LIMIT 1
    `).get(String(agent.id));
    res.json({ active: !!row, window: row || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/maintenance', requirePermission('agents.edit'), (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  const { hours = 1, reason = 'Geplante Wartung' } = req.body || {};
  try {
    db.prepare('DELETE FROM maintenance_windows WHERE end_time < CURRENT_TIMESTAMP').run();
    const result = db.prepare(`
      INSERT INTO maintenance_windows (server_id, start_time, end_time, reason, created_by)
      VALUES (?, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+' || ? || ' hours'), ?, ?)
    `).run(String(agent.id), Number(hours) || 1, reason, req.user?.username || 'admin');
    auditLog(req, 'agent.maintenance.enable', 'agent', agent.name, { hours, reason });
    const row = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, window: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/maintenance', requirePermission('agents.edit'), (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    db.prepare('DELETE FROM maintenance_windows WHERE server_id = ?').run(String(agent.id));
    auditLog(req, 'agent.maintenance.disable', 'agent', agent.name, { id: agent.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Version & Update ─────────────────────────────────────────────────────────


router.get('/:id/version', requirePermission('agents.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/version');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/agents/update-all
router.post('/update-all', requirePermission('agents.update'), async (req, res) => {
  const scriptPath = path.resolve(__dirname, '../../../agent/panel-agent.js');
  let script;
  try {
    script = fs.readFileSync(scriptPath, 'utf8');
  } catch {
    return res.status(500).json({ error: 'Agent-Script nicht gefunden (lokal).' });
  }

  const scriptVersion = (script.match(/^const VERSION\s*=\s*['"]([^'"]+)['"]/m) || [])[1] || null;
  const allAgents = db.prepare('SELECT * FROM remote_agents ORDER BY name').all();
  let accessible = allAgents.filter(a => canAccessAgent(a.id, req.user?.role));
  if (Array.isArray(req.body?.agentIds) && req.body.agentIds.length > 0) {
    const idSet = new Set(req.body.agentIds.map(String));
    accessible = accessible.filter(a => idSet.has(String(a.id)));
  }

  const results = [];
  for (const agent of accessible) {
    try {
      const hmac = crypto.createHmac('sha256', agent.token).update(script).digest('hex');
      const { data } = await agentApi(agent).post('/update', { script, hmac }, { timeout: 30000 });
      try {
        db.prepare('UPDATE remote_agents SET version = ? WHERE id = ?').run(scriptVersion || data.newVersion, agent.id);
      } catch {}
      auditLog(req, 'agent.update', 'agent', agent.name, { from: data.oldVersion, to: data.newVersion, bulk: true });
      results.push({ id: agent.id, name: agent.name, success: true, oldVersion: data.oldVersion, newVersion: data.newVersion });
    } catch (err) {
      results.push({ id: agent.id, name: agent.name, success: false, error: err.response?.data?.error || err.message });
    }
  }

  _latestCache.ts = 0;
  res.json({
    total: accessible.length,
    updated: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  });
});

router.post('/:id/update', requirePermission('agents.update'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  // Aktuelles Agent-Script vom lokalen Dateisystem lesen und direkt pushen
  const scriptPath = path.resolve(__dirname, '../../../agent/panel-agent.js');
  let script;
  try {
    script = fs.readFileSync(scriptPath, 'utf8');
  } catch {
    return res.status(500).json({ error: 'Agent-Script nicht gefunden (lokal). Bitte manuell aktualisieren.' });
  }

  try {
    // HMAC-Signatur damit der Agent die Herkunft verifizieren kann
    const hmac = crypto.createHmac('sha256', agent.token).update(script).digest('hex');
    const { data } = await agentApi(agent).post('/update', { script, hmac }, { timeout: 30000 });
    // Versions-Cache invalidieren damit nächste Abfrage aktuell ist
    _latestCache.ts = 0;
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

// POST /api/agents/:id/packages/update
router.post('/:id/packages/update', requirePermission('system.update'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  auditLog(req, 'agent.packages_update', 'agent', agent.name, { agentId: agent.id });

  if (useNative()) {
    try {
      // Eigener Client mit langem Timeout: die 8 Sekunden des Standard-Clients sind
      // eine Socket-Inaktivitätsgrenze und würden ein laufendes Update abschneiden,
      // sobald apt einmal länger keine Zeile ausgibt (z. B. beim Entpacken).
      const response = await agentClient(agent, 60 * 60 * 1000)
        .post('/packages/update', {}, { responseType: 'stream' });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      // NGINX puffert Proxy-Antworten von sich aus. Ohne diesen Header käme das
      // Live-Log erst am Schluss an — und bei einem Abbruch überhaupt nicht.
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      // Reißt die Verbindung zum Agenten ab — typisch, wenn das Update Docker oder
      // den Server selbst neu startet —, darf der ungefangene Stream-Fehler nicht
      // den ganzen Panel-Prozess mitnehmen.
      response.data.on('error', (streamErr) => {
        console.error('[Update Stream]', agent.name, streamErr.message);
        if (!res.writableEnded) res.end(`\n[Verbindung zum Agenten abgerissen: ${streamErr.message}]\n`);
      });
      // Bricht der Browser ab, auch die Leitung zum Agenten schließen. Das Update
      // selbst läuft auf dem Zielserver weiter — es hängt nicht an der Verbindung.
      req.on('close', () => response.data.destroy());

      response.data.pipe(res);
      return;
    } catch (err) {
      console.error('[Update Error]', err.message, err.response?.data);
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(400).json({ error: err.response?.data?.error || err.message });
      }
    }
  }
  res.status(501).json({ error: 'Paket-Updates via Dockhand nicht unterstützt. Bitte auf Native Agent umstellen.' });
});


// ── Docker via Dockhand Hawser ────────────────────────────────────────────────
// Remote-Container werden jetzt über Dockhand Environments abgefragt,
// nicht mehr direkt über den panel-agent.

const dockhand = require('../utils/dockhandClient');

const requireDockhandEnv = (agent, res) => {
  if (!agent.dockhand_env_id) {
    res.status(400).json({
      error: `Kein Dockhand-Environment für "${agent.name}" konfiguriert. Bitte unter Einstellungen → Dockhand zuweisen.`,
    });
    return false;
  }
  return true;
};

// ─── Betriebsart: nativ / mixed / dockhand ───────────────────────────────────
// 'agents'   → ausschließlich über den Panel-Agent
// 'mixed'    → zuerst der Agent, bei Fehler Rückfall auf Dockhand Pro
// 'dockhand' → ausschließlich über Dockhand Pro
const engineMode = () => getSetting('dockerEngine') || 'agents';
const useNative  = () => engineMode() !== 'dockhand';

// Gedrosselte Meldung je Agent, damit die pollende Docker-Seite das Log nicht flutet.
const _fallbackSeen = new Map();
const FALLBACK_QUIET_MS = 5 * 60 * 1000;

// Entscheidet nach einem gescheiterten Agent-Aufruf, ob auf Dockhand ausgewichen wird.
// Der Rückfall passiert bewusst *nicht* stillschweigend: Sonst verdeckt er dauerhaft
// einen ausgefallenen Agenten, und niemand merkt, dass nativ längst nichts mehr geht.
const allowFallback = (req, agent, what, err) => {
  if (engineMode() !== 'mixed') return false;
  if (!agent.dockhand_env_id)   return false;   // ohne Environment gibt es nichts zum Ausweichen

  const last = _fallbackSeen.get(agent.id) || 0;
  if (Date.now() - last > FALLBACK_QUIET_MS) {
    _fallbackSeen.set(agent.id, Date.now());
    console.warn(`[Docker] Agent "${agent.name}" antwortet nicht (${err.message}) — Rückfall auf Dockhand Pro`);
    auditLog(req, 'docker.fallback.dockhand', 'agent', agent.name, { grund: err.message, aufruf: what });
  }
  return true;
};

router.get('/:id/docker', requirePermission('docker.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  
  if (useNative()) {
    try {
      // Bewusst ohne .catch()-Unterdrückung: Sonst meldete die Übersicht auch bei
      // totem Agenten "online" mit 0 Containern, statt den Fehler zu zeigen bzw. im
      // Mixed-Modus auf Dockhand auszuweichen.
      const [{ data: containers }, { data: images }] = await Promise.all([
        agentApi(agent).get('/docker/containers'),
        agentApi(agent).get('/docker/images'),
      ]);
      const running = containers.filter(c => c.state === 'running').length;
      const stopped = containers.filter(c => c.state !== 'running').length;
      return res.json({
        images: images.length,
        volumes: null,
        networks: null,
        serverVersion: 'Agent Nativ',
        envName: agent.name,
        envStatus: 'online',
        containers: { running, stopped }
      });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    const envId = agent.dockhand_env_id;
    // Environments + Images parallel laden
    const [envRes, imagesRes] = await Promise.allSettled([
      dockhand.getEnvironments(),
      dockhand.getImages(envId),
    ]);
    const envList = envRes.status === 'fulfilled' ? (Array.isArray(envRes.value.data) ? envRes.value.data : []) : [];
    const env     = envList.find(e => String(e.id) === String(envId)) ?? {};
    const images  = imagesRes.status === 'fulfilled' ? (Array.isArray(imagesRes.value.data) ? imagesRes.value.data : []) : [];
    res.json({
      images:        images.length,
      volumes:       null,   // Dockhand liefert keine Volume-Statistik pro Environment
      networks:      null,
      serverVersion: env.dockerVersion || env.version || null,
      envName:       env.name || null,
      envStatus:     env.status || null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:id/docker/containers', requirePermission('docker.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  
  if (useNative()) {
    try {
      const { data } = await agentApi(agent).get('/docker/containers');
      return res.json(data);
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    const { data } = await dockhand.getContainers(agent.dockhand_env_id);
    res.json((Array.isArray(data) ? data : []).map(dockhand.normalizeContainer));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /:id/docker/stats ─────────────────────────────────────────────────────
// Auslastung *aller* laufenden Container eines Servers in einer einzigen Antwort.
// Muss vor der Einzelroute darunter stehen, sonst gilt „stats" als Container-Kennung.
//
// Warum es das gibt: Einzeln abgefragt braucht jeder Container rund zwei Sekunden, weil
// die Docker-Engine für die CPU-Prozente zwei Messpunkte abwarten muss. Bei zehn
// Containern und dem Verbindungslimit des Browsers zog sich das über zehn Sekunden und
// wiederholte sich alle acht. Hier laufen die Abrufe gebündelt und gleichzeitig, das
// Ergebnis wird ein paar Sekunden vorgehalten.
router.get('/:id/docker/stats', requirePermission('docker.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  try {
    const daten = await statsCache.holen(`agent:${agent.id}`, async () => {
      const api = agentApi(agent);
      const { data: liste } = await api.get('/docker/containers');
      const laufende = (Array.isArray(liste) ? liste : []).filter(c => (c.state || '').toLowerCase() === 'running');

      // Ein einzelner Container, der klemmt, darf nicht die ganze Antwort verhindern.
      const ergebnisse = await Promise.allSettled(
        laufende.map(c => api.get(`/docker/containers/${c.id}/stats`).then(r => [c.id, r.data]))
      );
      const karte = {};
      for (const e of ergebnisse) if (e.status === 'fulfilled') karte[e.value[0]] = e.value[1];
      return karte;
    });
    res.json(daten);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.get('/:id/docker/containers/:containerId/stats', requirePermission('docker.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  
  if (useNative()) {
    try {
      const { data } = await agentApi(agent).get(`/docker/containers/${req.params.containerId}/stats`);
      return res.json(data);
    } catch (err) {
      // "Container läuft nicht / gibt es nicht mehr" ist eine gültige Antwort, kein
      // Agent-Ausfall. Der Agent liefert das aber nicht immer als HTTP 404, sondern auch
      // als Meldung — dann entstand hier ein 502, das die pollende Docker-Seite im
      // Sekundentakt als Fehler ins Panel-Log schrieb, sobald ein Container neu erstellt
      // wurde und seine alte ID noch abgefragt wurde.
      const meldung = err.response?.data?.error || err.message || '';
      if (err.response?.status === 404 || /nicht gefunden|no such container|404/i.test(meldung)) {
        return res.json({ cpu_percent: 0, memory_usage: 0, not_running: true });
      }
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    const { data } = await dockhand.getContainerStats(agent.dockhand_env_id, req.params.containerId);
    res.json(data ?? {});
  } catch (err) {
    if (err.message?.includes('Ressource nicht gefunden') || err.message?.includes('404')) {
      return res.json({ cpu_percent: 0, memory_usage: 0, not_running: true });
    }
    res.status(502).json({ error: err.message });
  }
});

router.get('/:id/docker/containers/:containerId/logs', requirePermission('docker.logs'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  
  if (useNative()) {
    try {
      const tail = Math.max(1, Math.min(10000, parseInt(req.query.tail) || 100));
      const { data } = await agentApi(agent).get(`/docker/containers/${req.params.containerId}/logs?tail=${tail}`);
      return res.json(data);
    } catch (err) {
      if (err.response?.status === 404) return res.json([]);
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    const tail = Math.max(1, Math.min(10000, parseInt(req.query.tail) || 100));
    const { data } = await dockhand.getContainerLogs(agent.dockhand_env_id, req.params.containerId, tail);
    res.json(data ?? []);
  } catch (err) {
    if (err.message?.includes('Ressource nicht gefunden') || err.message?.includes('404')) {
      return res.json([]);
    }
    res.status(502).json({ error: err.message });
  }
});

// Einmal-Ticket für den Terminal-WebSocket. Muss vor der generischen :action-Route
// stehen, sonst würde die 'terminal-ticket' als Container-Aktion auffassen.
//
// Die Betriebsart (nativ / mixed / dockhand) wird hier bewusst *nicht* geprüft: Die
// Konsole läuft seit v5.4.1.0 grundsätzlich über den Panel-Agent, auch wenn die
// Container-Daten selbst von Dockhand kommen. Ein Rückfall auf ein Dockhand-Terminal
// existiert nicht mehr.
router.post('/:id/docker/containers/:containerId/terminal-ticket', requirePermission('docker.control'), (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  const ticket = terminalTickets.issue({
    userId:      req.user?.id,
    username:    req.user?.username,
    role:        req.user?.role,
    agentId:     agent.id,
    containerId: req.params.containerId,
  });
  res.json({ ticket });
});

router.post('/:id/docker/containers/:containerId/:action', requirePermission('docker.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  const { containerId, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Ungültige Aktion' });
  
  if (useNative()) {
    try {
      await agentApi(agent).post(`/docker/containers/${containerId}/${action}`);
      auditLog(req, `docker.${action}`, 'container', containerId.slice(0, 12), { agentId: req.params.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    await dockhand.containerAction(agent.dockhand_env_id, containerId, action);
    auditLog(req, `docker.${action}`, 'container', containerId.slice(0, 12), { agentId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Images ───────────────────────────────────────────────────────────────────
router.get('/:id/docker/images', requirePermission('docker.images.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  
  if (useNative()) {
    try {
      const { data } = await agentApi(agent).get('/docker/images');
      return res.json(data || []);
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try { res.json((await dockhand.getImages(agent.dockhand_env_id)).data || []); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

const validImageRef = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,220}$/.test(s);

router.post('/:id/docker/images/pull', requirePermission('docker.images.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  const image = (req.body?.image || '').trim();
  if (!validImageRef(image)) return res.status(400).json({ error: 'Ungültige Image-Referenz' });

  if (useNative()) {
    try {
      await agentApi(agent).post('/docker/images/pull', { image });
      auditLog(req, 'docker.image.pull', 'image', image, { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    await dockhand.pullImage(agent.dockhand_env_id, image);
    auditLog(req, 'docker.image.pull', 'image', image, { agentId: agent.id });
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.post('/:id/docker/images/prune', requirePermission('docker.images.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      await agentApi(agent).post('/docker/images/prune');
      auditLog(req, 'docker.image.prune', 'image', 'ungenutzte', { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    const { data } = await dockhand.pruneImages(agent.dockhand_env_id);
    auditLog(req, 'docker.image.prune', 'image', 'ungenutzte', { agentId: agent.id });
    res.json(data ?? { success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.delete('/:id/docker/images/:imageId', requirePermission('docker.images.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      await agentApi(agent).delete(`/docker/images/${encodeURIComponent(req.params.imageId)}`);
      auditLog(req, 'docker.image.delete', 'image', String(req.params.imageId).slice(0, 20), { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    await dockhand.removeImage(agent.dockhand_env_id, req.params.imageId);
    auditLog(req, 'docker.image.delete', 'image', String(req.params.imageId).slice(0, 20), { agentId: agent.id });
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── Volumes ───────────────────────────────────────────────────────────────────
router.get('/:id/docker/volumes', requirePermission('docker.volumes.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      const { data } = await agentApi(agent).get('/docker/volumes');
      return res.json(data || []);
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try { res.json((await dockhand.getVolumes(agent.dockhand_env_id)).data || []); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

router.delete('/:id/docker/volumes/:volumeName', requirePermission('docker.volumes.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      await agentApi(agent).delete(`/docker/volumes/${encodeURIComponent(req.params.volumeName)}`);
      auditLog(req, 'docker.volume.delete', 'volume', String(req.params.volumeName).slice(0, 40), { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    await dockhand.removeVolume(agent.dockhand_env_id, req.params.volumeName);
    auditLog(req, 'docker.volume.delete', 'volume', String(req.params.volumeName).slice(0, 40), { agentId: agent.id });
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.post('/:id/docker/volumes/prune', requirePermission('docker.volumes.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      await agentApi(agent).post('/docker/volumes/prune');
      auditLog(req, 'docker.volume.prune', 'volume', 'ungenutzte', { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    const { data } = await dockhand.pruneVolumes(agent.dockhand_env_id);
    auditLog(req, 'docker.volume.prune', 'volume', 'ungenutzte', { agentId: agent.id });
    res.json(data ?? { success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── Networks ──────────────────────────────────────────────────────────────────
router.get('/:id/docker/networks', requirePermission('docker.networks.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      const { data } = await agentApi(agent).get('/docker/networks');
      return res.json(data || []);
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try { res.json((await dockhand.getNetworks(agent.dockhand_env_id)).data || []); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

router.delete('/:id/docker/networks/:networkId', requirePermission('docker.networks.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      await agentApi(agent).delete(`/docker/networks/${encodeURIComponent(req.params.networkId)}`);
      auditLog(req, 'docker.network.delete', 'network', String(req.params.networkId).slice(0, 20), { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    await dockhand.removeNetwork(agent.dockhand_env_id, req.params.networkId);
    auditLog(req, 'docker.network.delete', 'network', String(req.params.networkId).slice(0, 20), { agentId: agent.id });
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.post('/:id/docker/networks/prune', requirePermission('docker.networks.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      await agentApi(agent).post('/docker/networks/prune');
      auditLog(req, 'docker.network.prune', 'network', 'ungenutzte', { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    const { data } = await dockhand.pruneNetworks(agent.dockhand_env_id);
    auditLog(req, 'docker.network.prune', 'network', 'ungenutzte', { agentId: agent.id });
    res.json(data ?? { success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── Stacks ────────────────────────────────────────────────────────────────────
router.get('/:id/docker/stacks', requirePermission('docker.stacks.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      const { data } = await agentApi(agent).get('/docker/stacks');
      return res.json(data || []);
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try { res.json((await dockhand.getStacks(agent.dockhand_env_id)).data || []); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

router.delete('/:id/docker/stacks/:stackId', requirePermission('docker.stacks.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      // Löschen für native Stacks führt ein docker compose down aus (kein Löschen der yml Dateien)
      await agentApi(agent).post(`/docker/stacks/${encodeURIComponent(req.params.stackId)}/down`);
      auditLog(req, 'docker.stack.delete', 'stack', String(req.params.stackId).slice(0, 40), { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  try {
    await dockhand.removeStack(agent.dockhand_env_id, req.params.stackId);
    auditLog(req, 'docker.stack.delete', 'stack', String(req.params.stackId).slice(0, 40), { agentId: agent.id });
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.post('/:id/docker/stacks/:stackId/:action', requirePermission('docker.stacks.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  const { stackId, action } = req.params;
  
  // Modul 10: Live-Deploy Stream (nativ)
  if (action === 'deploy') {
    if (!useNative()) return res.status(501).json({ error: 'Live-Deploy nur mit Native Agent unterstützt.' });
    try {
      const response = await agentApi(agent).post(`/docker/stacks/${encodeURIComponent(stackId)}/deploy`, null, {
        responseType: 'stream',
        timeout: 0 // Stream nicht abbrechen
      });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      
      response.data.on('error', (err) => {
        if (!res.writableEnded) res.end(`\n[Stream Fehler: ${err.message}]\n`);
      });
      req.on('close', () => response.data.destroy());
      response.data.pipe(res);
      auditLog(req, 'docker.stack.deploy', 'stack', String(stackId).slice(0, 40), { agentId: agent.id });
      return;
    } catch (err) {
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }
  
  if (useNative()) {
    const validNativeActions = ['start', 'stop', 'update', 'restart']; // We mapped up, down, pull in agent, but UI might send start, stop, update
    if (!validNativeActions.includes(action)) return res.status(400).json({ error: 'Invalid action' });
    
    // Map UI actions to docker compose actions
    let agentAction = action;
    if (action === 'start') agentAction = 'up';
    if (action === 'stop') agentAction = 'down';
    if (action === 'update') agentAction = 'pull';
    
    try {
      await agentApi(agent).post(`/docker/stacks/${encodeURIComponent(stackId)}/${agentAction}`);
      // if it was a pull, we also need to restart (up -d)
      if (agentAction === 'pull') {
        await agentApi(agent).post(`/docker/stacks/${encodeURIComponent(stackId)}/up`);
      }
      auditLog(req, `docker.stack.${action}`, 'stack', String(stackId).slice(0, 40), { agentId: agent.id });
      return res.json({ success: true });
    } catch (err) {
      // Mixed-Modus: Agent-Fehler faellt unten auf Dockhand zurueck
      if (!allowFallback(req, agent, req.originalUrl, err)) {
        return res.status(502).json({ error: err.response?.data?.error || err.message });
      }
    }
  }

  if (!requireDockhandEnv(agent, res)) return;
  if (!['start', 'stop', 'update'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    if (action === 'start') await dockhand.startStack(agent.dockhand_env_id, stackId);
    else if (action === 'stop') await dockhand.stopStack(agent.dockhand_env_id, stackId);
    else if (action === 'update') await dockhand.updateStack(agent.dockhand_env_id, stackId, req.body);
    auditLog(req, `docker.stack.${action}`, 'stack', String(stackId).slice(0, 40), { agentId: agent.id });
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

router.get('/:id/docker/stacks/:stackId/file', requirePermission('docker.stacks.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      const { data } = await agentApi(agent).get(`/docker/stacks/${encodeURIComponent(req.params.stackId)}/file`);
      return res.json(data);
    } catch (err) {
      return res.status(502).json({ error: err.response?.data?.error || err.message });
    }
  }
  res.status(501).json({ error: 'Stack-Editor via Dockhand nicht unterstützt.' });
});

router.put('/:id/docker/stacks/:stackId/file', requirePermission('docker.stacks.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (useNative()) {
    try {
      const { data } = await agentApi(agent).put(`/docker/stacks/${encodeURIComponent(req.params.stackId)}/file`, req.body);
      auditLog(req, 'docker.stack.edit', 'stack', String(req.params.stackId).slice(0, 40), { agentId: agent.id });
      return res.json(data);
    } catch (err) {
      return res.status(502).json({ error: err.response?.data?.error || err.message });
    }
  }
  res.status(501).json({ error: 'Stack-Editor via Dockhand nicht unterstützt.' });
});

// ── Firewall Proxy ──────────────────────────────────────────────────────────
// Der Agent kann seit jeher /firewall/detect und /firewall/toggle — es fehlten nur
// die Proxys davor. Ohne /detect meldete das Frontend für jeden Remote-Server
// „Keine aktive Firewall gefunden" und lud die Regeln erst gar nicht.

// Regel-IDs sehen je nach Tool unterschiedlich aus: laufende Nummer (UFW, iptables),
// nftables-Handle, "PORT/PROTO" und "svc:NAME" (firewalld) sowie "rich:INDEX" für
// firewalld-Rich-Rules. Alles andere wird abgewiesen, damit nichts in die URL zum
// Agenten und von dort in einen Befehl gerät.
const isValidRuleId = (id) =>
  /^\d+$/.test(id) ||
  /^\d{1,5}(:\d{1,5})?\/(tcp|udp)$/.test(id) ||
  /^svc:[\w.-]{1,64}$/.test(id) ||
  /^rich:\d{1,4}$/.test(id);

const firewallAgent = (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) { res.status(404).json({ error: 'Agent nicht gefunden' }); return null; }
  if (!canAccessAgent(agent.id, req.user?.role)) { res.status(403).json({ error: 'Kein Zugriff' }); return null; }
  return agent;
};

const firewallFail = (res, err) =>
  res.status(err.response?.status || 502).json({ error: err.response?.data?.error || err.message });

router.get('/:id/firewall/detect', requirePermission('firewall.view'), async (req, res) => {
  const agent = firewallAgent(req, res); if (!agent) return;
  try {
    const { data } = await agentApi(agent).get('/firewall/detect');
    res.json(data);
  } catch (err) { firewallFail(res, err); }
});

router.post('/:id/firewall/toggle', requirePermission('firewall.manage'), async (req, res) => {
  const agent = firewallAgent(req, res); if (!agent) return;
  try {
    // Dieselbe Bremse wie beim lokalen Server — hier sogar wichtiger: Sperrt sich ein
    // Remote-Server aus, ist er weder über das Panel noch über SSH zurückzuholen, und der
    // Agent als einziger Draht dorthin ist mit weg. Die Prüfung passiert im Panel und
    // wirkt deshalb auch mit älteren Agenten, ohne dort ein Update zu erzwingen.
    if (req.body?.enable === true && req.body?.trotzdem !== true) {
      let regeln = [];
      try {
        const { data } = await agentApi(agent).get('/firewall/rules');
        regeln = Array.isArray(data) ? data : (data?.rules || []);
      } catch { regeln = []; }
      // Zusätzlich zum SSH-Port der Port, über den das Panel den Agenten erreicht.
      const agentPort = parseInt((agent.url || '').match(/:(\d{2,5})(?:\/|$)/)?.[1] || '', 10);
      const { sicher, fehlend } = zugangGesichert(regeln, isNaN(agentPort) ? [] : [agentPort]);
      if (!sicher) {
        return res.status(409).json({ error: warnung(fehlend), fehlendePorts: fehlend, bestaetigungNoetig: true });
      }
    }

    const { data } = await agentApi(agent).post('/firewall/toggle', req.body);
    auditLog(req, req.body?.enable ? 'firewall.enable' : 'firewall.disable', 'firewall',
      req.body?.tool || 'agent', { agentId: agent.id, agentName: agent.name });
    res.json(data);
  } catch (err) { firewallFail(res, err); }
});

// Bearbeiten = löschen + neu anlegen. Agenten ab 2.6.0 erledigen das in einem Aufruf;
// bei älteren gibt es den Endpunkt nicht, dann übernimmt das Panel die beiden Schritte
// selbst. So funktioniert Bearbeiten sofort auf allen Servern, auch ohne Agent-Update.
router.put('/:id/firewall/rules/:num', requirePermission('firewall.manage'), async (req, res) => {
  const agent = firewallAgent(req, res); if (!agent) return;
  const id = String(req.params.num);
  if (!isValidRuleId(id)) return res.status(400).json({ error: 'Ungültige Regel-ID' });

  const { port, proto, from, action } = req.body || {};
  if (!port || !action) return res.status(400).json({ error: 'Port und Aktion erforderlich' });
  if (action !== 'allow' && action !== 'deny') return res.status(400).json({ error: 'Ungültige Aktion' });

  const api = agentApi(agent);
  try {
    const { data } = await api.put(`/firewall/rules/${encodeURIComponent(id)}`, req.body);
    auditLog(req, 'firewall.edit', 'rule', `Regel ${id} → ${port}/${proto || 'tcp'}`,
      { agentId: agent.id, action, from: from || 'any' });
    return res.json(data);
  } catch (err) {
    if (err.response?.status !== 404) return firewallFail(res, err);
  }

  try {
    await api.delete(`/firewall/rules/${encodeURIComponent(id)}`);
    const { data } = await api.post(`/firewall/${action}`, { port, proto, from });
    auditLog(req, 'firewall.edit', 'rule', `Regel ${id} → ${port}/${proto || 'tcp'}`,
      { agentId: agent.id, action, from: from || 'any', fallback: true });
    res.json(data);
  } catch (err) { firewallFail(res, err); }
});

router.get('/:id/firewall/status', requirePermission('firewall.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/firewall/status');
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json({ error: err.response?.data?.error || err.message });
  }
});

router.get('/:id/firewall/rules', requirePermission('firewall.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/firewall/rules');
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 502).json({ error: err.response?.data?.error || err.message });
  }
});

// Die beiden schrieben bisher nichts ins Audit-Log — Firewall-Änderungen an
// Remote-Servern waren damit nirgends nachvollziehbar, anders als lokale.
router.post('/:id/firewall/allow', requirePermission('firewall.manage'), async (req, res) => {
  const agent = firewallAgent(req, res); if (!agent) return;
  try {
    const { data } = await agentApi(agent).post('/firewall/allow', req.body);
    auditLog(req, 'firewall.allow', 'rule', `${req.body?.port}${req.body?.proto ? '/' + req.body.proto : ''}`,
      { agentId: agent.id, agentName: agent.name, from: req.body?.from || 'any' });
    res.json(data);
  } catch (err) { firewallFail(res, err); }
});

router.post('/:id/firewall/deny', requirePermission('firewall.manage'), async (req, res) => {
  const agent = firewallAgent(req, res); if (!agent) return;
  try {
    const { data } = await agentApi(agent).post('/firewall/deny', req.body);
    auditLog(req, 'firewall.deny', 'rule', `${req.body?.port}${req.body?.proto ? '/' + req.body.proto : ''}`,
      { agentId: agent.id, agentName: agent.name, from: req.body?.from || 'any' });
    res.json(data);
  } catch (err) { firewallFail(res, err); }
});

// Die Prüfung ließ früher nur reine Zahlen zu — firewalld-Regeln heißen aber
// "80/tcp" oder "svc:ssh" und waren damit remote nicht löschbar.
router.delete('/:id/firewall/rules/:num', requirePermission('firewall.manage'), async (req, res) => {
  const agent = firewallAgent(req, res); if (!agent) return;
  const id = String(req.params.num);
  if (!isValidRuleId(id)) return res.status(400).json({ error: 'Ungültige Regel-ID' });
  try {
    const { data } = await agentApi(agent).delete(`/firewall/rules/${encodeURIComponent(id)}`);
    auditLog(req, 'firewall.delete', 'rule', `Regel ${id}`, { agentId: agent.id, agentName: agent.name });
    res.json(data);
  } catch (err) { firewallFail(res, err); }
});

// ── System-Stats Proxy (CPU, RAM, Disk, Kerne) ──────────────────────────────
// Wird von Monitoring-Frontend alle 3s gepolt — fehlte bisher → 404

router.get('/:id/system/stats', requirePermission('metrics.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/stats', { timeout: 8000 });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

// ── Netzwerk Proxy ──────────────────────────────────────────────────────────

router.get('/:id/network/interfaces', requirePermission('metrics.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/network/interfaces');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.get('/:id/network/stats', requirePermission('metrics.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/network/stats', { timeout: 12000 }); // 1s Messung + Puffer
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.get('/:id/network/public-ip', requirePermission('metrics.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/network/public-ip');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

// ── SSH & Sicherheit Proxy ────────────────────────────────────────────────────
router.get('/:id/ssh/keys', requirePermission('agents.manage_ssh'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/ssh/keys');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.delete('/:id/ssh/keys/:identifier', requirePermission('agents.manage_ssh'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).delete(`/ssh/keys/${encodeURIComponent(req.params.identifier)}`);
    auditLog(req, 'agent.ssh.remove_key', 'agent', agent.name, { identifier: req.params.identifier });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.get('/:id/ssh/audit', requirePermission('agents.manage_ssh'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/ssh/audit');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.get('/:id/ssh/sessions', requirePermission('agents.manage_ssh'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data: ips } = await agentApi(agent).get('/network/ssh-sessions');
    const sessions = (ips || []).map(ip => {
      const geo = geoip.lookup(ip);
      return {
        ip,
        country: geo ? geo.country : 'Unknown',
        city: geo ? geo.city : ''
      };
    });
    res.json(sessions);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

// ── Agent deinstallieren (stoppt + entfernt Service auf dem Server) ──────────

router.post('/:id/uninstall', requirePermission('agents.delete'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    await agentApi(agent).post('/uninstall', {}, { timeout: 10000 });
  } catch {
    // Agent antwortet ggf. nicht mehr nach dem Stop — Fehler ignorieren
  }
  // Agent aus Panel-DB entfernen
  db.prepare('DELETE FROM remote_agents WHERE id = ?').run(agent.id);

  // Clean up alert_rules agent_ids
  const rules = db.prepare('SELECT id, agent_ids FROM alert_rules').all();
  for (const rule of rules) {
    try {
      let ids = JSON.parse(rule.agent_ids || '[]');
      if (ids.includes(agent.id) || ids.includes(String(agent.id))) {
        ids = ids.filter(id => String(id) !== String(agent.id));
        db.prepare('UPDATE alert_rules SET agent_ids = ? WHERE id = ?').run(JSON.stringify(ids), rule.id);
      }
    } catch {}
  }

  auditLog(req, 'agent.uninstall', 'agent', agent.name, { url: agent.url });
  res.json({ success: true, message: 'Agent deinstalliert und aus Panel entfernt' });
});

// ── System-Aufräumen (Modul 7) ───────────────────────────────────────────────
router.post('/:id/system/cleanup', requirePermission('disks.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  try {
    const { data } = await agentApi(agent).post('/system/cleanup', req.body);
    auditLog(req, 'system.cleanup', 'system', agent.name, { agentId: agent.id, tasks: req.body });
    return res.json(data);
  } catch (err) {
    if (!allowFallback(req, agent, req.originalUrl, err)) {
      return res.status(502).json({ error: err.response?.data?.error || err.message });
    }
  }
});

// ── Festplatten-Gesundheit (Modul 7) ─────────────────────────────────────────
router.get('/:id/disks/smart', requirePermission('disks.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  try {
    const { data } = await agentApi(agent).get('/disks/smart');
    return res.json(data);
  } catch (err) {
    if (!allowFallback(req, agent, req.originalUrl, err)) {
      return res.status(502).json({ error: err.response?.data?.error || err.message });
    }
  }
});

router.post('/:id/disks/smart/test', requirePermission('disks.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  try {
    const { data } = await agentApi(agent).post('/disks/smart/test', { disk: req.body.disk });
    auditLog(req, 'disks.smart.test', 'disk', req.body.disk, { agentId: agent.id });
    return res.json(data);
  } catch (err) {
    if (!allowFallback(req, agent, req.originalUrl, err)) {
      return res.status(502).json({ error: err.response?.data?.error || err.message });
    }
  }
});

module.exports = router;
