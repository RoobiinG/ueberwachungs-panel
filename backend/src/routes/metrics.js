const router = require('express').Router();
const db = require('../db');

// Zeitbereiche → Bucket-Größe in Sekunden
const RANGES = {
  '1h':  { seconds: 3600,         bucket: 60    },  // 1-Min-Buckets  → 60  Punkte
  '24h': { seconds: 86400,        bucket: 300   },  // 5-Min-Buckets  → 288 Punkte
  '7d':  { seconds: 7 * 86400,    bucket: 3600  },  // 1-Std-Buckets  → 168 Punkte
  '30d': { seconds: 30 * 86400,   bucket: 21600 },  // 6-Std-Buckets  → 120 Punkte
};

router.get('/', (req, res) => {
  const range  = RANGES[req.query.range] ? req.query.range : '24h';
  const { seconds, bucket } = RANGES[range];
  const since = Math.floor(Date.now() / 1000) - seconds;

  const rows = db.prepare(`
    SELECT
      (ts / ?) * ? AS t,
      ROUND(AVG(cpu), 1)                                    AS cpu,
      ROUND(AVG(mem_used)  * 100.0 / AVG(mem_total),  1)   AS mem,
      ROUND(AVG(disk_used) * 100.0 / AVG(disk_total), 1)   AS disk
    FROM metrics
    WHERE ts >= ? AND mem_total > 0
    GROUP BY (ts / ?)
    ORDER BY t ASC
  `).all(bucket, bucket, since, bucket);

  res.json({ range, rows });
});

// Letzten bekannten Messpunkt (für "Uptime seit letztem Restart")
router.get('/first', (req, res) => {
  const row = db.prepare('SELECT ts FROM metrics ORDER BY ts ASC LIMIT 1').get();
  res.json({ ts: row?.ts ?? null });
});

module.exports = router;
