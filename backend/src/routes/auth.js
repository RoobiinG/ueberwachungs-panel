const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const db        = require('../db');
const authMiddleware = require('../middleware/auth');
const { getPermissions } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');

const hashToken   = (t) => crypto.createHash('sha256').update(t).digest('hex');

/**
 * Setzt alle Sitzungen eines Benutzers ungültig — optional mit Ausnahme der aktuellen.
 * Wird nach jeder Passwortänderung aufgerufen: Wer sein Passwort ändert (oder es nach einem
 * Verdacht auf Missbrauch zurücksetzt), erwartet, dass fremde Anmeldungen damit hinfällig sind.
 * Ohne das bliebe ein erbeutetes JWT bis zum Ablauf (Standard 24 h) weiter gültig.
 * @returns {number} Anzahl der beendeten Sitzungen
 */
const revokeUserSessions = (userId, exceptTokenHash = null) => {
  try {
    const rows = db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').all(userId);
    const ins  = db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_hash) VALUES (?)');
    const del  = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
    let count = 0;
    for (const row of rows) {
      if (exceptTokenHash && row.token_hash === exceptTokenHash) continue;
      ins.run(row.token_hash);
      del.run(row.token_hash);
      count++;
    }
    return count;
  } catch {
    return 0;
  }
};

const storeSession = (token, userId, req) => {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO sessions (user_id, token_hash, ip, user_agent)
      VALUES (?, ?, ?, ?)
    `).run(userId, hashToken(token), req.ip || '', req.headers['user-agent'] || '');
  } catch {}
};

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

async function send2faMail(toEmail, code) {
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
    subject: '2FA-Bestätigungscode — Überwachungs-Panel',
    text:    `Dein 2FA Bestätigungscode für das Überwachungs-Panel lautet: ${code}\n\nDer Code ist 10 Minuten gültig.`,
    html:    `<p>Dein 2FA Bestätigungscode für das Überwachungs-Panel lautet:</p><h2 style="font-size:24px;letter-spacing:4px;color:#3b82f6;">${code}</h2><p>Der Code ist 10 Minuten gültig.</p>`,
  });
}

async function sendFailedLoginMail(toEmail, username, ip, userAgent) {
  const nodemailer = require('nodemailer');
  const smtp = getSmtp();
  if (!smtp.host) throw new Error('SMTP nicht konfiguriert');
  const transporter = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  const timeStr = new Date().toLocaleString('de-DE');
  await transporter.sendMail({
    from:    smtp.from,
    to:      toEmail,
    subject: 'Sicherheitswarnung: Fehlgeschlagener Anmeldeversuch — Überwachungs-Panel',
    text:    `Hallo ${username},\n\nes gab gerade einen fehlgeschlagenen Anmeldeversuch am Überwachungs-Panel mit einem falschen Passwort.\n\nDetails:\n• Zeit: ${timeStr}\n• IP-Adresse: ${ip || 'Unbekannt'}\n• Gerät/Browser: ${userAgent || 'Unbekannt'}\n\nFalls du das nicht warst, empfehlen wir dir dringend, dein Passwort zu prüfen und 2FA zu aktivieren.`,
    html:    `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;"><p>Hallo <strong>${username}</strong>,</p><p>es gab gerade einen fehlgeschlagenen Anmeldeversuch am Überwachungs-Panel mit einem falschen Passwort.</p><div style="background:#1e293b;padding:16px;border-radius:8px;margin:16px 0;font-family:monospace;color:#f8fafc;"><p style="margin:4px 0;"><strong>Zeit:</strong> ${timeStr}</p><p style="margin:4px 0;"><strong>IP-Adresse:</strong> ${ip || 'Unbekannt'}</p><p style="margin:4px 0;"><strong>Gerät/Browser:</strong> ${userAgent || 'Unbekannt'}</p></div><p>Falls du das nicht warst, empfehlen wir dir dringend, dein Passwort zu prüfen und 2FA zu aktivieren.</p></div>`,
  });
}

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }
  if (!bcrypt.compareSync(password, user.password)) {
    auditLog(req, 'login.failed', 'user', user.username, { reason: 'Falsches Passwort' });
    if (user.email) {
      const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                    || req.socket?.remoteAddress
                    || req.connection?.remoteAddress
                    || 'Unbekannt';
      const userAgent = req.headers['user-agent'] || 'Unbekannt';
      sendFailedLoginMail(user.email, user.username, rawIp, userAgent).catch((err) => {
        console.warn('[Failed Login Mail] E-Mail-Versand fehlgeschlagen:', err.message);
      });
    }
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }

  // 2FA Prüfung
  if (user.twofa_type && user.twofa_type !== 'none') {
    const tempToken = jwt.sign(
      { id: user.id, username: user.username, is2fa: true },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    if (user.twofa_type === 'email') {
      if (!user.email) {
        return res.status(400).json({ error: 'E-Mail-2FA ist aktiviert, aber im Profil ist keine E-Mail hinterlegt.' });
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = Date.now() + 20 * 60_000;
      db.prepare('UPDATE users SET twofa_code = ?, twofa_expires = ? WHERE id = ?').run(code, expires, user.id);
      console.log(`[2FA Login] Neuer E-Mail-Code für User ${user.username}: ${code}`);
      try {
        await send2faMail(user.email, code);
      } catch (err) {
        console.warn('[2FA Login] E-Mail Versand fehlgeschlagen:', err.message);
        return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + err.message });
      }
    }
    return res.json({
      require2FA: true,
      twofaType: user.twofa_type,
      tempToken,
      message: user.twofa_type === 'email' ? '6-stelliger Code per E-Mail gesendet.' : '6-stelligen Authenticator-Code eingeben.'
    });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
  const permissions = getPermissions(user.role);
  const roleRow = db.prepare('SELECT hide_local, is_admin FROM roles WHERE name = ?').get(user.role);
  const hideLocal = roleRow?.is_admin ? false : !!roleRow?.hide_local;
  storeSession(token, user.id, req);
  auditLog(req, 'login', 'user', user.username);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role }, permissions, hideLocal });
});

// ─── 2FA Verify (Login Schritt 2) ─────────────────────────────────────────────
router.post('/2fa/verify', loginLimiter, (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) return res.status(400).json({ error: 'Token und Code erforderlich' });

  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Abgelaufene oder ungültige Sitzung. Bitte neu einloggen.' });
  }
  if (!decoded.is2fa || !decoded.id) {
    return res.status(401).json({ error: 'Ungültiges 2FA-Token' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  const { verifyTOTP } = require('../utils/totp');

  if (user.twofa_type === 'email') {
    const storedCode = String(user.twofa_code || '').trim();
    const inputCode  = String(code || '').trim();
    if (!storedCode || storedCode !== inputCode || Date.now() > (user.twofa_expires || 0)) {
      console.warn(`[2FA Login] E-Mail Code fehlerhaft für ${user.username}: DB='${storedCode}' vs Input='${inputCode}', Expired=${Date.now() > (user.twofa_expires || 0)}`);
      return res.status(401).json({ error: 'Ungültiger oder abgelaufener E-Mail-Code (Gültigkeit: 20 Minuten)' });
    }
    db.prepare('UPDATE users SET twofa_code = NULL, twofa_expires = NULL WHERE id = ?').run(user.id);
  } else if (user.twofa_type === 'totp') {
    if (!verifyTOTP(user.twofa_secret, code)) {
      return res.status(401).json({ error: 'Ungültiger Authenticator-Code' });
    }
  } else {
    return res.status(400).json({ error: '2FA ist für dieses Konto nicht aktiv' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
  const permissions = getPermissions(user.role);
  const roleRow = db.prepare('SELECT hide_local, is_admin FROM roles WHERE name = ?').get(user.role);
  const hideLocal = roleRow?.is_admin ? false : !!roleRow?.hide_local;
  storeSession(token, user.id, req);
  auditLog(req, 'login.2fa', 'user', user.username);
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
  // Ein Reset läuft ohne Anmeldung — hier werden ausnahmslos alle Sitzungen beendet,
  // damit ein eventuell fremder Zugriff mit dem Zurücksetzen tatsächlich endet.
  const revoked = revokeUserSessions(user.id);
  res.json({ ok: true, revokedSessions: revoked });
});

// ─── Auth-pflichtiger Bereich ─────────────────────────────────────────────────

router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, role, email, twofa_type, created_at FROM users WHERE id = ?').get(req.user.id);
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
  // Alle anderen Sitzungen beenden — die aktuelle bleibt bestehen, damit man nach dem
  // Ändern des eigenen Passworts nicht aus dem Panel fliegt.
  const revoked = revokeUserSessions(req.user.id, req.tokenHash);
  auditLog(req, 'password.change', 'user', req.user.username, { revokedSessions: revoked });
  res.json({ success: true, revokedSessions: revoked });
});

router.put('/me/email', authMiddleware, (req, res) => {
  const { email, currentPassword } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Gültige E-Mail-Adresse erforderlich' });
  // Passwortbestätigung ist hier Pflicht: Die E-Mail-Adresse ist der Wiederherstellungsweg des
  // Kontos. Ohne Prüfung könnte über eine gekaperte Sitzung erst die Adresse getauscht und
  // danach per "Passwort vergessen" das Konto vollständig übernommen werden.
  if (!currentPassword) return res.status(400).json({ error: 'Aktuelles Passwort zur Bestätigung erforderlich' });
  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
  }
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim().toLowerCase(), req.user.id);
  auditLog(req, 'email.change', 'user', req.user.username);
  res.json({ success: true });
});

// ─── 2FA Verwaltung (Konto) ───────────────────────────────────────────────────

router.get('/2fa/status', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT twofa_type, email FROM users WHERE id = ?').get(req.user.id);
  res.json({
    twofa_type: user?.twofa_type || 'none',
    hasEmail: !!user?.email,
  });
});

router.post('/2fa/setup', authMiddleware, async (req, res) => {
  const { type } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  if (type === 'email') {
    if (!user.email) {
      return res.status(400).json({ error: 'Bitte zuerst eine E-Mail-Adresse im Profil hinterlegen' });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = Date.now() + 20 * 60_000;
    db.prepare('UPDATE users SET twofa_code = ?, twofa_expires = ? WHERE id = ?').run(code, expires, user.id);
    console.log(`[2FA Setup] Neuer E-Mail-Code für User ${user.username}: ${code}`);
    try {
      await send2faMail(user.email, code);
      return res.json({ ok: true, type: 'email', message: 'Bestätigungscode an deine E-Mail-Adresse gesendet.' });
    } catch (err) {
      console.warn('[2FA Setup] E-Mail Versand fehlgeschlagen:', err.message);
      return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + err.message });
    }
  } else if (type === 'totp') {
    const { generateSecret, getOtpAuthUrl, generateQrSvg } = require('../utils/totp');
    const secret = generateSecret();
    const otpauthUrl = getOtpAuthUrl('Ueberwachungs-Panel', user.username, secret);
    const qrSvg = generateQrSvg(otpauthUrl);
    return res.json({ ok: true, type: 'totp', secret, qrSvg, otpauthUrl });
  }
  res.status(400).json({ error: 'Ungültiger 2FA-Typ' });
});

router.post('/2fa/enable', authMiddleware, (req, res) => {
  const { type, secret, code } = req.body;
  if (!code) return res.status(400).json({ error: 'Bestätigungscode erforderlich' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  if (type === 'email') {
    const storedCode = String(user.twofa_code || '').trim();
    const inputCode  = String(code || '').trim();
    if (!storedCode) {
      return res.status(400).json({ error: 'Kein E-Mail-Code angefordert. Bitte Setup erneut starten.' });
    }
    if (Date.now() > (user.twofa_expires || 0)) {
      return res.status(400).json({ error: 'E-Mail-Code ist abgelaufen (Gültig: 20 Min). Bitte Setup neu starten.' });
    }
    if (storedCode !== inputCode) {
      console.warn(`[2FA Enable] E-Mail Code fehlerhaft für ${user.username}: Erwartet='${storedCode}', Erhalten='${inputCode}'`);
      return res.status(400).json({ error: 'Der eingegebene 6-stellige Code ist nicht korrekt.' });
    }
    db.prepare("UPDATE users SET twofa_type = 'email', twofa_code = NULL, twofa_expires = NULL WHERE id = ?").run(user.id);
    auditLog(req, '2fa.enable_email', 'user', user.username);
    return res.json({ ok: true, twofa_type: 'email' });
  } else if (type === 'totp') {
    const { verifyTOTP } = require('../utils/totp');
    if (!secret || !verifyTOTP(secret, code)) {
      return res.status(400).json({ error: 'Ungültiger Authenticator-Code' });
    }
    db.prepare("UPDATE users SET twofa_type = 'totp', twofa_secret = ?, twofa_code = NULL, twofa_expires = NULL WHERE id = ?").run(secret, user.id);
    auditLog(req, '2fa.enable_totp', 'user', user.username);
    return res.json({ ok: true, twofa_type: 'totp' });
  }
  res.status(400).json({ error: 'Ungültiger 2FA-Typ' });
});

router.post('/2fa/disable', authMiddleware, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Passwort zur Bestätigung erforderlich' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }

  db.prepare("UPDATE users SET twofa_type = 'none', twofa_secret = NULL, twofa_code = NULL, twofa_expires = NULL WHERE id = ?").run(user.id);
  auditLog(req, '2fa.disable', 'user', user.username);
  res.json({ ok: true, twofa_type: 'none' });
});

module.exports = router;

