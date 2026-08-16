const crypto = require('crypto');

// Kurzlebige Einmal-Tickets für den Terminal-WebSocket.
//
// Browser-WebSockets können keine Authorization-Header setzen, das Token muss also in
// die URL. Ein Session-JWT hat dort nichts verloren — der Reverse Proxy schreibt
// vollständige URLs in seine Access-Logs, wo es die Sitzung überdauern würde.
// Stattdessen holt das Frontend über die reguläre (Header-authentifizierte) API ein
// Ticket, das 30 Sekunden gilt, genau einmal einlösbar ist und nur für genau diesen
// Container auf genau diesem Agenten passt.

const TTL_MS = 30_000;
const tickets = new Map();

function issue({ userId, username, role, agentId, containerId }) {
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    userId,
    username,
    role,
    agentId: String(agentId),
    containerId: String(containerId),
    expires: Date.now() + TTL_MS,
  });
  return ticket;
}

// Einlösen: Der Eintrag wird immer entfernt, auch wenn er abgelaufen ist oder nicht
// passt — ein Ticket ist damit garantiert nur ein einziges Mal verwendbar.
function redeem(ticket, agentId, containerId) {
  if (!ticket) return null;
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket);

  if (Date.now() > entry.expires) return null;
  if (entry.agentId !== String(agentId)) return null;
  if (entry.containerId !== String(containerId)) return null;

  return entry;
}

// Abgelaufene Tickets regelmäßig aufräumen, damit die Map nicht unbegrenzt wächst.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of tickets) {
    if (now > entry.expires) tickets.delete(key);
  }
}, 60_000);
sweeper.unref();

module.exports = { issue, redeem };
