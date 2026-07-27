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

  // 2. Git Pull oder Docker Image Update ausführen
  let isDockerUpdate = false;
  try {
    const tokenObj = db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get();
    const token = tokenObj?.value;
    const hasGitDir = fs.existsSync(path.join(repoDir, '.git'));

    if (hasGitDir) {
      if (token) {
        try {
          const remoteUrl = `https://${token}@github.com/RoobiinG/ueberwachungs-panel.git`;
          await execPromise(`git pull ${remoteUrl} master`, { cwd: repoDir, timeout: 45000 });
        } catch (authErr) {
          await execPromise('git pull', { cwd: repoDir, timeout: 45000 });
        }
      } else {
        await execPromise('git pull', { cwd: repoDir, timeout: 45000 });
      }
    } else {
      // Kein .git-Repository (z. B. Docker Container via ghcr.io): Update über Host via nsenter
      isDockerUpdate = true;
      console.log('[Update] Docker-Umgebung ohne .git erkannt. Führe Docker-Update über Host (nsenter) aus...');
      try {
        await execPromise('nsenter --target 1 --mount --uts --ipc --net --pid -- docker pull ghcr.io/roobiing/ueberwachungs-panel:latest', { timeout: 120_000 });
      } catch (nsErr) {
        console.warn('[Update] Docker pull über nsenter Hinweis:', nsErr.message);
      }
    }
  } catch (pullErr) {
    console.error('[Update] Update-Fehler:', pullErr.message);
    return res.status(500).json({ error: 'Update fehlgeschlagen: ' + pullErr.message });
  }

  // 3. Neue Version lesen (falls lokales Repo aktualisiert wurde)
  let newVersionStr = isDockerUpdate ? 'Neueste Docker-Version (ghcr.io)' : 'Unbekannt';
  if (!isDockerUpdate) {
    try {
      const newVer = JSON.parse(fs.readFileSync(path.join(repoDir, 'version.json'), 'utf8'));
      newVersionStr = `v${newVer.version} (Build ${newVer.build})`;
    } catch (e) {
      console.warn('[Update] Neue version.json nicht lesbar:', e.message);
    }
  }

  // 4. Letzte Commits (Update Log) abrufen oder Docker-Log erstellen
  let log = [];
  if (isDockerUpdate) {
    log = [{
      hash: 'docker',
      subject: 'Docker Image Update via ghcr.io/roobiing/ueberwachungs-panel:latest',
      time: 'gerade eben',
      author: 'Docker'
    }];
  } else {
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
  }

  // 5. Neuesten Eintrag aus CHANGELOG.md (Nachwirken & Features) lesen
  let changelogEntry = '';
  try {
    const clPath = path.join(repoDir, 'CHANGELOG.md');
    if (fs.existsSync(clPath)) {
      const fullCl = fs.readFileSync(clPath, 'utf8');
      const match = fullCl.match(/## \[[^\]]+\][\s\S]*?(?=(## \[|$))/);
      if (match) changelogEntry = match[0].trim();
    }
  } catch (e) {
    console.warn('[Update] CHANGELOG.md nicht lesbar:', e.message);
  }

  // 6. Erfolg melden & anschließend Prozess / Container für Neustart beenden
  res.json({
    success: true,
    message: isDockerUpdate ? 'Docker Image erfolgreich aktualisiert!' : 'Panel erfolgreich aktualisiert!',
    oldVersion: oldVersionStr,
    newVersion: newVersionStr,
    log,
    changelogEntry
  });

  setTimeout(() => {
    console.log('[Update] Server startet nach automatischem Update neu...');
    if (isDockerUpdate) {
      exec('nsenter --target 1 --mount --uts --ipc --net --pid -- sh -c "for d in /root /home/* /opt /var/docker /srv/* /app $(pwd); do if [ -f \\"$d/docker-compose.yml\\" ] || [ -f \\"$d/docker-compose.prod.yml\\" ]; then cd \\"$d\\" && docker compose up -d --force-recreate; exit 0; fi; done; docker restart ueberwachungs-panel"', () => {
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }, 1500);
});

// Vollständigen CHANGELOG.md (Update-Log & Nachwirken) abrufen
router.get('/changelog', async (req, res) => {
  try {
    const clPath = path.join(__dirname, '../../../CHANGELOG.md');
    if (fs.existsSync(clPath)) {
      const content = fs.readFileSync(clPath, 'utf8');
      res.json({ success: true, changelog: content });
    } else {
      res.json({ success: false, changelog: 'Kein CHANGELOG.md im Repository gefunden.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Changelog konnte nicht geladen werden: ' + err.message });
  }
});

module.exports = router;


