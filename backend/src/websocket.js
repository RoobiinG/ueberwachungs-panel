const WebSocket = require('ws');
const jwt   = require('jsonwebtoken');
const cache = require('./metricsCache'); // gemeinsamer Mess-Cache — kein zweiter si.currentLoad()

let wss;

const broadcast = (data) => {
  if (!wss) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.authenticated) client.send(payload);
  });
};

// Abonniert den metricsCache und broadcastet bei jedem neuen Tick
const startMonitoring = () => {
  cache.subscribe(({ cpu, mem, network, ts }) => {
    let containers = {};
    try { containers = require('./dockerMetricsRecorder').getLatestStats(); } catch {}

    broadcast({
      type: 'stats',
      payload: {
        cpu,
        memory: {
          total:      mem.total,
          used:       mem.total - mem.available,
          usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100),
        },
        network: network.map(n => ({ iface: n.iface, rxSec: n.rx_sec, txSec: n.tx_sec })),
        containers,
        timestamp: ts * 1000,
      },
    });
  });
};

const setup = (server) => {
  wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.authenticated = false;
    ws.userId        = null;

    const authTimeout = setTimeout(() => {
      if (!ws.authenticated) ws.close(1008, 'Auth timeout');
    }, 5000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (!ws.authenticated) {
          if (msg?.type === 'auth' && msg?.token) {
            const decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
            ws.authenticated = true;
            ws.userId        = decoded.id;
            clearTimeout(authTimeout);
            ws.send(JSON.stringify({ type: 'connected' }));
          } else {
            ws.close(1008, 'Invalid auth message');
          }
          return;
        }
      } catch {
        if (!ws.authenticated) ws.close(1008, 'Invalid token');
      }
    });

    ws.on('close', () => {});
    ws.on('error', console.error);
  });
  startMonitoring();
};

module.exports = { setup, broadcast };
