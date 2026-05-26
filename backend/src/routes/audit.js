const router             = require('express').Router();
const db                 = require('../db');
const { requirePermission, getPermissions } = require('../middleware/requirePermission');

// ─── Hilfsfunktion: hat der anfragende Nutzer ein bestimmtes Recht? ────────────
const hasPerm = (req, key) => getPermissions(req.user?.role || '').includes(key);

// LIKE-Sonderzeichen escapen damit Nutzereingaben nicht als Wildcards wirken
const escLike = (s) => s.replace(/[%_\\]/g, c => `\\${c}`);

// ─── Audit-Log abrufen ─────────────────────────────────────────────────────────
router.get('/', requirePermission('audit.view'), (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const { user, action, from, to } = req.query;

  const canSeeIp  = hasPerm(req, 'audit.view_ip');
  const canSeeGeo = hasPerm(req, 'audit.view_geo');

  let where   = 'WHERE 1=1';
  const params = [];

  if (user)   { where += ' AND username LIKE ? ESCAPE \'\\\'';    params.push(`%${escLike(user)}%`); }
  if (action) { where += ' AND action   LIKE ? ESCAPE \'\\\'';    params.push(`%${escLike(action)}%`); }
  if (from)   { where += ' AND created_at >= ?';    params.push(from); }
  if (to)     { where += ' AND created_at <= ?';    params.push(`${to} 23:59:59`); }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).get(...params).n;
  const rows  = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  // Felder je nach Berechtigung maskieren
  const masked = rows.map(r => ({
    ...r,
    ip:       canSeeIp  ? r.ip       : null,
    location: canSeeGeo ? r.location : null,
  }));

  res.json({ rows: masked, total, limit, offset, canSeeIp, canSeeGeo });
});

// ─── Einzelnen Eintrag löschen ────────────────────────────────────────────────
router.delete('/:id', requirePermission('audit.clear'), (req, res) => {
  db.prepare('DELETE FROM audit_log WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Komplettes Log leeren ────────────────────────────────────────────────────
router.delete('/', requirePermission('audit.clear'), (req, res) => {
  db.prepare('DELETE FROM audit_log').run();
  res.json({ success: true });
});

module.exports = router;
