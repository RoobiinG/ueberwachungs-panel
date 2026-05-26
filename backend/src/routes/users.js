const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const requireRole = require('../middleware/roles');
const { auditLog } = require('../utils/audit');

router.get('/', requireRole('admin'), (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
  const roles = db.prepare('SELECT name, label FROM roles').all();
  const roleMap = Object.fromEntries(roles.map(r => [r.name, r.label]));
  res.json(users.map(u => ({ ...u, roleLabel: roleMap[u.role] || u.role })));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { username, password, role = 'guest' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  // Rolle muss in der roles-Tabelle existieren (außer admin — schreibgeschützt)
  const validRole = db.prepare('SELECT name FROM roles WHERE name = ?').get(role);
  if (!validRole) return res.status(400).json({ error: 'Ungültige Rolle' });
  if (role === 'admin') return res.status(403).json({ error: 'Admin-Rolle kann nicht vergeben werden' });
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

router.put('/:id', requireRole('admin'), (req, res) => {
  const { role, password } = req.body;
  const userId = parseInt(req.params.id);

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  if (role) {
    if (role === 'admin') return res.status(403).json({ error: 'Admin-Rolle kann nicht vergeben werden' });
    const validRole = db.prepare('SELECT name FROM roles WHERE name = ?').get(role);
    if (!validRole) return res.status(400).json({ error: 'Ungültige Rolle' });
    // Eigene Admin-Rolle nicht entziehen
    if (userId === req.user.id && req.user.role === 'admin') {
      return res.status(403).json({ error: 'Eigene Admin-Rolle kann nicht geändert werden' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    auditLog(req, 'user.role_change', 'user', target.id.toString(), { newRole: role, previousRole: target.role });
  }
  if (password) {
    if (!password.trim()) return res.status(400).json({ error: 'Passwort darf nicht leer sein' });
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), userId);
    auditLog(req, 'user.password_reset', 'user', userId.toString());
  }
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const delUser = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  auditLog(req, 'user.delete', 'user', delUser?.username || userId.toString());
  res.json({ success: true });
});

module.exports = router;
