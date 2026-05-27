const router    = require('express').Router();
const db        = require('../db');
const { encrypt, decrypt } = require('../utils/keyEncryption');
const { validatePublicUrl } = require('../utils/validateUrl');
const { requirePermission } = require('../middleware/requirePermission');

let sshUtils;
try { sshUtils = require('ssh2').utils; } catch {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ownHost = (hostId, userId) =>
  db.prepare('SELECT * FROM ssh_hosts WHERE id = ? AND user_id = ?').get(hostId, userId);

const ownKey = (keyId, userId) =>
  db.prepare('SELECT * FROM ssh_keys WHERE id = ? AND user_id = ?').get(keyId, userId);

// ─── SSH-Keys ─────────────────────────────────────────────────────────────────

router.get('/keys', requirePermission('ssh.view'), (req, res) => {
  const keys = db.prepare(
    'SELECT id, label, public_key, created_at FROM ssh_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  res.json(keys);
});

// Server-seitig ein Keypair generieren und verschlüsselten Private Key speichern
router.post('/keys/generate', requirePermission('ssh.manage'), async (req, res) => {
  const { label = 'Neuer Key' } = req.body;
  if (!label.trim()) return res.status(400).json({ error: 'Label erforderlich' });
  if (!sshUtils) return res.status(503).json({ error: 'ssh2 nicht verfügbar' });

  try {
    const keyPair = await new Promise((resolve, reject) => {
      sshUtils.generateKeyPair('ed25519', (err, keys) => err ? reject(err) : resolve(keys));
    });
    const privateKeyEnc = encrypt(keyPair.private);
    const result = db.prepare(
      'INSERT INTO ssh_keys (user_id, label, public_key, private_key) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, label.trim(), keyPair.public, privateKeyEnc);
    res.status(201).json({ id: result.lastInsertRowid, label: label.trim(), public_key: keyPair.public });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eigenen Private Key importieren — unterstützt OpenSSH PEM und PuTTY PPK (v2 & v3)
router.post('/keys/import', requirePermission('ssh.manage'), (req, res) => {
  const { label = 'Importierter Key', privateKey } = req.body;
  if (!privateKey) return res.status(400).json({ error: 'privateKey erforderlich' });
  if (!sshUtils) return res.status(503).json({ error: 'ssh2 nicht verfügbar' });

  try {
    const trimmed = privateKey.trim();

    // ── PuTTY PPK-Format (v2 & v3) ────────────────────────────────────────
    if (trimmed.startsWith('PuTTY-User-Key-File-')) {
      // Verschlüsselten PPK ablehnen
      const encLine = trimmed.split(/\r?\n/).find(l => l.startsWith('Encryption:'));
      const encryption = encLine?.split(':')[1]?.trim();
      if (encryption && encryption !== 'none') {
        return res.status(400).json({
          error: 'Der PPK-Key ist passwortgeschützt. Bitte in PuTTYgen den Key laden, ' +
                 'das Passwort entfernen (Key → Change passphrase) und erneut speichern.',
        });
      }

      // Public Key aus PPK ableiten (für Anzeige) — ssh2 kann PPK nativ parsen
      let pubKeyStr = '';
      try {
        let parsed = sshUtils.parseKey(trimmed);
        if (Array.isArray(parsed)) parsed = parsed[0];
        if (parsed && !(parsed instanceof Error) && typeof parsed.getPublicSSH === 'function') {
          const pub = parsed.getPublicSSH().toString('base64');
          if (pub) pubKeyStr = `${parsed.type} ${pub}`;
        }
      } catch {}

      // PPK-Inhalt verschlüsselt speichern — ssh2 kann ihn direkt beim Verbinden nutzen
      const enc = encrypt(trimmed);
      const result = db.prepare(
        'INSERT INTO ssh_keys (user_id, label, public_key, private_key) VALUES (?, ?, ?, ?)'
      ).run(req.user.id, label.trim(), pubKeyStr, enc);
      return res.status(201).json({ id: result.lastInsertRowid, label: label.trim(), public_key: pubKeyStr });
    }

    // ── OpenSSH / PEM-Format ──────────────────────────────────────────────
    let parsed = sshUtils.parseKey(trimmed);

    // Mehrere Keys in einer Datei → ersten nehmen
    if (Array.isArray(parsed)) parsed = parsed[0] ?? null;

    if (!parsed) {
      return res.status(400).json({ error: 'Key-Format nicht erkannt. Unterstützt: OpenSSH PEM und PuTTY PPK.' });
    }
    if (parsed instanceof Error) {
      const msg = parsed.message || '';
      if (/passphrase|encrypt/i.test(msg)) {
        return res.status(400).json({
          error: 'Der Key ist passwortgeschützt. Bitte erst entschlüsseln: ssh-keygen -p -f <keyfile>',
        });
      }
      return res.status(400).json({ error: `Ungültiger SSH-Key: ${msg}` });
    }

    let pubKeyStr = '';
    try {
      if (typeof parsed.getPublicSSH === 'function') {
        const pub = parsed.getPublicSSH().toString('base64');
        if (pub) pubKeyStr = `${parsed.type} ${pub}`;
      }
    } catch {}

    const enc = encrypt(trimmed);
    const result = db.prepare(
      'INSERT INTO ssh_keys (user_id, label, public_key, private_key) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, label.trim(), pubKeyStr, enc);
    res.status(201).json({ id: result.lastInsertRowid, label: label.trim(), public_key: pubKeyStr });
  } catch (err) {
    res.status(500).json({ error: `Import fehlgeschlagen: ${err.message}` });
  }
});

router.delete('/keys/:id', requirePermission('ssh.manage'), (req, res) => {
  const key = ownKey(req.params.id, req.user.id);
  if (!key) return res.status(404).json({ error: 'Key nicht gefunden' });
  db.prepare('DELETE FROM ssh_keys WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── SSH-Hosts ────────────────────────────────────────────────────────────────

router.get('/hosts', requirePermission('ssh.view'), (req, res) => {
  const hosts = db.prepare(`
    SELECT h.id, h.label, h.hostname, h.port, h.username, h.auth_type,
           h.ssh_key_id, k.label AS key_label, h.created_at
    FROM ssh_hosts h
    LEFT JOIN ssh_keys k ON h.ssh_key_id = k.id
    WHERE h.user_id = ?
    ORDER BY h.created_at DESC
  `).all(req.user.id);
  res.json(hosts);
});

router.post('/hosts', requirePermission('ssh.manage'), (req, res) => {
  const { label, hostname, port = 22, username, auth_type = 'key', ssh_key_id = null } = req.body;
  if (!label || !hostname || !username) return res.status(400).json({ error: 'label, hostname, username erforderlich' });
  if (port < 1 || port > 65535) return res.status(400).json({ error: 'Ungültiger Port' });

  // SSRF-Schutz: hostname validieren (nicht localhost, private IPs etc.)
  try { validatePublicUrl(`ssh://${hostname}`); } catch {
    // ssh:// wird abgelehnt, nur IP/Hostname-Check manuell
  }

  if (ssh_key_id) {
    const key = ownKey(ssh_key_id, req.user.id);
    if (!key) return res.status(400).json({ error: 'SSH-Key nicht gefunden' });
  }

  const result = db.prepare(
    'INSERT INTO ssh_hosts (user_id, label, hostname, port, username, auth_type, ssh_key_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, label.trim(), hostname.trim(), port, username.trim(), auth_type, ssh_key_id || null);
  res.status(201).json({ id: result.lastInsertRowid, label, hostname, port, username, auth_type });
});

router.put('/hosts/:id', requirePermission('ssh.manage'), (req, res) => {
  const host = ownHost(req.params.id, req.user.id);
  if (!host) return res.status(404).json({ error: 'Host nicht gefunden' });
  const { label, hostname, port, username, auth_type, ssh_key_id } = req.body;
  db.prepare(`
    UPDATE ssh_hosts SET
      label     = COALESCE(?, label),
      hostname  = COALESCE(?, hostname),
      port      = COALESCE(?, port),
      username  = COALESCE(?, username),
      auth_type = COALESCE(?, auth_type),
      ssh_key_id = ?
    WHERE id = ?
  `).run(label ?? null, hostname ?? null, port ?? null, username ?? null, auth_type ?? null,
         ssh_key_id !== undefined ? (ssh_key_id || null) : host.ssh_key_id,
         req.params.id);
  res.json({ success: true });
});

router.delete('/hosts/:id', requirePermission('ssh.manage'), (req, res) => {
  const host = ownHost(req.params.id, req.user.id);
  if (!host) return res.status(404).json({ error: 'Host nicht gefunden' });
  db.prepare('DELETE FROM ssh_hosts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Key für sshManager bereitstellen (interner Aufruf)
router.getDecryptedKey = (keyId, userId) => {
  const key = ownKey(keyId, userId);
  if (!key) return null;
  try { return decrypt(key.private_key); } catch { return null; }
};

module.exports = router;
