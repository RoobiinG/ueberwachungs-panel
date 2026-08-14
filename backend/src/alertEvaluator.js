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

// ─── Wartungsfenster-Prüfung (Modul 4) ───────────────────────────────────────
function isServerInMaintenance(srvKey, agentId) {
  try {
    const keys = [srvKey, agentId ? String(agentId) : null].filter(Boolean);
    for (const k of keys) {
      const row = db.prepare(`
        SELECT id FROM maintenance_windows
        WHERE server_id = ? AND CURRENT_TIMESTAMP BETWEEN start_time AND end_time
        LIMIT 1
      `).get(k);
      if (row) return true;
    }
  } catch (e) {}
  return false;
}

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

// Tag als String aus einem Server/Objekt formatieren
function getServerTagString(item) {
  if (!item) return null;
  if (typeof item.tag === 'string' && item.tag.trim()) return item.tag.trim();
  if (Array.isArray(item.tags) && item.tags.length > 0) {
    const arr = item.tags
      .map(t => (typeof t === 'object' && t ? t.tag : t))
      .filter(Boolean);
    if (arr.length > 0) return arr.join(', ');
  }
  return null;
}

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
    const host = hosts.find(h => String(h.id) === String(hostId));
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

// ─── Server-Liste für PatchMon-Regeln ────────────────────────────────────────
// PatchMon-Alerts gelten für *alle* Server mit PatchMon-Verknüpfung (lokaler Server
// + Remote-Agenten), nicht nur für den lokalen. Eine Auswahl in agent_ids grenzt
// zusätzlich ein; ohne Auswahl zählen alle verknüpften Server.
const warnedPatchmonRules = new Set();
function getPatchmonServerList(rule) {
  let selected = [];
  try { selected = JSON.parse(rule.agent_ids || '[]'); } catch {}
  if (selected.length === 0 && rule.agent_id) selected = [String(rule.agent_id)];
  const wanted = new Set(selected.map(String));
  const all    = wanted.size === 0;

  const list = [];
  if ((all || wanted.has('local')) && getSetting('patchmonLocalHostId')) {
    list.push({ key: 'local', name: 'Lokal', agentId: null });
  }

  let rows = [];
  try {
    rows = db.prepare(
      "SELECT id, name FROM remote_agents WHERE patchmon_host_id IS NOT NULL AND TRIM(patchmon_host_id) != ''"
    ).all();
  } catch {}
  for (const a of rows) {
    if (all || wanted.has(String(a.id))) list.push({ key: String(a.id), name: a.name, agentId: a.id });
  }

  // Ohne jede Verknüpfung liefe die Regel still ins Leere → einmalig im Log melden.
  if (list.length === 0) {
    if (!warnedPatchmonRules.has(rule.id)) {
      warnedPatchmonRules.add(rule.id);
      console.warn(`[AlertEvaluator] PatchMon-Regel "${rule.name}" hat keinen verknüpften Server — unter Einstellungen › PatchMon-Server-Verknüpfung zuordnen.`);
    }
  } else {
    warnedPatchmonRules.delete(rule.id);
  }
  return list;
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
    SELECT r.*, w.type AS wtype, w.url AS wurl, w.method AS wmethod, w.headers AS wheaders, w.template AS wtemplate, a.name AS agent_name
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

    const isStorage  = conditions.some(c => c.metric === 'hetzner_storage_usage');
    const isMCHost   = conditions.some(c => c.metric === 'mchost_runtime');
    const isPatchmon = conditions.some(c => c.metric === 'patchmon_updates' || c.metric === 'patchmon_security');
    const servers = [];
    if (isStorage) {
      const boxes = (await getStorageBoxesSafe()) || [];
      const relevant = targetRefs.length > 0 ? boxes.filter(b => targetRefs.includes(String(b.id))) : boxes;
      for (const b of relevant) servers.push({ key: 'sbox:' + b.id, name: b.name, tag: getServerTagString(b), agentId: null, targetRef: String(b.id) });
    } else if (isMCHost) {
      const mcs = (await getMCHostServersSafe()) || [];
      const relevant = targetRefs.length > 0 ? mcs.filter(m => targetRefs.includes(String(m.id))) : mcs;
      for (const m of relevant) servers.push({ key: 'mchost:' + m.id, name: m.name || `VServer ${m.id}`, tag: getServerTagString(m), agentId: null, targetRef: String(m.id) });
    } else if (isPatchmon) {
      for (const s of getPatchmonServerList(rule)) servers.push({ ...s, tag: null, targetRef: null });
    } else {
      for (const s of getServerList(rule)) servers.push({ ...s, tag: getServerTagString(s), targetRef: null });
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
            const tagLine = srv.tag ? `\n🏷️ <b>Tag:</b> ${srv.tag}` : '';
            message = `⚠️ <b>MC-Host24 Laufzeit-Warnung</b>\n\n🖥️ <b>Server:</b> ${srv.name} (MC-Host24)${tagLine}\n⏳ <b>Verbleibende Laufzeit:</b> ${daysStr}`;
          } else {
            const logicStr = conditions.length > 1 ? (logic === 'or' ? ' (ODER)' : ' (UND)') : '';
            const tagLine  = srv.tag ? `\n🏷️ <b>Tag:</b> ${srv.tag}` : '';
            const detailLines = results.map(r => {
              const u = METRIC_UNIT[r.cond.metric] ?? '%';
              const c = r.cond.condition === 'gt' ? '>' : '<';
              const isIntMetric = r.cond.metric === 'patchmon_updates' || r.cond.metric === 'patchmon_security';
              const valStr = isIntMetric ? Math.round(r.value) : r.value.toFixed(1);
              return `📊 <b>${METRIC_LABELS[r.cond.metric] ?? r.cond.metric}:</b> ${valStr}${u} (Schwelle: ${c} ${r.cond.threshold}${u})`;
            }).join('\n');
            message = `⚠️ <b>Alert ausgelöst:</b> ${rule.name}${logicStr}\n\n🖥️ <b>Server:</b> ${srv.name}${tagLine}\n${detailLines}`;
          }

          const inMaintenance = isServerInMaintenance(srv.key, srv.agentId);
          if (!inMaintenance) {
            try {
              await sendWebhook({ type: rule.wtype, url: rule.wurl, method: rule.wmethod, headers: rule.wheaders, template: rule.wtemplate }, message, { ruleName: rule.name, serverName: srv.name, value: currentMetThreshold ?? (results[0]?.value ?? 0), alertType: 'fired' });
            } catch (err) {
              console.error(`[AlertEvaluator] Webhook "${rule.name}" fehlgeschlagen:`, err.message);
            }
          }
          s.lastFiredAt = now;
          s.hasFired    = true;
          if (currentMetThreshold !== null) s.lastFiredThreshold = currentMetThreshold;

          try {
            db.prepare("INSERT INTO alert_history (rule_id, value, message, type, server_key) VALUES (?, ?, ?, ?, ?)")
              .run(rule.id, currentMetThreshold ?? (results[0]?.value ?? 0), inMaintenance ? `[Wartungsmodus] ${message}` : message, inMaintenance ? 'suppressed' : 'fired', srv.key);
          } catch {
            try {
              db.prepare("INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, ?, ?, ?)")
                .run(rule.id, currentMetThreshold ?? (results[0]?.value ?? 0), inMaintenance ? `[Wartungsmodus] ${message}` : message, inMaintenance ? 'suppressed' : 'fired');
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
              tag:        srv.tag || null,
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
            const tagLine = srv.tag ? `\n🏷️ <b>Tag:</b> ${srv.tag}` : '';
            message = `✅ <b>MC-Host24 Laufzeit verlängert</b>\n\n🖥️ <b>Server:</b> ${srv.name} (MC-Host24)${tagLine}\n⏳ <b>Aktuelle Laufzeit:</b> ${daysStr}`;
          } else {
            const tagLine = srv.tag ? `\n🏷️ <b>Tag:</b> ${srv.tag}` : '';
            const recoveryLines = results.map(r => {
              const u   = METRIC_UNIT[r.cond.metric] ?? '%';
              const dir = r.cond.condition === 'gt' ? 'über' : 'unter';
              const isIntMetric = r.cond.metric === 'patchmon_updates' || r.cond.metric === 'patchmon_security';
              const valStr = isIntMetric ? Math.round(r.value) : r.value.toFixed(1);
              return `📊 <b>${METRIC_LABELS[r.cond.metric] ?? r.cond.metric}:</b> ${valStr}${u} ✓ (war ${dir} ${r.cond.threshold}${u})`;
            }).join('\n');
            message = `✅ <b>Erholt:</b> ${rule.name}\n\n🖥️ <b>Server:</b> ${srv.name}${tagLine}\n${recoveryLines}`;
          }

          const inMaintenance = isServerInMaintenance(srv.key, srv.agentId);
          if (!inMaintenance) {
            try {
              await sendWebhook({ type: rule.wtype, url: rule.wurl, method: rule.wmethod, headers: rule.wheaders, template: rule.wtemplate }, message, { ruleName: rule.name, serverName: srv.name, value: results[0]?.value ?? 0, alertType: 'resolved' });
            } catch (err) {
              console.error(`[AlertEvaluator] Resolved-Webhook "${rule.name}" fehlgeschlagen:`, err.message);
            }
          }

          try {
            db.prepare("INSERT INTO alert_history (rule_id, value, message, type, server_key) VALUES (?, ?, ?, ?, ?)")
              .run(rule.id, results[0]?.value ?? 0, inMaintenance ? `[Wartungsmodus] ${message}` : message, inMaintenance ? 'suppressed' : 'resolved', srv.key);
          } catch {
            try {
              db.prepare("INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, ?, ?, ?)")
                .run(rule.id, results[0]?.value ?? 0, inMaintenance ? `[Wartungsmodus] ${message}` : message, inMaintenance ? 'suppressed' : 'resolved');
            } catch {}
          }


          broadcast({
            type: 'alert',
            payload: { alertType: 'resolved', ruleId: rule.id, ruleName: rule.name, conditions, logic, serverName: srv.name, tag: srv.tag || null, agentId: srv.agentId || null, metric: conditions[0]?.metric ?? null, value: results[0]?.value ?? null, threshold: conditions[0]?.threshold ?? null },
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
