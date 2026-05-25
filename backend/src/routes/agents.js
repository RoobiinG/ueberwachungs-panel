const router = require('express').Router();
const axios  = require('axios');
const https  = require('https');
const tls    = require('tls');
const db     = require('../db');
const requireRole = require('../middleware/roles');

const getAll = () => db.prepare(
  'SELECT id, name, url, fingerprint, created_at FROM remote_agents ORDER BY name'
).all();
const getOne = (id) => db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(id);

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

router.get('/', (req, res) => {
  res.json(getAll());
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, url, token = '', fingerprint: fpProvided = '' } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name und URL erforderlich' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Ungültige URL' }); }

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

module.exports = router;
