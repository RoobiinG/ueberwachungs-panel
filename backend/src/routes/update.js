const router = require('express').Router();
const updateCheck = require('../utils/updateCheck');
const requireRole = require('../middleware/roles');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');
const db = require('../db');

// Update-Status abrufen
router.get('/status', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const status = await updateCheck.checkUpdates(force);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Automatischen Panel-Update durchführen (Git Pull + Changelog + Neustart)
router.post('/run', requireRole('admin'), async (req, res) => {
  const repoDir = path.join(__dirname, '../../../');

  // 1. Vorherige Version lesen
  let oldVersionStr = 'Unbekannt';
  try {
    const oldVer = JSON.parse(fs.readFileSync(path.join(repoDir, 'version.json'), 'utf8'));
    oldVersionStr = `v${oldVer.version} (Build ${oldVer.build})`;
  } catch (e) {
    console.warn('[Update] Vorherige version.json nicht lesbar:', e.message);
  }

  // 2. Git Pull ausführen (mit GitHub Token falls in Settings vorhanden)
  try {
    const tokenObj = db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get();
    const token = tokenObj?.value;

    if (token) {
      try {
        const remoteUrl = `https://${token}@github.com/RoobiinG/ueberwachungs-panel.git`;
        await execPromise(`git pull ${remoteUrl} master`, { cwd: repoDir, timeout: 45000 });
      } catch (authErr) {
        // Fallback auf standard git pull falls Token-Url nicht greift
        await execPromise('git pull', { cwd: repoDir, timeout: 45000 });
      }
    } else {
      await execPromise('git pull', { cwd: repoDir, timeout: 45000 });
    }
  } catch (pullErr) {
    console.error('[Update] Git pull fehler:', pullErr.message);
    return res.status(500).json({ error: 'Git Pull fehlgeschlagen: ' + pullErr.message });
  }

  // 3. Neue Version lesen
  let newVersionStr = 'Unbekannt';
  try {
    const newVer = JSON.parse(fs.readFileSync(path.join(repoDir, 'version.json'), 'utf8'));
    newVersionStr = `v${newVer.version} (Build ${newVer.build})`;
  } catch (e) {
    console.warn('[Update] Neue version.json nicht lesbar:', e.message);
  }

  // 4. Letzte 15 Commits (Update Log) abrufen
  let log = [];
  try {
    const { stdout } = await execPromise('git log -n 15 --pretty=format:"%h|%s|%cr|%an"', { cwd: repoDir });
    log = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [hash, subject, time, author] = line.split('|');
      return {
        hash: hash || '',
        subject: subject || '',
        time: time || '',
        author: author || ''
      };
    });
  } catch (logErr) {
    log = [{ hash: '', subject: 'Update-Log konnte nicht geladen werden', time: '', author: '' }];
  }

  // 5. Erfolg melden & anschließend Prozess für Neustart beenden
  res.json({
    success: true,
    message: 'Panel erfolgreich aktualisiert!',
    oldVersion: oldVersionStr,
    newVersion: newVersionStr,
    log
  });

  setTimeout(() => {
    console.log('[Update] Server startet nach automatischem Update neu...');
    process.exit(0);
  }, 1500);
});

module.exports = router;

