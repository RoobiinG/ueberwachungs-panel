const db              = require('./db');
const { sendWebhook } = require('./utils/sendWebhook');
const { fetchAgentStats } = require('./utils/agentFetch');
const patchmon        = require('./routes/patchmon');   // .fetchHosts (30s-Cache intern)
const hetzner         = require('./routes/hetzner');    // .getStorageBoxes (45s-Cache intern)
const mchost          = require('./routes/mchost');     // .getVserversSafe

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;

// PatchMon-Hosts holen (fail-soft; patchmon.fetchHosts cached 30s intern)
async function getPatchmonHosts() {
  const url = getSetting('patchmonUrl');
  const key = getSetting('patchmonTokenKey');
  const sec = getSetting('patchmonTokenSecret');
  if (!url || !key || !sec) return null;
  try { const { hosts } = await patchmon.fetchHosts(url, key, sec); return hosts; }
  catch { return null; }
}

// Hetzner Storage Boxes holen (fail-soft; eigener 45s-Cache)
async function getStorageBoxesSafe() {
  try { return await hetzner.getStorageBoxes(); } catch { return null; }
}

// MC-Host24 VServers holen (fail-soft)
async function getMCHostServersSafe() {
  try { return await mchost.getVserversSafe(); } catch { return null; }
}

// broadcast wird lazy geladen (zirkuläre Abhängigkeit vermeiden)
let _broadcast = null;
const broadcast = (data) => {
  if (!_broadcast) {
    try { _broadcast = require('./websocket').broadcast; } catch {}
  }
  _broadcast?.(data);
};

// ─── In-Memory-Zustand pro (Regel × Server) ──────────────────────────────────
// Schlüssel: "<ruleId>:<serverId>" → { activeSince, lastFiredAt, hasFired, lastFiredThreshold }
const state = new Map();
const getState = (ruleId, srvKey) => {
  const key = `${ruleId}:${srvKey}`;
  if (!state.has(key)) {
    let hasFired = false;
    let lastFiredThreshold = null;
    try {
      const row = db.prepare(
        "SELECT type, value FROM alert_history WHERE rule_id = ? AND (server_key = ? OR server_key IS NULL) ORDER BY triggered_at DESC, id DESC LIMIT 1"
      ).get(ruleId, srvKey);
      if (row && row.type === 'fired') {
        hasFired = true;
        lastFiredThreshold = row.value;
      }
    } catch {}
    state.set(key, { activeSince: null, lastFiredAt: null, hasFired, lastFiredThreshold });
  }
  return state.get(key);
};

const METRIC_LABELS = { cpu: 'CPU', memory: 'RAM', disk: 'Disk', net_rx: 'Netz ↓', net_tx: 'Netz ↑', action: 'Aktion', patchmon_updates: 'PatchMon Updates', patchmon_security: 'PatchMon Security', hetzner_storage_usage: 'Storage Box', mchost_runtime: 'MC-Host Laufzeit' };
const METRIC_UNIT   = { cpu: '%', memory: '%', disk: '%', net_rx: ' MB/s', net_tx: ' MB/s', action: '', patchmon_updates: '', patchmon_security: '', hetzner_storage_usage: '%', mchost_runtime: ' Tage' };

// ─── Metrik-Wert abrufen ─────────────────────────────────────────────────────
async function getMetricValue(metric, agentId, targetRef) {
  if (metric === 'action') return null; // Aktions-Alerts werden in actionNotify gehandelt

  // Hetzner Storage Box: Auslastung % der per target_ref gebundenen Box (server-unabhängig).
  if (metric === 'hetzner_storage_usage') {
    if (!targetRef) return null;
    const boxes = await getStorageBoxesSafe();
    if (!boxes) return null;
    const box = boxes.find(b => String(b.id) === String(targetRef));
    if (!box) return null;
    return box.usagePct ?? (box.quotaBytes > 0 ? (box.usedBytes / box.quotaBytes) * 100 : null);
  }

  // MC-Host24 Laufzeit: Restlaufzeit in Tagen des per target_ref gebundenen VServers
  if (metric === 'mchost_runtime') {
    if (!targetRef) return null;
    const servers = await getMCHostServersSafe();
    if (!servers) return null;
    const srv = servers.find(s => String(s.id) === String(targetRef));
    if (!srv || !srv.expire_at) return null;
    const expireSec = srv.expire_at > 1e11 ? Math.floor(srv.expire_at / 1000) : srv.expire_at;
    const nowSec = Math.floor(Date.now() / 1000);
    return (expireSec - nowSec) / 86400; // in Tagen
  }

  // PatchMon-Metriken: Wert kommt vom verknüpften PatchMon-Host des Servers.
  if (metric === 'patchmon_updates' || metric === 'patchmon_security') {
    // Lokaler Server: Bindung aus Settings; Remote-Agent: aus remote_agents.
    const hostId = agentId == null
      ? getSetting('patchmonLocalHostId')
      : db.prepare('SELECT patchmon_host_id FROM remote_agents WHERE id = ?').get(agentId)?.patchmon_host_id;
    if (!hostId) return null;
    const hosts = await getPatchmonHosts();
    if (!hosts) return null;
    const host = hosts.find(h => h.id === hostId);
    if (!host) return null;
    return metric === 'patchmon_security' ? (host.securityCount || 0) : (host.updatesCount || 0);
  }

  if (agentId != null) {
    // 1. Primär: Lokale SQLite-Datenbank (von remoteMetricsRecorder / Push), max. 5 Min. alt
    const serverId = `agent:${agentId}`;
    const minTs    = Math.floor(Date.now() / 1000) - 300;
    if (metric === 'net_rx' || metric === 'net_tx') {
      const col = metric === 'net_rx' ? 'net_rx_sec' : 'net_tx_sec';
      const row = db.prepare(`SELECT ${col} FROM metrics WHERE server_id = ? AND ts >= ? ORDER BY ts DESC LIMIT 1`).get(serverId, minTs);
      if (row && row[col] != null) return row[col] / (1024 * 1024);
    } else {
      const latest = db.prepare(
        `SELECT cpu,
                ROUND(mem_used * 100.0 / mem_total, 1) AS memory,
                ROUND(disk_used * 100.0 / disk_total, 1) AS disk
         FROM metrics WHERE server_id = ? AND ts >= ? AND mem_total > 0 ORDER BY ts DESC LIMIT 1`
      ).get(serverId, minTs);
      if (latest && latest[metric] != null) return latest[metric];
    }
    // 2. Fallback: Direkter HTTP-Aufruf via fetchAgentStats
    const stats = await fetchAgentStats(agentId);
    return stats?.[metric] ?? null;
  }

  // Lokale Metriken
  if (metric === 'net_rx' || metric === 'net_tx') {
    const col = metric === 'net_rx' ? 'net_rx_sec' : 'net_tx_sec';
    const row = db.prepare(`SELECT ${col} FROM metrics WHERE server_id='local' ORDER BY ts DESC LIMIT 1`).get();
    return row ? row[col] / (1024 * 1024) : null; // Bytes/s → MB/s
  }
  const latest = db.prepare(
    `SELECT cpu,
            ROUND(mem_used * 100.0 / mem_total, 1) AS memory,
            ROUND(disk_used * 100.0 / disk_total, 1) AS disk
     FROM metrics WHERE server_id = 'local' AND mem_total > 0 ORDER BY ts DESC LIMIT 1`
  ).get();
  return latest?.[metric] ?? null;
}

// ─── Agent-Cache (wird einmal pro evaluate()-Lauf befüllt) ───────────────────
let _agentCache = null;
const getAgentCache = () => {
  if (!_agentCache) {
    const rows = db.prepare('SELECT id, name FROM remote_agents').all();
    _agentCache = new Map(rows.map(r => [String(r.id), r]));
  }
  return _agentCache;
};
// Cache nach jeder Runde invalidieren (Agenten könnten sich ändern)
const clearAgentCache = () => { _agentCache = null; };

// ─── Server-Liste für eine Regel ermitteln ────────────────────────────────────
function getServerList(rule) {
  const ids = (() => {
    try { return JSON.parse(rule.agent_ids || '[]'); } catch { return []; }
  })();

  if (ids.length > 0) {
    const agents = getAgentCache();
    return ids.map(id => {
      if (id === 'local') return { key: 'local', name: 'Lokal', agentId: null };
      const a = agents.get(String(id));
      return a ? { key: String(a.id), name: a.name, agentId: a.id } : null;
    }).filter(Boolean);
  }
  // Fallback: altes agent_id-Format
  if (rule.agent_id) {
    return [{ key: String(rule.agent_id), name: rule.agent_name || `Agent #${rule.agent_id}`, agentId: rule.agent_id }];
  }
  return [{ key: 'local', name: 'Lokal', agentId: null }];
}

// ─── Alle Metrik-Werte für eine Bedingungsliste holen ────────────────────────
async function evaluateConditions(conditions, agentId, targetRef) {
  const results = [];
  for (const cond of conditions) {
    let value;
    try { value = await getMetricValue(cond.metric, agentId, targetRef); } catch { value = null; }
    if (value == null) { results.push(null); continue; }
    const met = cond.condition === 'gt' ? value > cond.threshold : value < cond.threshold;
    results.push({ met, value, cond });
  }
  return results;
}

// ─── Haupt-Evaluierungslauf ───────────────────────────────────────────────────
async function evaluate() {
  const now   = Math.floor(Date.now() / 1000);
  const rules = db.prepare(`
    SELECT r.*, w.type AS wtype, w.url AS wurl, a.name AS agent_name
    FROM alert_rules r
    JOIN webhooks w ON r.webhook_id = w.id
    LEFT JOIN remote_agents a ON r.agent_id = a.id
    WHERE r.enabled = 1 AND r.metric != 'action' AND w.active = 1
  `).all();

  for (const rule of rules) {
    // Bedingungen lesen (neu: conditions-Array, Fallback: alter Einzel-Wert)
    let conditions = [];
    try { conditions = JSON.parse(rule.conditions || '[]'); } catch {}
    if (conditions.length === 0) {
      // Fallback für alte Regeln ohne conditions-Array
      conditions = [{ metric: rule.metric, condition: rule.condition, threshold: rule.threshold }];
    }

    const logic     = rule.logic || 'and';
    let targetRefs = [];
    try { targetRefs = JSON.parse(rule.target_ref || '[]'); } catch {
      if (rule.target_ref) targetRefs = [String(rule.target_ref)];
    }

    const isStorage = conditions.some(c => c.metric === 'hetzner_storage_usage');
    const isMCHost  = conditions.some(c => c.metric === 'mchost_runtime');
    const servers = [];
    if (isStorage) {
      const boxes = (await getStorageBoxesSafe()) || [];
      const relevant = targetRefs.length > 0 ? boxes.filter(b => targetRefs.includes(String(b.id))) : boxes;
      for (const b of relevant) servers.push({ key: 'sbox:' + b.id, name: b.name, agentId: null, targetRef: String(b.id) });
    } else if (isMCHost) {
      const mcs = (await getMCHostServersSafe()) || [];
      const relevant = targetRefs.length > 0 ? mcs.filter(m => targetRefs.includes(String(m.id))) : mcs;
      for (const m of relevant) servers.push({ key: 'mchost:' + m.id, name: m.name || `VServer ${m.id}`, agentId: null, targetRef: String(m.id) });
    } else {
      for (const s of getServerList(rule)) servers.push({ ...s, targetRef: null });
    }

    for (const srv of servers) {
      const results = await evaluateConditions(conditions, srv.agentId, srv.targetRef);
      if (results.some(r => r === null)) continue; // Metrik nicht verfügbar

      const conditionMet = logic === 'or'
        ? results.some(r => r.met)
        : results.every(r => r.met);

      const s = getState(rule.id, srv.key);

      const metConditions = results.filter(r => r.met);
      let currentMetThreshold = null;
      if (metConditions.length > 0) {
        const isGt = metConditions[0].cond.condition === 'gt';
        const thresholds = metConditions.map(r => r.cond.threshold);
        currentMetThreshold = isGt ? Math.max(...thresholds) : Math.min(...thresholds);
      }

      const isMCHostMetric = conditions.some(c => c.metric === 'mchost_runtime');

      if (conditionMet) {
        if (s.activeSince === null) s.activeSince = now;
        const activeFor = now - s.activeSince;

        let shouldFire = false;
        if (activeFor >= (rule.duration_seconds || 0)) {
          if (!s.hasFired) {
            shouldFire = true;
          } else if (currentMetThreshold !== null && s.lastFiredThreshold !== null) {
            const isGt = metConditions[0]?.cond.condition === 'gt';
            if (isGt && currentMetThreshold > s.lastFiredThreshold) shouldFire = true;
            if (!isGt && currentMetThreshold < s.lastFiredThreshold) shouldFire = true;
          }
        }

        if (shouldFire) {
          let message;
          if (isMCHostMetric) {
            const daysVal = results[0]?.value;
            const daysStr = daysVal != null ? `${daysVal.toFixed(1).replace('.', ',')} Tage` : '? Tage';
            message = `⚠️ MC-Host24 Laufzeit-Warnung\nServer: ${srv.name} (MC-Host24)\nVerbleibende Laufzeit: ${daysStr}`;
          } else {
            const logicStr = logic === 'or' ? '(ODER)' : '(UND)';
            const detailLines = results.map(r => {
              const u = METRIC_UNIT[r.cond.metric] ?? '%';
              const c = r.cond.condition === 'gt' ? '>' : '<';
              return `${METRIC_LABELS[r.cond.metric] ?? r.cond.metric} ${c} ${r.cond.threshold}${u} (${r.value.toFixed(1)}${u})`;
            }).join('\n');
            message = `⚠️ Alert: ${rule.name} ${logicStr}\nServer: ${srv.name}\n${detailLines}`;
          }

          try {
            await sendWebhook({ type: rule.wtype, url: rule.wurl }, message);
          } catch (err) {
            console.error(`[AlertEvaluator] Webhook "${rule.name}" fehlgeschlagen:`, err.message);
          }
          s.lastFiredAt = now;
          s.hasFired    = true;
          if (currentMetThreshold !== null) s.lastFiredThreshold = currentMetThreshold;

          try {
            db.prepare("INSERT INTO alert_history (rule_id, value, message, type, server_key) VALUES (?, ?, ?, 'fired', ?)")
              .run(rule.id, currentMetThreshold ?? (results[0]?.value ?? 0), message, srv.key);
          } catch {
            try {
              db.prepare("INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, ?, ?, 'fired')")
                .run(rule.id, currentMetThreshold ?? (results[0]?.value ?? 0), message);
            } catch {}
          }

          broadcast({
            type: 'alert',
            payload: {
              alertType:  'fired',
              ruleId:     rule.id,
              ruleName:   rule.name,
              conditions,
              logic,
              serverName: srv.name,
              agentId:    srv.agentId || null,
              metric:     conditions[0]?.metric ?? null,
              value:      results[0]?.value ?? null,
              threshold:  currentMetThreshold ?? conditions[0]?.threshold ?? null,
            },
          });
        }
      } else {
        if (s.hasFired) {
          s.hasFired           = false;
          s.lastFiredThreshold = null;
          s.activeSince        = null;

          let message;
          if (isMCHostMetric) {
            const daysVal = results[0]?.value;
            const daysStr = daysVal != null ? `${daysVal.toFixed(1).replace('.', ',')} Tage` : '? Tage';
            message = `✅ MC-Host24 Laufzeit verlängert\nServer: ${srv.name} (MC-Host24)\nAktuelle Laufzeit: ${daysStr}`;
          } else {
            const recoveryLines = results.map(r => {
              const u   = METRIC_UNIT[r.cond.metric] ?? '%';
              const dir = r.cond.condition === 'gt' ? 'über' : 'unter';
              return `${METRIC_LABELS[r.cond.metric] ?? r.cond.metric}: ${r.value.toFixed(1)}${u} ✓ (war ${dir} ${r.cond.threshold}${u})`;
            }).join('\n');
            message = `✅ Erholt: ${rule.name}\nServer: ${srv.name}\n${recoveryLines}`;
          }

          try {
            await sendWebhook({ type: rule.wtype, url: rule.wurl }, message);
          } catch (err) {
            console.error(`[AlertEvaluator] Resolved-Webhook "${rule.name}" fehlgeschlagen:`, err.message);
          }

          try {
            db.prepare("INSERT INTO alert_history (rule_id, value, message, type, server_key) VALUES (?, ?, ?, 'resolved', ?)")
              .run(rule.id, results[0]?.value ?? 0, message, srv.key);
          } catch {
            try {
              db.prepare("INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, ?, ?, 'resolved')")
                .run(rule.id, results[0]?.value ?? 0, message);
            } catch {}
          }

          broadcast({
            type: 'alert',
            payload: { alertType: 'resolved', ruleId: rule.id, ruleName: rule.name, conditions, logic, serverName: srv.name, agentId: srv.agentId || null, metric: conditions[0]?.metric ?? null, value: results[0]?.value ?? null, threshold: conditions[0]?.threshold ?? null },
          });
        }
        s.activeSince = null;
      }
    }
  }
  clearAgentCache();
}

function start() {
  evaluate().catch(() => {});
  setInterval(() => evaluate().catch(() => {}), 10_000);
  console.log('Alert-Evaluator gestartet (alle 10s)');
}

module.exports = { start };
