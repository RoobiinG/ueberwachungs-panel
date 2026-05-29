const router = require('express').Router();
const axios = require('axios');
const db = require('../db');
const requireRole = require('../middleware/roles');
const { auditLog } = require('../utils/audit');

const SENSITIVE = ['hetzner_api_token', 'mchost_password', 'mchost_api_token', 'smtp_pass'];

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
    smtp_host:         get('smtp_host'),
    smtp_port:         get('smtp_port') || '587',
    smtp_user:         get('smtp_user'),
    smtp_pass:         get('smtp_pass') ? '***gesetzt***' : '',
    smtp_from:         get('smtp_from'),
    smtp_secure:       get('smtp_secure') || 'false',
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
    const { data } = await axios.post(
      'https://mc-host24.de/api/v1/token',
      { username, password },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
    );
    // Prüfen ob API Erfolg gemeldet hat (status: "SUCCESS")
    if (data?.status !== 'SUCCESS' || data?.success === false) {
      const apiMsg = data?.message || data?.messages?.[0] || 'Anmeldung fehlgeschlagen';
      return res.status(401).json({ error: `MC-Host24: ${apiMsg}. Tipp: E-Mail-Adresse (nicht Anzeigename) verwenden.` });
    }
    // API antwortet mit: { status: "SUCCESS", data: { api_token: "..." } }
    const apiToken = data?.data?.api_token ?? data?.api_token;
    if (!apiToken) {
      return res.status(401).json({ error: `Kein Token in der Antwort. Bitte Support kontaktieren.` });
    }

    set('mchost_username', username);
    set('mchost_password', password);
    set('mchost_api_token', apiToken);

    res.json({ success: true, message: 'Login erfolgreich, Token gespeichert' });
  } catch (err) {
    const msg = err.response?.data?.messages
      ? Object.values(err.response.data.messages).flat().join(', ')
      : err.response?.data?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
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
    const { data } = await axios.post(
      'https://mc-host24.de/api/v1/token',
      { username, password },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
    );
    const apiToken = data?.data?.api_token ?? data?.api_token;
    if (!apiToken) return res.status(401).json({ error: `Kein Token erhalten: ${JSON.stringify(data)}` });
    set('mchost_api_token', apiToken);
    res.json({ success: true, message: 'Token erneuert' });
  } catch (err) {
    const msg = err.response?.data?.messages
      ? Object.values(err.response.data.messages).flat().join(', ')
      : err.response?.data?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

// ─── SMTP-Konfiguration ───────────────────────────────────────────────────────

router.put('/smtp', requireRole('admin'), (req, res) => {
  const { host, port, user, pass, from, secure } = req.body;
  if (host !== undefined) set('smtp_host', host.trim());
  if (port !== undefined) set('smtp_port', String(port));
  if (user !== undefined) set('smtp_user', user.trim());
  if (pass !== undefined && pass !== '***gesetzt***') set('smtp_pass', pass);
  if (from !== undefined) set('smtp_from', from.trim());
  if (secure !== undefined) set('smtp_secure', String(secure));
  auditLog(req, 'settings.smtp_save', 'settings', 'SMTP');
  res.json({ success: true });
});

router.post('/smtp/test', requireRole('admin'), async (req, res) => {
  const adminUser = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  const toEmail   = req.body.email || adminUser?.email;
  if (!toEmail) return res.status(400).json({ error: 'Keine Test-E-Mail-Adresse angegeben — E-Mail in Profil hinterlegen oder im Body mitschicken' });

  const nodemailer = require('nodemailer');
  const smtpHost = get('smtp_host');
  if (!smtpHost) return res.status(400).json({ error: 'SMTP nicht konfiguriert' });

  try {
    const transporter = nodemailer.createTransport({
      host:   smtpHost,
      port:   parseInt(get('smtp_port')) || 587,
      secure: get('smtp_secure') === 'true',
      auth:   get('smtp_user') ? { user: get('smtp_user'), pass: get('smtp_pass') } : undefined,
    });
    await transporter.sendMail({
      from:    get('smtp_from') || get('smtp_user'),
      to:      toEmail,
      subject: 'Test-E-Mail — Überwachungs-Panel',
      text:    'SMTP-Konfiguration erfolgreich!',
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Öffentliche Einstellungen (alle eingeloggten User) ──────────────────────

// Gibt allgemeine, nicht-sensible Panel-Einstellungen zurück
router.get('/general', (req, res) => {
  const raw = parseInt(get('liveRefreshInterval') || '15', 10);
  const secs = Math.max(5, Math.min(300, isNaN(raw) ? 15 : raw));
  res.json({ liveRefreshInterval: secs * 1000 });
});

router.put('/general', requireRole('admin'), (req, res) => {
  const { liveRefreshInterval } = req.body;
  if (liveRefreshInterval !== undefined) {
    const secs = Math.max(5, Math.min(300, parseInt(liveRefreshInterval, 10) || 15));
    set('liveRefreshInterval', String(secs));
    auditLog(req, 'settings.general_save', 'settings', 'liveRefreshInterval', { value: secs });
  }
  res.json({ success: true });
});

// ── Aktions-Benachrichtigungen ────────────────────────────────────────────────
router.get('/notifications', requireRole('admin'), (req, res) => {
  const wid = get('action_webhook_id');
  res.json({
    actionNotifications: get('action_notifications') === '1',
    actionWebhookId:     wid ? parseInt(wid) : null,
  });
});

router.put('/notifications', requireRole('admin'), (req, res) => {
  const { actionNotifications, actionWebhookId } = req.body;
  if (actionNotifications !== undefined)
    set('action_notifications', actionNotifications ? '1' : '0');
  if (actionWebhookId !== undefined)
    set('action_webhook_id', actionWebhookId ? String(actionWebhookId) : '');
  res.json({ success: true });
});

module.exports = (req, res, next) => router(req, res, next);
