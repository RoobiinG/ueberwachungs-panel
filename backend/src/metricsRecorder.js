const si  = require('systeminformation');
const db  = require('./db');
const { getHostDisks } = require('./hostUtils');

const insert  = db.prepare(`
  INSERT OR REPLACE INTO metrics (ts, cpu, mem_used, mem_total, disk_used, disk_total)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const cleanup = db.prepare('DELETE FROM metrics WHERE ts < ?');

async function record() {
  try {
    const [cpu, mem, siDisk] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
    const ts = Math.floor(Date.now() / 1000);

    // Disk: nsenter für echte Host-Daten, Fallback auf si.fsSize()
    const hostDisk = await getHostDisks();
    const disks = hostDisk || siDisk.map(d => ({ mount: d.mount, used: d.used, size: d.size }));
    const root = disks.find(d => d.mount === '/') || disks[0];

    insert.run(
      ts,
      Math.round(cpu.currentLoad * 10) / 10,
      mem.total - mem.available,   // MemAvailable-basiert = entspricht htop/free -h
      mem.total,
      root?.used  ?? 0,
      root?.size  ?? 0,
    );

    // Daten älter als 30 Tage löschen
    cleanup.run(ts - 30 * 24 * 3600);
  } catch {}
}

function start() {
  record();                                    // sofort beim Start einmal aufzeichnen
  setInterval(record, 10_000);                // dann alle 10 Sekunden
  console.log('Metrics-Recorder gestartet (alle 10 Sek, 30 Tage Aufbewahrung)');
}

module.exports = { start };
