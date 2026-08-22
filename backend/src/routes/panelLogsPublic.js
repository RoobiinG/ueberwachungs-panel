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

  // Abgelaufene Links geben nichts mehr heraus. Bewusst dieselbe Sprache wie bei einem
  // unbekannten Link, nur mit dem Zusatz „abgelaufen" — wer den Link nicht kennt, soll
  // daraus nicht schließen können, dass es ihn einmal gab.
  if (share.expires_at && new Date(share.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    return res.status(404).json({ error: 'Link nicht gefunden oder abgelaufen' });
  }

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
