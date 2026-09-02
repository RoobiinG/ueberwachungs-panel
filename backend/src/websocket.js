const WebSocket = require('ws');
const jwt   = require('jsonwebtoken');

let wss;

const broadcast = (data) => {
  if (!wss) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.authenticated) client.send(payload);
  });
};


// Pfade des Terminal-Proxys aus index.js. Sie hängen am selben `upgrade`-Ereignis und
// müssen hier durchgelassen werden.
const TERMINAL_PFADE = [
  /^\/api\/agents\/\d+\/docker\/containers\/.+\/terminal$/,   // Remote-Server, über den Agent
  /^\/api\/docker\/containers\/.+\/terminal$/,                // Panel-Server selbst
];

const setup = (server) => {
  // Bewusst `noServer` statt `{ server, path: '/ws' }`: Mit gesetztem `path` hängt sich die
  // ws-Bibliothek selbst an das `upgrade`-Ereignis und beantwortet **jeden** abweichenden
  // Pfad sofort mit 400 — auch den Terminal-WebSocket, dessen Handler erst danach
  // registriert wird und dann auf einen bereits zerstörten Socket trifft. Die native
  // Container-Konsole war dadurch seit ihrer Einführung in v5.3.1.0 nicht benutzbar;
  // aufgefallen ist es nicht, weil bis v5.4.1.0 ersatzweise das Dockhand-Terminal aufging.
  wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pfad = String(req.url || '').split('?')[0];

    if (pfad === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      return;
    }
    // Den Terminal-Pfad übernimmt der Proxy in index.js — hier nicht anfassen.
    if (TERMINAL_PFADE.some(r => r.test(pfad))) return;

    // Alles Übrige wie bisher abweisen.
    if (!socket.destroyed) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
    }
  });
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
};

module.exports = { setup, broadcast };
