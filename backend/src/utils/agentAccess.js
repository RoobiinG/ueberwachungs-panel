const db = require('../db');

// Prüft ob eine Rolle Zugriff auf einen bestimmten Agent hat.
// Rollen ohne `restrict_agents` (und Admins) dürfen überall hin, sonst entscheidet agent_grants.
// Liegt bewusst hier statt in routes/agents.js, damit auch der Terminal-WebSocket-Proxy
// in index.js exakt dieselbe Prüfung nutzt wie die HTTP-Routen.
const canAccessAgent = (agentId, roleName) => {
  const role = db.prepare('SELECT id, is_admin, restrict_agents FROM roles WHERE name = ?').get(roleName);
  if (!role || role.is_admin || !role.restrict_agents) return true;
  return !!db.prepare('SELECT 1 FROM agent_grants WHERE role_id = ? AND agent_id = ?').get(role.id, agentId);
};

module.exports = { canAccessAgent };
