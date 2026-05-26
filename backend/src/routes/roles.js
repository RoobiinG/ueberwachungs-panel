const router     = require('express').Router();
const db         = require('../db');
const requireRole = require('../middleware/roles');
const { PERMISSIONS, ALL_KEYS } = require('../permissions');
const { auditLog } = require('../utils/audit');

const getRole  = (id) => db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
const allRoles = ()   => db.prepare('SELECT id, name, label, is_system, is_admin, restrict_agents, created_at FROM roles ORDER BY is_admin DESC, is_system DESC, label').all();

// ─── Alle Rollen listen (für Dropdown in Benutzerverwaltung) ──────────────────
router.get('/', requireRole('admin'), (req, res) => {
  res.json(allRoles());
});

// ─── Alle Berechtigungs-Definitionen (für UI) ─────────────────────────────────
router.get('/permissions', requireRole('admin'), (req, res) => {
  res.json(PERMISSIONS);
});

// ─── Berechtigungen einer Rolle abrufen ───────────────────────────────────────
router.get('/:id/permissions', requireRole('admin'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.json(ALL_KEYS);
  const keys = db.prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
    .all(role.id).map(r => r.permission_key);
  res.json(keys);
});

// ─── Berechtigungen einer Rolle setzen (ersetzt komplett) ─────────────────────
router.put('/:id/permissions', requireRole('admin'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.status(403).json({ error: 'Admin-Rolle kann nicht bearbeitet werden' });

  const { permissions } = req.body;
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions muss ein Array sein' });

  // Nur gültige Keys akzeptieren
  const valid = permissions.filter(k => ALL_KEYS.includes(k));

  db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(role.id);
    const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const key of valid) ins.run(role.id, key);
  })();

  auditLog(req, 'role.permissions_changed', 'role', role.label || role.name, { count: valid.length });
  res.json({ success: true, count: valid.length });
});

// ─── Server-Zuweisungen einer Rolle abrufen ───────────────────────────────────
router.get('/:id/agents', requireRole('admin'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  const agentIds = db.prepare('SELECT agent_id FROM agent_grants WHERE role_id = ?')
    .all(role.id).map(r => r.agent_id);
  res.json({ restrictAgents: !!role.restrict_agents, agentIds, hideLocal: !!role.hide_local });
});

// ─── Server-Zuweisungen einer Rolle setzen ────────────────────────────────────
router.put('/:id/agents', requireRole('admin'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.status(403).json({ error: 'Admin-Rolle kann nicht eingeschränkt werden' });

  const { restrictAgents, agentIds = [], hideLocal } = req.body;

  db.transaction(() => {
    if (restrictAgents !== undefined) {
      db.prepare('UPDATE roles SET restrict_agents = ? WHERE id = ?').run(restrictAgents ? 1 : 0, role.id);
    }
    if (hideLocal !== undefined) {
      db.prepare('UPDATE roles SET hide_local = ? WHERE id = ?').run(hideLocal ? 1 : 0, role.id);
    }
    db.prepare('DELETE FROM agent_grants WHERE role_id = ?').run(role.id);
    const ins = db.prepare('INSERT OR IGNORE INTO agent_grants (role_id, agent_id) VALUES (?, ?)');
    for (const agentId of agentIds) ins.run(role.id, parseInt(agentId));
  })();

  res.json({ success: true });
});

// ─── Neue Rolle erstellen ─────────────────────────────────────────────────────
router.post('/', requireRole('admin'), (req, res) => {
  const { label, permissions = [] } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Label erforderlich' });

  // Interner Name = slugifiziertes Label
  const name = label.trim().toLowerCase()
    .replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]))
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    || `role_${Date.now()}`;

  // Eindeutigkeit sicherstellen
  const exists = db.prepare('SELECT id FROM roles WHERE name = ?').get(name);
  const finalName = exists ? `${name}_${Date.now()}` : name;

  try {
    const result = db.prepare(
      'INSERT INTO roles (name, label, is_system, is_admin) VALUES (?, ?, 0, 0)'
    ).run(finalName, label.trim());

    const valid = Array.isArray(permissions) ? permissions.filter(k => ALL_KEYS.includes(k)) : [];
    const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const key of valid) ins.run(result.lastInsertRowid, key);

    auditLog(req, 'role.create', 'role', label.trim());
  res.status(201).json({ id: result.lastInsertRowid, name: finalName, label: label.trim(), is_system: 0, is_admin: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Rolle umbenennen (nur Label, nicht name) ─────────────────────────────────
router.put('/:id', requireRole('admin'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.status(403).json({ error: 'Admin-Rolle kann nicht bearbeitet werden' });

  const { label } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Label erforderlich' });

  db.prepare('UPDATE roles SET label = ? WHERE id = ?').run(label.trim(), role.id);
  res.json({ success: true });
});

// ─── Rolle löschen (nicht System-Rollen) ─────────────────────────────────────
router.delete('/:id', requireRole('admin'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_system) return res.status(403).json({ error: 'System-Rollen können nicht gelöscht werden' });

  // Benutzer mit dieser Rolle auf 'guest' zurücksetzen
  db.prepare("UPDATE users SET role = 'guest' WHERE role = ?").run(role.name);
  db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
  auditLog(req, 'role.delete', 'role', role.label || role.name);
  res.json({ success: true });
});

module.exports = router;
