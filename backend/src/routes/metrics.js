const router = require('express').Router();
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');

const RANGES = {
  '1h':  { seconds: 3600,         bucket: null  },  // Rohdaten (10-Sek)   → ≤360 Punkte
  '6h':  { seconds: 6 * 3600,     bucket: 60    },  // 1-Min-Buckets        → 360 Punkte
  '24h': { seconds: 86400,        bucket: 300   },  // 5-Min-Buckets        → 288 Punkte
  '7d':  { seconds: 7 * 86400,    bucket: 3600  },  // 1-Std-Buckets        → 168 Punkte
  '30d': { seconds: 30 * 86400,   bucket: 21600 },  // 6-Std-Buckets        → 120 Punkte
};

// Automatische Bucket-Größe für benutzerdefinierte Zeiträume
const autoBucket = (spanSeconds) => {
  if (spanSeconds <= 7_200)    return null;    // ≤ 2h:  Rohdaten (10-Sek)
  if (spanSeconds <= 43_200)   return 60;      // ≤ 12h: 1-Min-Buckets
  if (spanSeconds <= 345_600)  return 300;     // ≤ 4d:  5-Min-Buckets
  if (spanSeconds <= 1_209_600) return 3600;   // ≤ 14d: 1-Std-Buckets
  return 21600;                                // sonst: 6-Std-Buckets
};

const resolveServerId = (server) => {
  if (!server || server === 'local') return 'local';
  const id = parseInt(server, 10);
  if (!isNaN(id)) return `agent:${id}`;
  return 'local';
};

const queryRows = (from, to, bucket, serverId) => {
  if (!bucket) {
    return db.prepare(`
      SELECT
        ts                                                        AS t,
        cpu,
        ROUND(mem_used  * 100.0 / mem_total,  1)                 AS mem,
        ROUND(disk_used * 100.0 / disk_total, 1)                 AS disk
      FROM metrics
      WHERE ts >= ? AND ts <= ? AND server_id = ? AND mem_total > 0
      ORDER BY t ASC
    `).all(from, to, serverId);
  }
  return db.prepare(`
    SELECT
      (ts / ?) * ?                                              AS t,
      ROUND(AVG(cpu), 1)                                        AS cpu,
      ROUND(AVG(mem_used)  * 100.0 / AVG(mem_total),  1)       AS mem,
      ROUND(AVG(disk_used) * 100.0 / AVG(disk_total), 1)       AS disk
    FROM metrics
    WHERE ts >= ? AND ts <= ? AND server_id = ? AND mem_total > 0
    GROUP BY (ts / ?)
    ORDER BY t ASC
  `).all(bucket, bucket, from, to, serverId, bucket);
};

// Liste aller Server mit aufgezeichneten Metriken
router.get('/servers', requirePermission('metrics.view'), (req, res) => {
  const servers = [{ id: 'local', label: 'Panel (lokal)' }];
  const agents  = db.prepare('SELECT id, name FROM remote_agents ORDER BY name ASC').all();
  for (const a of agents) servers.push({ id: String(a.id), label: a.name });
  res.json(servers);
});

// Zeitreihen abrufen — ?range=1h|6h|24h|7d|30d  ODER  ?from=<unix>&to=<unix>
router.get('/', requirePermission('metrics.view'), (req, res) => {
  const serverId = resolveServerId(req.query.server);
  const now      = Math.floor(Date.now() / 1000);

  // Benutzerdefinierter Zeitraum
  if (req.query.from && req.query.to) {
    const from = parseInt(req.query.from, 10);
    const to   = parseInt(req.query.to,   10);
    if (isNaN(from) || isNaN(to) || to <= from || (to - from) > 31 * 86400) {
      return res.status(400).json({ error: 'Ungültiger Zeitraum (max. 31 Tage)' });
    }
    const bucket = autoBucket(to - from);
    return res.json({ range: 'custom', from, to, rows: queryRows(from, to, bucket, serverId) });
  }

  // Vordefinierter Zeitraum
  const range  = RANGES[req.query.range] ? req.query.range : '24h';
  const { seconds, bucket } = RANGES[range];
  const from   = now - seconds;
  res.json({ range, rows: queryRows(from, now, bucket, serverId) });
});

// Ersten bekannten Messpunkt (für Uptime-Anzeige)
router.get('/first', requirePermission('metrics.view'), (req, res) => {
  const serverId = resolveServerId(req.query.server);
  const row = db.prepare('SELECT ts FROM metrics WHERE server_id = ? ORDER BY ts ASC LIMIT 1').get(serverId);
  res.json({ ts: row?.ts ?? null });
});

module.exports = router;
