const axios = require('axios');

/**
 * Sendet eine Nachricht an einen Discord- oder Telegram-Webhook.
 * @param {{ type: string, url: string }} webhook - Webhook-Datensatz aus der DB
 * @param {string} message - Nachrichtentext
 */
async function sendWebhook(webhook, message) {
  if (webhook.type === 'discord') {
    await axios.post(webhook.url, { content: message }, { timeout: 10_000 });
  } else if (webhook.type === 'telegram') {
    const urlObj = new URL(webhook.url);
    const token  = urlObj.pathname.split('/')[2] || '';
    const chatId = urlObj.searchParams.get('chat_id') || '';
    if (!token || !chatId) throw new Error('Ungültige Telegram-Webhook-URL (bot-Token oder chat_id fehlt)');
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text: message, parse_mode: 'HTML' },
      { timeout: 10_000 }
    );
  } else {
    throw new Error(`Unbekannter Webhook-Typ: ${webhook.type}`);
  }
}

module.exports = { sendWebhook };
