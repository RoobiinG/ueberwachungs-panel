const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { decrypt } = require('../utils/keyEncryption');
const { requirePermission } = require('../middleware/requirePermission');

// ─── SSH2-Client (optional – falls nicht installiert kein Crash) ──────────────

let Client;
try { Client = require('ssh2').Client; } catch {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Null-Byte-Injection verhindern */
const hasNullByte = (s) => typeof s === 'string' && s.includes('\0');

async function getHostConfig(hostId, userId) {
  // Fix #5: hostId als Integer erzwingen
  const id = Number(hostId);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Ungültige hostId'), { status: 400 });

  const host = db.prepare('SELECT * FROM ssh_hosts WHERE id = ? AND user_id = ?').get(id, userId);
  if (!host) throw Object.assign(new Error('Host nicht gefunden'), { status: 404 });

  const cfg = {
    host:         host.hostname,
    port:         host.port || 22,
    username:     host.username,
    readyTimeout: 10000,
  };

  if (host.ssh_key_id) {
    const keyRow = db.prepare('SELECT private_key FROM ssh_keys WHERE id = ? AND user_id = ?')
      .get(host.ssh_key_id, userId);
    if (keyRow) {
      try { cfg.privateKey = decrypt(keyRow.private_key); } catch {}
    }
  }

  return cfg;
}

// Fix #4: settled-Flag verhindert double-reject nach Timeout + error-Event
function openSftp(cfg) {
  return new Promise((resolve, reject) => {
    if (!Client) return reject(new Error('ssh2 nicht verfügbar'));
    const conn    = new Client();
    let   settled = false;
    const done    = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const timer = setTimeout(
      () => { conn.destroy(); done(reject, new Error('Verbindungs-Timeout')); },
      12000
    );

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        clearTimeout(timer);
        if (err) { conn.end(); return done(reject, err); }
        done(resolve, { conn, sftp });
      });
    });

    conn.on('error', (err) => { clearTimeout(timer); done(reject, err); });
    conn.connect(cfg);
  });
}

const perm = requirePermission('ssh.connect');

// ─── GET /ls?hostId=&path= ────────────────────────────────────────────────────

router.get('/ls', perm, async (req, res) => {
  const { hostId, path: dir = '.' } = req.query;
  if (!hostId) return res.status(400).json({ error: 'hostId fehlt' });
  // Fix #6: Null-Byte-Check
  if (hasNullByte(dir)) return res.status(400).json({ error: 'Ungültiger Pfad' });

  let conn;
  try {
    const cfg = await getHostConfig(hostId, req.user.id);
    const { conn: c, sftp } = await openSftp(cfg);
    conn = c;

    // Absoluten Pfad auflösen ('.' → Heimverzeichnis)
    const absPath = await new Promise((resolve, reject) =>
      sftp.realpath(dir, (err, p) => err ? reject(err) : resolve(p))
    );

    const list = await new Promise((resolve, reject) =>
      sftp.readdir(absPath, (err, items) => err ? reject(err) : resolve(items))
    );

    // Fix #7: . und .. aus SFTP-readdir herausfiltern
    const entries = list
      .filter(item => item.filename !== '.' && item.filename !== '..')
      .map(item => ({
        name:     item.filename,
        type:     item.attrs.isDirectory() ? 'd' : 'f',
        size:     item.attrs.size ?? 0,
        modified: item.attrs.mtime ? item.attrs.mtime * 1000 : null,
      }));

    // Verzeichnisse zuerst, dann alphabetisch
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'd' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    conn.end();
    res.json({ path: absPath, entries });
  } catch (err) {
    conn?.end();
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /download?hostId=&path= ──────────────────────────────────────────────

router.get('/download', perm, async (req, res) => {
  const { hostId, path: filePath } = req.query;
  if (!hostId || !filePath) return res.status(400).json({ error: 'hostId und path fehlen' });
  // Fix #6
  if (hasNullByte(filePath)) return res.status(400).json({ error: 'Ungültiger Pfad' });

  let conn;
  try {
    const cfg = await getHostConfig(hostId, req.user.id);
    const { conn: c, sftp } = await openSftp(cfg);
    conn = c;

    // Fix #1 + #2: einmaliges Schließen via Flag; Client-Disconnect räumt auf
    let connEnded = false;
    const endConn = () => { if (!connEnded) { connEnded = true; conn.end(); } };

    const filename = filePath.split('/').pop() || 'download';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const readStream = sftp.createReadStream(filePath);

    // Fix #2: Client trennt Verbindung → readStream zerstören + conn schließen
    res.on('close', () => { readStream.destroy(); endConn(); });

    readStream.on('error', (err) => {
      endConn();
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.destroy();
    });

    // Fix #1: close-Event nach error verhindert double-end via Flag
    readStream.on('close', endConn);

    readStream.pipe(res);
  } catch (err) {
    conn?.end();
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /upload?hostId=&path= ───────────────────────────────────────────────
// Fix #3: req direkt pipen statt 500 MB in RAM buffern (kein express.raw())

router.post('/upload', perm, async (req, res) => {
  const { hostId, path: filePath } = req.query;
  if (!hostId || !filePath) return res.status(400).json({ error: 'hostId und path fehlen' });
  // Fix #6
  if (hasNullByte(filePath)) return res.status(400).json({ error: 'Ungültiger Pfad' });

  let conn;
  try {
    const cfg = await getHostConfig(hostId, req.user.id);
    const { conn: c, sftp } = await openSftp(cfg);
    conn = c;

    const writeStream = sftp.createWriteStream(filePath);

    await new Promise((resolve, reject) => {
      writeStream.on('close', resolve);
      writeStream.on('error', reject);
      req.on('error', reject);
      // Wenn Client abbricht: WriteStream sauber schließen
      req.on('close', () => { if (!res.headersSent) { writeStream.destroy(); reject(new Error('Upload abgebrochen')); } });
      req.pipe(writeStream);
    });

    conn.end();
    res.json({ ok: true });
  } catch (err) {
    conn?.end();
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /mkdir ──────────────────────────────────────────────────────────────

router.post('/mkdir', perm, async (req, res) => {
  const { hostId, path: dirPath } = req.body;
  if (!hostId || !dirPath) return res.status(400).json({ error: 'hostId und path fehlen' });
  if (hasNullByte(dirPath)) return res.status(400).json({ error: 'Ungültiger Pfad' });

  let conn;
  try {
    const cfg = await getHostConfig(hostId, req.user.id);
    const { conn: c, sftp } = await openSftp(cfg);
    conn = c;

    await new Promise((resolve, reject) =>
      sftp.mkdir(dirPath, (err) => err ? reject(err) : resolve())
    );

    conn.end();
    res.json({ ok: true });
  } catch (err) {
    conn?.end();
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── DELETE / ─────────────────────────────────────────────────────────────────
// Body: { hostId, path, type }  — type 'd' = Verzeichnis, sonst Datei

router.delete('/', perm, async (req, res) => {
  const { hostId, path: filePath, type } = req.body;
  if (!hostId || !filePath) return res.status(400).json({ error: 'hostId und path fehlen' });
  if (hasNullByte(filePath)) return res.status(400).json({ error: 'Ungültiger Pfad' });

  let conn;
  try {
    const cfg = await getHostConfig(hostId, req.user.id);
    const { conn: c, sftp } = await openSftp(cfg);
    conn = c;

    await new Promise((resolve, reject) => {
      if (type === 'd') {
        sftp.rmdir(filePath, (err) => err ? reject(err) : resolve());
      } else {
        sftp.unlink(filePath, (err) => err ? reject(err) : resolve());
      }
    });

    conn.end();
    res.json({ ok: true });
  } catch (err) {
    conn?.end();
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /rename ─────────────────────────────────────────────────────────────

router.post('/rename', perm, async (req, res) => {
  const { hostId, oldPath, newPath } = req.body;
  if (!hostId || !oldPath || !newPath) return res.status(400).json({ error: 'hostId, oldPath und newPath fehlen' });
  if (hasNullByte(oldPath) || hasNullByte(newPath)) return res.status(400).json({ error: 'Ungültiger Pfad' });

  let conn;
  try {
    const cfg = await getHostConfig(hostId, req.user.id);
    const { conn: c, sftp } = await openSftp(cfg);
    conn = c;

    await new Promise((resolve, reject) =>
      sftp.rename(oldPath, newPath, (err) => err ? reject(err) : resolve())
    );

    conn.end();
    res.json({ ok: true });
  } catch (err) {
    conn?.end();
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
