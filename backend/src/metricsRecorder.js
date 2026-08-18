const db    = require('./db');
const cache = require('./metricsCache');
const { getHostDisks } = require('./hostUtils');

// Die Abfragen werden erst beim ersten Gebrauch vorbereitet, nicht schon beim Laden
// des Moduls. Bei einer frischen Installation lief das `prepare` sonst, bevor die
// Migration in db.js die Spalten `net_rx_sec`/`net_tx_sec` ergänzt hatte — das Panel
// stürzte beim allerersten Start ab („table metrics has no column named net_rx_sec")
// und fing sich nur über den Container-Neustart. Alles, was in index.js *nach* dieser
// Zeile gestartet wird, kam dabei gar nicht erst zum Zug.
let _insert = null, _cleanup = null;
const insert = () => (_insert ??= db.prepare(`
  INSERT OR REPLACE INTO metrics (ts, server_id, cpu, mem_used, mem_total, disk_used, disk_total, net_rx_sec, net_tx_sec)
  VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)
`));
const cleanup = () => (_cleanup ??= db.prepare("DELETE FROM metrics WHERE ts < ? AND server_id = 'local'"));

// Disk-Wert wird separat gepolt (seltener, da sich kaum ändert)
let lastDisk = null;
async function refreshDisk() {
  try {
    const si = require('systeminformation');
    const hostDisk = await getHostDisks();
    const siDisk   = hostDisk || (await si.fsSize()).map(d => ({ mount: d.mount, used: d.used, size: d.size }));
    const root = siDisk.find(d => d.mount === '/') || siDisk[0];
    lastDisk = root ?? null;
  } catch {}
}

function start() {
  // Disk einmalig vorabladen, dann alle 30s aktualisieren (ändert sich kaum)
  refreshDisk();
  setInterval(refreshDisk, 30_000);

  // Cache abonnieren — wird jede Sekunde vom metricsCache befeuert
  cache.subscribe(({ cpu, mem, network, ts }) => {
    // Netzwerk summieren (alle Non-Loopback)
    let rxSec = 0, txSec = 0;
    for (const n of (network || [])) {
      if (n.iface === 'lo') continue;
      if ((n.rx_sec ?? -1) >= 0) rxSec += n.rx_sec;
      if ((n.tx_sec ?? -1) >= 0) txSec += n.tx_sec;
    }

    try {
      insert().run(
        ts,
        cpu,
        mem.total - mem.available,
        mem.total,
        lastDisk?.used  ?? 0,
        lastDisk?.size  ?? 0,
        Math.round(rxSec),
        Math.round(txSec),
      );
    } catch (e) {
      console.warn('[metricsRecorder] insert-Fehler:', e.message);
    }
  });

  // Raw-Daten nur 6 Stunden aufbewahren
  const runCleanup = () => cleanup().run(Math.floor(Date.now() / 1000) - 6 * 3600);
  runCleanup();
  setInterval(runCleanup, 3_600_000);
  console.log('Metrics-Recorder gestartet (via metricsCache)');
}

module.exports = { start };
