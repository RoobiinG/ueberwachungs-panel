const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const si = require('systeminformation');

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
      broadcast({
        type: 'stats',
        payload: {
          cpu: Math.round(cpu.currentLoad),
          memory: { total: mem.total, used: mem.total - mem.available, usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100) },
          network: network.map(n => ({ iface: n.iface, rxSec: n.rx_sec, txSec: n.tx_sec })),
          timestamp: Date.now(),
        },
      });
    } catch {}
  }, 2000);
};

const setup = (server) => {
  wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.authenticated = false;

    // Auth-Timeout: Wenn kein gültiges Token binnen 5 s → Verbindung trennen
    const authTimeout = setTimeout(() => {
      if (!ws.authenticated) ws.close(1008, 'Auth timeout');
    }, 5000);

    ws.on('message', (data) => {
      if (ws.authenticated) return; // Nur einmalige Auth nötig
      try {
        const msg = JSON.parse(data);
        if (msg?.type === 'auth' && msg?.token) {
          jwt.verify(msg.token, process.env.JWT_SECRET);
          ws.authenticated = true;
          clearTimeout(authTimeout);
          ws.send(JSON.stringify({ type: 'connected' }));
        } else {
          ws.close(1008, 'Invalid auth message');
        }
      } catch {
        ws.close(1008, 'Invalid token');
      }
    });

    ws.on('error', console.error);
  });
  startMonitoring();
};

module.exports = { setup, broadcast };
