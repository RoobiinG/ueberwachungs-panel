const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const Database = require('better-sqlite3');
const db     = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data.db');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');

// Stelle sicher, dass das Backup-Verzeichnis existiert
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// Sichere Dateinamensprüfung gegen Directory-Traversal
function isValidFilename(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z0-9_\-\.]+\.db$/.test(name) && !name.includes('..');
}

// Datum-Hilfsfunktion für Dateinamen: YYYY-MM-DD_HH-mm-ss
function getTimestampStr() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// Aufbewahrungsrichtlinie: Max. 10 Backups behalten, ältere rotieren
function rotateOldBackups(maxKeep = 10) {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const full = path.join(BACKUP_DIR, f);
        const st = fs.statSync(full);
        return { name: f, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // neueste zuerst

    if (files.length > maxKeep) {
      const toDelete = files.slice(maxKeep);
      for (const item of toDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, item.name));
      }
    }
  } catch (err) {
    console.warn('[Backup] Fehler bei der Backup-Rotation:', err.message);
  }
}

// GET  /api/backups  — Liste aller verfügbaren SQLite-Backups
router.get('/', requirePermission(['system.backup', 'system.update']), (req, res) => {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const fullPath = path.join(BACKUP_DIR, f);
        const stats = fs.statSync(fullPath);
        return {
          filename: f,
          sizeBytes: stats.size,
          createdAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ backups: files });
  } catch (err) {
    console.error('[Backup] Fehler beim Abrufen der Backup-Liste:', err.message);
    res.status(500).json({ error: 'Backup-Liste konnte nicht geladen werden' });
  }
});

// POST /api/backups/create — Erstellt sofort ein neues Backup von data.db
router.post('/create', requirePermission(['system.backup', 'system.update']), async (req, res) => {
  try {
    ensureBackupDir();
    const filename = `panel-backup_${getTimestampStr()}.db`;
    const destPath = path.join(BACKUP_DIR, filename);

    // Online-Backup der aktiven SQLite-Datenbank ausführen
    await db.backup(destPath);
    rotateOldBackups(10);

    const stats = fs.statSync(destPath);
    auditLog(req, 'backup.create', 'database', filename, { sizeBytes: stats.size });

    res.json({
      ok: true,
      backup: {
        filename,
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString(),
      }
    });
  } catch (err) {
    console.error('[Backup] Fehler beim Erstellen des Backups:', err.message);
    res.status(500).json({ error: `Backup fehlgeschlagen: ${err.message}` });
  }
});

// POST /api/backups/restore — Stellt eine ausgewählte Backup-Datei wieder her
router.post('/restore', requirePermission(['system.backup', 'system.update']), async (req, res) => {
  const { filename } = req.body;
  if (!isValidFilename(filename)) {
    return res.status(400).json({ error: 'Ungültiger Dateiname' });
  }

  const srcPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: 'Backup-Datei nicht gefunden' });
  }

  try {
    ensureBackupDir();
    // 1. Sicherheits-Backup vor Wiederherstellung anlegen
    const preRestoreName = `pre_restore_${getTimestampStr()}.db`;
    const preRestorePath = path.join(BACKUP_DIR, preRestoreName);
    await db.backup(preRestorePath);

    // 2. Ausgewähltes Backup mit SQLite Online-Backup-API in die aktive db laden
    const sourceDb = new Database(srcPath, { readonly: true });
    await sourceDb.backup(db);
    sourceDb.close();

    auditLog(req, 'backup.restore', 'database', filename, { preRestoreBackup: preRestoreName });
    res.json({ ok: true, message: `Datenbank erfolgreich aus '${filename}' wiederhergestellt` });
  } catch (err) {
    console.error('[Backup] Fehler bei der Wiederherstellung:', err.message);
    res.status(500).json({ error: `Wiederherstellung fehlgeschlagen: ${err.message}` });
  }
});

// DELETE /api/backups/:filename — Löscht eine bestimmte Backup-Datei
router.delete('/:filename', requirePermission(['system.backup', 'system.update']), (req, res) => {
  const { filename } = req.params;
  if (!isValidFilename(filename)) {
    return res.status(400).json({ error: 'Ungültiger Dateiname' });
  }

  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup-Datei existiert nicht' });
  }

  try {
    fs.unlinkSync(filePath);
    auditLog(req, 'backup.delete', 'database', filename);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Fehler beim Löschen: ${err.message}` });
  }
});

// GET  /api/backups/download/:filename — Lädt eine Backup-Datei herunter
router.get('/download/:filename', requirePermission(['system.backup', 'system.update']), (req, res) => {
  const { filename } = req.params;
  if (!isValidFilename(filename)) {
    return res.status(400).send('Ungültiger Dateiname');
  }

  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Backup-Datei nicht gefunden');
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});

module.exports = router;
