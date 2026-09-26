const express = require('express');
const router = express.Router();
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { canAccessAgent, erlaubteAgenten } = require('../utils/agentAccess');

// LIKE-Sonderzeichen escapen, damit Nutzereingaben nicht als Wildcards wirken (wie audit.js)
const escLike = (s) => s.replace(/[%_\\]/g, c => `\\${c}`);

// GET /api/logs
// Parameter: ?agent_id=1&level=error&search=cron&limit=100&offset=0
// Syslogs sammeln sich über 7 Tage von allen Servern — deshalb feste Obergrenzen:
// höchstens 500 Zeilen je Abruf, Zählung ohne JOIN direkt auf den indizierten Spalten.
router.get('/', requirePermission('agents.view'), (req, res) => {
  const { agent_id, level, search } = req.query;
  const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  const where = [];
  const params = [];

  if (agent_id) {
    if (!canAccessAgent(parseInt(agent_id), req.user?.role)) return res.status(403).json({ error: 'Kein Zugriff' });
    where.push('syslogs.agent_id = ?');
    params.push(parseInt(agent_id));
  } else {
    // Kein Filter angegeben: nur Logs der Agenten, die diese Rolle auch sehen darf,
    // sonst liest eine auf restrict_agents beschränkte Rolle Syslogs fremder Server mit.
    const erlaubteIds = erlaubteAgenten(req.user?.role).map(a => a.id);
    where.push(`syslogs.agent_id IN (${erlaubteIds.length ? erlaubteIds.map(() => '?').join(',') : 'NULL'})`);
    params.push(...erlaubteIds);
  }

  if (level) {
    where.push('syslogs.level = ?');
    params.push(String(level));
  }

  if (search) {
    where.push("syslogs.message LIKE ? ESCAPE '\\'");
    params.push(`%${escLike(String(search).slice(0, 200))}%`);
  }

  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS total FROM syslogs${whereSql}`).get(...params).total;

  const rows = db.prepare(
    `SELECT syslogs.*, remote_agents.name AS agent_name
       FROM syslogs LEFT JOIN remote_agents ON syslogs.agent_id = remote_agents.id
     ${whereSql}
     ORDER BY syslogs.timestamp DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ total, logs: rows });
});

module.exports = router;
