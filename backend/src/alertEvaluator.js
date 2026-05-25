const db           = require('./db');
const { sendWebhook } = require('./utils/sendWebhook');

// In-Memory-Zustand pro Regel: wann wurde die Bedingung zuletzt aktiv, und wann zuletzt ausgelöst
const state = new Map(); // ruleId → { activeSince: number|null, lastFiredAt: number|null }

const getState = (id) => {
  if (!state.has(id)) state.set(id, { activeSince: null, lastFiredAt: null });
  return state.get(id);
};

const metricLabels = { cpu: 'CPU', memory: 'RAM', disk: 'Disk' };

async function evaluate() {
  // Letzten Metrik-Datenpunkt holen
  const latest = db.prepare(
    'SELECT ts, cpu, ROUND(mem_used*100.0/mem_total,1) AS memory, ROUND(disk_used*100.0/disk_total,1) AS disk FROM metrics WHERE mem_total > 0 ORDER BY ts DESC LIMIT 1'
  ).get();
  if (!latest) return;

  const now   = Math.floor(Date.now() / 1000);
  const rules = db.prepare('SELECT r.*, w.type, w.url FROM alert_rules r JOIN webhooks w ON r.webhook_id = w.id WHERE r.enabled = 1').all();

  for (const rule of rules) {
    const value = latest[rule.metric];
    if (value == null) continue;

    const conditionMet = rule.condition === 'gt' ? value > rule.threshold : value < rule.threshold;
    const s = getState(rule.id);

    if (conditionMet) {
      if (s.activeSince === null) s.activeSince = now;

      const activeFor = now - s.activeSince;
      if (activeFor >= rule.duration_seconds) {
        const cooldownSecs = rule.cooldown_minutes * 60;
        const cooldownOk   = s.lastFiredAt === null || (now - s.lastFiredAt) >= cooldownSecs;
        if (cooldownOk) {
          const condStr = rule.condition === 'gt' ? '>' : '<';
          const message = `⚠️ Alert: ${rule.name}\n${metricLabels[rule.metric]} ${condStr} ${rule.threshold}% (aktuell: ${value?.toFixed(1)}%)\nSeit ${Math.round(activeFor / 60)} Minuten aktiv`;
          try {
            await sendWebhook({ type: rule.type, url: rule.url }, message);
            s.lastFiredAt = now;
            db.prepare(
              'INSERT INTO alert_history (rule_id, value, message) VALUES (?, ?, ?)'
            ).run(rule.id, value, message);
          } catch (err) {
            console.error(`[AlertEvaluator] Webhook für Regel "${rule.name}" fehlgeschlagen:`, err.message);
          }
        }
      }
    } else {
      // Bedingung nicht mehr erfüllt → zurücksetzen
      s.activeSince = null;
    }
  }
}

function start() {
  // Sofort prüfen, dann alle 10s
  evaluate().catch(() => {});
  setInterval(() => evaluate().catch(() => {}), 10_000);
  console.log('Alert-Evaluator gestartet (alle 10s)');
}

module.exports = { start };
