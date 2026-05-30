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

// ─── Server-Liste für eine Regel ermitteln ────────────────────────────────────
function getServerList(rule) {
  const ids = (() => {
    try { return JSON.parse(rule.agent_ids || '[]'); } catch { return []; }
  })();

  if (ids.length > 0) {
    return ids.map(id => {
      if (id === 'local') return { key: 'local', name: 'Lokal', agentId: null };
      const a = db.prepare('SELECT id, name FROM remote_agents WHERE id = ?').get(parseInt(id));
      return a ? { key: String(a.id), name: a.name, agentId: a.id } : null;
    }).filter(Boolean);
  }
  // Fallback: altes agent_id-Format
  if (rule.agent_id) {
    return [{ key: String(rule.agent_id), name: rule.agent_name || `Agent #${rule.agent_id}`, agentId: rule.agent_id }];
  }
  return [{ key: 'local', name: 'Lokal', agentId: null }];
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
    const servers = getServerList(rule);
    for (const srv of servers) {
      let value;
      try { value = await getMetricValue(rule.metric, srv.agentId); } catch { continue; }
      if (value == null) continue;

      const conditionMet = rule.condition === 'gt' ? value > rule.threshold : value < rule.threshold;
      const stateKey     = `${rule.id}:${srv.key}`;
      const s            = getState(stateKey);
      const unit         = METRIC_UNIT[rule.metric] ?? '%';
      const condStr      = rule.condition === 'gt' ? '>' : '<';

      if (conditionMet) {
        if (s.activeSince === null) s.activeSince = now;
        const activeFor = now - s.activeSince;

        if (activeFor >= rule.duration_seconds) {
          const cooldownSecs = rule.cooldown_minutes * 60;
          const cooldownOk   = s.lastFiredAt === null || (now - s.lastFiredAt) >= cooldownSecs;

          if (cooldownOk) {
            const message = `⚠️ Alert: ${rule.name}\n${METRIC_LABELS[rule.metric] ?? rule.metric} ${condStr} ${rule.threshold}${unit} (aktuell: ${value.toFixed(2)}${unit})\nServer: ${srv.name}`;
            try {
              await sendWebhook({ type: rule.wtype, url: rule.wurl }, message);
            } catch (err) {
              console.error(`[AlertEvaluator] Webhook "${rule.name}" fehlgeschlagen:`, err.message);
            }
            s.lastFiredAt = now;
            s.hasFired    = true;

            try {
              db.prepare(
                "INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, ?, ?, 'fired')"
              ).run(rule.id, value, message);
            } catch {}

            broadcast({
              type: 'alert',
              payload: {
                alertType: 'fired',
                ruleId:    rule.id,
                ruleName:  rule.name,
                metric:    rule.metric,
                value,
                threshold: rule.threshold,
                condition: rule.condition,
                serverName: srv.name,
                agentId:   srv.agentId || null,
              },
            });
          }
        }
      } else {
        if (s.hasFired) {
          s.hasFired = false;
          const message = `✅ Erholt: ${rule.name}\n${METRIC_LABELS[rule.metric] ?? rule.metric} wieder normal (${value.toFixed(2)}${unit})\nServer: ${srv.name}`;
          try {
            db.prepare(
              "INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, ?, ?, 'resolved')"
            ).run(rule.id, value, message);
          } catch {}

          broadcast({
            type: 'alert',
            payload: {
              alertType: 'resolved',
              ruleId:    rule.id,
              ruleName:  rule.name,
              metric:    rule.metric,
              value,
              threshold: rule.threshold,
              condition: rule.condition,
              serverName: srv.name,
              agentId:   srv.agentId || null,
            },
          });
        }
        s.activeSince = null;
      }
    }
  }
}

function start() {
  evaluate().catch(() => {});
  setInterval(() => evaluate().catch(() => {}), 10_000);
  console.log('Alert-Evaluator gestartet (alle 10s)');
}

module.exports = { start };
