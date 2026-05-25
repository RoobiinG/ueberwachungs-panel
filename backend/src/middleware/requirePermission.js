const db = require('../db');
const { ALL_KEYS } = require('../permissions');

/**
 * Gibt alle Berechtigungs-Keys für eine Rolle zurück.
 * Admin-Rollen bekommen ALL_KEYS.
 */
function getPermissions(roleName) {
  try {
    const role = db.prepare('SELECT id, is_admin FROM roles WHERE name = ?').get(roleName);
    if (!role) return [];
    if (role.is_admin) return ALL_KEYS;
    return db.prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
      .all(role.id).map(r => r.permission_key);
  } catch {
    return [];
  }
}

/**
 * Middleware: erlaubt nur wenn der Nutzer die angegebene Berechtigung hat.
 * requirePermission('docker.control')
 */
function requirePermission(key) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentifizierung erforderlich' });
    const perms = getPermissions(req.user.role);
    if (!perms.includes(key)) return res.status(403).json({ error: 'Keine Berechtigung' });
    next();
  };
}

module.exports = { requirePermission, getPermissions };
