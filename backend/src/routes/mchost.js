const router = require('express').Router();
const axios = require('axios');
const db = require('../db');

const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
const setSetting = (key, val) => db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, val);

// Token aus DB holen — bei Bedarf automatisch neu fetchen
const getToken = async () => {
  const cached = getSetting('mchost_api_token');
  if (cached) return cached;

  const username = getSetting('mchost_username');
  const password = getSetting('mchost_password');
  if (!username || !password) throw new Error('MC-Host24 Zugangsdaten nicht konfiguriert');

  const { data } = await axios.post('https://mc-host24.de/api/v1/token', { username, password });
  if (!data.api_token) throw new Error('Login fehlgeschlagen');
  setSetting('mchost_api_token', data.api_token);
  return data.api_token;
};

const api = async () => {
  const token = await getToken();
  return axios.create({
    baseURL: 'https://mc-host24.de/api/v1',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
  });
};

const handle = async (res, fn) => {
  try {
    res.json((await fn()).data);
  } catch (err) {
    // Bei 401 gecachten Token löschen — nächster Call holt automatisch neuen
    if (err.response?.status === 401) {
      db.prepare("DELETE FROM settings WHERE key = 'mchost_api_token'").run();
    }
    res.status(err.response?.status || 500).json({ error: err.response?.data || err.message });
  }
};

router.get('/vserver', async (req, res) => handle(res, async () => (await api()).get('/vserver')));
router.get('/vserver/:id/status', async (req, res) => handle(res, async () => (await api()).get(`/vserver/${req.params.id}/status`)));

router.post('/vserver/:id/:action', async (req, res) => {
  const valid = ['start', 'stop', 'shutdown', 'restart'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  handle(res, async () => (await api()).post(`/vserver/${req.params.id}/${req.params.action}`));
});

router.get('/vserver/:id/backups', async (req, res) => handle(res, async () => (await api()).get(`/vserver/${req.params.id}/backups`)));
router.post('/vserver/:id/backups', async (req, res) => handle(res, async () => (await api()).post(`/vserver/${req.params.id}/backups`)));

module.exports = router;
