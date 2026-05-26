const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const si  = require('systeminformation');
const { getPermissions } = require('./middleware/requirePermission');
const db = require('./db');

let wss;
let sshManager;
try { sshManager = require('./sshManager'); } catch {}

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
          cpu: Math.round(cpu.currentLoad),
          memory: { total: mem.total, used: mem.total - mem.available, usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100) },
          network: network.map(n => ({ iface: n.iface, rxSec: n.rx_sec, txSec: n.tx_sec })),
          containers,
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

        // ─── Post-Auth: SSH-Nachrichtenrouting ───────────────────
        if (!sshManager) return;
        switch (msg?.type) {
          case 'ssh_connect': {
            // Berechtigung prüfen: ssh.connect erforderlich
            const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(ws.userId);
            const perms   = userRow ? getPermissions(userRow.role) : [];
            if (!perms.includes('ssh.connect')) {
              sendToClient(ws, 'ssh_error', { message: 'Keine Berechtigung für SSH-Verbindungen' });
              return;
            }
            sshManager.connect(ws, msg.hostId, ws.userId);
            break;
          }
          case 'ssh_input':
            sshManager.write(ws, msg.data);
            break;
          case 'ssh_resize':
            sshManager.resize(ws, msg.cols, msg.rows);
            break;
          case 'ssh_disconnect':
            sshManager.disconnect(ws);
            break;
        }
      } catch {
        if (!ws.authenticated) ws.close(1008, 'Invalid token');
      }
    });

    ws.on('close', () => {
      if (sshManager) sshManager.disconnect(ws);
    });

    ws.on('error', console.error);
  });
  startMonitoring();
};

module.exports = { setup, broadcast };
