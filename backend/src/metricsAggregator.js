const db = require('./db');

// ─── Prepared Statements ─────────────────────────────────────────────────────

// Alle bekannten Server-IDs aus den Raw-Metriken
const getServerIds = db.prepare(
  'SELECT DISTINCT server_id FROM metrics'
);

// Raw (1s) → metrics_10s
const agg10s = db.prepare(`
  INSERT OR REPLACE INTO metrics_10s (ts, server_id, cpu, mem, disk, net_rx, net_tx)
  SELECT (ts/10)*10, server_id,
    ROUND(AVG(cpu), 1),
    ROUND(AVG(mem_used)  * 100.0 / NULLIF(AVG(mem_total),  0), 1),
    ROUND(AVG(disk_used) * 100.0 / NULLIF(AVG(disk_total), 0), 1),
    ROUND(AVG(net_rx_sec) / 1024.0, 2),
    ROUND(AVG(net_tx_sec) / 1024.0, 2)
  FROM metrics
  WHERE server_id = ? AND ts >= ? AND ts < ? AND mem_total > 0
  GROUP BY (ts/10), server_id
`);

// metrics_10s → metrics_1min
const agg1min = db.prepare(`
  INSERT OR REPLACE INTO metrics_1min (ts, server_id, cpu, mem, disk, net_rx, net_tx)
  SELECT (ts/60)*60, server_id,
    ROUND(AVG(cpu), 1),
    ROUND(AVG(mem), 1),
    ROUND(AVG(disk), 1),
    ROUND(AVG(net_rx), 2),
    ROUND(AVG(net_tx), 2)
  FROM metrics_10s
  WHERE server_id = ? AND ts >= ? AND ts < ?
  GROUP BY (ts/60), server_id
`);

// metrics_1min → metrics_1hour
const agg1hour = db.prepare(`
  INSERT OR REPLACE INTO metrics_1hour (ts, server_id, cpu, mem, disk, net_rx, net_tx)
  SELECT (ts/3600)*3600, server_id,
    ROUND(AVG(cpu), 1),
    ROUND(AVG(mem), 1),
    ROUND(AVG(disk), 1),
    ROUND(AVG(net_rx), 2),
    ROUND(AVG(net_tx), 2)
  FROM metrics_1min
  WHERE server_id = ? AND ts >= ? AND ts < ?
  GROUP BY (ts/3600), server_id
`);

// Cleanup
const cleanup10s   = db.prepare('DELETE FROM metrics_10s   WHERE ts < ?');
const cleanup1min  = db.prepare('DELETE FROM metrics_1min  WHERE ts < ?');
const cleanup1hour = db.prepare('DELETE FROM metrics_1hour WHERE ts < ?');

// ─── Aggregation ─────────────────────────────────────────────────────────────

function aggregateAll() {
  const now     = Math.floor(Date.now() / 1000);
  const servers = getServerIds.all().map(r => r.server_id);

  for (const sid of servers) {
    // Raw → 10s: letzte 35s (etwas Overlap für sicheres Abdecken)
    const from10s = now - 35;
    const to10s   = now - 5;
    agg10s.run(sid, from10s, to10s);
  }
}

function aggregateMinute() {
  const now     = Math.floor(Date.now() / 1000);
  const servers = db.prepare('SELECT DISTINCT server_id FROM metrics_10s').all().map(r => r.server_id);

  for (const sid of servers) {
    // 10s → 1min: letzte 2 Minuten
    const from = now - 120;
    const to   = now - 10;
    agg1min.run(sid, from, to);
  }
}

function aggregateHour() {
  const now     = Math.floor(Date.now() / 1000);
  const servers = db.prepare('SELECT DISTINCT server_id FROM metrics_1min').all().map(r => r.server_id);

  for (const sid of servers) {
    // 1min → 1hour: letzte 2 Stunden
    const from = now - 7200;
    const to   = now - 60;
    agg1hour.run(sid, from, to);
  }
}

function runCleanup() {
  const now = Math.floor(Date.now() / 1000);
  cleanup10s.run(now   - 7  * 86400);       // 7 Tage
  cleanup1min.run(now  - 30 * 86400);       // 30 Tage
  cleanup1hour.run(now - 180 * 86400);      // 6 Monate
}

// ─── Start ───────────────────────────────────────────────────────────────────

function start() {
  // 10s-Aggregation: alle 30s
  setInterval(aggregateAll, 30_000);

  // 1min-Aggregation: alle 5 Minuten
  setInterval(aggregateMinute, 5 * 60_000);

  // 1h-Aggregation: stündlich
  setInterval(aggregateHour, 60 * 60_000);

  // Cleanup: stündlich
  runCleanup();
  setInterval(runCleanup, 60 * 60_000);

  // Sofortige Erstbefüllung nach kurzem Delay (Raw-Daten müssen erst vorhanden sein)
  setTimeout(aggregateAll, 35_000);

  console.log('Metrics-Aggregator gestartet (10s→1min→1h, 6 Monate Aufbewahrung)');
}

module.exports = { start };
