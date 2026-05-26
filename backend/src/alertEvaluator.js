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

// ─── In-Memory-Zustand pro Regel ─────────────────────────────────────────────
// ruleId → { activeSince, lastFiredAt, hasFired }
const state = new Map();
const getState = (id) => {
  if (!state.has(id)) state.set(id, { activeSince: null, lastFiredAt: null, hasFired: false });
  return state.get(id);
};

const metricLabels = { cpu: 'CPU', memory: 'RAM', disk: 'Disk' };

// ─── Metrik-Wert ermitteln ────────────────────────────────────────────────────
async function getMetricValue(rule) {
  if (rule.agent_id) {
    // Remote-Agent: Stats direkt vom Agent abrufen
    const stats = await fetchAgentStats(rule.agent_id);
    return stats?.[rule.metric] ?? null;
  }
  // Lokal: letzter Wert aus der Metrics-Tabelle
  const latest = db.prepare(
    `SELECT cpu,
            ROUND(mem_used * 100.0 / mem_total, 1) AS memory,
            ROUND(disk_used * 100.0 / disk_total, 1) AS disk
     FROM metrics WHERE server_id = 'local' AND mem_total > 0 ORDER BY ts DESC LIMIT 1`
  ).get();
  return latest?.[rule.metric] ?? null;
}

// ─── Haupt-Evaluierungslauf ───────────────────────────────────────────────────
async function evaluate() {
  const now   = Math.floor(Date.now() / 1000);
  const rules = db.prepare(`
    SELECT r.*, w.type AS wtype, w.url AS wurl,
           a.name AS agent_name
    FROM alert_rules r
    JOIN webhooks w ON r.webhook_id = w.id
    LEFT JOIN remote_agents a ON r.agent_id = a.id
    WHERE r.enabled = 1
  `).all();

  for (const rule of rules) {
    let value;
    try { value = await getMetricValue(rule); } catch { continue; }
    if (value == null) continue;

    const conditionMet = rule.condition === 'gt' ? value > rule.threshold : value < rule.threshold;
    const s            = getState(rule.id);
    const serverName   = rule.agent_name || 'Lokal';
    const condStr      = rule.condition === 'gt' ? '>' : '<';

    if (conditionMet) {
      if (s.activeSince === null) s.activeSince = now;
      const activeFor  = now - s.activeSince;

      if (activeFor >= rule.duration_seconds) {
        const cooldownSecs = rule.cooldown_minutes * 60;
        const cooldownOk   = s.lastFiredAt === null || (now - s.lastFiredAt) >= cooldownSecs;

        if (cooldownOk) {
          const message = `⚠️ Alert: ${rule.name}\n${metricLabels[rule.metric]} ${condStr} ${rule.threshold}% (aktuell: ${value.toFixed(1)}%)\nServer: ${serverName}`;
          try {
            await sendWebhook({ type: rule.wtype, url: rule.wurl }, message);
          } catch (err) {
            console.error(`[AlertEvaluator] Webhook "${rule.name}" fehlgeschlagen:`, err.message);
          }
          s.lastFiredAt = now;
          s.hasFired    = true;

          // History + WebSocket-Broadcast (unabhängig vom Webhook-Erfolg)
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
              serverName,
              agentId:   rule.agent_id || null,
            },
          });
        }
      }
    } else {
      // Bedingung nicht mehr erfüllt
      if (s.hasFired) {
        // War aktiv → Erholt-Event senden
        s.hasFired = false;
        const message = `✅ Erholt: ${rule.name}\n${metricLabels[rule.metric]} wieder normal (${value.toFixed(1)}%)\nServer: ${serverName}`;
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
            serverName,
            agentId:   rule.agent_id || null,
          },
        });
      }
      s.activeSince = null;
    }
  }
}

function start() {
  evaluate().catch(() => {});
  setInterval(() => evaluate().catch(() => {}), 10_000);
  console.log('Alert-Evaluator gestartet (alle 10s)');
}

module.exports = { start };
