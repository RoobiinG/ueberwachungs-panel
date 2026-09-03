const express = require('express');
const router = express.Router();
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');

// GET /api/logs
// Parameter: ?agent_id=1&level=error&search=cron&limit=100&offset=0
router.get('/', requirePermission('agents.view'), (req, res) => {
  const { agent_id, level, search, limit = '100', offset = '0' } = req.query;
  
  let query = 'SELECT syslogs.*, remote_agents.name as agent_name FROM syslogs LEFT JOIN remote_agents ON syslogs.agent_id = remote_agents.id WHERE 1=1';
  const params = [];

  if (agent_id) {
    query += ' AND syslogs.agent_id = ?';
    params.push(parseInt(agent_id));
  }

  if (level) {
    query += ' AND syslogs.level = ?';
    params.push(level);
  }

  if (search) {
    query += ' AND syslogs.message LIKE ?';
    params.push(`%${search}%`);
  }

  // Count total for pagination
  const countQuery = `SELECT COUNT(*) as total FROM (${query})`;
  const totalRow = db.prepare(countQuery).get(...params);

  // Pagination
  query += ' ORDER BY syslogs.timestamp DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit) || 100);
  params.push(parseInt(offset) || 0);

  const rows = db.prepare(query).all(...params);

  res.json({
    total: totalRow ? totalRow.total : 0,
    logs: rows
  });
});

module.exports = router;
