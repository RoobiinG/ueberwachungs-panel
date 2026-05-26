const router = require('express').Router();
const db     = require('../db');
const { requirePermission } = require('../middleware/requirePermission');

// Aktueller Snapshot aller Container (aus letztem Recorder-Lauf)
router.get('/', requirePermission('docker.view'), (req, res) => {
  try {
    const { getLatestStats } = require('../dockerMetricsRecorder');
    return res.json(getLatestStats());
  } catch { return res.json({}); }
});

// Zeitreihe für einen Container
router.get('/:id', requirePermission('docker.view'), (req, res) => {
  const range = req.query.range || '1h';
  const RANGES = { '1h': 3600, '24h': 86400 };
  const duration = RANGES[range] ?? 3600;
  const since = Math.floor(Date.now() / 1000) - duration;

  const rows = db.prepare(
    `SELECT ts, cpu_percent AS cpu, mem_used, mem_limit,
            net_rx_sec AS rx, net_tx_sec AS tx
     FROM container_metrics
     WHERE container_id = ? AND ts >= ?
     ORDER BY ts ASC`
  ).all(req.params.id, since);

  res.json({ range, rows });
});

module.exports = router;
