const router = require('express').Router();
const os     = require('os');
const si = require('systeminformation');
const fs     = require('fs');
const path   = require('path');
const express= require('express');
const axios  = require('axios');
const db     = require('../db');
const crypto = require('crypto');
const { getHostDisks } = require('../hostUtils');
const { requirePermission } = require('../middleware/requirePermission');

router.get('/stats', requirePermission('metrics.view'), async (req, res) => {
  try {
    // Parallelisierte Abfragen mit individuellem Error-Handling
    const wrap = (promise, fallback) => Promise.resolve(promise).catch(err => {
      console.warn(`[SystemStats] Teilfehler: ${err.message}`);
      return fallback;
    });

    const [cpu, mem, siDisk, network, os, time] = await Promise.all([
      wrap(si.currentLoad(), { currentLoad: 0 }),
      wrap(si.mem(), { total: 0, available: 0, free: 0 }),
      wrap(si.fsSize(), []),
      wrap(si.networkStats(), []),
      wrap(si.osInfo(), { distro: 'Unknown', release: '', arch: '', hostname: '' }),
      wrap(si.time(), { uptime: 0 }),
    ]);

    // Disk: nsenter liefert echte Host-Daten; Fallback auf si.fsSize()
    let disk = null;
    try {
      disk = await getHostDisks();
    } catch (e) {
      console.warn('[SystemStats] getHostDisks fehlgeschlagen:', e.message);
    }

    if (!disk || disk.length === 0) {
      disk = (Array.isArray(siDisk) ? siDisk : []).map(d => ({
        fs: d.fs || '', size: d.size || 0, used: d.used || 0, free: d.available || 0, usedPercent: d.use || 0, mount: d.mount || '',
      }));
    }

    res.json({
      cpu: { usage: Math.round(cpu?.currentLoad || 0), cores: cpu?.cpus?.length || 0 },
      memory: {
        total: mem?.total || 0,
        used: (mem?.total || 0) - (mem?.available || 0),
        free: mem?.free || 0,
        usedPercent: (mem?.total > 0) ? Math.round(((mem.total - mem.available) / mem.total) * 100) : 0,
      },
      disk: disk || [],
      network: (Array.isArray(network) ? network : []).map(n => ({
        iface: n.iface || 'eth0',
        rxBytes: n.rx_bytes || 0,
        txBytes: n.tx_bytes || 0,
        rxSec: n.rx_sec || 0,
        txSec: n.tx_sec || 0,
      })),
      os: {
        distro: os?.distro || 'Unknown',
        release: os?.release || '',
        arch: os?.arch || '',
        hostname: process.env.SERVER_HOSTNAME || os?.hostname || 'Panel',
        uptime: time?.uptime || 0,
      },
    });
  } catch (err) {
    console.error('[SystemStats] Schwerwiegender Fehler:', err);
    res.status(500).json({ error: 'Systemdaten konnten nicht ermittelt werden' });
  }
});

router.get('/info', requirePermission('metrics.view'), async (req, res) => {
  try {
    const [cpu, system] = await Promise.all([si.cpu(), si.system()]);
    res.json({ cpu, system });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Backup & Migration ───────────────────────────────────────────────────────

router.get('/backup', requirePermission('system.backup'), (req, res) => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../data.db');
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.warn('[Backup] WAL checkpoint failed:', e.message);
  }
  if (fs.existsSync(dbPath)) {
    res.download(dbPath, 'ueberwachungs-panel-backup.db');
  } else {
    res.status(404).json({ error: 'Datenbankdatei nicht gefunden' });
  }
});

router.post('/migrate/import', requirePermission('system.backup'), express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../data.db');
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'Keine Daten empfangen' });
  }
  
  try {
    const tmpPath = dbPath + '.tmp';
    fs.writeFileSync(tmpPath, req.body);
    
    // Prüfen ob es eine SQLite DB ist
    const header = Buffer.alloc(16);
    const fd = fs.openSync(tmpPath, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    
    if (header.toString('utf8') !== 'SQLite format 3\0') {
      fs.unlinkSync(tmpPath);
      return res.status(400).json({ error: 'Ungültige SQLite-Datenbankdatei' });
    }
    
    db.close();
    fs.renameSync(tmpPath, dbPath);
    
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
    
    res.json({ success: true, message: 'Datenbank erfolgreich importiert. Server startet neu.' });
    
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (err) {
    res.status(500).json({ error: 'Import fehlgeschlagen: ' + err.message });
  }
});

router.post('/migrate/push', requirePermission('system.backup'), async (req, res) => {
  const { targetUrl, username, password } = req.body;
  if (!targetUrl || !username || !password) {
    return res.status(400).json({ error: 'Ziel-URL, Benutzername und Passwort erforderlich' });
  }
  
  const target = targetUrl.replace(/\/$/, '');
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../data.db');
  
  try {
    // 1. Authentifizieren am Ziel-Panel
    const loginRes = await axios.post(`${target}/api/auth/login`, { username, password });
    const token = loginRes.data.token;
    if (!token) throw new Error('Kein Token in der Antwort vom Ziel-Panel');
    
    // 2. Eigene DB sichern (WAL wegschreiben)
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    
    if (!fs.existsSync(dbPath)) throw new Error('Lokale Datenbankdatei nicht gefunden');
    const dbData = fs.readFileSync(dbPath);
    
    // 3. DB ans Ziel-Panel senden
    await axios.post(`${target}/api/system/migrate/import`, dbData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    
    // 4. Agents updaten (Script + PANEL_URL setzen)
    const agents = db.prepare('SELECT id, name, url, token FROM remote_agents').all();
    const results = [];
    
    // Script lokal laden, um es an die Agents zu pushen
    const scriptPath = path.resolve(__dirname, '../../../agent/panel-agent.js');
    let script = '';
    try { script = fs.readFileSync(scriptPath, 'utf8'); } catch (e) {}

    for (const agent of agents) {
      try {
        const agentUrl = agent.url.replace(/\/$/, '');
        
        // Zuerst versuchen wir, den Agent zu updaten, damit er den /config Endpunkt sicher kennt
        if (script) {
          try {
            const hmac = crypto.createHmac('sha256', agent.token).update(script).digest('hex');
            await axios.post(`${agentUrl}/update`, { script, hmac }, {
              headers: { 'x-agent-token': agent.token },
              timeout: 10000
            });
            // Agent startet sich in 1.5s neu. Wir warten 4 Sekunden.
            await new Promise(r => setTimeout(r, 4000));
          } catch (updateErr) {
            console.warn(`[Migration] Agent-Update für ${agent.name} fehlgeschlagen:`, updateErr.message);
          }
        }

        // Dann rufen wir /config auf
        await axios.post(`${agentUrl}/config`, { panelUrl: target }, {
          headers: { 'x-agent-token': agent.token },
          timeout: 5000
        });
        results.push({ name: agent.name, success: true });
      } catch (err) {
        results.push({ name: agent.name, success: false, error: err.message });
      }
    }
    
    res.json({ success: true, message: 'Migration erfolgreich abgeschlossen!', agents: results });
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    res.status(err.response?.status || 500).json({ error: 'Migration fehlgeschlagen: ' + msg });
  }
});

module.exports = router;
