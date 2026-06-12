/**
 * metricsCache.js
 * Zentrale Datenquelle für CPU, RAM und Netzwerk-Stats.
 * Ersetzt die bisher getrennten si-Aufrufe in websocket.js und metricsRecorder.js.
 * Beide Konsumenten erhalten dieselben Messwerte ohne doppelten systeminformation-Overhead.
 */
const si = require('systeminformation');

let latest   = null;
const subs   = new Set();
let timer    = null;

async function tick() {
  try {
    const [cpu, mem, network] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats(),
    ]);
    latest = {
      cpu:     Math.round(cpu.currentLoad * 10) / 10,
      cpuData: cpu,           // voll für Kern-Anzahl etc.
      mem,
      network,
      ts: Math.floor(Date.now() / 1000),
    };
    subs.forEach(fn => { try { fn(latest); } catch {} });
  } catch (e) {
    console.warn('[metricsCache] tick-Fehler:', e.message);
  }
}

function start(intervalMs = 1_000) {
  if (timer) return; // bereits gestartet
  tick();            // sofort
  timer = setInterval(tick, intervalMs);
  console.log(`Metrics-Cache gestartet (${intervalMs}ms Intervall)`);
}

/** Liefert den zuletzt gemessenen Wert (oder null beim ersten Start). */
function getLatest() { return latest; }

/** Abonniert neue Werte. Gibt Unsubscribe-Funktion zurück. */
function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

module.exports = { start, getLatest, subscribe };
