const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { decrypt } = require('../utils/keyEncryption');
const { requirePermission } = require('../middleware/requirePermission');

// ─── SSH2-Client (optional – falls nicht installiert kein Crash) ──────────────

let Client;
try { Client = require('ssh2').Client; } catch {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getHostConfig(hostId, userId) {
  const host = db.prepare('SELECT * FROM ssh_hosts WHERE id = ? AND user_id = ?').get(hostId, userId);
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

function openSftp(cfg) {
  return new Promise((resolve, reject) => {
    if (!Client) return reject(new Error('ssh2 nicht verfügbar'));
    const conn  = new Client();
    const timer = setTimeout(() => { conn.destroy(); reject(new Error('Verbindungs-Timeout')); }, 12000);

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        clearTimeout(timer);
        if (err) { conn.end(); return reject(err); }
        resolve({ conn, sftp });
      });
    });

    conn.on('error', (err) => { clearTimeout(timer); reject(err); });
    conn.connect(cfg);
  });
}

const perm = requirePermission('ssh.connect');

// ─── GET /ls?hostId=&path= ────────────────────────────────────────────────────

router.get('/ls', perm, async (req, res) => {
  const { hostId, path: dir = '.' } = req.query;
  if (!hostId) return res.status(400).json({ error: 'hostId fehlt' });

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

    const entries = list.map(item => ({
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

  let conn;
  try {
    const cfg = await getHostConfig(hostId, req.user.id);
    const { conn: c, sftp } = await openSftp(cfg);
    conn = c;

    const filename = filePath.split('/').pop() || 'download';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const readStream = sftp.createReadStream(filePath);
    readStream.on('error', (err) => {
      conn.end();
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    readStream.on('close', () => conn.end());
    readStream.pipe(res);
  } catch (err) {
    conn?.end();
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /upload?hostId=&path= ───────────────────────────────────────────────
// Datei-Inhalt als Raw-Body (kein Multipart nötig)

router.post(
  '/upload',
  perm,
  express.raw({ type: '*/*', limit: '500mb' }),
  async (req, res) => {
    const { hostId, path: filePath } = req.query;
    if (!hostId || !filePath) return res.status(400).json({ error: 'hostId und path fehlen' });

    let conn;
    try {
      const cfg = await getHostConfig(hostId, req.user.id);
      const { conn: c, sftp } = await openSftp(cfg);
      conn = c;

      const writeStream = sftp.createWriteStream(filePath);
      await new Promise((resolve, reject) => {
        writeStream.on('close', resolve);
        writeStream.on('error', reject);
        writeStream.end(req.body);
      });

      conn.end();
      res.json({ ok: true });
    } catch (err) {
      conn?.end();
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

// ─── POST /mkdir ──────────────────────────────────────────────────────────────

router.post('/mkdir', perm, async (req, res) => {
  const { hostId, path: dirPath } = req.body;
  if (!hostId || !dirPath) return res.status(400).json({ error: 'hostId und path fehlen' });

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
