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
      const lines = trimmed.split(/\r?\n/);
      const encLine = lines.find(l => l.startsWith('Encryption:'));
      const encryption = encLine ? encLine.slice('Encryption:'.length).trim() : 'none';
      if (encryption !== 'none') {
        return res.status(400).json({
          error: 'Der PPK-Key ist passwortgeschützt. Bitte in PuTTYgen: Key → Change passphrase → leer lassen → OK.',
        });
      }

      // Algorithmus aus erster Zeile lesen (für Anzeige als Fallback)
      const algoMatch = lines[0].match(/^PuTTY-User-Key-File-\d+:\s*(.+)$/);
      const algo = algoMatch ? algoMatch[1].trim() : 'ssh-key';

      // PPK öffentlichen Key extrahieren (damit User ihn in authorized_keys eintragen kann)
      const { resolveKeyForSsh2 } = require('../utils/sshKeyHelper');
      let pubKeyStr = `ppk:${algo}`;
      try {
        const { key: parsed } = resolveKeyForSsh2(trimmed);
        if (parsed && typeof parsed.getPublicSSH === 'function') {
          const pub = parsed.getPublicSSH().toString('base64');
          if (pub) pubKeyStr = `${parsed.type} ${pub}`;
        }
      } catch {}

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

// Öffentlichen Key abrufen (extrahiert falls PPK ohne echten public_key gespeichert)
router.get('/keys/:id/public', requirePermission('ssh.view'), (req, res) => {
  const key = ownKey(req.params.id, req.user.id);
  if (!key) return res.status(404).json({ error: 'Key nicht gefunden' });

  // Falls echte public_key vorhanden → direkt zurückgeben
  if (key.public_key && !key.public_key.startsWith('ppk:')) {
    return res.json({ public_key: key.public_key });
  }

  // Bei PPK-Platzhalter: Private Key entschlüsseln und Public Key on-the-fly extrahieren
  try {
    const { decrypt } = require('../utils/keyEncryption');
    const { resolveKeyForSsh2 } = require('../utils/sshKeyHelper');
    const raw = decrypt(key.private_key);
    const { key: parsed, error } = resolveKeyForSsh2(raw);
    if (error) return res.status(422).json({ error });
    if (!parsed || typeof parsed.getPublicSSH !== 'function') {
      return res.status(422).json({ error: 'Public Key konnte nicht extrahiert werden' });
    }
    const pub = parsed.getPublicSSH().toString('base64');
    const pubKeyStr = `${parsed.type} ${pub}`;
    // Datenbank für die Zukunft aktualisieren
    db.prepare('UPDATE ssh_keys SET public_key = ? WHERE id = ?').run(pubKeyStr, key.id);
    res.json({ public_key: pubKeyStr });
  } catch (err) {
    res.status(500).json({ error: `Fehler beim Extrahieren: ${err.message}` });
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

  // SSRF-Schutz: hostname auf private IPs / localhost prüfen
  try { validatePublicUrl(`http://${hostname}`); } catch (e) {
    return res.status(400).json({ error: `Ungültiger Hostname: ${e.message}` });
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

  // SSRF-Schutz auch bei Updates
  if (hostname) {
    try { validatePublicUrl(`http://${hostname}`); } catch (e) {
      return res.status(400).json({ error: `Ungültiger Hostname: ${e.message}` });
    }
  }

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
