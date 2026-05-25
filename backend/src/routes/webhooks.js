const router = require('express').Router();
const axios = require('axios');
const db = require('../db');
const requireRole = require('../middleware/roles');

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM webhooks').all();
  res.json(rows.map(w => ({ ...w, events: JSON.parse(w.events) })));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, type, url, events = [] } = req.body;
  if (!name || !type || !url) return res.status(400).json({ error: 'name, type, url required' });
  const result = db.prepare('INSERT INTO webhooks (name, type, url, events) VALUES (?, ?, ?, ?)').run(name, type, url, JSON.stringify(events));
  res.status(201).json({ id: result.lastInsertRowid, name, type, url, events });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { name, url, events, active } = req.body;
  db.prepare('UPDATE webhooks SET name = COALESCE(?, name), url = COALESCE(?, url), events = COALESCE(?, events), active = COALESCE(?, active) WHERE id = ?')
    .run(name ?? null, url ?? null, events ? JSON.stringify(events) : null, active ?? null, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/:id/test', requireRole('admin'), async (req, res) => {
  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
  try {
    if (webhook.type === 'discord') {
      await axios.post(webhook.url, { content: '🔔 Test-Benachrichtigung vom Überwachungs-Panel' });
    } else if (webhook.type === 'telegram') {
      const urlObj = new URL(webhook.url);
      const token = urlObj.pathname.split('/')[2] || '';
      const chatId = urlObj.searchParams.get('chat_id') || '';
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId, text: '🔔 Test-Benachrichtigung vom Überwachungs-Panel',
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
