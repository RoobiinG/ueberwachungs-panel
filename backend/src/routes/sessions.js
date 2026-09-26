const router = require('express').Router();
const crypto = require('crypto');
const db     = require('../db');
const { isAdminRole } = require('../utils/rbacGuard');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ─── Cleanup: abgelaufene widerrufene Tokens stündlich entfernen ──────────────
const jwtTtlSeconds = (() => {
  const v = process.env.JWT_EXPIRES_IN || '24h';
  const m = v.match(/^(\d+)(h|d|m)$/);
  if (!m) return 86400;
  const n = parseInt(m[1]);
  return m[2] === 'd' ? n * 86400 : m[2] === 'h' ? n * 3600 : n * 60;
})();

const cleanup = () => {
  const cutoff = new Date(Date.now() - (jwtTtlSeconds + 300) * 1000).toISOString();
  db.prepare("DELETE FROM revoked_tokens WHERE revoked_at < ?").run(cutoff);
  db.prepare("DELETE FROM sessions WHERE last_used < ?").run(cutoff);
};
cleanup();
setInterval(cleanup, 3_600_000);

// ─── GET /api/sessions ────────────────────────────────────────────────────────
// User: eigene Sitzungen | Admin: alle Sitzungen
router.get('/', (req, res) => {
  const currentHash = req.tokenHash || '';
  const isAdmin = isAdminRole(req.user.role);

  const rows = isAdmin
    ? db.prepare(`
        SELECT s.id, s.user_id, u.username, s.ip, s.user_agent,
               s.created_at, s.last_used,
               (s.token_hash = ?) AS is_current
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        ORDER BY s.last_used DESC
      `).all(currentHash)
    : db.prepare(`
        SELECT s.id, s.user_id, s.ip, s.user_agent,
               s.created_at, s.last_used,
               (s.token_hash = ?) AS is_current
        FROM sessions s
        WHERE s.user_id = ?
        ORDER BY s.last_used DESC
      `).all(currentHash, req.user.id);

  res.json(rows);
});

// ─── DELETE /api/sessions/others ─────────────────────────────────────────────
// Alle eigenen Sitzungen außer der aktuellen widerrufen
router.delete('/others', (req, res) => {
  const currentHash = req.tokenHash || '';
  const rows = db.prepare(
    'SELECT id, token_hash FROM sessions WHERE user_id = ? AND token_hash != ?'
  ).all(req.user.id, currentHash);

  const ins = db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_hash) VALUES (?)');
  const del = db.prepare('DELETE FROM sessions WHERE id = ?');
  db.transaction(() => { for (const r of rows) { ins.run(r.token_hash); del.run(r.id); } })();

  res.json({ ok: true, count: rows.length });
});

// ─── DELETE /api/sessions/:id ─────────────────────────────────────────────────
// Einzelne Sitzung widerrufen — User: nur eigene | Admin: beliebige
router.delete('/:id', (req, res) => {
  const id      = parseInt(req.params.id);
  const isAdmin = isAdminRole(req.user.role);

  const session = isAdmin
    ? db.prepare('SELECT id, token_hash, user_id FROM sessions WHERE id = ?').get(id)
    : db.prepare('SELECT id, token_hash, user_id FROM sessions WHERE id = ? AND user_id = ?').get(id, req.user.id);

  if (!session) return res.status(404).json({ error: 'Sitzung nicht gefunden' });

  db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_hash) VALUES (?)').run(session.token_hash);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);

  res.json({ ok: true });
});

module.exports = router;
