const router      = require('express').Router();
const db          = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { sendWebhook } = require('../utils/sendWebhook');
const { auditLog } = require('../utils/audit');

// ─── Regel-CRUD ───────────────────────────────────────────────────────────────

// Hilfsfunktion: Servername aus server_key ableiten
function resolveServerName(serverKey) {
  if (!serverKey) return null;
  if (serverKey === 'local') return 'Lokal';
  if (serverKey.startsWith('sbox:')) {
    const boxId = serverKey.slice(5);
    return `Storage Box #${boxId}`;
  }
  if (serverKey.startsWith('mchost:')) {
    const srvId = serverKey.slice(7);
    return `MC-Host VServer #${srvId}`;
  }
  // Numerischer Key → Agent-ID
  const agent = db.prepare('SELECT name FROM remote_agents WHERE id = ?').get(serverKey);
  return agent?.name || `Agent #${serverKey}`;
}

router.get('/rules', requirePermission('alerts.view'), (req, res) => {
  const rules = db.prepare(`
    SELECT r.*, w.name AS webhook_name, w.type AS webhook_type,
           a.name AS agent_name
    FROM alert_rules r
    LEFT JOIN webhooks w ON r.webhook_id = w.id
    LEFT JOIN remote_agents a ON r.agent_id = a.id
    ORDER BY r.created_at DESC
  `).all();

  // is_active pro Regel: Prüfen ob der letzte History-Eintrag pro Regel×Server noch
  // vom Typ 'fired' oder 'failed' ist (also nicht erholt / aufgelöst).
  const activeStmt = db.prepare(`
    SELECT COUNT(*) AS cnt FROM (
      SELECT server_key, type FROM alert_history
      WHERE rule_id = ?
      GROUP BY COALESCE(server_key, '__none__')
      HAVING id = MAX(id)
    ) sub WHERE sub.type IN ('fired', 'failed')
  `);

  const enriched = rules.map(rule => {
    let activeCount = 0;
    try { activeCount = activeStmt.get(rule.id)?.cnt || 0; } catch {}
    return { ...rule, is_active: activeCount > 0, active_count: activeCount };
  });

  res.json(enriched);
});

const VALID_METRICS    = ['cpu', 'memory', 'disk', 'net_rx', 'net_tx', 'action', 'patchmon_updates', 'patchmon_security', 'hetzner_storage_usage', 'mchost_runtime'];
const VALID_CONDITIONS = ['gt', 'lt'];

router.post('/rules', requirePermission('alerts.manage'), (req, res) => {
  const {
    name, metric = 'cpu', condition = 'gt', threshold = 0,
    duration_seconds = 0, cooldown_minutes = 30,
    webhook_id, agent_ids = [],
    conditions = [], logic = 'and', notify_resolved = 0,
    target_ref = null,
  } = req.body;

  if (!name || !webhook_id)
    return res.status(400).json({ error: 'name, webhook_id erforderlich' });
  if (!Array.isArray(agent_ids))
    return res.status(400).json({ error: 'agent_ids muss ein Array sein' });
  if (!['and', 'or'].includes(logic))
    return res.status(400).json({ error: 'logic muss and oder or sein' });

  // conditions validieren
  const condArr = Array.isArray(conditions) ? conditions : [];
  for (const c of condArr) {
    if (!VALID_METRICS.includes(c.metric)) return res.status(400).json({ error: `Ungültige Metrik: ${c.metric}` });
    if (!VALID_CONDITIONS.includes(c.condition)) return res.status(400).json({ error: `Ungültige Bedingung: ${c.condition}` });
  }

  const webhook = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(webhook_id);
  if (!webhook) return res.status(400).json({ error: 'Webhook nicht gefunden' });

  // Haupt-Metrik: aus conditions ableiten oder explizit
  const mainMetric    = condArr[0]?.metric || metric;
  const mainCondition = condArr[0]?.condition || condition;
  const mainThreshold = condArr[0]?.threshold ?? parseFloat(threshold) ?? 0;

  const result = db.prepare(
    'INSERT INTO alert_rules (name, metric, condition, threshold, duration_seconds, cooldown_minutes, webhook_id, agent_id, agent_ids, conditions, logic, notify_resolved, target_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    name.trim(), mainMetric, mainCondition, mainThreshold,
    parseInt(duration_seconds) || 0, parseInt(cooldown_minutes) || 30,
    webhook_id, null,
    JSON.stringify(agent_ids), JSON.stringify(condArr), logic, notify_resolved ? 1 : 0,
    target_ref ? String(target_ref) : null
  );

  auditLog(req, 'alert.create', 'alert_rule', name, { conditions: condArr.length, servers: agent_ids.length, logic });
  res.status(201).json({ id: result.lastInsertRowid, name, metric: mainMetric, conditions: condArr, logic, agent_ids, enabled: 1 });
});

router.put('/rules/:id', requirePermission('alerts.manage'), (req, res) => {
  const {
    name, metric, condition, threshold,
    duration_seconds, cooldown_minutes, webhook_id,
    agent_ids, enabled, conditions, logic, notify_resolved, target_ref,
  } = req.body;
  const rule = db.prepare('SELECT id FROM alert_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Regel nicht gefunden' });

  const condArr       = Array.isArray(conditions) ? conditions : undefined;
  const mainMetric    = condArr?.[0]?.metric    ?? metric    ?? null;
  const mainCondition = condArr?.[0]?.condition ?? condition ?? null;
  const mainThreshold = condArr?.[0]?.threshold != null ? condArr[0].threshold
                      : (threshold != null ? parseFloat(threshold) : null);

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
      conditions       = COALESCE(?, conditions),
      logic            = COALESCE(?, logic),
      notify_resolved  = COALESCE(?, notify_resolved),
      enabled          = COALESCE(?, enabled),
      target_ref       = COALESCE(?, target_ref)
    WHERE id = ?
  `).run(
    name ?? null, mainMetric, mainCondition, mainThreshold,
    duration_seconds != null ? parseInt(duration_seconds) : null,
    cooldown_minutes != null ? parseInt(cooldown_minutes) : null,
    webhook_id ?? null,
    agent_ids != null ? JSON.stringify(agent_ids) : null,
    condArr != null ? JSON.stringify(condArr) : null,
    logic ?? null,
    notify_resolved != null ? (notify_resolved ? 1 : 0) : null,
    enabled ?? null,
    target_ref != null ? String(target_ref) : null,
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

  const METRIC_LABELS = { cpu: 'CPU', memory: 'RAM', disk: 'Disk', net_rx: 'Netz ↓', net_tx: 'Netz ↑', action: 'Aktion', patchmon_updates: 'PatchMon Updates', patchmon_security: 'PatchMon Security', hetzner_storage_usage: 'Storage Box', mchost_runtime: 'MC-Host Laufzeit' };
  const METRIC_UNIT   = { cpu: '%', memory: '%', disk: '%', net_rx: ' MB/s', net_tx: ' MB/s', action: '', patchmon_updates: '', patchmon_security: '', hetzner_storage_usage: '%', mchost_runtime: ' Tage' };
  const serverStr = rule.agent_name ? `${rule.agent_name}` : 'Lokal';
  const label = METRIC_LABELS[rule.metric] || rule.metric;
  const unit  = METRIC_UNIT[rule.metric] !== undefined ? METRIC_UNIT[rule.metric] : '%';
  const c     = rule.condition === 'gt' ? '>' : '<';
  try {
    await sendWebhook(
      { type: rule.type, url: rule.url },
      `🔔 <b>Test-Alert:</b> ${rule.name}\n\n🖥️ <b>Server:</b> ${serverStr}\n📊 <b>${label}:</b> Schwelle ${c} ${rule.threshold}${unit}`
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
           h.server_key,
           h.rule_id,
           r.name AS rule_name, r.metric, r.threshold, r.condition, r.agent_id,
           a.name AS agent_name
    FROM alert_history h
    LEFT JOIN alert_rules r ON h.rule_id = r.id
    LEFT JOIN remote_agents a ON r.agent_id = a.id
    ORDER BY h.triggered_at DESC
    LIMIT ?
  `).all(limit);

  // Servername aus server_key ableiten (Fallback: alter agent_name-JOIN)
  const enriched = rows.map(row => {
    const resolvedName = row.server_key
      ? resolveServerName(row.server_key)
      : (row.agent_name || null);
    return { ...row, agent_name: resolvedName || row.agent_name || null };
  });

  res.json(enriched);
});

// ─── Aktive-Alerts-Zählung (für Dashboard-KPI) ──────────────────────────────

router.get('/active-count', requirePermission('alerts.view'), (req, res) => {
  // Zählt alle Regeln, deren jüngster History-Eintrag (pro server_key) 'fired' oder 'failed' ist.
  // 'suppressed' wird nicht mitgezählt — im Wartungsmodus soll kein aktiver Alert angezeigt werden.
  try {
    const rows = db.prepare(`
      SELECT h.id, h.triggered_at, h.value, h.message, h.type,
             h.server_key, h.rule_id,
             r.name AS rule_name, r.metric, r.threshold, r.condition, r.agent_id,
             a.name AS agent_name
      FROM alert_history h
      INNER JOIN alert_rules r ON h.rule_id = r.id AND r.enabled = 1
      LEFT JOIN remote_agents a ON r.agent_id = a.id
      WHERE h.id IN (
        SELECT MAX(id) FROM alert_history
        GROUP BY rule_id, COALESCE(server_key, '__none__')
      )
      AND h.type IN ('fired', 'failed')
      ORDER BY h.triggered_at DESC
    `).all();

    const enriched = rows.map(row => {
      const resolvedName = row.server_key
        ? resolveServerName(row.server_key)
        : (row.agent_name || null);
      return { ...row, agent_name: resolvedName || row.agent_name || null };
    });

    res.json({ count: enriched.length, details: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
