const axios = require('axios');

/**
 * Hilfsfunktion: Escapet &, <, > für Telegram HTML-Mode, behält aber
 * gültige Telegram-HTML-Tags (b, strong, i, em, u, ins, s, strike, del, code, pre, a, span, blockquote) bei.
 */
function sanitizeTelegramHtml(text) {
  if (!text) return '';
  const str = String(text);

  // 1. Erlaubte Telegram-HTML-Tags durch Platzhalter ersetzen
  const allowedTagsRegex = /<(\/?(b|strong|i|em|u|ins|s|strike|del|code|pre|a|span|blockquote|tg-spoiler|tg-emoji)(\s+[^>]*)?)>/gi;
  const placeholders = [];
  let protectedText = str.replace(allowedTagsRegex, (match) => {
    placeholders.push(match);
    return `__TG_TAG_${placeholders.length - 1}__`;
  });

  // 2. Alle verbliebenen &, < und > escapen (wenn & nicht schon eine benannte/numerische HTML-Entität ist)
  protectedText = protectedText
    .replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 3. Erlaubte HTML-Tags aus Platzhaltern wiederherstellen
  return protectedText.replace(/__TG_TAG_(\d+)__/g, (_, idx) => {
    return placeholders[Number(idx)] || '';
  });
}

/**
 * Sendet eine Nachricht an einen Discord-, Telegram- oder Custom-Webhook.
 * @param {{ type: string, url: string, method?: string, headers?: string, template?: string }} webhook - Webhook-Datensatz aus der DB
 * @param {string} message - Nachrichtentext
 * @param {object} [context] - Zusätzliche Kontextdaten für Embeds / Platzhalter
 */
async function sendWebhook(webhook, message, context = {}) {
  if (webhook.type === 'discord') {
    let content = String(message || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<[^>]+>/g, '');
    if (content.length > 1990) content = content.slice(0, 1990) + '...';

    // Discord Rich Embed Farb-Balken: rot = 15680324 (#ef4444), grün = 4176208 (#3fb950)
    const isResolved = context.alertType === 'resolved' || content.includes('✅');
    const embedColor = isResolved ? 4176208 : 15680324;
    const title = context.ruleName
      ? (isResolved ? `✅ Entwarnung: ${context.ruleName}` : `⚠️ Alert: ${context.ruleName}`)
      : (isResolved ? '✅ System-Entwarnung' : '⚠️ System-Alert');

    const fields = [];
    if (context.serverName) fields.push({ name: '🖥️ Server', value: String(context.serverName), inline: true });
    if (context.value !== undefined) fields.push({ name: '📊 Wert', value: String(context.value), inline: true });

    const embed = {
      title,
      description: content,
      color: embedColor,
      timestamp: new Date().toISOString(),
      fields: fields.length > 0 ? fields : undefined,
    };

    await axios.post(webhook.url, { content: '', embeds: [embed] }, { timeout: 10_000 });
  } else if (webhook.type === 'telegram') {
    const urlObj  = new URL(webhook.url);
    const botPart = urlObj.pathname.split('/')[1] || '';
    const token   = botPart.startsWith('bot') ? botPart.slice(3) : botPart;
    const chatId  = urlObj.searchParams.get('chat_id') || '';
    if (!token || !chatId) throw new Error('Ungültige Telegram-Webhook-URL (bot-Token oder chat_id fehlt)');
    if (!/^-?\d+$/.test(chatId)) throw new Error('Ungültige Telegram Chat-ID (muss numerisch sein)');

    let escapedMessage = sanitizeTelegramHtml(message);
    if (escapedMessage.length > 4090) escapedMessage = escapedMessage.slice(0, 4090) + '...';

    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text: escapedMessage, parse_mode: 'HTML' },
      { timeout: 10_000 }
    );
  } else if (webhook.type === 'custom') {
    const method = (webhook.method || 'POST').toUpperCase();
    let headers = {};
    try {
      headers = typeof webhook.headers === 'string' ? JSON.parse(webhook.headers || '{}') : (webhook.headers || {});
    } catch (e) { headers = {}; }
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    let payloadStr = webhook.template || '{"message": "{{message}}"}';
    const rep = {
      '{{server_name}}': String(context.serverName || 'Server'),
      '{{alert_title}}': String(context.ruleName || 'Alert'),
      '{{severity}}': context.alertType === 'resolved' ? 'ok' : 'danger',
      '{{time}}': new Date().toISOString(),
      '{{value}}': String(context.value || '0'),
      '{{message}}': String(message || '').replace(/"/g, '\\"').replace(/\n/g, '\\n'),
    };
    for (const [k, v] of Object.entries(rep)) {
      payloadStr = payloadStr.split(k).join(v);
    }
    let data;
    try { data = JSON.parse(payloadStr); } catch { data = payloadStr; }

    await axios({
      method,
      url: webhook.url,
      headers,
      data,
      timeout: 10_000,
    });
  } else {
    throw new Error(`Unbekannter Webhook-Typ: ${webhook.type}`);
  }
}

module.exports = { sendWebhook, sanitizeTelegramHtml };
