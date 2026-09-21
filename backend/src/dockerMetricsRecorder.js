let Docker;
try { Docker = require('dockerode'); } catch { /* Docker nicht verfügbar */ }

const db = require('./db');

// In-Memory: vorherige Netzwerk-Bytes pro Container für Delta-Berechnung
const prevNet = new Map(); // containerId → { rx, tx, ts }

// Letzter bekannter Snapshot für WS-Broadcast
const latestStats = new Map(); // containerId → stats

function getLatestStats() {
  return Object.fromEntries(latestStats);
}

function calcCpu(stats) {
  const cpu     = stats.cpu_stats;
  const preCpu  = stats.precpu_stats;
  const cpuDelta    = (cpu.cpu_usage?.total_usage ?? 0) - (preCpu.cpu_usage?.total_usage ?? 0);
  const systemDelta = (cpu.system_cpu_usage ?? 0) - (preCpu.system_cpu_usage ?? 0);
  const numCpus     = cpu.online_cpus || cpu.cpu_usage?.percpu_usage?.length || 1;
  if (systemDelta <= 0 || cpuDelta < 0) return 0;
  return Math.round((cpuDelta / systemDelta) * numCpus * 100 * 10) / 10;
}

function calcNet(stats, containerId, intervalSec) {
  const networks = stats.networks || {};
  let totalRx = 0, totalTx = 0;
  for (const iface of Object.values(networks)) {
    totalRx += iface.rx_bytes ?? 0;
    totalTx += iface.tx_bytes ?? 0;
  }

  const prev = prevNet.get(containerId);
  let rxSec = 0, txSec = 0;
  if (prev) {
    // Container-Neustart erkennen (Bytes kleiner als vorher)
    rxSec = totalRx >= prev.rx ? Math.round((totalRx - prev.rx) / intervalSec) : 0;
    txSec = totalTx >= prev.tx ? Math.round((totalTx - prev.tx) / intervalSec) : 0;
  }
  prevNet.set(containerId, { rx: totalRx, tx: totalTx });
  return { rxSec, txSec };
}

async function recordContainerStats() {
  if (!Docker) return;
  let docker;
  try {
    docker = new Docker({ socketPath: '/var/run/docker.sock' });
    await docker.info(); // Verbindung prüfen
  } catch { return; }

  let containers;
  try {
    containers = await docker.listContainers({ all: false });
  } catch { return; }

  const ts        = Math.floor(Date.now() / 1000);
  const INTERVAL  = 30;
  const RETENTION = 86_400; // 24h

  await Promise.allSettled(containers.map(async (c) => {
    const id      = c.Id;
    const name    = (c.Names?.[0] || id).replace(/^\//, '');
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 3000));
    let stats;
    try {
      stats = await Promise.race([docker.getContainer(id).stats({ stream: false }), timeout]);
    } catch { return; }

    const cpuPercent = calcCpu(stats);
    const memUsed    = (stats.memory_stats?.usage ?? 0) - (stats.memory_stats?.stats?.cache ?? 0);
    const memLimit   = stats.memory_stats?.limit ?? 0;
    const { rxSec, txSec } = calcNet(stats, id, INTERVAL);

    const row = { ts, id, name, cpuPercent, memUsed, memLimit, rxSec, txSec };
    latestStats.set(id, row);

    db.prepare(
      'INSERT OR REPLACE INTO container_metrics (ts, container_id, container_name, cpu_percent, mem_used, mem_limit, net_rx_sec, net_tx_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(ts, id, name, cpuPercent, memUsed, memLimit, rxSec, txSec);
  }));

  // Cleanup läuft separat stündlich — nicht bei jeder Aufzeichnung
}

let _started = false;

function start() {
  if (!Docker) {
    console.warn('Docker-Metriken: dockerode nicht verfügbar');
    return;
  }
  _started = true;
  recordContainerStats().catch(() => {});
  setInterval(() => recordContainerStats().catch(() => {}), 30_000);
  // Cleanup stündlich
  const runCleanup = () => db.prepare('DELETE FROM container_metrics WHERE ts < ?').run(Math.floor(Date.now() / 1000) - 86_400);
  runCleanup();
  setInterval(runCleanup, 3_600_000);
  console.log('Docker-Metriken-Recorder gestartet (alle 30s, 24h Aufbewahrung)');
}

// Wird derzeit nicht gestartet (siehe index.js) — Docker-Stats kommen von der Dockhand-API.
// Für den Diagnostik-Report klar als "disabled" statt fälschlich als "nicht erreichbar" melden.
const getStatus = () => ({ disabled: !_started });

module.exports = { start, getLatestStats, getStatus };
