const db = require('../db');

/**
 * Middleware: Zugriff auf den lokalen Server prüfen.
 * Verweigert den Zugriff wenn die Rolle hide_local = 1 hat.
 * Admins und Rollen ohne hide_local-Flag dürfen immer zugreifen.
 */
module.exports = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentifizierung erforderlich' });

  const role = db.prepare('SELECT is_admin, hide_local FROM roles WHERE name = ?').get(req.user.role);

  // Unbekannte Rolle → sicherheitshalber sperren
  if (!role) return res.status(403).json({ error: 'Rolle nicht gefunden' });

  // Admins sehen immer alles
  if (role.is_admin) return next();

  // hide_local gesetzt → kein Zugriff auf lokalen Server
  if (role.hide_local) return res.status(403).json({ error: 'Kein Zugriff auf den lokalen Server' });

  next();
};
