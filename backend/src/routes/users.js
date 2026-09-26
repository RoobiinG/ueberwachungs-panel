const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const { isAdminRole, eskalationsGrund, requireAdmin } = require('../utils/rbacGuard');

// Fremde Konten nur verwalten, wenn deren Rolle höchstens so viel darf wie die eigene —
// sonst könnte `users.manage` das Admin-Passwort setzen oder den Admin herabstufen.
function darfKontoVerwalten(req, target) {
  if (target.id === req.user.id) return null;
  return eskalationsGrund(req.user.role, target.role);
}

router.get('/', requirePermission('users.view'), (req, res) => {
  const users = db.prepare('SELECT id, username, email, role, twofa_type, created_at, last_login, last_login_ip, last_login_from FROM users').all();
  const roles = db.prepare('SELECT name, label FROM roles').all();
  const roleMap = Object.fromEntries(roles.map(r => [r.name, r.label]));
  res.json(users.map(u => ({ ...u, roleLabel: roleMap[u.role] || u.role })));
});

router.post('/', requirePermission('users.manage'), (req, res) => {
  const { username, password, role = 'guest' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  // Rolle muss in der roles-Tabelle existieren (außer admin — schreibgeschützt)
  const validRole = db.prepare('SELECT name FROM roles WHERE name = ?').get(role);
  if (!validRole) return res.status(400).json({ error: 'Ungültige Rolle' });
  if (isAdminRole(role)) return res.status(403).json({ error: 'Admin-Rolle kann nicht vergeben werden' });
  const grund = eskalationsGrund(req.user.role, role);
  if (grund) return res.status(403).json({ error: grund });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
    auditLog(req, 'user.create', 'user', username, { role });
    res.status(201).json({ id: result.lastInsertRowid, username, role });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermission('users.manage'), (req, res) => {
  const { role, password, username, email } = req.body;
  const userId = parseInt(req.params.id);

  const target = db.prepare('SELECT id, role, username, email FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const kontoGrund = darfKontoVerwalten(req, target);
  if (kontoGrund) return res.status(403).json({ error: kontoGrund });

  // Alle Prüfungen vor der ersten Änderung, damit eine abgelehnte Rollenänderung
  // nicht schon Benutzername oder E-Mail umgeschrieben hat.
  if (role && role !== target.role) {
    if (isAdminRole(role)) return res.status(403).json({ error: 'Admin-Rolle kann nicht vergeben werden' });
    const validRole = db.prepare('SELECT name FROM roles WHERE name = ?').get(role);
    if (!validRole) return res.status(400).json({ error: 'Ungültige Rolle' });
    // Eigene Admin-Rolle nicht entziehen
    if (userId === req.user.id && isAdminRole(req.user.role)) {
      return res.status(403).json({ error: 'Eigene Admin-Rolle kann nicht geändert werden' });
    }
    const grund = eskalationsGrund(req.user.role, role);
    if (grund) return res.status(403).json({ error: grund });
  }
  if (password !== undefined && password !== '' && !String(password).trim()) {
    return res.status(400).json({ error: 'Passwort darf nicht leer sein' });
  }

  if (username && username !== target.username) {
    try {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, userId);
      auditLog(req, 'user.update_username', 'user', userId.toString(), { oldUsername: target.username, newUsername: username });
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
      return res.status(500).json({ error: err.message });
    }
  }

  if (email !== undefined && email !== target.email) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
    auditLog(req, 'user.update_email', 'user', userId.toString(), { oldEmail: target.email, newEmail: email });
  }

  if (role && role !== target.role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    auditLog(req, 'user.role_change', 'user', target.id.toString(), { newRole: role, previousRole: target.role });
  }
  
  if (password) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), userId);
    auditLog(req, 'user.password_reset', 'user', userId.toString());
  }
  res.json({ success: true });
});

router.delete('/:id', requirePermission('users.manage'), (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const delUser = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
  if (!delUser) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const grund = darfKontoVerwalten(req, delUser);
  if (grund) return res.status(403).json({ error: grund });
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  auditLog(req, 'user.delete', 'user', delUser?.username || userId.toString());
  res.json({ success: true });
});

// Prüft `is_admin` der Rolle statt des Rollen-Namens „admin".
router.post('/:id/disable-2fa', requirePermission('users.manage'), requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  db.prepare("UPDATE users SET twofa_type = 'none', twofa_secret = NULL, twofa_code = NULL, twofa_expires = NULL WHERE id = ?").run(userId);
  auditLog(req, 'user.disable_2fa', 'user', target.username);
  res.json({ success: true });
});

module.exports = router;
