const router      = require('express').Router();
const db          = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { sendWebhook } = require('../utils/sendWebhook');
const { auditLog } = require('../utils/audit');

// ─── Regel-CRUD ───────────────────────────────────────────────────────────────

router.get('/rules', requirePermission('alerts.view'), (req, res) => {
  const rules = db.prepare(`
    SELECT r.*, w.name AS webhook_name, w.type AS webhook_type,
           a.name AS agent_name
    FROM alert_rules r
    LEFT JOIN webhooks w ON r.webhook_id = w.id
    LEFT JOIN remote_agents a ON r.agent_id = a.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(rules);
});

const VALID_METRICS    = ['cpu', 'memory', 'disk', 'net_rx', 'net_tx', 'action'];
const VALID_CONDITIONS = ['gt', 'lt'];

router.post('/rules', requirePermission('alerts.manage'), (req, res) => {
  const {
    name, metric, condition = 'gt', threshold = 0,
    duration_seconds = 0, cooldown_minutes = 30,
    webhook_id, agent_ids = [],
  } = req.body;

  if (!name || !metric || !webhook_id)
    return res.status(400).json({ error: 'name, metric, webhook_id erforderlich' });
  if (!VALID_METRICS.includes(metric))
    return res.status(400).json({ error: `metric muss einer von ${VALID_METRICS.join(', ')} sein` });
  if (metric !== 'action' && !VALID_CONDITIONS.includes(condition))
    return res.status(400).json({ error: 'condition muss gt oder lt sein' });
  if (!Array.isArray(agent_ids))
    return res.status(400).json({ error: 'agent_ids muss ein Array sein' });

  const webhook = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(webhook_id);
  if (!webhook) return res.status(400).json({ error: 'Webhook nicht gefunden' });

  const result = db.prepare(
    'INSERT INTO alert_rules (name, metric, condition, threshold, duration_seconds, cooldown_minutes, webhook_id, agent_id, agent_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name.trim(), metric, condition, parseFloat(threshold) || 0, parseInt(duration_seconds) || 0, parseInt(cooldown_minutes) || 30, webhook_id, null, JSON.stringify(agent_ids));

  auditLog(req, 'alert.create', 'alert_rule', name, { metric, threshold, servers: agent_ids.length });
  res.status(201).json({ id: result.lastInsertRowid, name, metric, condition, threshold, duration_seconds, cooldown_minutes, webhook_id, agent_ids, enabled: 1 });
});

router.put('/rules/:id', requirePermission('alerts.manage'), (req, res) => {
  const { name, metric, condition, threshold, duration_seconds, cooldown_minutes, webhook_id, agent_ids, enabled } = req.body;
  const rule = db.prepare('SELECT id FROM alert_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Regel nicht gefunden' });

  db.prepare(`
    UPDATE alert_rules SET
      name             = COALESCE(?, name),
      metric           = COALESCE(?, metric),
      condition        = COALESCE(?, condition),
      threshold        = COALESCE(?, threshold),
      duration_seconds = COALESCE(?, duration_seconds),
      cooldown_minutes = COALESCE(?, cooldown_minutes),
      webhook_id       = COALESCE(?, webhook_id),
      agent_ids        = COALESCE(?, agent_ids),
      enabled          = COALESCE(?, enabled)
    WHERE id = ?
  `).run(
    name ?? null, metric ?? null, condition ?? null,
    threshold != null ? parseFloat(threshold) : null,
    duration_seconds != null ? parseInt(duration_seconds) : null,
    cooldown_minutes != null ? parseInt(cooldown_minutes) : null,
    webhook_id ?? null,
    agent_ids != null ? JSON.stringify(agent_ids) : null,
    enabled ?? null,
    req.params.id
  );
  res.json({ success: true });
});

router.delete('/rules/:id', requirePermission('alerts.manage'), (req, res) => {
  const rule = db.prepare('SELECT name FROM alert_rules WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
  auditLog(req, 'alert.delete', 'alert_rule', rule?.name || req.params.id);
  res.json({ success: true });
});

// Webhook testweise auslösen (ignoriert Cooldown und Dauer)
router.post('/rules/:id/test', requirePermission('alerts.manage'), async (req, res) => {
  const rule = db.prepare(
    'SELECT r.*, w.type, w.url, a.name AS agent_name FROM alert_rules r JOIN webhooks w ON r.webhook_id = w.id LEFT JOIN remote_agents a ON r.agent_id = a.id WHERE r.id = ?'
  ).get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Regel nicht gefunden' });

  const serverStr = rule.agent_name ? ` (${rule.agent_name})` : ' (Lokal)';
  try {
    await sendWebhook(
      { type: rule.type, url: rule.url },
      `🔔 Test-Alert: ${rule.name}${serverStr}\n${rule.metric.toUpperCase()} ${rule.condition === 'gt' ? '>' : '<'} ${rule.threshold}%`
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Alert-History ────────────────────────────────────────────────────────────

router.get('/history', requirePermission('alerts.view'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT h.id, h.triggered_at, h.value, h.message, h.type,
           r.name AS rule_name, r.metric, r.threshold, r.condition, r.agent_id,
           a.name AS agent_name
    FROM alert_history h
    LEFT JOIN alert_rules r ON h.rule_id = r.id
    LEFT JOIN remote_agents a ON r.agent_id = a.id
    ORDER BY h.triggered_at DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

module.exports = router;
