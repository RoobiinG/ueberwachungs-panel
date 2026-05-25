const router  = require('express').Router();
const db      = require('../db');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const jwt = require('jsonwebtoken');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getRpId = () => {
  if (process.env.ALLOWED_ORIGIN) {
    try { return new URL(process.env.ALLOWED_ORIGIN).hostname; } catch {}
  }
  return 'localhost';
};
const getRpName = () => 'Überwachungs-Panel';

// In-Memory Challenge-Store mit 5-Min-TTL
const challenges = new Map(); // key → { challenge, userId?, expiresAt }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) { if (v.expiresAt < now) challenges.delete(k); }
}, 60_000);

// ─── Passkey-Registrierung (erfordert auth) ───────────────────────────────────

router.get('/register/start', async (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  const existingPasskeys = db.prepare('SELECT credential_id FROM passkeys WHERE user_id = ?').all(user.id);

  const options = await generateRegistrationOptions({
    rpName:          getRpName(),
    rpID:            getRpId(),
    userName:        user.username,
    userID:          new TextEncoder().encode(String(user.id)),
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(p => ({
      id: p.credential_id,
      transports: ['internal', 'hybrid'],
    })),
    authenticatorSelection: {
      residentKey:     'preferred',
      userVerification: 'preferred',
    },
  });

  challenges.set(`reg:${user.id}`, { challenge: options.challenge, expiresAt: Date.now() + 5 * 60_000 });
  res.json(options);
});

router.post('/register/finish', async (req, res) => {
  const stored = challenges.get(`reg:${req.user.id}`);
  if (!stored) return res.status(400).json({ error: 'Challenge abgelaufen — bitte neu starten' });
  challenges.delete(`reg:${req.user.id}`);

  const { name: deviceName = 'Passkey' } = req.body;

  try {
    const verification = await verifyRegistrationResponse({
      response:           req.body.registration,
      expectedChallenge:  stored.challenge,
      expectedOrigin:     process.env.ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || 3001}`,
      expectedRPID:       getRpId(),
    });

    if (!verification.verified) return res.status(400).json({ error: 'Verifizierung fehlgeschlagen' });

    const { credentialID, credentialPublicKey, counter, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    db.prepare(
      'INSERT INTO passkeys (user_id, credential_id, public_key, counter, device_type, transports) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      req.user.id,
      Buffer.from(credentialID).toString('base64url'),
      Buffer.from(credentialPublicKey).toString('base64url'),
      counter,
      deviceName,
      JSON.stringify(req.body.registration?.response?.transports || []),
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Passkey-Verwaltung (eigene Passkeys) ────────────────────────────────────

router.get('/', (req, res) => {
  const passkeys = db.prepare(
    'SELECT id, device_type, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json(passkeys);
});

router.delete('/:id', (req, res) => {
  const pk = db.prepare('SELECT id FROM passkeys WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!pk) return res.status(404).json({ error: 'Passkey nicht gefunden' });
  db.prepare('DELETE FROM passkeys WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Passkey-Login (öffentlich — kein auth-Middleware) ───────────────────────
// Diese Endpoints werden in auth.js eingebunden

const loginStart = async (req, res) => {
  const options = await generateAuthenticationOptions({
    rpID:             getRpId(),
    userVerification: 'preferred',
    allowCredentials: [], // Passkey sucht selbst nach passenden Keys (discoverable)
  });
  challenges.set(`login:${options.challenge}`, { challenge: options.challenge, expiresAt: Date.now() + 5 * 60_000 });
  res.json(options);
};

const loginFinish = async (req, res) => {
  const credId = req.body?.id;
  if (!credId) return res.status(400).json({ error: 'Ungültige Anfrage' });

  // Passkey aus DB laden
  const pk = db.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(credId);
  if (!pk) return res.status(400).json({ error: 'Unbekannter Passkey' });

  const stored = challenges.get(`login:${req.body.response?.clientDataJSON ? (() => {
    try { return JSON.parse(Buffer.from(req.body.response.clientDataJSON, 'base64url').toString()).challenge; } catch { return ''; }
  })() : ''}`);
  if (!stored) return res.status(400).json({ error: 'Challenge abgelaufen' });

  try {
    const verification = await verifyAuthenticationResponse({
      response:              req.body,
      expectedChallenge:     stored.challenge,
      expectedOrigin:        process.env.ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || 3001}`,
      expectedRPID:          getRpId(),
      credential: {
        id:        pk.credential_id,
        publicKey: Buffer.from(pk.public_key, 'base64url'),
        counter:   pk.counter,
        transports: JSON.parse(pk.transports || '[]'),
      },
    });

    if (!verification.verified) return res.status(401).json({ error: 'Passkey-Verifizierung fehlgeschlagen' });

    // Counter updaten (Replay-Schutz)
    db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(verification.authenticationInfo.newCounter, pk.id);
    challenges.delete(`login:${stored.challenge}`);

    const user  = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(pk.user_id);
    if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = { router, loginStart, loginFinish };
