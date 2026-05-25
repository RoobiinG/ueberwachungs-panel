const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const requireRole = require('../middleware/roles');

router.get('/', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT id, username, role, created_at FROM users').all());
});

router.post('/', requireRole('admin'), (req, res) => {
  const { username, password, role = 'viewer' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const validRoles = ['admin', 'operator', 'viewer'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
    res.status(201).json({ id: result.lastInsertRowid, username, role });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { role, password } = req.body;
  const userId = parseInt(req.params.id);
  if (role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  if (password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), userId);
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ success: true });
});

module.exports = router;
