const router     = require('express').Router();
const db         = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { PERMISSIONS, ALL_KEYS } = require('../permissions');
const { auditLog } = require('../utils/audit');
const { isAdminRole, eskalationsGrund, rollenStand } = require('../utils/rbacGuard');

const getRole  = (id) => db.prepare('SELECT * FROM roles WHERE id = ?').get(id);

// Nicht-Admins dürfen die eigene Rolle nicht anfassen und nur Rollen verwalten, die vor
// und nach der Änderung höchstens so viel dürfen wie die eigene. Sonst gäbe `roles.manage`
// der eigenen Rolle einfach alle Rechte. Liefert null oder den Ablehnungsgrund.
function rollenAenderungGrund(req, role, aenderung = {}) {
  if (isAdminRole(req.user.role)) return null;
  if (role.name === req.user.role) return 'Die eigene Rolle kann nur ein Administrator ändern';
  return eskalationsGrund(req.user.role, role.name)
      || eskalationsGrund(req.user.role, { ...rollenStand(role.id), ...aenderung });
}
const allRoles = ()   => db.prepare('SELECT id, name, label, is_system, is_admin, restrict_agents, restrict_mchost, created_at FROM roles ORDER BY is_admin DESC, is_system DESC, label').all();

// ─── Alle Rollen listen (für Dropdown in Benutzerverwaltung) ──────────────────
router.get('/', requirePermission(['users.manage', 'roles.manage', 'users.view']), (req, res) => {
  res.json(allRoles());
});

// ─── Alle Berechtigungs-Definitionen (für UI) ─────────────────────────────────
router.get('/permissions', requirePermission('roles.manage'), (req, res) => {
  res.json(PERMISSIONS);
});

// ─── Berechtigungen einer Rolle abrufen ───────────────────────────────────────
router.get('/:id/permissions', requirePermission('roles.manage'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.json(ALL_KEYS);
  const keys = db.prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
    .all(role.id).map(r => r.permission_key);
  res.json(keys);
});

// ─── Berechtigungen einer Rolle setzen (ersetzt komplett) ─────────────────────
router.put('/:id/permissions', requirePermission('roles.manage'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.status(403).json({ error: 'Admin-Rolle kann nicht bearbeitet werden' });

  const { permissions } = req.body;
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions muss ein Array sein' });

  // Nur gültige Keys akzeptieren
  const valid = permissions.filter(k => ALL_KEYS.includes(k));
  const grund = rollenAenderungGrund(req, role, { permissions: valid });
  if (grund) return res.status(403).json({ error: grund });

  db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(role.id);
    const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const key of valid) ins.run(role.id, key);
  })();

  auditLog(req, 'role.permissions_changed', 'role', role.label || role.name, { count: valid.length });
  res.json({ success: true, count: valid.length });
});

// ─── Server-Zuweisungen einer Rolle abrufen ───────────────────────────────────
router.get('/:id/agents', requirePermission('roles.manage'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  const agentIds = db.prepare('SELECT agent_id FROM agent_grants WHERE role_id = ?')
    .all(role.id).map(r => r.agent_id);
  res.json({ restrictAgents: !!role.restrict_agents, agentIds });
});

// ─── Server-Zuweisungen einer Rolle setzen ────────────────────────────────────
router.put('/:id/agents', requirePermission('roles.manage'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.status(403).json({ error: 'Admin-Rolle kann nicht eingeschränkt werden' });

  const { restrictAgents, agentIds = [] } = req.body;
  if (!Array.isArray(agentIds)) return res.status(400).json({ error: 'agentIds muss ein Array sein' });
  const grund = rollenAenderungGrund(req, role, {
    restrict_agents: restrictAgents !== undefined ? !!restrictAgents : !!role.restrict_agents,
    agentIds,
  });
  if (grund) return res.status(403).json({ error: grund });

  db.transaction(() => {
    if (restrictAgents !== undefined) {
      db.prepare('UPDATE roles SET restrict_agents = ? WHERE id = ?').run(restrictAgents ? 1 : 0, role.id);
    }

    db.prepare('DELETE FROM agent_grants WHERE role_id = ?').run(role.id);
    const ins = db.prepare('INSERT OR IGNORE INTO agent_grants (role_id, agent_id) VALUES (?, ?)');
    for (const agentId of agentIds) ins.run(role.id, parseInt(agentId));
  })();

  auditLog(req, 'role.agents_changed', 'role', role.label || role.name, { restrictAgents, count: agentIds.length });
  res.json({ success: true });
});

// ─── MC-Host24 VServer-Einschränkung einer Rolle ──────────────────────────────
router.get('/:id/mchost', requirePermission('roles.manage'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  const vserverIds = db.prepare('SELECT vserver_id FROM mchost_vserver_access WHERE role_id = ?')
    .all(role.id).map(r => r.vserver_id);
  res.json({ restrictMchost: !!role.restrict_mchost, vserverIds });
});

router.put('/:id/mchost', requirePermission('roles.manage'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.status(403).json({ error: 'Admin-Rolle kann nicht eingeschränkt werden' });

  const { restrictMchost, vserverIds = [] } = req.body;
  if (!Array.isArray(vserverIds)) return res.status(400).json({ error: 'vserverIds muss ein Array sein' });
  const grund = rollenAenderungGrund(req, role, {
    restrict_mchost: restrictMchost !== undefined ? !!restrictMchost : !!role.restrict_mchost,
    vserverIds,
  });
  if (grund) return res.status(403).json({ error: grund });

  db.transaction(() => {
    if (restrictMchost !== undefined) {
      db.prepare('UPDATE roles SET restrict_mchost = ? WHERE id = ?').run(restrictMchost ? 1 : 0, role.id);
    }
    db.prepare('DELETE FROM mchost_vserver_access WHERE role_id = ?').run(role.id);
    const ins = db.prepare('INSERT OR IGNORE INTO mchost_vserver_access (role_id, vserver_id) VALUES (?, ?)');
    for (const vsId of vserverIds) ins.run(role.id, String(vsId));
  })();

  auditLog(req, 'role.mchost_changed', 'role', role.label || role.name, { restrictMchost, count: vserverIds.length });
  res.json({ success: true });
});

// ─── Neue Rolle erstellen ─────────────────────────────────────────────────────
router.post('/', requirePermission('roles.manage'), (req, res) => {
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

  // Eine neue Rolle startet ohne Server-Beschränkung — auch das muss zur eigenen Rolle passen.
  const valid = Array.isArray(permissions) ? permissions.filter(k => ALL_KEYS.includes(k)) : [];
  const grund = eskalationsGrund(req.user.role, { permissions: valid, restrict_agents: false, restrict_mchost: false });
  if (grund) return res.status(403).json({ error: grund });

  try {
    const result = db.prepare(
      'INSERT INTO roles (name, label, is_system, is_admin) VALUES (?, ?, 0, 0)'
    ).run(finalName, label.trim());

    const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const key of valid) ins.run(result.lastInsertRowid, key);

    auditLog(req, 'role.create', 'role', label.trim());
  res.status(201).json({ id: result.lastInsertRowid, name: finalName, label: label.trim(), is_system: 0, is_admin: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Rolle umbenennen (nur Label, nicht name) ─────────────────────────────────
router.put('/:id', requirePermission('roles.manage'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_admin) return res.status(403).json({ error: 'Admin-Rolle kann nicht bearbeitet werden' });

  const { label } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Label erforderlich' });
  const grund = rollenAenderungGrund(req, role);
  if (grund) return res.status(403).json({ error: grund });

  db.prepare('UPDATE roles SET label = ? WHERE id = ?').run(label.trim(), role.id);
  auditLog(req, 'role.rename', 'role', role.name, { oldLabel: role.label, newLabel: label.trim() });
  res.json({ success: true });
});

// ─── Rolle löschen (nicht System-Rollen) ─────────────────────────────────────
router.delete('/:id', requirePermission('roles.manage'), (req, res) => {
  const role = getRole(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
  if (role.is_system) return res.status(403).json({ error: 'System-Rollen können nicht gelöscht werden' });
  // Löschen setzt alle Mitglieder auf „guest" — ohne Prüfung ließen sich so mächtigere Benutzer herabstufen.
  const grund = rollenAenderungGrund(req, role);
  if (grund) return res.status(403).json({ error: grund });

  // Benutzer mit dieser Rolle auf 'guest' zurücksetzen
  db.prepare("UPDATE users SET role = 'guest' WHERE role = ?").run(role.name);
  db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
  auditLog(req, 'role.delete', 'role', role.label || role.name);
  res.json({ success: true });
});

module.exports = router;
