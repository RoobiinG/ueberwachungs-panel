const router      = require('express').Router();
const db          = require('../db');
const requireRole = require('../middleware/roles');
const { sendWebhook } = require('../utils/sendWebhook');

// ─── Regel-CRUD (nur Admin) ───────────────────────────────────────────────────

router.get('/rules', (req, res) => {
  const rules = db.prepare(`
    SELECT r.*, w.name AS webhook_name, w.type AS webhook_type
    FROM alert_rules r
    LEFT JOIN webhooks w ON r.webhook_id = w.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(rules);
});

router.post('/rules', requireRole('admin'), (req, res) => {
  const { name, metric, condition, threshold, duration_seconds = 0, cooldown_minutes = 30, webhook_id } = req.body;
  if (!name || !metric || !condition || threshold == null || !webhook_id)
    return res.status(400).json({ error: 'name, metric, condition, threshold, webhook_id erforderlich' });
  if (!['cpu', 'memory', 'disk'].includes(metric))
    return res.status(400).json({ error: 'metric muss cpu, memory oder disk sein' });
  if (!['gt', 'lt'].includes(condition))
    return res.status(400).json({ error: 'condition muss gt oder lt sein' });
  if (threshold < 0 || threshold > 100)
    return res.status(400).json({ error: 'threshold muss zwischen 0 und 100 liegen' });

  const webhook = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(webhook_id);
  if (!webhook) return res.status(400).json({ error: 'Webhook nicht gefunden' });

  const result = db.prepare(
    'INSERT INTO alert_rules (name, metric, condition, threshold, duration_seconds, cooldown_minutes, webhook_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name.trim(), metric, condition, threshold, duration_seconds, cooldown_minutes, webhook_id);

  res.status(201).json({ id: result.lastInsertRowid, name, metric, condition, threshold, duration_seconds, cooldown_minutes, webhook_id, enabled: 1 });
});

router.put('/rules/:id', requireRole('admin'), (req, res) => {
  const { name, metric, condition, threshold, duration_seconds, cooldown_minutes, webhook_id, enabled } = req.body;
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
      enabled          = COALESCE(?, enabled)
    WHERE id = ?
  `).run(
    name ?? null, metric ?? null, condition ?? null,
    threshold ?? null, duration_seconds ?? null, cooldown_minutes ?? null,
    webhook_id ?? null, enabled ?? null,
    req.params.id
  );
  res.json({ success: true });
});

router.delete('/rules/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Webhook testweise auslösen (ignoriert Cooldown und Dauer)
router.post('/rules/:id/test', requireRole('admin'), async (req, res) => {
  const rule = db.prepare(
    'SELECT r.*, w.type, w.url FROM alert_rules r JOIN webhooks w ON r.webhook_id = w.id WHERE r.id = ?'
  ).get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Regel nicht gefunden' });
  try {
    await sendWebhook(
      { type: rule.type, url: rule.url },
      `🔔 Test-Alert: ${rule.name}\n${rule.metric.toUpperCase()} ${rule.condition === 'gt' ? '>' : '<'} ${rule.threshold}%`
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Alert-History ────────────────────────────────────────────────────────────

router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT h.id, h.triggered_at, h.value, h.message,
           r.name AS rule_name, r.metric, r.threshold, r.condition
    FROM alert_history h
    LEFT JOIN alert_rules r ON h.rule_id = r.id
    ORDER BY h.triggered_at DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

module.exports = router;
