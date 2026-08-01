const router = require('express').Router();
const updateCheck = require('../utils/updateCheck');
const requireRole = require('../middleware/roles');
const { exec, execFile } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
// execFile startet ohne Shell — nötig überall dort, wo Werte wie der GitHub-Token
// in den Befehl einfließen und sonst von der Shell interpretiert würden.
const execFilePromise = util.promisify(execFile);
const path = require('path');
const fs = require('fs');
const db = require('../db');
const dockhand = require('../utils/dockhandClient');

// SICHERHEIT: Das konfigurierte Update-Ziel wird unten in ein Shell-Skript eingesetzt, das per
// nsenter als root im Host-Namespace läuft. Ohne strenge Prüfung wäre ein Wert wie `$(befehl)`
// eine Befehlsinjektion als root auf dem Host. Erlaubt ist deshalb nur das Zeichenrepertoire,
// das Docker für Container-, Stack- und ID-Namen selbst zulässt.
const VALID_TARGET_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const isValidTarget = (t) => typeof t === 'string' && VALID_TARGET_RE.test(t);

/**
 * Schreibt eine Meldung in die Panel-Logs.
 * Das Update läuft nach der HTTP-Antwort im Hintergrund weiter — Fehler landeten bisher
 * ausschließlich in der Container-Konsole und waren im Panel nicht zu sehen. Ausgerechnet
 * beim Selbst-Update ist das unpraktisch, weil man dann erst recht in die Oberfläche schaut.
 */
const logPanel = (level, message, stack = null) => {
  try {
    db.prepare('INSERT INTO panel_logs (level, source, message, stack, url) VALUES (?, ?, ?, ?, ?)')
      .run(level, 'Panel-Updater', String(message).slice(0, 2000), stack ? String(stack).slice(0, 4000) : null, '/api/update/run');
  } catch { /* Logging darf das Update nie zum Scheitern bringen */ }
};

// Schutz vor mehrfachem Auslösen: Ein zweiter Klick würde sonst einen weiteren Pull und
// Recreate starten, während der erste noch läuft. Nach 10 Minuten gilt die Sperre als
// verwaist, damit ein abgebrochener Lauf das Update nicht dauerhaft blockiert.
const UPDATE_SPERRE_MS = 10 * 60 * 1000;
let updateLaeuftSeit = 0;

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
  if (updateLaeuftSeit && Date.now() - updateLaeuftSeit < UPDATE_SPERRE_MS) {
    const seit = Math.round((Date.now() - updateLaeuftSeit) / 1000);
    return res.status(409).json({
      error: `Es läuft bereits ein Update (seit ${seit} s). Bitte den Neustart abwarten.`,
    });
  }
  updateLaeuftSeit = Date.now();

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
          // Ohne Shell ausführen: Ein Token mit Sonderzeichen würde sonst von der Shell
          // interpretiert werden statt als Teil der URL anzukommen.
          await execFilePromise('git', ['pull', remoteUrl, 'master'], { cwd: repoDir, timeout: 45000 });
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
    logPanel('error', `Update fehlgeschlagen: ${pullErr.message}`, pullErr.stack);
    updateLaeuftSeit = 0;   // Sperre lösen, sonst blockiert ein Fehlversuch alle weiteren
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

      let configuredTarget = db.prepare("SELECT value FROM settings WHERE key = 'panel_container'").get()?.value?.trim() || '';
      // Zweite Verteidigungslinie: Auch ein bereits gespeicherter Wert wird vor der Verwendung
      // geprüft — er könnte aus einer älteren Version ohne Prüfung oder direkt aus der DB stammen.
      if (configuredTarget && !isValidTarget(configuredTarget)) {
        console.warn(`[Update] SICHERHEIT: Gespeichertes Update-Ziel enthält unerlaubte Zeichen und wird ignoriert. Es gilt wieder die automatische Erkennung.`);
        configuredTarget = '';
      }
      if (configuredTarget) {
        console.log(`[Update] Konfigurierter Standard-Container / Stack für Panel-Update: "${configuredTarget}"`);
      } else {
        console.log('[Update] Kein Standard-Container konfiguriert -> Automatische Erkennung aktiv.');
      }

      // 1. Primär: Update über Dockhand Pro API (falls in Einstellungen konfiguriert)
      const dhToken = db.prepare("SELECT value FROM settings WHERE key = 'dockhandApiToken'").get()?.value;
      const dhUrl   = db.prepare("SELECT value FROM settings WHERE key = 'dockhandUrl'").get()?.value;

      let apiSuccess = false;
      let stackUpdated = false;

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
          }

          console.log('[Update] Suche Panel-Stack über Dockhand API...');
          try {
            const stacksRes = await dockhand.getStacks(envId);
            const stacksList = Array.isArray(stacksRes) ? stacksRes : (Array.isArray(stacksRes.data) ? stacksRes.data : (stacksRes?.data && Array.isArray(stacksRes.data.data) ? stacksRes.data.data : []));
            const panelStack = stacksList.find(s => {
              const n = (s.name || '').toLowerCase();
              if (configuredTarget && configuredTarget !== 'ueberwachungs-panel') {
                return s.id === configuredTarget || n === configuredTarget.toLowerCase();
              }
              return s.id === configuredTarget || n === configuredTarget.toLowerCase() || n.includes('ueberwachungs-panel') || n.includes('ueberwachungs_panel') || n.includes('panel');
            });

            if (panelStack) {
              const sName = panelStack.name || panelStack.id;
              console.log(`[Update] Panel-Stack (${sName}, ID: ${panelStack.id}) gefunden! Starte Stack Deploy via Dockhand API...`);
              await dockhand.updateStack(envId, panelStack.id, {
                pull: true,
                build: false,
                forceRecreate: true,
                pullImages: true,
                buildImages: false,
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
            const panelContainer = list.find(c => {
              if (configuredTarget) {
                return c.id === configuredTarget || (c.name || '').toLowerCase() === configuredTarget.toLowerCase();
              }
              const n = (c.name || '').toLowerCase();
              const img = (c.image || '').toLowerCase();
              return n.includes('ueberwachungs-panel') || n.includes('panel') || img.includes('ueberwachungs-panel') || img.includes('roobiing');
            });

            if (panelContainer) {
              const cName = panelContainer.name || panelContainer.id;
              console.log(`[Update] Panel-Container (${cName}, ID: ${panelContainer.id}) gefunden! Versuche Update via Dockhand API...`);
              let containerUpdated = false;
              try {
                await dockhand.updateContainer(envId, panelContainer.id, { pull: true, forceRecreate: true });
                console.log(`[Update] ERFOLG: Container ${cName} wurde über Dockhand API (/api/containers/[id]/update) aktualisiert!`);
                apiSuccess = true;
                containerUpdated = true;
              } catch (updateErr1) {
                console.warn(`[Update] Warnung bei /api/containers/[id]/update via Dockhand API (${updateErr1.message}). Versuche Fallback /api/containers/batch-update...`);
                try {
                  await dockhand.batchUpdateContainers(envId, [panelContainer.id], { pull: true, forceRecreate: true });
                  console.log(`[Update] ERFOLG: Container ${cName} wurde über Dockhand API (/api/containers/batch-update) aktualisiert!`);
                  apiSuccess = true;
                  containerUpdated = true;
                } catch (updateErr2) {
                  console.error('[Update] FEHLER bei Container-Update via Dockhand API:', updateErr2.message);
                  console.log(`[Update] HINWEIS: Führe Host-Namespace Fallback aus, um Container-Update mit neuem Image sicherzustellen...`);
                }
              }
            } else {
              console.log(`[Update] HINWEIS: Kein Panel-Container in Dockhand Environment ${envId} gefunden.`);
            }
          }
        } catch (dhErr) {
          console.error('[Update] Dockhand Pro API Update fehlgeschlagen:', dhErr.message);
        }
      }

      // Hat einer der Dockhand-Wege (Stack-Deploy oder Container-Recreate) funktioniert,
      // ist das Update durch — dann darf der Host-Fallback nicht nochmal recreaten.
      if (apiSuccess) {
        logPanel('info', `Update über die Dockhand-API ausgeführt (${stackUpdated ? 'Stack-Deploy' : 'Container-Recreate'}).`);
        updateLaeuftSeit = 0;
        return;
      }

      // 2. Lokaler Host-Namespace Fallback (nsenter / docker inspect)
      // WICHTIG: Zuerst nsenter nutzen, da nur im Host-Namespace die Compose-Pfade (/home/robin/...) existieren!
      const targetName = configuredTarget || 'ueberwachungs-panel';
      const hostScript = `echo "[Update] Starte lokales Docker-Update für Ziel: ${targetName}..."; ` +
        `TARGET="${targetName}"; ` +
        `if [ -z "$TARGET" ] || [ "$TARGET" = "ueberwachungs-panel" ]; then ` +
          `DETECTED=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -iE 'roobiing|ueberwachungs-panel' | awk '{print $1}' | head -n 1); ` +
          `if [ -n "$DETECTED" ]; then ` +
            `TARGET="$DETECTED"; ` +
            `echo "[Update] Automatisch erkannter Container-Name: $TARGET"; ` +
          `fi; ` +
        `fi; ` +
        `echo "[Update] Pulle neues Image ghcr.io/roobiing/ueberwachungs-panel:latest..."; ` +
        `docker pull ghcr.io/roobiing/ueberwachungs-panel:latest; ` +
        `WDIR=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$TARGET" 2>/dev/null); ` +
        `CFG=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$TARGET" 2>/dev/null); ` +
        `if [ -n "$WDIR" ] && [ -d "$WDIR" ]; then ` +
          `echo "[Update] Compose Working-Directory von $TARGET gefunden: $WDIR"; ` +
          `cd "$WDIR" && docker compose pull && docker compose up -d --force-recreate && exit 0; ` +
        `fi; ` +
        `if [ -n "$CFG" ] && [ -f "$CFG" ]; then ` +
          `echo "[Update] Compose Config-File von $TARGET gefunden: $CFG"; ` +
          `docker compose -f "$CFG" pull && docker compose -f "$CFG" up -d --force-recreate && exit 0; ` +
        `fi; ` +
        `for d in /root /root/* /home/* /home/*/* /opt /opt/* /var/docker /var/docker/* /srv /srv/* /app /app/* $(pwd); do ` +
          `if [ -f "$d/docker-compose.yml" ] && grep -iE 'roobiing|ueberwachungs-panel' "$d/docker-compose.yml" >/dev/null 2>&1; then ` +
            `echo "[Update] Prüfe Compose-Datei in $d"; ` +
            `cd "$d" && docker compose pull && docker compose up -d --force-recreate && exit 0; ` +
          `fi; ` +
          `if [ -f "$d/docker-compose.prod.yml" ] && grep -iE 'roobiing|ueberwachungs-panel' "$d/docker-compose.prod.yml" >/dev/null 2>&1; then ` +
            `echo "[Update] Prüfe Compose-Datei in $d"; ` +
            `cd "$d" && docker compose pull && docker compose up -d --force-recreate && exit 0; ` +
          `fi; ` +
        `done; ` +
        `echo "[Update] Fallback: Standalone Recreate für Container $TARGET..."; ` +
        `docker restart "$TARGET"`;

      const nsenterCmd = `nsenter --target 1 --mount --uts --ipc --net --pid -- sh -c '${hostScript.replace(/'/g, "'\\''")}'`;
      const dockerDirectCmd = hostScript;

      console.log('[Update] Primär lokales Update über Host-Namespace (nsenter)...');
      exec(nsenterCmd, { timeout: 120000 }, (errNs, stdoutNs, stderrNs) => {
        if (!errNs) {
          console.log('[Update] ERFOLG: Docker-Container über nsenter (Host-Namespace) mit neuem Image aktualisiert und neu gestartet.');
          if (stdoutNs) console.log('[Update] nsenter STDOUT:', stdoutNs);
          logPanel('info', `Update über den Host-Namespace (nsenter) ausgeführt. Ziel: ${targetName}`);
          updateLaeuftSeit = 0;
          return;
        }
        console.error('[Update] FEHLER bei nsenter-Update:', errNs.message);
        if (stdoutNs) console.error('[Update] nsenter STDOUT:', stdoutNs);
        if (stderrNs) console.error('[Update] nsenter STDERR:', stderrNs);

        console.log('[Update] Fallback: Versuche Update über lokales Docker-Socket (/var/run/docker.sock)...');
        exec(dockerDirectCmd, { timeout: 120000 }, (errDirect, stdoutDirect, stderrDirect) => {
          if (!errDirect) {
            console.log('[Update] ERFOLG: Docker-Container über lokales Docker-Socket aktualisiert und neu gestartet.');
            if (stdoutDirect) console.log('[Update] Docker STDOUT:', stdoutDirect);
            logPanel('info', `Update über das lokale Docker-Socket ausgeführt. Ziel: ${targetName}`);
            updateLaeuftSeit = 0;
            return;
          }
          console.error('[Update] FEHLER beim lokalen Docker-Socket Update:', errDirect.message);
          if (stdoutDirect) console.error('[Update] Docker STDOUT:', stdoutDirect);
          if (stderrDirect) console.error('[Update] Docker STDERR:', stderrDirect);
          console.error('[Update] KRITISCH: Alle Update-Methoden sind fehlgeschlagen!');
          // In die Panel-Logs schreiben: Der Container läuft ja weiter, also sieht der Nutzer
          // die Meldung dort auch tatsächlich. Ohne das bliebe der Fehlschlag unbemerkt.
          logPanel('error',
            'Alle Update-Wege sind fehlgeschlagen (Dockhand-API, Host-Namespace via nsenter, Docker-Socket). ' +
            `Letzter Fehler: ${errDirect.message}`,
            [stderrDirect, stderrNs].filter(Boolean).join('\n---\n'));
          updateLaeuftSeit = 0;   // Sperre lösen, damit ein neuer Versuch möglich ist
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

// ── GET /api/update/targets ──────────────────────────────────────────────────
router.get('/targets', requireRole('admin'), async (req, res) => {
  const currentTarget = db.prepare("SELECT value FROM settings WHERE key = 'panel_container'").get()?.value || '';
  const targets = [];
  const addedIds = new Set();

  const addTarget = (id, name, type, source) => {
    if (!id || addedIds.has(id)) return;
    addedIds.add(id);
    targets.push({ id, name, type, source });
  };

  // 1. Stacks und Container über Dockhand Pro API abrufen (falls konfiguriert)
  const dhToken = db.prepare("SELECT value FROM settings WHERE key = 'dockhandApiToken'").get()?.value;
  const dhUrl   = db.prepare("SELECT value FROM settings WHERE key = 'dockhandUrl'").get()?.value;
  if (dhToken && dhUrl) {
    try {
      const envId = db.prepare("SELECT value FROM settings WHERE key = 'dockhandLocalEnvId'").get()?.value || '1';
      const stacksRes = await dockhand.getStacks(envId);
      const stacksList = Array.isArray(stacksRes) ? stacksRes : (Array.isArray(stacksRes.data) ? stacksRes.data : (stacksRes?.data && Array.isArray(stacksRes.data.data) ? stacksRes.data.data : []));
      stacksList.forEach(s => {
        addTarget(s.id, `[Dockhand Stack] ${s.name || s.id}`, 'stack', 'Dockhand');
      });

      const containersRes = await dockhand.getContainers(envId);
      const containersList = Array.isArray(containersRes) ? containersRes : (Array.isArray(containersRes.data) ? containersRes.data : (containersRes?.data && Array.isArray(containersRes.data.data) ? containersRes.data.data : []));
      containersList.forEach(c => {
        const img = (c.image || '').split('/').pop();
        // Nur EIN Eintrag pro Container. Der Name wird der ID vorgezogen: er ist lesbar und
        // funktioniert in beiden Update-Wegen — die Dockhand-Suche vergleicht ohnehin gegen
        // ID und Name, der Host-Fallback braucht ihn für `docker inspect` / `docker restart`.
        // Ohne Namen bleibt die ID als Rückfallebene.
        addTarget(c.name || c.id, `[Dockhand Container] ${c.name || c.id} (${img})`, 'container', 'Dockhand');
      });
    } catch (e) {
      console.warn('[Update/Targets] Dockhand Abruf fehlerhaft:', e.message);
    }
  }

  // 2. Lokale Docker-Container über Host-Namespace abrufen
  try {
    const cmd = 'nsenter --target 1 --mount --uts --ipc --net --pid -- docker ps -a --format "{{.Names}}|{{.Image}}" 2>/dev/null || docker ps -a --format "{{.Names}}|{{.Image}}" 2>/dev/null';
    const { stdout } = await execPromise(cmd, { timeout: 10000 });
    if (stdout) {
      stdout.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
        const [name, image] = line.split('|');
        if (name) {
          const imgShort = (image || '').split('/').pop();
          addTarget(name, `[Lokaler Container] ${name} (${imgShort})`, 'local', 'Lokal');
        }
      });
    }
  } catch (e) {
    console.warn('[Update/Targets] Lokaler Docker Abruf fehlerhaft:', e.message);
  }

  res.json({ success: true, currentTarget, targets });
});

// ── PUT /api/update/target ───────────────────────────────────────────────────
router.put('/target', requireRole('admin'), (req, res) => {
  const { target } = req.body;
  const val = (target || '').trim();
  // Leerer Wert = automatische Erkennung. Alles andere muss ein zulässiger Docker-Name sein,
  // da der Wert später im Host-Namespace in einer Shell landet (siehe isValidTarget oben).
  if (val && !isValidTarget(val)) {
    return res.status(400).json({
      error: 'Ungültiger Container- bzw. Stack-Name. Erlaubt sind Buchstaben, Ziffern sowie _ . - (maximal 128 Zeichen).',
    });
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('panel_container', ?, CURRENT_TIMESTAMP)").run(val);
  res.json({ success: true, target: val });
});

module.exports = router;


