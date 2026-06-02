const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const si  = require('systeminformation');

let wss;

const broadcast = (data) => {
  if (!wss) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    // Nur an authentifizierte Clients senden
    if (client.readyState === WebSocket.OPEN && client.authenticated) client.send(payload);
  });
};

const startMonitoring = () => {
  setInterval(async () => {
    try {
      const [cpu, mem, network] = await Promise.all([si.currentLoad(), si.mem(), si.networkStats()]);
      let containers = {};
      try { containers = require('./dockerMetricsRecorder').getLatestStats(); } catch {}
      broadcast({
        type: 'stats',
        payload: {
          cpu: Math.round(cpu.currentLoad * 10) / 10,
          memory: { total: mem.total, used: mem.total - mem.available, usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100) },
          network: network.map(n => ({ iface: n.iface, rxSec: n.rx_sec, txSec: n.tx_sec })),
          containers,
          timestamp: Date.now(),
        },
      });
    } catch {}
  }, 1000);
};

const setup = (server) => {
  wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.authenticated = false;
    ws.userId        = null;

    // Auth-Timeout: 5s für Auth-Nachricht
    const authTimeout = setTimeout(() => {
      if (!ws.authenticated) ws.close(1008, 'Auth timeout');
    }, 5000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);

        if (!ws.authenticated) {
          // ─── Auth-Phase ──────────────────────────────────────────
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

        // Post-Auth: Keine weiteren WS-Nachrichten-Typen aktuell
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
