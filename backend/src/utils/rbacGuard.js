// Schutz vor Rechte-Eskalation in der Benutzer- und Rollenverwaltung.
//
// Grundregel: Wer kein Admin ist, darf nur Rollen vergeben, bearbeiten oder löschen und
// nur Benutzer verwalten, deren Rolle in allem höchstens so viel darf wie die eigene —
// Berechtigungen, Server-Freigaben (restrict_agents) und MC-Host-Freigaben (restrict_mchost).
// Ohne diese Prüfung reichte `users.manage` oder `roles.manage`, um sich selbst oder
// einer vorbereiteten Rolle Admin-gleiche Rechte zu verschaffen.
const db = require('../db');
const { getPermissions } = require('../middleware/requirePermission');
const { ALL_KEYS } = require('../permissions');

const getRoleByName = (name) =>
  db.prepare('SELECT id, name, is_admin, restrict_agents, restrict_mchost FROM roles WHERE name = ?').get(name);

function isAdminRole(name) {
  return !!getRoleByName(name)?.is_admin;
}

const agentGrants   = (roleId) => new Set(db.prepare('SELECT agent_id FROM agent_grants WHERE role_id = ?').all(roleId).map(r => String(r.agent_id)));
const mchostGrants  = (roleId) => new Set(db.prepare('SELECT vserver_id FROM mchost_vserver_access WHERE role_id = ?').all(roleId).map(r => String(r.vserver_id)));
const istTeilmenge  = (a, b) => [...a].every(x => b.has(x));

/**
 * Darf `actorRoleName` etwas mit dieser Zielbeschreibung tun?
 * `ziel` ist entweder ein Rollen-Name oder ein Vorschlag
 * { permissions, is_admin, restrict_agents, agentIds, restrict_mchost, vserverIds }
 * (für noch nicht gespeicherte Änderungen). Liefert null bei Erlaubnis, sonst den Grund.
 */
function eskalationsGrund(actorRoleName, ziel) {
  const actor = getRoleByName(actorRoleName);
  if (!actor) return 'Eigene Rolle unbekannt';
  if (actor.is_admin) return null;

  let z;
  if (typeof ziel === 'string') {
    const r = getRoleByName(ziel);
    if (!r) return 'Rolle nicht gefunden';
    z = {
      is_admin:        !!r.is_admin,
      permissions:     getPermissions(r.name),
      restrict_agents: !!r.restrict_agents,
      agentIds:        agentGrants(r.id),
      restrict_mchost: !!r.restrict_mchost,
      vserverIds:      mchostGrants(r.id),
    };
  } else {
    z = { ...ziel, agentIds: new Set((ziel.agentIds || []).map(String)), vserverIds: new Set((ziel.vserverIds || []).map(String)) };
  }

  if (z.is_admin) return 'Admin-Rollen können nur von Administratoren verwaltet werden';

  // Veraltete Keys, die es nicht mehr gibt, zählen nicht — sie gewähren nichts.
  const eigene = new Set(getPermissions(actor.name));
  const fremd  = (z.permissions || []).filter(k => ALL_KEYS.includes(k) && !eigene.has(k));
  if (fremd.length) return `Die Rolle enthält Berechtigungen, die du selbst nicht hast (${fremd.slice(0, 5).join(', ')}${fremd.length > 5 ? ', …' : ''})`;

  if (actor.restrict_agents) {
    if (!z.restrict_agents) return 'Deine Rolle ist auf bestimmte Server beschränkt — die Zielrolle muss es ebenfalls sein';
    if (!istTeilmenge(z.agentIds, agentGrants(actor.id))) return 'Die Rolle hat Zugriff auf Server, die für dich nicht freigegeben sind';
  }
  if (actor.restrict_mchost) {
    if (!z.restrict_mchost) return 'Deine Rolle ist auf bestimmte MC-Host-Server beschränkt — die Zielrolle muss es ebenfalls sein';
    if (!istTeilmenge(z.vserverIds, mchostGrants(actor.id))) return 'Die Rolle hat Zugriff auf MC-Host-Server, die für dich nicht freigegeben sind';
  }
  return null;
}

// Aktuellen Stand einer Rolle als Vorschlag, damit Routen nur das geänderte Feld ersetzen müssen.
function rollenStand(roleId) {
  const r = db.prepare('SELECT id, name, is_admin, restrict_agents, restrict_mchost FROM roles WHERE id = ?').get(roleId);
  if (!r) return null;
  return {
    is_admin:        !!r.is_admin,
    permissions:     getPermissions(r.name),
    restrict_agents: !!r.restrict_agents,
    agentIds:        [...agentGrants(r.id)],
    restrict_mchost: !!r.restrict_mchost,
    vserverIds:      [...mchostGrants(r.id)],
  };
}

// Middleware für Aktionen, die ausschließlich Administratoren vorbehalten sind.
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentifizierung erforderlich' });
  if (!isAdminRole(req.user.role)) return res.status(403).json({ error: 'Nur für Administratoren' });
  next();
}

module.exports = { isAdminRole, eskalationsGrund, rollenStand, requireAdmin };
