const router = require('express').Router();
const { requirePermission } = require('../middleware/requirePermission');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const crypto = require('crypto');
const db = require('../db');

// Helper um den Audit-Log-Eintrag für lokale Aktionen zu schreiben
const logAction = (user, action, details) => {
  try {
    const stmt = db.prepare('INSERT INTO audit_logs (id, timestamp, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(crypto.randomUUID(), Date.now(), user.id, action, details, '127.0.0.1');
  } catch (e) {
    console.error('[Audit] Fehler beim Schreiben:', e.message);
  }
};

// Führt einen Befehl im Host-Namespace aus
const host = (cmd, opts = {}) =>
  execAsync(`nsenter --target 1 --mount --uts --ipc --net --pid -- ${cmd}`, { timeout: 10_000, ...opts });

// Validiere den Benutzernamen (nur alphanumerisch und Bindestriche/Unterstriche)
const isValidUser = (user) => /^[a-zA-Z0-9_-]+$/.test(user);

// 1. Hole lokale Systembenutzer
router.get('/users', requirePermission('cron.manage'), async (req, res) => {
  try {
    const { stdout } = await host('cat /etc/passwd');
    const users = stdout.trim().split('\n')
      .map(line => {
        const parts = line.split(':');
        return parts[0] ? parts[0].trim() : null;
      })
      .filter(u => u && isValidUser(u))
      .sort((a, b) => {
        if (a === 'root') return -1;
        if (b === 'root') return 1;
        return a.localeCompare(b);
      });
    res.json(users);
  } catch (err) {
    console.error('[Cron] Fehler beim Lesen lokaler User:', err.message);
    res.status(500).json({ error: 'Fehler beim Lesen der lokalen Benutzer' });
  }
});

// 2. Lese Cron-Jobs eines Benutzers
router.get('/jobs/:user', requirePermission('cron.manage'), async (req, res) => {
  const { user } = req.params;
  if (!isValidUser(user)) return res.status(400).json({ error: 'Ungültiger Benutzer' });
  try {
    const { stdout } = await host(`crontab -u ${user} -l`);
    const jobs = stdout.trim().split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const parts = line.split(/\s+/);
        if (parts.length >= 6) {
          return {
            schedule: parts.slice(0, 5).join(' '),
            command: parts.slice(5).join(' ')
          };
        }
        return { schedule: '?', command: line };
      });
    res.json(jobs);
  } catch (err) {
    // Wenn keine Crontab existiert, crontab -l liefert i.d.R. "no crontab for user"
    if (err.message.includes('no crontab')) {
      return res.json([]);
    }
    console.error(`[Cron] Fehler beim Lesen der Jobs für ${user}:`, err.message);
    res.json([]); // Leere Liste zurückgeben, wenn Fehler auftritt (z.B. User existiert nicht)
  }
});

// 3. Füge Cron-Job hinzu
router.post('/jobs/:user', requirePermission('cron.manage'), async (req, res) => {
  const { user } = req.params;
  const { schedule, command } = req.body;

  if (!isValidUser(user)) return res.status(400).json({ error: 'Ungültiger Benutzer' });
  if (!schedule || !command) return res.status(400).json({ error: 'Fehlende Felder' });
  // Verhindere mehrzeilige Befehle, da crontab pro Zeile arbeitet
  if (schedule.includes('\n') || command.includes('\n')) {
    return res.status(400).json({ error: 'Zeilenumbrüche sind nicht erlaubt' });
  }

  try {
    // Aktuelle lesen
    let currentCrontab = '';
    try {
      const { stdout } = await host(`crontab -u ${user} -l`);
      currentCrontab = stdout.trim();
    } catch (e) {
      if (!e.message.includes('no crontab')) throw e;
    }

    const newJob = `${schedule} ${command}`;
    const updatedCrontab = currentCrontab ? `${currentCrontab}\n${newJob}\n` : `${newJob}\n`;

    // Schreibe zurück
    await new Promise((resolve, reject) => {
      const child = spawn('nsenter', ['--target', '1', '--mount', '--uts', '--ipc', '--net', '--pid', '--', 'crontab', '-u', user, '-']);
      let errData = '';
      child.stderr.on('data', (d) => errData += d.toString());
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`crontab beendet mit ${code}: ${errData}`));
      });
      child.on('error', reject);
      child.stdin.write(updatedCrontab);
      child.stdin.end();
    });

    logAction(req.user, 'local_cron_job_created', `Cron Job für ${user} erstellt: ${newJob}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[Cron] Fehler beim Anlegen des Jobs für ${user}:`, err.message);
    res.status(500).json({ error: 'Fehler beim Anlegen des Jobs' });
  }
});

// 4. Lösche Cron-Job
router.delete('/jobs/:user/:index', requirePermission('cron.manage'), async (req, res) => {
  const { user, index } = req.params;
  if (!isValidUser(user)) return res.status(400).json({ error: 'Ungültiger Benutzer' });

  const idx = parseInt(index, 10);
  if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Ungültiger Index' });

  try {
    let currentCrontab = '';
    try {
      const { stdout } = await host(`crontab -u ${user} -l`);
      currentCrontab = stdout.trim();
    } catch (e) {
      if (e.message.includes('no crontab')) return res.status(400).json({ error: 'Keine Crontab gefunden' });
      throw e;
    }

    const lines = currentCrontab.split('\n');
    const validLines = [];
    let jobCounter = 0;
    let deletedJob = null;

    for (const line of lines) {
      const tLine = line.trim();
      if (!tLine || tLine.startsWith('#')) {
        validLines.push(line); // Kommentare beibehalten
      } else {
        if (jobCounter === idx) {
          deletedJob = tLine; // Diesen Job auslassen
        } else {
          validLines.push(line);
        }
        jobCounter++;
      }
    }

    if (!deletedJob) {
      return res.status(404).json({ error: 'Job nicht gefunden' });
    }

    const updatedCrontab = validLines.join('\n') + '\n';

    await new Promise((resolve, reject) => {
      const child = spawn('nsenter', ['--target', '1', '--mount', '--uts', '--ipc', '--net', '--pid', '--', 'crontab', '-u', user, '-']);
      let errData = '';
      child.stderr.on('data', (d) => errData += d.toString());
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`crontab beendet mit ${code}: ${errData}`));
      });
      child.on('error', reject);
      child.stdin.write(updatedCrontab);
      child.stdin.end();
    });

    logAction(req.user, 'local_cron_job_deleted', `Cron Job für ${user} gelöscht: ${deletedJob}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[Cron] Fehler beim Löschen des Jobs für ${user}:`, err.message);
    res.status(500).json({ error: 'Fehler beim Löschen des Jobs' });
  }
});

module.exports = router;
