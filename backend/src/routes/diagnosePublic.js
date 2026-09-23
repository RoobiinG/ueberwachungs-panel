// Öffentlicher Share-Endpunkt für Diagnose-Berichte — kein Login nötig
// GET /api/diagnose/share/:token

const db = require('../db');
const diagnostics = require('../utils/diagnostics');

module.exports = (req, res) => {
  const { token } = req.params;

  // Nur valide Hex-Tokens akzeptieren
  if (!/^[0-9a-f]{32,64}$/.test(token)) {
    return res.status(404).json({ error: 'Link nicht gefunden' });
  }

  const share = db.prepare(
    'SELECT * FROM diagnose_shares WHERE token = ?'
  ).get(token);

  if (!share) return res.status(404).json({ error: 'Link nicht gefunden oder widerrufen' });

  // Prüfe Ablaufdatum
  if (share.expires_at && new Date(share.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    return res.status(404).json({ error: 'Link nicht gefunden oder abgelaufen' });
  }

  let bericht;
  try {
    bericht = JSON.parse(share.data);
  } catch {
    return res.status(500).json({ error: 'Fehler beim Laden des Berichts' });
  }

  // Zugriff zählen
  db.prepare(
    'UPDATE diagnose_shares SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1 WHERE token = ?'
  ).run(token);

  res.json({
    bericht,
    text: diagnostics.alsText(bericht),
    createdAt: share.created_at,
    expiresAt: share.expires_at,
  });
};
