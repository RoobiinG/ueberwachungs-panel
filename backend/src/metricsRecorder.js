const si  = require('systeminformation');
const db  = require('./db');

const insert  = db.prepare(`
  INSERT OR REPLACE INTO metrics (ts, cpu, mem_used, mem_total, disk_used, disk_total)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const cleanup = db.prepare('DELETE FROM metrics WHERE ts < ?');

async function record() {
  try {
    const [cpu, mem, disk] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
    const ts = Math.floor(Date.now() / 1000);

    // Nur das erste Haupt-Laufwerk
    const root = disk.find(d => d.mount === '/') || disk[0];

    insert.run(
      ts,
      Math.round(cpu.currentLoad * 10) / 10,
      mem.used,
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
  setInterval(record, 5 * 60 * 1000);         // dann alle 5 Minuten
  console.log('Metrics-Recorder gestartet (alle 5 min, 30 Tage Aufbewahrung)');
}

module.exports = { start };
