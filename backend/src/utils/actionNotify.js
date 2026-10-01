const db          = require('../db');
const { broadcast }   = require('../websocket');
const { sendWebhook } = require('./sendWebhook');
const { getPermissions } = require('../middleware/requirePermission');

const ACTION_LABELS = {
  start:    'gestartet',
  stop:     'gestoppt',
  restart:  'neugestartet',
  shutdown: 'heruntergefahren',
  kill:     'beendet',
  pause:    'pausiert',
  unpause:  'fortgesetzt',
  // Security Center: serverName enthält hier „Server: Ziel" (z. B. „Web01: 1.2.3.4").
  ip_block:   'dauerhaft gesperrt',
  ip_unblock: 'entsperrt',
  ssh_kick:   'ausgeworfen',
  ip_whitelist:   'in die Whitelist aufgenommen',
  ip_unwhitelist: 'aus der Whitelist entfernt',
};

/**
 * Benachrichtigt bei einer Server-/Container-Aktion:
 * - WebSocket-Broadcast an alle eingeloggten Clients
 * - Optionaler Webhook (falls action_webhook_id konfiguriert)
 */
async function notifyAction(req, action, serverName, platform = 'server') {
  if (db.prepare("SELECT value FROM settings WHERE key='action_notifications'").get()?.value !== '1') return;

  // Benutzer mit actions.silent-Recht: nur Audit-Log, keine Benachrichtigung
  const perms = getPermissions(req.user?.role);
  if (perms.includes('actions.silent')) return;

  const actor   = req.user?.username || 'Unbekannt';
  const agentId = platform === 'mchost' ? null : (req.body?.agentId ? String(req.body.agentId) : null);
  const payload = { actor, action, serverName, platform, agentId, timestamp: Date.now() };

  // 1. WebSocket an alle verbundenen Clients, die diesen Agent auch sehen dürfen
  broadcast({ type: 'action_notify', payload });

  const label   = ACTION_LABELS[action] || action;
  const dateStr = new Date().toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const message = `🔔 <b>Server-Aktion</b>\n👤 <b>${actor}</b> hat <b>${serverName}</b> ${label}\n🕐 ${dateStr}`;

  // 2. Globaler Aktions-Webhook (aus Einstellungen)
  const webhookIdVal = db.prepare("SELECT value FROM settings WHERE key='action_webhook_id'").get()?.value;
  if (webhookIdVal) {
    const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND active = 1').get(parseInt(webhookIdVal));
    if (webhook) {
      sendWebhook(webhook, message).catch(err =>
        console.error('[Action-Webhook] Fehler beim Senden:', err.message)
      );
    }
  }

  // 3. Alert-Regeln vom Typ 'action' auswerten (mit Cooldown)
  const now = Math.floor(Date.now() / 1000);
  const actionRules = db.prepare(`
    SELECT r.*, w.type AS wtype, w.url AS wurl
    FROM alert_rules r
    JOIN webhooks w ON r.webhook_id = w.id
    WHERE r.enabled = 1 AND r.metric = 'action' AND w.active = 1
  `).all();

  for (const rule of actionRules) {
    // Prüfen ob diese Regel für den betroffenen Server gilt
    let agentIds = [];
    try { agentIds = JSON.parse(rule.agent_ids || '[]'); } catch {}
    const coversAll    = agentIds.length === 0;
    const coversLocal  = agentIds.includes('local');
    const agentIdStr   = platform === 'mchost' ? null : (req.body?.agentId ? String(req.body.agentId) : null);
    const isLocal      = !agentIdStr;

    if (!coversAll) {
      if (isLocal && !coversLocal) continue;
      if (!isLocal && !agentIds.includes(agentIdStr)) continue;
    }

    // Cooldown prüfen
    const cooldownKey = `action:${rule.id}`;
    const lastFired = db.prepare(
      "SELECT triggered_at FROM alert_history WHERE rule_id=? AND type='fired' ORDER BY triggered_at DESC LIMIT 1"
    ).get(rule.id);
    if (lastFired) {
      const lastTs = Math.floor(new Date(lastFired.triggered_at).getTime() / 1000);
      if ((now - lastTs) < rule.cooldown_minutes * 60) continue;
    }

    // Regel feuern
    const ruleMsg = `🔔 <b>Server-Aktion</b>: ${rule.name}\n👤 <b>${actor}</b> hat <b>${serverName}</b> ${label}\n🕐 ${dateStr}`;
    sendWebhook({ type: rule.wtype, url: rule.wurl }, ruleMsg).catch(err =>
      console.error(`[Action-Alert] Regel "${rule.name}" Webhook-Fehler:`, err.message)
    );
    try {
      db.prepare(
        "INSERT INTO alert_history (rule_id, value, message, type) VALUES (?, 0, ?, 'fired')"
      ).run(rule.id, ruleMsg);
    } catch {}
  }
}

module.exports = { notifyAction };
