const db              = require('./db');
const { sendWebhook } = require('./utils/sendWebhook');
const { fetchAgentStats } = require('./utils/agentFetch');

// broadcast wird lazy geladen (zirkuläre Abhängigkeit vermeiden)
let _broadcast = null;
const broadcast = (data) => {
  if (!_broadcast) {
    try { _broadcast = require('./websocket').broadcast; } catch {}
  }
  _broadcast?.(data);
};

// ─── In-Memory-Zustand pro (Regel × Server) ──────────────────────────────────
// Schlüssel: "<ruleId>:<serverId>" → { activeSince, lastFiredAt, hasFired }
const state = new Map();
const getState = (key) => {
  if (!state.has(key)) state.set(key, { activeSince: null, lastFiredAt: null, hasFired: false });
  return state.get(key);
};

const METRIC_LABELS = { cpu: 'CPU', memory: 'RAM', disk: 'Disk', net_rx: 'Netz ↓', net_tx: 'Netz ↑', action: 'Aktion' };
const METRIC_UNIT   = { cpu: '%', memory: '%', disk: '%', net_rx: ' MB/s', net_tx: ' MB/s', action: '' };

// ─── Metrik-Wert abrufen ─────────────────────────────────────────────────────
async function getMetricValue(metric, agentId) {
  if (metric === 'action') return null; // Aktions-Alerts werden in actionNotify gehandelt

  if (agentId != null) {
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
async function evaluateConditions(conditions, agentId) {
  const results = [];
  for (const cond of conditions) {
    let value;
    try { value = await getMetricValue(cond.metric, agentId); } catch { value = null; }
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
    WHERE r.enabled = 1 AND r.metric != 'action'
  `).all();

  for (const rule of rules) {
    // Bedingungen lesen (neu: conditions-Array, Fallback: alter Einzel-Wert)
    let conditions = [];
    try { conditions = JSON.parse(rule.conditions || '[]'); } catch {}
    if (conditions.length === 0) {
      // Fallback für alte Regeln ohne conditions-Array
      conditions = [{ metric: rule.metric, condition: rule.condition, threshold: rule.threshold }];
    }

    const logic   = rule.logic || 'and';
    const servers = getServerList(rule);

    for (const srv of servers) {
      const results = await evaluateConditions(conditions, srv.agentId);
      if (results.some(r => r === null)) continue; // Metrik nicht verfügbar

      const conditionMet = logic === 'or'
        ? results.some(r => r.met)
        : results.every(r => r.met);

      const stateKey = `${rule.id}:${srv.key}`;
      const s        = getState(stateKey);

      // Zusammenfassende Nachricht aus allen Bedingungen
      const detailLines = results.map(r => {
        const u = METRIC_UNIT[r.cond.metric] ?? '%';
        const c = r.cond.condition === 'gt' ? '>' : '<';
        return `${METRIC_LABELS[r.cond.metric] ?? r.cond.metric} ${c} ${r.cond.threshold}${u} (${r.value.toFixed(2)}${u})`;
      }).join('\n');

      if (conditionMet) {
        if (s.activeSince === null) s.activeSince = now;
        const activeFor = now - s.activeSince;

        // Nur beim ersten Auslösen reagieren — kein Spam bis zur Erholung
        if (activeFor >= (rule.duration_seconds || 0) && !s.hasFired) {
          const logicStr = logic === 'or' ? '(ODER)' : '(UND)';
          const message  = `⚠️ Alert: ${rule.name} ${logicStr}\n${detailLines}\nServer: ${srv.name}`;
          try {
            await sendWebhook({ type: rule.wtype, url: rule.wurl }, message);
          } catch (err) {
            console.error(`[AlertEvaluator] Webhook "${rule.name}" fehlgeschlagen:`, err.message);
          }
          s.lastFiredAt = now;
          s.hasFired    = true;

          try {
            db.prepare("INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, ?, ?, 'fired')")
              .run(rule.id, results[0]?.value ?? 0, message);
          } catch {}

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
              threshold:  conditions[0]?.threshold ?? null,
            },
          });
        }
      } else {
        if (s.hasFired) {
          s.hasFired    = false;
          s.activeSince = null;
          const recoveryLines = results.map(r => {
            const u = METRIC_UNIT[r.cond.metric] ?? '%';
            return `${METRIC_LABELS[r.cond.metric] ?? r.cond.metric}: ${r.value.toFixed(2)}${u}`;
          }).join(', ');
          const message = `✅ Erholt: ${rule.name}\n${recoveryLines}\nServer: ${srv.name}`;

          // Webhook nur senden wenn notify_resolved aktiv
          if (rule.notify_resolved) {
            try {
              await sendWebhook({ type: rule.wtype, url: rule.wurl }, message);
            } catch (err) {
              console.error(`[AlertEvaluator] Resolved-Webhook "${rule.name}" fehlgeschlagen:`, err.message);
            }
          }

          try {
            db.prepare("INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, ?, ?, 'resolved')")
              .run(rule.id, results[0]?.value ?? 0, message);
          } catch {}
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
