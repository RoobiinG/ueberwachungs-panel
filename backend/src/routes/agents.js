const router      = require('express').Router();
const axios       = require('axios');
const https       = require('https');
const tls         = require('tls');
const db          = require('../db');
const requireRole = require('../middleware/roles');
const { validatePublicUrl } = require('../utils/validateUrl');

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

// Neueste verfügbare Agent-Version von GitHub
router.get('/latest-version', async (req, res) => {
  const version = await fetchLatestVersion();
  res.json({ version });
});

router.get('/', (req, res) => {
  const roleName = req.user?.role;
  const role = db.prepare('SELECT id, is_admin, restrict_agents FROM roles WHERE name = ?').get(roleName);

  if (!role || role.is_admin || !role.restrict_agents) {
    return res.json(db.prepare(
      'SELECT id, name, url, fingerprint, created_at FROM remote_agents ORDER BY name'
    ).all());
  }

  // Eingeschränkte Rolle: nur gewährte Server
  return res.json(db.prepare(`
    SELECT ra.id, ra.name, ra.url, ra.fingerprint, ra.created_at
    FROM remote_agents ra
    INNER JOIN agent_grants ag ON ag.agent_id = ra.id
    WHERE ag.role_id = ?
    ORDER BY ra.name
  `).all(role.id));
});

router.post('/', requireRole('admin'), async (req, res) => {
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

  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), url: cleanUrl, fingerprint });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
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

  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM remote_agents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Fingerprint neu abrufen und speichern (bei Zertifikats-Rotation)
router.post('/:id/repin', requireRole('admin'), async (req, res) => {
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

router.get('/:id/ping', async (req, res) => {
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

router.get('/:id/stats', async (req, res) => {
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

router.get('/:id/services', async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/services');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/:id/services/:name/:action', requireRole('admin', 'operator'), async (req, res) => {
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

router.get('/:id/version', async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  try {
    const { data } = await agentApi(agent).get('/version');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/:id/update', requireRole('admin'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  try {
    const { data } = await agentApi(agent).post('/update', {}, { timeout: 30000 });
    // Versions-Cache invalidieren damit nächste Abfrage aktuell ist
    _latestCache.ts = 0;
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

// ── Docker Proxy ────────────────────────────────────────────────────────────

router.get('/:id/docker', async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/docker');
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: err.response?.data?.error || err.message });
  }
});

router.get('/:id/docker/containers', async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  if (!canAccessAgent(agent.id, req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const { data } = await agentApi(agent).get('/docker/containers');
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: err.response?.data?.error || err.message });
  }
});

router.post('/:id/docker/containers/:containerId/:action', requireRole('admin', 'operator'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  const { containerId, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Ungültige Aktion' });
  if (!/^[a-fA-F0-9]{12,64}$/.test(containerId)) return res.status(400).json({ error: 'Ungültige Container-ID' });
  try {
    const { data } = await agentApi(agent).post(`/docker/containers/${containerId}/${action}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || err.message });
  }
});

module.exports = router;
