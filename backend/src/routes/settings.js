const router = require('express').Router();
const axios = require('axios');
const db = require('../db');
const requireRole = require('../middleware/roles');

const SENSITIVE = ['hetzner_api_token', 'mchost_password', 'mchost_api_token'];

const get = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
const set = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, value);
const del = (key) => db.prepare('DELETE FROM settings WHERE key = ?').run(key);

// Alle Settings lesen — sensible Werte nur als "gesetzt/nicht gesetzt" zurückgeben
router.get('/', requireRole('admin'), (req, res) => {
  res.json({
    hetzner_api_token: get('hetzner_api_token') ? '***gesetzt***' : '',
    mchost_username:   get('mchost_username'),
    mchost_password:   get('mchost_password') ? '***gesetzt***' : '',
    mchost_token_set:  !!get('mchost_api_token'),
  });
});

// Hetzner Token speichern
router.put('/hetzner', requireRole('admin'), (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token erforderlich' });
  set('hetzner_api_token', token.trim());
  res.json({ success: true });
});

// Hetzner Token löschen
router.delete('/hetzner', requireRole('admin'), (req, res) => {
  del('hetzner_api_token');
  res.json({ success: true });
});

// MC-Host24 Login: Username + Passwort speichern und Token holen
router.post('/mchost/login', requireRole('admin'), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich' });

  try {
    const { data } = await axios.post('https://mc-host24.de/api/v1/token', { username, password });
    const apiToken = data.api_token;
    if (!apiToken) return res.status(401).json({ error: 'Login fehlgeschlagen — kein Token erhalten' });

    set('mchost_username', username);
    set('mchost_password', password);
    set('mchost_api_token', apiToken);

    res.json({ success: true, message: 'Login erfolgreich, Token gespeichert' });
  } catch (err) {
    res.status(401).json({ error: err.response?.data?.message || 'Login fehlgeschlagen' });
  }
});

// MC-Host24 Credentials löschen
router.delete('/mchost', requireRole('admin'), (req, res) => {
  del('mchost_username');
  del('mchost_password');
  del('mchost_api_token');
  res.json({ success: true });
});

// MC-Host24 Token manuell erneuern
router.post('/mchost/refresh', requireRole('admin'), async (req, res) => {
  const username = get('mchost_username');
  const password = get('mchost_password');
  if (!username || !password) return res.status(400).json({ error: 'Keine Zugangsdaten hinterlegt' });

  try {
    const { data } = await axios.post('https://mc-host24.de/api/v1/token', { username, password });
    set('mchost_api_token', data.api_token);
    res.json({ success: true, message: 'Token erneuert' });
  } catch (err) {
    res.status(401).json({ error: err.response?.data?.message || 'Token-Erneuerung fehlgeschlagen' });
  }
});

module.exports = router;
