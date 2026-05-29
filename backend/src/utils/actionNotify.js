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

  const actor = req.user?.username || 'Unbekannt';
  const payload = { actor, action, serverName, platform, timestamp: Date.now() };

  // 1. WebSocket an alle verbundenen Clients
  broadcast({ type: 'action_notify', payload });

  // 2. Webhook (fire-and-forget, blockiert nicht die HTTP-Response)
  const webhookIdVal = db.prepare("SELECT value FROM settings WHERE key='action_webhook_id'").get()?.value;
  if (!webhookIdVal) return;
  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND active = 1').get(parseInt(webhookIdVal));
  if (!webhook) return;

  const label   = ACTION_LABELS[action] || action;
  const dateStr = new Date().toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const message = `🔔 <b>Server-Aktion</b>\n👤 <b>${actor}</b> hat <b>${serverName}</b> ${label}\n🕐 ${dateStr}`;

  sendWebhook(webhook, message).catch(err =>
    console.error('[Action-Webhook] Fehler beim Senden:', err.message)
  );
}

module.exports = { notifyAction };
