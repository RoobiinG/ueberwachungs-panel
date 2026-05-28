// ─── Panel-Logs ───────────────────────────────────────────────────────────────
// Speichert Frontend-Fehler (JS-Errors, unhandled rejections, API-Fehler)
// persistiert in SQLite damit sie nach Seitenreload erhalten bleiben.
//
// POST /api/logs          → Frontend schreibt Fehler (jeder eingeloggte User)
// GET  /api/logs          → Admin liest alle Logs (paginiert)
// DELETE /api/logs        → Admin löscht alle Logs

const router      = require('express').Router();
const db          = require('../db');
const requireRole = require('../middleware/roles');

const MAX_LOGS = 500;   // Max. gespeicherte Einträge
const MAX_MSG  = 2000;  // Max. Länge einer Nachricht
const MAX_STK  = 5000;  // Max. Länge eines Stack-Trace

// ── POST /api/logs  (Frontend → speichern) ────────────────────────────────────
router.post('/', (req, res) => {
  const { level = 'error', source, message, stack, url } = req.body;
  if (!source || !message) return res.status(400).json({ error: 'source und message erforderlich' });

  // Duplizierte Logs innerhalb von 10 Sekunden unterdrücken
  const recent = db.prepare(
    "SELECT id FROM panel_logs WHERE source = ? AND message = ? AND created_at >= datetime('now', '-10 seconds') LIMIT 1"
  ).get(String(source).slice(0, 100), String(message).slice(0, MAX_MSG));
  if (recent) return res.json({ ok: true, skipped: true });

  // Alte Einträge rotieren wenn Maximum erreicht
  const count = db.prepare('SELECT COUNT(*) AS c FROM panel_logs').get().c;
  if (count >= MAX_LOGS) {
    db.prepare(
      'DELETE FROM panel_logs WHERE id IN (SELECT id FROM panel_logs ORDER BY created_at ASC LIMIT ?)'
    ).run(count - MAX_LOGS + 1);
  }

  db.prepare(
    'INSERT INTO panel_logs (level, source, message, stack, url) VALUES (?, ?, ?, ?, ?)'
  ).run(
    ['error', 'warn', 'info'].includes(level) ? level : 'error',
    String(source).slice(0, 100),
    String(message).slice(0, MAX_MSG),
    stack ? String(stack).slice(0, MAX_STK) : null,
    url   ? String(url).slice(0, 500)       : null,
  );

  res.json({ ok: true });
});

// ── GET /api/logs  (Admin → lesen) ───────────────────────────────────────────
router.get('/', requireRole('admin'), (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const level  = req.query.level;
  const source = req.query.source;

  let sql    = 'SELECT * FROM panel_logs';
  const params = [];
  const where  = [];

  if (level)  { where.push('level = ?');  params.push(level); }
  if (source) { where.push('source = ?'); params.push(source); }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs  = db.prepare(sql).all(...params);
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM panel_logs${where.length ? ' WHERE ' + where.join(' AND ') : ''}`
  ).get(...params.slice(0, -2)).c;

  res.json({ logs, total });
});

// ── DELETE /api/logs  (Admin → alle löschen) ─────────────────────────────────
router.delete('/', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM panel_logs').run();
  res.json({ ok: true });
});

// ── DELETE /api/logs/bulk  (Admin → ausgewählte löschen) ──────────────────────
router.delete('/bulk', requireRole('admin'), (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids fehlt' });
  const safeIds = ids.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!safeIds.length) return res.status(400).json({ error: 'Keine gültigen IDs' });
  const placeholders = safeIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM panel_logs WHERE id IN (${placeholders})`).run(...safeIds);
  res.json({ ok: true, deleted: safeIds.length });
});

// ── GET /api/logs/sources  (Admin → distincte Quellen für Filter) ─────────────
router.get('/sources', requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT DISTINCT source FROM panel_logs ORDER BY source').all();
  res.json(rows.map(r => r.source));
});

module.exports = router;
