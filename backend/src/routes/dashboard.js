const router = require('express').Router();
const db     = require('../db');

// GET  /api/dashboard/layout  — Layout des angemeldeten Users
router.get('/layout', (req, res) => {
  const row = db.prepare('SELECT layout FROM dashboard_layouts WHERE user_id = ?').get(req.user.id);
  res.json({ layout: row ? JSON.parse(row.layout) : null });
});

// PUT  /api/dashboard/layout  — Layout speichern
router.put('/layout', (req, res) => {
  const { layout } = req.body;
  if (!Array.isArray(layout)) return res.status(400).json({ error: 'layout muss ein Array sein' });
  db.prepare(`
    INSERT INTO dashboard_layouts (user_id, layout, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET layout = excluded.layout, updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, JSON.stringify(layout));
  res.json({ ok: true });
});

module.exports = router;
