const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const si = require('systeminformation');

let wss;

const broadcast = (data) => {
  if (!wss) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
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
          memory: { total: mem.total, used: mem.used, usedPercent: Math.round((mem.used / mem.total) * 100) },
          network: network.map(n => ({ iface: n.iface, rxSec: n.rx_sec, txSec: n.tx_sec })),
          timestamp: Date.now(),
        },
      });
    } catch {}
  }, 2000);
};

const setup = (server) => {
  wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) return ws.close(1008, 'No token');
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      ws.send(JSON.stringify({ type: 'connected' }));
    } catch {
      ws.close(1008, 'Invalid token');
    }
    ws.on('error', console.error);
  });
  startMonitoring();
};

module.exports = { setup, broadcast };
