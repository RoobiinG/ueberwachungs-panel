const si  = require('systeminformation');
const db  = require('./db');
const { getHostDisks } = require('./hostUtils');

const insert  = db.prepare(`
  INSERT OR REPLACE INTO metrics (ts, server_id, cpu, mem_used, mem_total, disk_used, disk_total, net_rx_sec, net_tx_sec)
  VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)
`);
const cleanup = db.prepare("DELETE FROM metrics WHERE ts < ? AND server_id = 'local'");

async function record() {
  try {
    const [cpu, mem, siDisk, netStats] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
    ]);
    const ts = Math.floor(Date.now() / 1000);

    const hostDisk = await getHostDisks();
    const disks = hostDisk || siDisk.map(d => ({ mount: d.mount, used: d.used, size: d.size }));
    const root = disks.find(d => d.mount === '/') || disks[0];

    // Netzwerk: alle Non-Loopback-Interfaces summieren; rx_sec = -1 beim ersten Aufruf
    let rxSec = 0, txSec = 0;
    for (const n of (netStats || [])) {
      if (n.iface === 'lo') continue;
      if ((n.rx_sec ?? -1) >= 0) rxSec += n.rx_sec;
      if ((n.tx_sec ?? -1) >= 0) txSec += n.tx_sec;
    }

    insert.run(
      ts,
      Math.round(cpu.currentLoad * 10) / 10,
      mem.total - mem.available,
      mem.total,
      root?.used  ?? 0,
      root?.size  ?? 0,
      Math.round(rxSec),
      Math.round(txSec),
    );
  } catch {}
}

function start() {
  record();
  setInterval(record, 10_000);
  // Cleanup nur stündlich statt bei jedem Messwert
  const runCleanup = () => cleanup.run(Math.floor(Date.now() / 1000) - 30 * 24 * 3600);
  runCleanup();
  setInterval(runCleanup, 3_600_000);
  console.log('Metrics-Recorder gestartet (alle 10 Sek, 30 Tage Aufbewahrung)');
}

module.exports = { start };
