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

// Alle Agenten, die eine Rolle sehen darf — dieselbe Regel wie oben, nur als Liste
// statt als Einzelprüfung. Die serverübergreifende Docker-Suche fragt damit von
// vornherein nur die erlaubten Server ab, statt hinterher auszusortieren.
const erlaubteAgenten = (roleName) => {
  const role = db.prepare('SELECT id, is_admin, restrict_agents FROM roles WHERE name = ?').get(roleName);
  const alle = () => db.prepare('SELECT id, name, url, token, fingerprint, dockhand_env_id FROM remote_agents ORDER BY name').all();

  if (!role || role.is_admin || !role.restrict_agents) return alle();

  return db.prepare(`
    SELECT ra.id, ra.name, ra.url, ra.token, ra.fingerprint, ra.dockhand_env_id
    FROM remote_agents ra
    INNER JOIN agent_grants ag ON ag.agent_id = ra.id
    WHERE ag.role_id = ?
    ORDER BY ra.name
  `).all(role.id);
};

module.exports = { canAccessAgent, erlaubteAgenten };
