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
 * Sendet eine Nachricht an einen Discord- oder Telegram-Webhook.
 * @param {{ type: string, url: string }} webhook - Webhook-Datensatz aus der DB
 * @param {string} message - Nachrichtentext
 */
async function sendWebhook(webhook, message) {
  if (webhook.type === 'discord') {
    const content = message.length > 1990 ? message.slice(0, 1990) + '...' : message;
    await axios.post(webhook.url, { content }, { timeout: 10_000 });
  } else if (webhook.type === 'telegram') {
    // URL-Format: https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>
    // pathname.split('/') = ['', 'bot<TOKEN>', 'sendMessage'] → [1] enthält das Bot-Segment
    const urlObj  = new URL(webhook.url);
    const botPart = urlObj.pathname.split('/')[1] || '';         // 'bot1234:ABC'
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
  } else {
    throw new Error(`Unbekannter Webhook-Typ: ${webhook.type}`);
  }
}

module.exports = { sendWebhook, sanitizeTelegramHtml };
