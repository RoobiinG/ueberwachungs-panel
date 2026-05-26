const router      = require('express').Router();
const db          = require('../db');
const requireRole = require('../middleware/roles');

// Nur Admins dürfen das Audit-Log einsehen
router.get('/', requireRole('admin'), (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const { user, action, from, to } = req.query;

  let where  = 'WHERE 1=1';
  const params = [];

  if (user)   { where += ' AND username LIKE ?';    params.push(`%${user}%`); }
  if (action) { where += ' AND action   LIKE ?';    params.push(`%${action}%`); }
  if (from)   { where += ' AND created_at >= ?';    params.push(from); }
  if (to)     { where += ' AND created_at <= ?';    params.push(`${to} 23:59:59`); }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).get(...params).n;
  const rows  = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ rows, total, limit, offset });
});

// Einzelnen Eintrag löschen
router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM audit_log WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Komplettes Log leeren
router.delete('/', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM audit_log').run();
  res.json({ success: true });
});

module.exports = router;
