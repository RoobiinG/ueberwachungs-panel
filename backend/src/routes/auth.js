const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const db        = require('../db');
const authMiddleware = require('../middleware/auth');
const { getPermissions } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');

// ─── Rate-Limiting ────────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Zu viele Login-Versuche — bitte 15 Minuten warten.' },
});

// ─── SMTP-Helper ──────────────────────────────────────────────────────────────

const getSmtp = () => {
  const get = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value || '';
  return {
    host:     get('smtp_host'),
    port:     parseInt(get('smtp_port')) || 587,
    secure:   get('smtp_secure') === 'true',
    user:     get('smtp_user'),
    pass:     get('smtp_pass'),
    from:     get('smtp_from') || get('smtp_user'),
  };
};

async function sendResetMail(toEmail, resetUrl) {
  const nodemailer = require('nodemailer');
  const smtp = getSmtp();
  if (!smtp.host) throw new Error('SMTP nicht konfiguriert');
  const transporter = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  await transporter.sendMail({
    from:    smtp.from,
    to:      toEmail,
    subject: 'Passwort zurücksetzen — Überwachungs-Panel',
    text:    `Klicke auf diesen Link um dein Passwort zurückzusetzen:\n\n${resetUrl}\n\nDer Link ist 1 Stunde gültig.`,
    html:    `<p>Klicke auf diesen Link um dein Passwort zurückzusetzen:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Der Link ist 1 Stunde gültig.</p>`,
  });
}

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
  const permissions = getPermissions(user.role);
  const roleRow = db.prepare('SELECT hide_local, is_admin FROM roles WHERE name = ?').get(user.role);
  const hideLocal = roleRow?.is_admin ? false : !!roleRow?.hide_local;
  auditLog(req, 'login', 'user', user.username);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role }, permissions, hideLocal });
});

// ─── Passkey-Login (öffentlich) ───────────────────────────────────────────────

let passkeyHandlers;
try {
  passkeyHandlers = require('./passkeys');
  router.post('/passkey/login/start',  passkeyHandlers.loginStart);
  router.post('/passkey/login/finish', passkeyHandlers.loginFinish);
} catch (e) {
  console.warn('WebAuthn nicht verfügbar:', e.message);
}

// ─── Passwort vergessen ───────────────────────────────────────────────────────

router.post('/forgot-password', loginLimiter, async (req, res) => {
  const { username } = req.body;
  // Anti-Enumeration: immer OK zurückgeben, egal ob User existiert
  if (!username) return res.json({ ok: true });

  const user = db.prepare('SELECT id, email FROM users WHERE username = ?').get(username);
  if (!user?.email) return res.json({ ok: true }); // Kein E-Mail → still ignore

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3_600_000; // 1 Stunde
  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id);

  const origin   = process.env.ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || 3001}`;
  const resetUrl = `${origin}/reset-password?token=${token}`;
  try {
    await sendResetMail(user.email, resetUrl);
  } catch (err) {
    console.error('[Auth] Reset-Mail Fehler:', err.message);
  }
  res.json({ ok: true });
});

// ─── Passwort zurücksetzen ────────────────────────────────────────────────────

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token und neues Passwort erforderlich' });
  if (newPassword.length < 12) return res.status(400).json({ error: 'Passwort muss mindestens 12 Zeichen lang sein' });

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_expires || user.reset_expires < Date.now()) {
    return res.status(400).json({ error: 'Token ungültig oder abgelaufen' });
  }

  db.prepare('UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), user.id);
  res.json({ ok: true });
});

// ─── Auth-pflichtiger Bereich ─────────────────────────────────────────────────

router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, role, email, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const permissions = getPermissions(user.role);
  // Rollenbezeichnung + hide_local-Flag aus der roles-Tabelle holen
  const roleRow = db.prepare('SELECT label, hide_local, is_admin FROM roles WHERE name = ?').get(user.role);
  // Admins sehen immer alles
  const hideLocal = roleRow?.is_admin ? false : !!roleRow?.hide_local;
  res.json({ ...user, roleLabel: roleRow?.label || user.role, permissions, hideLocal });
});

router.put('/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
  if (newPassword.length < 12) return res.status(400).json({ error: 'Passwort muss mindestens 12 Zeichen lang sein' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  auditLog(req, 'password.change', 'user', req.user.username);
  res.json({ success: true });
});

router.put('/me/email', authMiddleware, (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Gültige E-Mail-Adresse erforderlich' });
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim().toLowerCase(), req.user.id);
  res.json({ success: true });
});

module.exports = router;
