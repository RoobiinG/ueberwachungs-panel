// Öffentlicher Share-Endpunkt — kein Login nötig
// GET /api/logs/share/:token

const db = require('../db');

module.exports = (req, res) => {
  const { token } = req.params;

  // Nur valide 40-Zeichen Hex-Tokens akzeptieren
  if (!/^[0-9a-f]{40}$/.test(token)) {
    return res.status(404).json({ error: 'Link nicht gefunden' });
  }

  const share = db.prepare(
    'SELECT * FROM panel_log_shares WHERE token = ?'
  ).get(token);

  if (!share) return res.status(404).json({ error: 'Link nicht gefunden oder widerrufen' });

  const ids = JSON.parse(share.log_ids);
  const placeholders = ids.map(() => '?').join(',');
  const logs = db.prepare(
    `SELECT id, level, source, message, stack, url, created_at FROM panel_logs WHERE id IN (${placeholders}) ORDER BY created_at DESC`
  ).all(...ids);

  // Zugriff tracken
  db.prepare(
    'UPDATE panel_log_shares SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1 WHERE token = ?'
  ).run(token);

  res.json({
    logs,
    label:     share.label,
    createdAt: share.created_at,
  });
};
