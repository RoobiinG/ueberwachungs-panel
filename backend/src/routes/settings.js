const router = require('express').Router();
const axios = require('axios');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const { checkAllMonitors } = require('../utils/sslMonitor');
const { sendTestMail } = require('../utils/smtpTest');
const { validatePublicUrl } = require('../utils/validateUrl');

const SENSITIVE = ['hetzner_api_token', 'mchost_password', 'mchost_api_token', 'dsh_api_token', 'smtp_pass', 'github_token', 'npm_password', 'npm_token'];

const get = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
const set = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, value);
const del = (key) => db.prepare('DELETE FROM settings WHERE key = ?').run(key);

// Alle Settings lesen — sensible Werte nur als "gesetzt/nicht gesetzt" zurückgeben
router.get('/', requirePermission('settings.view'), (req, res) => {
  res.json({
    hetzner_api_token: get('hetzner_api_token') ? '***gesetzt***' : '',
    mchost_username:   get('mchost_username'),
    mchost_password:   get('mchost_password') ? '***gesetzt***' : '',
    mchost_token_set:  !!get('mchost_api_token'),
    dsh_api_token:     get('dsh_api_token') ? '***gesetzt***' : '',
    dsh_token_set:     !!get('dsh_api_token'),
    smtp_host:         get('smtp_host'),
    smtp_port:         get('smtp_port') || '587',
    smtp_user:         get('smtp_user'),
    smtp_pass:         get('smtp_pass') ? '***gesetzt***' : '',
    smtp_from:         get('smtp_from'),
    smtp_secure:       get('smtp_secure') || 'false',
    github_token:      get('github_token') ? '***gesetzt***' : '',
    report_email:      get('report_email') || '',
    report_weekly_enabled: get('report_weekly_enabled') === 'true',
    
    // NGINX Proxy Manager
    npm_host:          get('npm_host'),
    npm_port:          get('npm_port') || '81',
    npm_email:         get('npm_email'),
    npm_password:      get('npm_password') ? '***gesetzt***' : '',
    npm_token_set:     !!get('npm_token'),
  });
});


// Hetzner Token speichern
router.put('/hetzner', requirePermission('settings.manage'), (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token erforderlich' });
  set('hetzner_api_token', token.trim());
  res.json({ success: true });
});

// Hetzner Token löschen
router.delete('/hetzner', requirePermission('settings.manage'), (req, res) => {
  del('hetzner_api_token');
  res.json({ success: true });
});

// DeinServerHost (DSH) Token speichern
router.put('/dsh', requirePermission('settings.manage'), (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token erforderlich' });
  set('dsh_api_token', token.trim());
  auditLog(req, 'settings.dsh_token_save', 'settings', 'dsh_api_token');
  res.json({ success: true, message: 'DSH API-Token erfolgreich gespeichert' });
});

// DeinServerHost (DSH) Token löschen
router.delete('/dsh', requirePermission('settings.manage'), (req, res) => {
  del('dsh_api_token');
  auditLog(req, 'settings.dsh_token_delete', 'settings', 'dsh_api_token');
  res.json({ success: true, message: 'DSH API-Token gelöscht' });
});

// DeinServerHost (DSH) Verbindung testen
router.post('/dsh/test', requirePermission('settings.manage'), async (req, res) => {
  const token = req.body.token ? req.body.token.trim() : get('dsh_api_token');
  if (!token) return res.status(400).json({ error: 'Kein DSH API-Token angegeben oder gespeichert' });
  try {
    const { data } = await axios.get('https://api.dsh.gg/api/v2/service', {
      headers: { 'X-TOKEN': token },
      timeout: 8000,
    });
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
    const count = items.length;
    res.json({ success: true, count, message: `Verbindung erfolgreich! ${count} Service(s) bei DSH gefunden.` });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.status(err.response?.status || 500).json({ error: `DSH API Fehler (${err.response?.status || 500}): ${msg}` });
  }
});

// NGINX Proxy Manager
router.post('/npm/login', requirePermission('settings.manage'), async (req, res) => {
  const { host, port, email, password, totp_code, challenge_token } = req.body;
  
  if (!host || !email) {
    return res.status(400).json({ error: 'Host und E-Mail sind erforderlich' });
  }
  if (!password && !challenge_token) {
    return res.status(400).json({ error: 'Passwort oder Challenge Token erforderlich' });
  }

  try {
    const cleanHost = host.trim().replace(/\/+$/, '');
    const cleanPort = parseInt(port) || 81;
    const baseHostUrl = /:\d+$/.test(cleanHost) ? cleanHost : `${cleanHost}:${cleanPort}`;
    const baseUrl = `${baseHostUrl}/api/tokens`;
    const url = totp_code ? `${baseUrl}/2fa` : baseUrl;
    try { validatePublicUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); }
    const payload = totp_code 
      ? { challenge_token, code: totp_code } 
      : { identity: email, secret: password };

    const { data } = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    });

    if (data && data.requires_2fa) {
      return res.json({ requires_2fa: true, challenge_token: data.challenge_token });
    }

    if (data && data.token) {
      set('npm_host', cleanHost);
      set('npm_port', cleanPort);
      set('npm_email', email.trim());
      if (password) set('npm_password', password);
      set('npm_token', data.token);
      
      // NPM-Zertifikate sofort im Hintergrund synchronisieren
      checkAllMonitors().catch(err => console.error('[NPM] Sync nach Login fehlgeschlagen:', err));
      
      res.json({ success: true, message: 'NPM Login erfolgreich' });
    } else {
      res.status(401).json({ error: 'NPM Login fehlgeschlagen: Kein Token erhalten' });
    }
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(err.response?.status || 500).json({ error: `NPM API Fehler: ${msg}` });
  }
});

router.delete('/npm', requirePermission('settings.manage'), (req, res) => {
  del('npm_host');
  del('npm_port');
  del('npm_email');
  del('npm_password');
  del('npm_token');
  res.json({ success: true });
});

// MC-Host24 Login: Username + Passwort speichern und Token holen
router.post('/mchost/login', requirePermission('settings.manage'), async (req, res) => {
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
router.delete('/mchost', requirePermission('settings.manage'), (req, res) => {
  del('mchost_username');
  del('mchost_password');
  del('mchost_api_token');
  res.json({ success: true });
});

// MC-Host24 Token manuell erneuern
router.post('/mchost/refresh', requirePermission('settings.manage'), async (req, res) => {
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

router.put('/smtp', requirePermission('settings.manage'), (req, res) => {
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

// ─── Berichte-Konfiguration ───
router.put('/reports', requirePermission('settings.manage'), (req, res) => {
  const { report_email, report_weekly_enabled } = req.body;
  if (report_email !== undefined) set('report_email', report_email.trim());
  if (report_weekly_enabled !== undefined) set('report_weekly_enabled', report_weekly_enabled ? 'true' : 'false');
  auditLog(req, 'settings.reports_save', 'settings', 'Reports');
  res.json({ success: true });
});

router.post('/smtp/test', requirePermission('settings.manage'), async (req, res) => {
  const adminUser = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  const toEmail   = req.body.email || adminUser?.email;
  if (!toEmail) return res.status(400).json({ error: 'Keine Test-E-Mail-Adresse angegeben — E-Mail in Profil hinterlegen oder im Body mitschicken' });

  try {
    await sendTestMail(toEmail);
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
  res.json({
    liveRefreshInterval: secs * 1000,
    // Standard ist eingeschaltet — abgeschaltet ist es nur bei ausdrücklichem 'off'.
    agentAutoUpdate: get('agentAutoUpdate') !== 'off',
  });
});

router.put('/general', requirePermission('settings.manage'), (req, res) => {
  const { liveRefreshInterval, agentAutoUpdate } = req.body;
  if (liveRefreshInterval !== undefined) {
    const secs = Math.max(5, Math.min(300, parseInt(liveRefreshInterval, 10) || 15));
    set('liveRefreshInterval', String(secs));
    auditLog(req, 'settings.general_save', 'settings', 'liveRefreshInterval', { value: secs });
  }
  if (agentAutoUpdate !== undefined) {
    set('agentAutoUpdate', agentAutoUpdate ? 'on' : 'off');
    auditLog(req, 'settings.general_save', 'settings', 'agentAutoUpdate', { value: !!agentAutoUpdate });
  }
  res.json({ success: true });
});

// ── Aktions-Benachrichtigungen ────────────────────────────────────────────────
router.get('/notifications', requirePermission('settings.view'), (req, res) => {
  const wid = get('action_webhook_id');
  res.json({
    actionNotifications: get('action_notifications') === '1',
    actionWebhookId:     wid ? parseInt(wid) : null,
  });
});

router.put('/notifications', requirePermission('settings.manage'), (req, res) => {
  const { actionNotifications, actionWebhookId } = req.body;
  if (actionNotifications !== undefined)
    set('action_notifications', actionNotifications ? '1' : '0');
  if (actionWebhookId !== undefined)
    set('action_webhook_id', actionWebhookId ? String(actionWebhookId) : '');
  res.json({ success: true });
});

// ── GitHub Personal Access Token (für Update-Check im privaten Repo) ─────────
router.put('/github', requirePermission('settings.manage'), (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token erforderlich' });
  set('github_token', token.trim());
  auditLog(req, 'settings.github', 'settings', 'github_token');
  res.json({ success: true });
});
router.delete('/github', requirePermission('settings.manage'), (req, res) => {
  del('github_token');
  res.json({ success: true });
});

// ── GitHub Token Verbindung und Gültigkeit prüfen ─────────────────────────────
router.post('/github/test', requirePermission('settings.manage'), async (req, res) => {
  const token = req.body.token ? req.body.token.trim() : get('github_token');
  if (!token) {
    return res.status(400).json({ error: 'Kein GitHub Token zum Testen angegeben oder gespeichert.' });
  }

  try {
    const url = 'https://api.github.com/repos/RoobiinG/ueberwachungs-panel/contents/version.json';
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'Ueberwachungs-Panel-UpdateChecker',
        Authorization: `token ${token}`,
      },
      timeout: 10000,
    });

    const ver = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    res.json({
      success: true,
      message: `Token ist gültig! Lesezugriff auf RoobiinG/ueberwachungs-panel erfolgreich (Aktuelle Remote-Version: v${ver.version} Build ${ver.build}).`,
      remoteVersion: ver.version,
      remoteBuild: ver.build,
    });
  } catch (err) {
    const status = err.response?.status;
    let errorMsg = 'Verbindung zu GitHub fehlgeschlagen.';
    if (status === 401) errorMsg = 'GitHub Token ist ungültig oder abgelaufen (401 Unauthorized).';
    else if (status === 404) errorMsg = 'GitHub Token hat keinen Lesezugriff auf das private Repository RoobiinG/ueberwachungs-panel (404 Not Found). Prüfe Repository-Rechte.';
    else if (err.message) errorMsg = `GitHub API-Fehler: ${err.message}`;
    res.status(status || 500).json({ error: errorMsg });
  }
});

// ── Aktive Module & Funktionen ────────────────────────────────────────────────
// Die Vorgabewerte stehen in utils/module.js, damit auch andere Routen (und die
// Anmeldeseite) prüfen können, ob eine Funktion überhaupt aktiv ist.
const { defaultModules, modulAktiv } = require('../utils/module');

router.get('/modules', (req, res) => {
  try {
    const raw = get('enabled_modules');
    const parsed = raw ? JSON.parse(raw) : {};
    res.json({ ...defaultModules, ...parsed });
  } catch {
    res.json(defaultModules);
  }
});

router.put('/modules', requirePermission('settings.manage'), (req, res) => {
  try {
    const { modules } = req.body;
    const raw = get('enabled_modules');
    const existing = raw ? JSON.parse(raw) : {};
    const updated = { ...defaultModules, ...existing, ...(modules || {}) };
    set('enabled_modules', JSON.stringify(updated));
    auditLog(req, 'settings.modules_save', 'settings', 'enabled_modules');
    res.json({ success: true, modules: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = (req, res, next) => router(req, res, next);
