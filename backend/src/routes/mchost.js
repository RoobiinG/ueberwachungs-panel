const router = require('express').Router();
const axios  = require('axios');
const db     = require('../db');

const getSetting = (key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
const setSetting = (key, val) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, val);

// ─── Token-Verwaltung ────────────────────────────────────────────────────────

const getToken = async () => {
  const cached = getSetting('mchost_api_token');
  if (cached) return cached;

  const username = getSetting('mchost_username');
  const password = getSetting('mchost_password');
  if (!username || !password) throw new Error('MC-Host24 Zugangsdaten nicht konfiguriert');

  let data;
  try {
    ({ data } = await axios.post(
      'https://mc-host24.de/api/v1/token',
      { username, password },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
    ));
  } catch (err) {
    const msg = err.response?.data?.message
      || Object.values(err.response?.data?.messages || {}).flat().join(', ')
      || err.message;
    throw new Error(`Login fehlgeschlagen: ${msg}`);
  }

  // MC-Host24 kann das Token unter verschiedenen Feldnamen zurückgeben
  const token = data?.api_token ?? data?.token ?? data?.access_token ?? data?.data?.token;

  if (!token) {
    // Zeige die vollständige API-Antwort im Fehler um das Feld zu finden
    throw new Error(`Kein Token in der API-Antwort gefunden. Response: ${JSON.stringify(data)}`);
  }

  setSetting('mchost_api_token', token);
  return token;
};

// ─── Axios-Instanz mit Auth-Header ──────────────────────────────────────────

const api = async () => {
  const token = await getToken();
  return axios.create({
    baseURL: 'https://mc-host24.de/api/v1',
    headers: {
      // MC-Host24 akzeptiert das Token als Bearer oder direkt — wir versuchen beide Varianten
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  });
};

// ─── Error-Handler ───────────────────────────────────────────────────────────

const handle = async (res, fn) => {
  try {
    res.json((await fn()).data);
  } catch (err) {
    // 401 → Token abgelaufen, beim nächsten Call neu holen
    if (err.response?.status === 401) {
      db.prepare("DELETE FROM settings WHERE key = 'mchost_api_token'").run();
    }
    const msg = err.response?.data?.message
      || Object.values(err.response?.data?.messages || {}).flat().join(', ')
      || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/vserver', async (req, res) =>
  handle(res, async () => (await api()).get('/vserver'))
);

router.get('/vserver/:id/status', async (req, res) =>
  handle(res, async () => (await api()).get(`/vserver/${req.params.id}/status`))
);

router.post('/vserver/:id/:action', async (req, res) => {
  const valid = ['start', 'stop', 'shutdown', 'restart'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Ungültige Aktion' });
  handle(res, async () => (await api()).post(`/vserver/${req.params.id}/${req.params.action}`));
});

router.get('/vserver/:id/backups', async (req, res) =>
  handle(res, async () => (await api()).get(`/vserver/${req.params.id}/backups`))
);

router.post('/vserver/:id/backups', async (req, res) =>
  handle(res, async () => (await api()).post(`/vserver/${req.params.id}/backups`))
);

module.exports = router;
