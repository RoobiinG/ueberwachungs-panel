const router = require('express').Router();
const db = require('../db');
const { requirePermission, getPermissions } = require('../middleware/requirePermission');
const { canAccessAgent, erlaubteAgenten } = require('../utils/agentAccess');

// ─── Tiered-Tabellen-Konfiguration ───────────────────────────────────────────
// Für jeden Zeitraum: welche Tabelle + Bucketing
const RANGES = {
  '15m': { seconds: 900,          table: 'raw',          bucket: null   },  // 1s roh
  '1h':  { seconds: 3_600,        table: 'raw',          bucket: null   },  // 1s roh  → ≤3600 Punkte
  '6h':  { seconds: 6 * 3_600,    table: 'metrics_10s',  bucket: null   },  // 10s-Tabelle → max. 2160 Punkte, kein GROUP BY nötig
  '24h': { seconds: 86_400,       table: 'metrics_10s',  bucket: 60     },  // 1min    → 1440 Punkte
  '7d':  { seconds: 7 * 86_400,   table: 'metrics_1min', bucket: 600    },  // 10min   → 1008 Punkte
  '30d': { seconds: 30 * 86_400,  table: 'metrics_1min', bucket: 3_600  },  // 1h      → 720 Punkte
  '3m':  { seconds: 90 * 86_400,  table: 'metrics_1hour',bucket: 3_600  },  // 1h      → 2160 Punkte
  '6m':  { seconds: 180 * 86_400, table: 'metrics_1hour',bucket: 3_600  },  // 1h      → 4320 Punkte
};

// Automatische Tabelle + Bucket für Custom-Zeiträume
// Ein Diagramm stellt ein paar hundert Punkte dar — mehr zu liefern kostet nur Zeit.
// Frei gewählte Zeiträume lieferten bis einschließlich sechs Stunden ungefiltert die
// Sekundenwerte: bei sechs Stunden über 21.000 Punkte und rund 1,6 MB je Abruf, die
// obendrein im Browser geparst und gezeichnet werden mussten. Das war die Ursache der
// langen Ladezeiten im Monitoring.
const ZIEL_PUNKTE = 2_000;

// Wählt ein Vielfaches der Tabellen-Auflösung, sodass höchstens ZIEL_PUNKTE herauskommen.
// `null` heißt „ungefiltert" und ist nur erlaubt, wenn die Rohauflösung schon fein genug ist.
const passenderBucket = (spanSeconds, aufloesung) => {
  const punkteRoh = spanSeconds / aufloesung;
  if (punkteRoh <= ZIEL_PUNKTE) return null;
  return Math.ceil(punkteRoh / ZIEL_PUNKTE) * aufloesung;
};

const autoRange = (spanSeconds) => {
  if (spanSeconds <= 6 * 3_600)    return { table: 'raw',           bucket: passenderBucket(spanSeconds, 1) };
  if (spanSeconds <= 7 * 86_400)   return { table: 'metrics_10s',   bucket: passenderBucket(spanSeconds, 10) };
  if (spanSeconds <= 30 * 86_400)  return { table: 'metrics_1min',  bucket: passenderBucket(spanSeconds, 60) };
  return                                  { table: 'metrics_1hour', bucket: passenderBucket(spanSeconds, 3_600) };
};

// Serverübergreifende Metriken sind serverfeindlich: `server` ist die numerische Agent-ID
// vor der agent:-Verpackung. Eine auf restrict_agents beschränkte Rolle darf hier nur
// Zeitreihen für Agenten abfragen, die ihr auch sonst angezeigt werden.
const agentZugriffVerweigert = (req, res) => {
  const numId = parseInt(req.query.server, 10);
  if (!isNaN(numId) && !canAccessAgent(numId, req.user?.role)) {
    res.status(403).json({ error: 'Kein Zugriff' });
    return true;
  }
  return false;
};

const resolveServerId = (server) => {
  if (!server) return null;
  const id = parseInt(server, 10);
  if (!isNaN(id)) return `agent:${id}`;
  return server;
};

// ─── Query-Funktionen ─────────────────────────────────────────────────────────

// Raw-Tabelle (metrics mit original Spalten)
const queryRaw = (from, to, bucket, serverId) => {
  if (!bucket) {
    return db.prepare(`
      SELECT ts AS t, cpu,
        ROUND(mem_used  * 100.0 / NULLIF(mem_total,  0), 1) AS mem,
        ROUND(disk_used * 100.0 / NULLIF(disk_total, 0), 1) AS disk,
        ROUND(net_rx_sec / 1024.0, 2) AS net_rx,
        ROUND(net_tx_sec / 1024.0, 2) AS net_tx
      FROM metrics
      WHERE ts >= ? AND ts <= ? AND server_id = ? AND mem_total > 0
      ORDER BY t ASC
    `).all(from, to, serverId);
  }
  // CAST ist hier nicht kosmetisch, sondern der Kern: Ohne ihn ist `ts/?` eine
  // Fließkomma-Division, weil der Bucket als Zahl gebunden wird — dann bekommt jeder
  // Messpunkt seine eigene Gruppe und es wird überhaupt nichts zusammengefasst.
  // Genau daran ist die Verdichtung bisher wirkungslos geblieben.
  return db.prepare(`
    SELECT CAST(ts / ? AS INTEGER) * ? AS t,
      ROUND(AVG(cpu), 1) AS cpu,
      ROUND(AVG(mem_used)  * 100.0 / NULLIF(AVG(mem_total),  0), 1) AS mem,
      ROUND(AVG(disk_used) * 100.0 / NULLIF(AVG(disk_total), 0), 1) AS disk,
      ROUND(AVG(net_rx_sec) / 1024.0, 2) AS net_rx,
      ROUND(AVG(net_tx_sec) / 1024.0, 2) AS net_tx
    FROM metrics
    WHERE ts >= ? AND ts <= ? AND server_id = ? AND mem_total > 0
    GROUP BY CAST(ts / ? AS INTEGER) ORDER BY t ASC
  `).all(bucket, bucket, from, to, serverId, bucket);
};

// Aggregierte Tabellen (metrics_10s / metrics_1min / metrics_1hour)
const queryAgg = (tableName, from, to, bucket, serverId) => {
  if (!bucket) {
    return db.prepare(`
      SELECT ts AS t, cpu, mem, disk, net_rx, net_tx
      FROM ${tableName}
      WHERE ts >= ? AND ts <= ? AND server_id = ?
      ORDER BY t ASC
    `).all(from, to, serverId);
  }
  // Siehe queryRaw: ohne CAST wird nicht gruppiert.
  return db.prepare(`
    SELECT CAST(ts / ? AS INTEGER) * ? AS t,
      ROUND(AVG(cpu), 1)    AS cpu,
      ROUND(AVG(mem), 1)    AS mem,
      ROUND(AVG(disk), 1)   AS disk,
      ROUND(AVG(net_rx), 2) AS net_rx,
      ROUND(AVG(net_tx), 2) AS net_tx
    FROM ${tableName}
    WHERE ts >= ? AND ts <= ? AND server_id = ?
    GROUP BY CAST(ts / ? AS INTEGER) ORDER BY t ASC
  `).all(bucket, bucket, from, to, serverId, bucket);
};

const queryRows = (table, from, to, bucket, serverId) =>
  table === 'raw'
    ? queryRaw(from, to, bucket, serverId)
    : queryAgg(table, from, to, bucket, serverId);

// ─── Routen ───────────────────────────────────────────────────────────────────

// Server-Liste
router.get('/servers', requirePermission('metrics.view'), (req, res) => {
  const servers = [];
  const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user?.id);
  const perms   = userRow ? getPermissions(userRow.role) : [];
  if (perms.includes('agents.view')) {
    const agents = erlaubteAgenten(req.user?.role);
    for (const a of agents) servers.push({ id: String(a.id), label: a.name });
  }
  res.json(servers);
});

// Kalender: Tage mit Daten (für Verlauf-Browser)
router.get('/calendar', requirePermission('metrics.view'), (req, res) => {
  if (agentZugriffVerweigert(req, res)) return;
  const serverId = resolveServerId(req.query.server);
  const rows = db.prepare(`
    SELECT DISTINCT
      strftime('%Y-%m-%d', datetime(ts, 'unixepoch', 'localtime')) AS date,
      MIN(ts) AS ts
    FROM metrics_1hour
    WHERE server_id = ?
    GROUP BY date
    ORDER BY date DESC
  `).all(serverId);
  res.json({ days: rows });
});

// Zeitreihen
router.get('/', requirePermission('metrics.view'), (req, res) => {
  if (agentZugriffVerweigert(req, res)) return;
  const serverId = resolveServerId(req.query.server);
  const now      = Math.floor(Date.now() / 1000);

  // Benutzerdefinierter Zeitraum
  if (req.query.from && req.query.to) {
    const from = parseInt(req.query.from, 10);
    const to   = parseInt(req.query.to,   10);
    if (isNaN(from) || isNaN(to) || to <= from || (to - from) > 180 * 86_400) {
      return res.status(400).json({ error: 'Ungültiger Zeitraum (max. 6 Monate)' });
    }
    const { table, bucket } = autoRange(to - from);
    return res.json({ range: 'custom', from, to, rows: queryRows(table, from, to, bucket, serverId) });
  }

  // Vordefinierter Zeitraum
  const range = RANGES[req.query.range] ? req.query.range : '1h';
  const { seconds, table, bucket } = RANGES[range];
  const from = now - seconds;
  res.json({ range, rows: queryRows(table, from, now, bucket, serverId) });
});

// Erster bekannter Messpunkt
router.get('/first', requirePermission('metrics.view'), (req, res) => {
  if (agentZugriffVerweigert(req, res)) return;
  const serverId = resolveServerId(req.query.server);
  // Zuerst in 1hour-Tabelle suchen (älteste Daten)
  let row = db.prepare('SELECT ts FROM metrics_1hour WHERE server_id = ? ORDER BY ts ASC LIMIT 1').get(serverId);
  if (!row) row = db.prepare('SELECT ts FROM metrics WHERE server_id = ? ORDER BY ts ASC LIMIT 1').get(serverId);
  res.json({ ts: row?.ts ?? null });
});

module.exports = router;
