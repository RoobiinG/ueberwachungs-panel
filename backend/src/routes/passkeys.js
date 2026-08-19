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

/**
 * RP ID = Hostname ohne Port, muss zur aktuellen Browser-Origin passen.
 * Reihenfolge:
 *  1. ALLOWED_ORIGIN env (explizit konfiguriert)
 *  2. Origin-Header des Requests (zuverlässigste Quelle beim Browser-Aufruf)
 *  3. Host-Header (Proxy-Szenarien)
 *  4. Fallback localhost
 */
const getRpId = (req) => {
  if (process.env.ALLOWED_ORIGIN) {
    try { return new URL(process.env.ALLOWED_ORIGIN).hostname; } catch {}
  }
  if (req?.headers?.origin) {
    try { return new URL(req.headers.origin).hostname; } catch {}
  }
  if (req?.headers?.host) {
    return req.headers.host.split(':')[0];
  }
  return 'localhost';
};

/**
 * Erwartete Origin für WebAuthn-Verifizierung.
 * Muss exakt mit der Origin übereinstimmen, die der Browser beim Registrieren sah.
 */
const getOrigin = (req) => {
  if (process.env.ALLOWED_ORIGIN) return process.env.ALLOWED_ORIGIN;
  if (req?.headers?.origin) return req.headers.origin;
  const proto = req?.headers?.['x-forwarded-proto'] || (req?.secure ? 'https' : 'http');
  const host  = req?.headers?.['x-forwarded-host'] || req?.headers?.host || `localhost:${process.env.PORT || 3001}`;
  return `${proto}://${host}`;
};

const getRpName = () => 'Überwachungs-Panel';

// In-Memory Challenge-Store mit 5-Min-TTL
const challenges = new Map(); // key → { challenge, userId?, expiresAt }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) { if (v.expiresAt < now) challenges.delete(k); }
}, 60_000);

// ─── Passkey-Registrierung (erfordert auth) ───────────────────────────────────

// Wohin der Passkey gespeichert werden soll. Ohne Angabe entscheidet der Browser —
// und der wählt unter Windows praktisch immer Windows Hello, sodass Passwortmanager
// wie Enpass gar nicht erst zur Auswahl stehen. Wer sie ausdrücklich will, muss den
// Plattform-Authenticator ausschließen; umgekehrt meldet sich Enpass in Brave *als*
// Plattform-Authenticator, weshalb 'extern' dort das Falsche wäre. Deshalb entscheidet
// das nicht der Server, sondern der Benutzer beim Anlegen.
// `still` nutzt den Weg, den die Spezifikation „conditional create" nennt: Der
// Passwortmanager, in dem das gerade benutzte Passwort liegt, legt den Passkey selbst an —
// ohne Auswahl, ohne Systemdialog. Deshalb darf hier *keine* Bauart vorgegeben werden,
// sonst schließt die Vorgabe genau den Manager aus, der es tun soll. Den Unterschied macht
// allein das Frontend beim Aufruf; serverseitig ist es eine gewöhnliche Registrierung.
const ATTACHMENT = {
  geraet: 'platform',        // Windows Hello, Touch ID, Android-Bildschirmsperre
  extern: 'cross-platform',  // Passwortmanager, Sicherheitsschlüssel, anderes Gerät
  auto:   undefined,         // der Browser entscheidet
  still:  undefined,         // der Passwortmanager legt ihn ohne Dialog an
};

router.get('/register/start', async (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  const ziel = String(req.query.ziel || 'auto');
  if (!(ziel in ATTACHMENT)) return res.status(400).json({ error: 'Unbekanntes Speicherziel' });
  const attachment = ATTACHMENT[ziel];

  const existingPasskeys = db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').all(user.id);

  const options = await generateRegistrationOptions({
    rpName:          getRpName(),
    rpID:            getRpId(req),
    userName:        user.username,
    userID:          new TextEncoder().encode(String(user.id)),
    attestationType: 'none',
    // Die tatsächlich gemeldeten Transportwege verwenden, nicht geraten: Nur damit
    // erkennt der Browser zuverlässig, welcher Authenticator schon belegt ist.
    excludeCredentials: existingPasskeys.map(p => {
      let transports = [];
      try { transports = JSON.parse(p.transports || '[]'); } catch {}
      return { id: p.credential_id, ...(transports.length ? { transports } : {}) };
    }),
    authenticatorSelection: {
      ...(attachment ? { authenticatorAttachment: attachment } : {}),
      residentKey:      'required',    // discoverable credential → Login ohne Benutzername
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

  // Frontend kann direkt attResp oder { registration: attResp, name: '...' } senden
  const regResponse = req.body.registration ?? req.body;
  const deviceName  = req.body.name || 'Passkey';

  try {
    const verification = await verifyRegistrationResponse({
      response:          regResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin:    getOrigin(req),
      expectedRPID:      getRpId(req),
      requireUserVerification: false,
    });

    if (!verification.verified) return res.status(400).json({ error: 'Verifizierung fehlgeschlagen' });

    // SimpleWebAuthn v9+: registrationInfo.credential statt direkte Felder
    const { credential, credentialDeviceType } = verification.registrationInfo;

    db.prepare(
      'INSERT INTO passkeys (user_id, credential_id, public_key, counter, device_type, transports) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      req.user.id,
      credential.id,                                               // Bereits Base64URL-String
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      deviceName,
      JSON.stringify(credential.transports || regResponse.response?.transports || []),
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
    rpID:             getRpId(req),
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
      expectedOrigin:        getOrigin(req),
      expectedRPID:          getRpId(req),
      requireUserVerification: false,
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
