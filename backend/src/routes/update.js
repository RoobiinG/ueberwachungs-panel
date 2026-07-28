const router = require('express').Router();
const updateCheck = require('../utils/updateCheck');
const requireRole = require('../middleware/roles');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');
const db = require('../db');
const dockhand = require('../utils/dockhandClient');

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
      // Kein .git-Repository (z. B. Docker Container via ghcr.io): Update über Host im Hintergrund
      isDockerUpdate = true;
      console.log('[Update] Docker-Umgebung ohne .git erkannt. Update wird im Hintergrund nach der API-Antwort ausgeführt...');
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
      subject: 'Docker Image Update im Hintergrund gestartet (ghcr.io/roobiing/ueberwachungs-panel:latest)',
      time: 'gerade eben',
      author: 'Docker Auto-Updater'
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

  // 6. Erfolg sofort an den Client melden (kein HTTP 504 Gateway Timeout bei langen Docker Pulls)
  res.json({
    success: true,
    message: isDockerUpdate
      ? 'Docker-Update im Hintergrund gestartet! Der Container wird in ca. 20-30 Sekunden automatisch neu geladen.'
      : 'Panel erfolgreich aktualisiert!',
    oldVersion: oldVersionStr,
    newVersion: newVersionStr,
    log,
    changelogEntry
  });

  // 7. Im Hintergrund Server neu starten bzw. Docker Pull & Container-Neustart ausführen
  setTimeout(async () => {
    if (isDockerUpdate) {
      console.log('[Update] Starte Docker Image Update...');
      // A. Versuch über Dockhand Pro API (falls in Einstellungen konfiguriert)
      const dhToken = db.prepare("SELECT value FROM settings WHERE key = 'dockhandApiToken'").get()?.value;
      const dhUrl   = db.prepare("SELECT value FROM settings WHERE key = 'dockhandUrl'").get()?.value;
      if (dhToken && dhUrl) {
        try {
          console.log('[Update] Dockhand Pro API konfiguriert. Versuche Update über Dockhand...');
          const envId = db.prepare("SELECT value FROM settings WHERE key = 'dockhandLocalEnvId'").get()?.value || '1';
          await dockhand.pullImage(envId, 'ghcr.io/roobiing/ueberwachungs-panel:latest');
          console.log('[Update] Image über Dockhand gezogen. Suche Panel-Container...');
          const { data: containers } = await dockhand.getContainers(envId);
          const panelContainer = (Array.isArray(containers) ? containers : []).find(
            c => (c.name && c.name.includes('ueberwachungs-panel')) || (c.image && c.image.includes('ueberwachungs-panel')) || (c.name && c.name.includes('panel'))
          );
          if (panelContainer) {
            console.log(`[Update] Panel-Container (${panelContainer.name}) gefunden → starte Recreate via Dockhand...`);
            await dockhand.containerAction(envId, panelContainer.id, 'recreate');
            return;
          }
          console.warn('[Update] Panel-Container in Dockhand nicht gefunden. Weiche auf Host-Docker aus...');
        } catch (dhErr) {
          console.warn('[Update] Dockhand Pro Update nicht möglich (' + dhErr.message + '). Weiche auf Host-Docker (nsenter/socket) aus...');
        }
      }

      // B. Fallback: Direkter Docker-Socket Befehl oder Host-Namespace via nsenter
      console.log('[Update] Versuche Update über lokales Docker / nsenter...');
      const dockerDirectCmd = 'docker pull ghcr.io/roobiing/ueberwachungs-panel:latest && (for d in /root /home/* /opt /var/docker /srv/* /app $(pwd); do if [ -f "$d/docker-compose.yml" ] || [ -f "$d/docker-compose.prod.yml" ]; then cd "$d" && docker compose up -d --force-recreate; exit 0; fi; done; docker restart ueberwachungs-panel)';
      const nsenterCmd = 'nsenter --target 1 --mount --uts --ipc --net --pid -- sh -c "docker pull ghcr.io/roobiing/ueberwachungs-panel:latest && (for d in /root /home/* /opt /var/docker /srv/* /app $(pwd); do if [ -f \\"$d/docker-compose.yml\\" ] || [ -f \\"$d/docker-compose.prod.yml\\" ]; then cd \\"$d\\" && docker compose up -d --force-recreate; exit 0; fi; done; docker restart ueberwachungs-panel)"';

      exec(dockerDirectCmd, (errDirect) => {
        if (errDirect) {
          console.log('[Update] Direkter Docker CLI Befehl nicht möglich, verwende nsenter...');
          exec(nsenterCmd, (errNs) => {
            if (errNs) console.error('[Update] Hintergrund Docker-Update (nsenter) Fehler:', errNs.message);
            else console.log('[Update] Docker-Container erfolgreich über nsenter aktualisiert und neu gestartet.');
          });
        } else {
          console.log('[Update] Docker-Container erfolgreich über Docker-Socket aktualisiert und neu gestartet.');
        }
      });
    } else {
      console.log('[Update] Server startet nach automatischem Git-Update neu...');
      process.exit(0);
    }
  }, 500);
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


