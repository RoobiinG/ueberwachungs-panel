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
      'SELECT id, name, url, fingerprint, dockhand_env_id, patchmon_host_id, created_at FROM remote_agents ORDER BY name'
    ).all();
  } else {
    agents = db.prepare(`
      SELECT ra.id, ra.name, ra.url, ra.fingerprint, ra.dockhand_env_id, ra.patchmon_host_id, ra.created_at
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

  const { name, url, token, patchmon_host_id } = req.body;
  const newUrl = (url ?? agent.url).trim().replace(/\/$/, '');

  if (url && url !== agent.url) {
    try { validatePublicUrl(newUrl); } catch (e) { return res.status(400).json({ error: e.message }); }
  }

  // Neuen Fingerprint holen wenn URL geändert wurde
  let fingerprint = agent.fingerprint;
  if (url && url !== agent.url && newUrl.startsWith('https://')) {
    try { fingerprint = (await fetchFingerprint(newUrl)) || ''; } catch { fingerprint = ''; }
  }

  // PatchMon-Verknüpfung: nur ändern wenn Feld im Body ist ('' → Verknüpfung entfernen)
  const pmHostId = ('patchmon_host_id' in req.body)
    ? (patchmon_host_id ? String(patchmon_host_id).trim() : null)
    : (agent.patchmon_host_id ?? null);

  db.prepare(`
    UPDATE remote_agents SET
      name             = COALESCE(?, name),
      url              = ?,
      token            = COALESCE(?, token),
      fingerprint      = ?,
      patchmon_host_id = ?
    WHERE id = ?
  `).run(name?.trim() ?? null, newUrl, token !== undefined ? token.trim() : null, fingerprint, pmHostId, agent.id);

  auditLog(req, 'agent.edit', 'agent', agent.name, { newUrl });
  res.json({ success: true });
});

router.delete('/:id', requirePermission('agents.delete'), (req, res) => {
  const delAgent = getOne(req.params.id);
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
    res.json({ online: true, hostname: data.hostname, tls: data.tls });
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

router.get('/:id/docker/containers/:containerId/stats', requirePermission('docker.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  
  if (useNative()) {
    try {
      const { data } = await agentApi(agent).get(`/docker/containers/${req.params.containerId}/stats`);
      return res.json(data);
    } catch (err) {
      // 404 heißt "Container läuft nicht" — eine gültige Antwort, kein Agent-Ausfall.
      if (err.response?.status === 404) return res.json({ cpu_percent: 0, memory_usage: 0, not_running: true });
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
router.post('/:id/docker/containers/:containerId/terminal-ticket', requirePermission('docker.control'), (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });

  if (!useNative()) {
    return res.status(400).json({ error: 'Natives Terminal ist im Dockhand-Modus nicht verfügbar' });
  }

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

// ── Firewall Proxy ──────────────────────────────────────────────────────────

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

router.post('/:id/firewall/allow', requirePermission('firewall.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).post('/firewall/allow', req.body);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.post('/:id/firewall/deny', requirePermission('firewall.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).post('/firewall/deny', req.body);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

router.delete('/:id/firewall/rules/:num', requirePermission('firewall.manage'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  if (!/^\d+$/.test(req.params.num)) return res.status(400).json({ error: 'Ungültige Regel-Nummer' });
  try {
    const { data } = await agentApi(agent).delete(`/firewall/rules/${req.params.num}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
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

module.exports = router;
