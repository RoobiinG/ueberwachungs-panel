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
      const nsenterCmd = 'nsenter --target 1 --mount --uts --ipc --net --pid -- sh -c "docker pull ghcr.io/roobiing/ueberwachungs-panel:latest && (WDIR=\\"\\$(docker inspect -f \'{{ index .Config.Labels \\"com.docker.compose.project.working_dir\\" }}\' ueberwachungs-panel 2>/dev/null)\\"; if [ -n \\"$WDIR\\" ] && [ -d \\"$WDIR\\" ]; then cd \\"$WDIR\\" && docker compose up -d --force-recreate && exit 0; fi; for d in /root /root/* /home/* /home/*/* /opt /opt/* /var/docker /var/docker/* /srv /srv/* /app /app/* \\$(pwd); do if [ -f \\"$d/docker-compose.yml\\" ] || [ -f \\"$d/docker-compose.prod.yml\\" ]; then cd \\"$d\\" && docker compose up -d --force-recreate; exit 0; fi; done; docker restart ueberwachungs-panel)"';
      const dockerDirectCmd = 'docker pull ghcr.io/roobiing/ueberwachungs-panel:latest && (WDIR="$(docker inspect -f \'{{ index .Config.Labels "com.docker.compose.project.working_dir" }}\' ueberwachungs-panel 2>/dev/null)"; if [ -n "$WDIR" ] && [ -d "$WDIR" ]; then cd "$WDIR" && docker compose up -d --force-recreate && exit 0; fi; for d in /root /root/* /home/* /home/*/* /opt /opt/* /var/docker /var/docker/* /srv /srv/* /app /app/* $(pwd); do if [ -f "$d/docker-compose.yml" ] || [ -f "$d/docker-compose.prod.yml" ]; then cd "$d" && docker compose up -d --force-recreate; exit 0; fi; done; docker restart ueberwachungs-panel)';

      // 1. Primär: Update über Dockhand Pro API (falls in Einstellungen konfiguriert)
      const dhToken = db.prepare("SELECT value FROM settings WHERE key = 'dockhandApiToken'").get()?.value;
      const dhUrl   = db.prepare("SELECT value FROM settings WHERE key = 'dockhandUrl'").get()?.value;

      let apiSuccess = false;
      if (dhToken && dhUrl) {
        try {
          const envId = db.prepare("SELECT value FROM settings WHERE key = 'dockhandLocalEnvId'").get()?.value || '1';
          console.log(`[Update] Starte Docker Image Update primär über die Dockhand Pro API (URL: ${dhUrl}, EnvID: ${envId})...`);
          
          console.log('[Update] Rufe Dockhand API /api/images/pull für ghcr.io/roobiing/ueberwachungs-panel:latest auf...');
          try {
            const pullRes = await dockhand.pullImage(envId, 'ghcr.io/roobiing/ueberwachungs-panel:latest');
            console.log('[Update] Image erfolgreich über Dockhand API geladen:', pullRes?.data || 'OK');
          } catch (pullErr) {
            console.error('[Update] FEHLER beim Image Pull über Dockhand API:', pullErr.message);
            if (pullErr.response?.data) {
              console.error('[Update] Dockhand API Fehler-Details (pullImage):', JSON.stringify(pullErr.response.data));
            }
            if (pullErr.stack) {
              console.error('[Update] Stack-Trace (pullImage):', pullErr.stack);
            }
            console.log('[Update] Versuche trotzdem Container-Aktualisierung (falls Image lokal aktuell ist)...');
          }

          console.log('[Update] Suche Panel-Stack über Dockhand API...');
          let stackUpdated = false;
          try {
            const stacksRes = await dockhand.getStacks(envId);
            const stacksList = Array.isArray(stacksRes) ? stacksRes : (Array.isArray(stacksRes.data) ? stacksRes.data : (stacksRes?.data && Array.isArray(stacksRes.data.data) ? stacksRes.data.data : []));
            const panelStack = stacksList.find(s => {
              const n = (s.name || '').toLowerCase();
              return n.includes('ueberwachungs-panel') || n.includes('panel');
            });

            if (panelStack) {
              const sName = panelStack.name || panelStack.id;
              console.log(`[Update] Panel-Stack (${sName}, ID: ${panelStack.id}) gefunden! Starte Stack Deploy via Dockhand API...`);
              await dockhand.updateStack(envId, panelStack.id, {
                pullImages: true,
                pullImage: true,
                buildImages: false,
                forceRecreate: true,
              });
              console.log(`[Update] ERFOLG: Stack "${sName}" wurde über Dockhand Pro API neu deployed und recreated!`);
              apiSuccess = true;
              stackUpdated = true;
            } else {
              console.log('[Update] Kein Stack für das Panel über Dockhand API gefunden.');
            }
          } catch (stackErr) {
            console.error('[Update] FEHLER bei Stack-Suche/Deploy via Dockhand API:', stackErr.message);
          }

          if (!stackUpdated) {
            console.log('[Update] Suche Panel-Container über Dockhand API...');
            const res = await dockhand.getContainers(envId);
            const list = Array.isArray(res) ? res : (Array.isArray(res.data) ? res.data : (res?.data && Array.isArray(res.data.data) ? res.data.data : []));
            console.log(`[Update] ${list.length} Container in Dockhand Environment ${envId} gefunden:`, list.map(c => `${c.name || 'unbekannt'} (${c.image || 'ohne image'})`).join(', '));
            
            const panelContainer = list.find(c => {
              const n = (c.name || '').toLowerCase();
              const img = (c.image || '').toLowerCase();
              return n.includes('ueberwachungs-panel') || n.includes('panel') || img.includes('ueberwachungs-panel') || img.includes('roobiing');
            });

            if (panelContainer) {
              const cName = panelContainer.name || panelContainer.id;
              console.log(`[Update] Panel-Container (${cName}, ID: ${panelContainer.id}) gefunden! Versuche Recreate/Restart via Dockhand API...`);
              try {
                console.log(`[Update] Sende action "recreate" für Container ${cName} an Dockhand API...`);
                await dockhand.containerAction(envId, panelContainer.id, 'recreate');
                console.log(`[Update] ERFOLG: Container ${cName} wurde über Dockhand API recreated!`);
                apiSuccess = true;
              } catch (recreateErr) {
                console.error('[Update] FEHLER bei action "recreate" via Dockhand API:', recreateErr.message);
                console.log(`[Update] Versuche stattdessen action "restart" für Container ${cName} via Dockhand API...`);
                try {
                  await dockhand.containerAction(envId, panelContainer.id, 'restart');
                  console.log(`[Update] HINWEIS: Container ${cName} wurde über Dockhand API neugestartet. Da Container-Restart ein bestehendes Image nicht durch ein neues ersetzt, wird zusätzlich Fallback via docker-compose force-recreate ausgeführt.`);
                  // WICHTIG: Kein apiSuccess = true, damit das lokale docker-compose force-recreate danach ausgeführt wird!
                } catch (restartErr) {
                  console.error('[Update] FEHLER bei action "restart" via Dockhand API:', restartErr.message);
                }
              }
            } else {
              console.error(`[Update] FEHLER: Kein Panel-Container mit Name "ueberwachungs-panel" oder "panel" in Dockhand Environment ${envId} gefunden!`);
            }
          }
        } catch (dhErr) {
          console.error('[Update] Dockhand Pro API Update fehlgeschlagen:', dhErr.message);
          if (dhErr.response?.data) {
            console.error('[Update] Dockhand API Response Fehler:', JSON.stringify(dhErr.response.data));
          }
          if (dhErr.stack) {
            console.error('[Update] Dockhand Stack-Trace:', dhErr.stack);
          }
        }
      } else {
        console.warn('[Update] Dockhand Pro API nicht konfiguriert (Token oder URL fehlt in Einstellungen).');
      }

      if (apiSuccess) return;

      // 2. Fallback: Lokales Docker CLI über /var/run/docker.sock
      console.log('[Update] Fallback 1: Versuche Update über lokales Docker-Socket (/var/run/docker.sock)...');
      exec(dockerDirectCmd, { timeout: 60000 }, (errDirect, stdoutDirect, stderrDirect) => {
        if (!errDirect) {
          console.log('[Update] ERFOLG: Docker-Container erfolgreich über lokales Docker aktualisiert und neu gestartet.');
          if (stdoutDirect) console.log('[Update] Docker STDOUT:', stdoutDirect);
          return;
        }
        console.error('[Update] FEHLER beim lokalen Docker-Update:', errDirect.message);
        if (stdoutDirect) console.error('[Update] Docker STDOUT:', stdoutDirect);
        if (stderrDirect) console.error('[Update] Docker STDERR:', stderrDirect);

        // 3. Fallback: Update über nsenter (Host-Namespace)
        console.log('[Update] Fallback 2: Versuche Update über Host-Namespace (nsenter)...');
        exec(nsenterCmd, { timeout: 60000 }, (errNs, stdoutNs, stderrNs) => {
          if (!errNs) {
            console.log('[Update] ERFOLG: Docker-Container erfolgreich über nsenter aktualisiert und neu gestartet.');
            if (stdoutNs) console.log('[Update] nsenter STDOUT:', stdoutNs);
            return;
          }
          console.error('[Update] FEHLER bei nsenter-Update:', errNs.message);
          if (stdoutNs) console.error('[Update] nsenter STDOUT:', stdoutNs);
          if (stderrNs) console.error('[Update] nsenter STDERR:', stderrNs);
          console.error('[Update] KRITISCH: Alle Update-Methoden (Dockhand API, lokales Docker CLI, nsenter) sind fehlgeschlagen!');
        });
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


