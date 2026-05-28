const router      = require('express').Router();
const axios       = require('axios');
const https       = require('https');
const tls         = require('tls');
const fs          = require('fs');
const path        = require('path');
const db          = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { validatePublicUrl } = require('../utils/validateUrl');
const { auditLog } = require('../utils/audit');

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

// Prüft ob ein Nutzer Zugriff auf einen bestimmten Agent hat
const canAccessAgent = (agentId, roleName) => {
  const role = db.prepare('SELECT id, is_admin, restrict_agents FROM roles WHERE name = ?').get(roleName);
  if (!role || role.is_admin || !role.restrict_agents) return true;
  return !!db.prepare('SELECT 1 FROM agent_grants WHERE role_id = ? AND agent_id = ?').get(role.id, agentId);
};

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

// Axios-Instanz mit Fingerprint-Pinning für HTTPS-Agents
const agentApi = (agent) => {
  const cfg = {
    baseURL: agent.url.replace(/\/$/, ''),
    timeout: 8000,
    headers: agent.token ? { 'x-agent-token': agent.token } : {},
  };

  if (agent.url.startsWith('https://')) {
    cfg.httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Selbstsigniert — wir pinnen manuell
      checkServerIdentity: agent.fingerprint
        ? (hostname, cert) => {
            const got      = (cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();
            const expected = agent.fingerprint.replace(/:/g, '').toLowerCase();
            if (got !== expected) {
              return new Error(
                `TLS-Fingerprint stimmt nicht überein!\nErwartet: ${expected}\nErhalten:  ${got}`
              );
            }
          }
        : () => undefined, // Kein Fingerprint gespeichert: akzeptieren (TOFU)
    });
  }

  return axios.create(cfg);
};

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

  if (!role || role.is_admin || !role.restrict_agents) {
    return res.json(db.prepare(
      'SELECT id, name, url, fingerprint, dockhand_env_id, created_at FROM remote_agents ORDER BY name'
    ).all());
  }

  // Eingeschränkte Rolle: nur gewährte Server
  return res.json(db.prepare(`
    SELECT ra.id, ra.name, ra.url, ra.fingerprint, ra.dockhand_env_id, ra.created_at
    FROM remote_agents ra
    INNER JOIN agent_grants ag ON ag.agent_id = ra.id
    WHERE ag.role_id = ?
    ORDER BY ra.name
  `).all(role.id));
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

  const { name, url, token } = req.body;
  const newUrl = (url ?? agent.url).trim().replace(/\/$/, '');

  if (url && url !== agent.url) {
    try { validatePublicUrl(newUrl); } catch (e) { return res.status(400).json({ error: e.message }); }
  }

  // Neuen Fingerprint holen wenn URL geändert wurde
  let fingerprint = agent.fingerprint;
  if (url && url !== agent.url && newUrl.startsWith('https://')) {
    try { fingerprint = (await fetchFingerprint(newUrl)) || ''; } catch { fingerprint = ''; }
  }

  db.prepare(`
    UPDATE remote_agents SET
      name        = COALESCE(?, name),
      url         = ?,
      token       = COALESCE(?, token),
      fingerprint = ?
    WHERE id = ?
  `).run(name?.trim() ?? null, newUrl, token !== undefined ? token.trim() : null, fingerprint, agent.id);

  auditLog(req, 'agent.edit', 'agent', agent.name, { newUrl });
  res.json({ success: true });
});

router.delete('/:id', requirePermission('agents.delete'), (req, res) => {
  const delAgent = getOne(req.params.id);
  db.prepare('DELETE FROM remote_agents WHERE id = ?').run(req.params.id);
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
    const { data } = await agentApi(agent).post('/update', { script }, { timeout: 30000 });
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

router.get('/:id/docker', requirePermission('docker.view'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
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
  if (!requireDockhandEnv(agent, res)) return;
  try {
    const { data } = await dockhand.getContainerStats(agent.dockhand_env_id, req.params.containerId);
    res.json(data ?? {});
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/:id/docker/containers/:containerId/:action', requirePermission('docker.control'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  if (!requireDockhandEnv(agent, res)) return;
  const { containerId, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Ungültige Aktion' });
  try {
    await dockhand.containerAction(agent.dockhand_env_id, containerId, action);
    auditLog(req, `docker.${action}`, 'container', containerId.slice(0, 12), { agentId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
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
  auditLog(req, 'agent.uninstall', 'agent', agent.name, { url: agent.url });
  res.json({ success: true, message: 'Agent deinstalliert und aus Panel entfernt' });
});

module.exports = router;
