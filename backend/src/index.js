require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const http        = require('http');
const path        = require('path');
const auth               = require('./middleware/auth');
const requireLocalAccess = require('./middleware/requireLocalAccess');
const { setup: setupWS } = require('./websocket');

// ─── Startup-Sicherheitscheck ────────────────────────────────────────────────
const JWT_PLACEHOLDER = 'HIER_SICHEREN_KEY_EINTRAGEN_MINDESTENS_32_ZEICHEN';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === JWT_PLACEHOLDER || process.env.JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET ist nicht gesetzt oder zu unsicher!');
  console.error('   Setze JWT_SECRET in docker-compose.prod.yml auf einen zufälligen 32+-Zeichen-String.');
  console.error('   Generieren mit: openssl rand -hex 32');
  process.exit(1);
}

const app    = express();
// Reverse Proxy (z. B. NGINX Proxy Manager / Docker) für korrekte Client-IPs und express-rate-limit vertrauen
app.set('trust proxy', 1);
const server = http.createServer(app);

// CORS: In Produktion nur erlaubte Origin; Standard = kein Cross-Origin
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors(
  allowedOrigin
    ? { origin: allowedOrigin, credentials: false }
    : { origin: false }
));
app.use(compression());   // gzip für API-Responses + statische Assets
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));

// ─── Öffentliche Agent-Downloads (kein Login nötig) ──────────────────────────
const fs = require('fs');
// install.sh: Panel-URL wird beim Ausliefern dynamisch injiziert
app.get('/api/agents/install-script', (req, res) => {
  try {
    const installPath = path.resolve(__dirname, '../../agent/install.sh');
    let content = fs.readFileSync(installPath, 'utf8');
    // Panel-URL eintragen, damit das Script agent-script von hier lädt
    const panelUrl = `${req.protocol}://${req.get('host')}`;
    content = content.replace(
      /^(PANEL_SOURCE=).*$/m,
      `$1"${panelUrl}"`,
    );
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="install.sh"');
    res.send(content);
  } catch (err) {
    res.status(500).send(`# FEHLER: install.sh nicht gefunden (${err.message})\nexit 1\n`);
  }
});
// panel-agent.js: direkt öffentlich auslieferbar (kein Geheimnis enthalten)
app.get('/api/agents/agent-script', (req, res) => {
  try {
    const agentPath = path.resolve(__dirname, '../../agent/panel-agent.js');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="panel-agent.js"');
    res.sendFile(agentPath);
  } catch (err) {
    res.status(500).send(`# FEHLER: panel-agent.js nicht gefunden\nexit 1\n`);
  }
});
try {
  const { router: passkeyRouter } = require('./routes/passkeys');
  app.use('/api/passkeys', auth, passkeyRouter);
} catch (e) { console.warn('Passkey-Route übersprungen:', e.message); }
// Docker-Labels: panel-seitig in SQLite, kein lokaler Docker-Zugriff nötig
// Muss VOR /api/docker gemountet sein, damit requireLocalAccess nicht greift
app.use('/api/docker/labels', auth, require('./routes/dockerLabels'));
// Lokaler Server — hide_local wird jetzt auch backend-seitig durchgesetzt
app.use('/api/system',  auth, requireLocalAccess, require('./routes/system'));
app.use('/api/docker',  auth, requireLocalAccess, require('./routes/docker'));
app.use('/api/services',auth, requireLocalAccess, require('./routes/services'));
app.use('/api/firewall',auth, requireLocalAccess, require('./routes/firewall'));
app.use('/api/network', auth, requireLocalAccess, require('./routes/network'));
app.use('/api/users', auth, require('./routes/users'));
app.use('/api/roles', auth, require('./routes/roles'));
app.use('/api/webhooks', auth, require('./routes/webhooks'));
app.use('/api/hetzner', auth, require('./routes/hetzner'));
app.use('/api/mchost', auth, require('./routes/mchost'));
app.use('/api/settings', auth, require('./routes/settings'));
app.use('/api/backups',  auth, require('./routes/backups'));
app.use('/api/agents',  auth, require('./routes/agents'));
app.use('/api/metrics',    auth, require('./routes/metrics'));    // Kein requireLocalAccess: Daten kommen aus lokaler SQLite (auch Remote-Agent-Daten)
app.use('/api/dashboard',  auth, require('./routes/dashboard'));
app.use('/api/uptime-kuma', auth, require('./routes/uptimeKuma'));
app.use('/api/alerts',      auth, require('./routes/alerts'));
app.use('/api/sessions',    auth, require('./routes/sessions'));
app.use('/api/dockhand',    auth, require('./routes/dockhand'));
app.use('/api/patchmon',    auth, require('./routes/patchmon'));
app.use('/api/audit',       auth, require('./routes/audit'));
// Öffentlicher Share-Endpunkt (kein Login nötig) — muss VOR auth stehen
app.get('/api/logs/share/:token', require('./routes/panelLogsPublic'));
app.use('/api/logs',        auth, require('./routes/panelLogs'));
app.use('/api/version',          require('./routes/version'));
app.use('/api/update',      auth, require('./routes/update'));

// Serve React frontend in production
const frontendDist = path.join(__dirname, '../../frontend/dist');
// Hashed assets (JS/CSS mit Content-Hash im Dateinamen) → 1 Jahr cachen
app.use('/assets', express.static(path.join(frontendDist, 'assets'), {
  maxAge: '1y',
  immutable: true,
}));
// index.html + sonstige Dateien → kein Cache (damit neue Deployments sofort wirken)
app.use(express.static(frontendDist, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));
app.get(/^(?!\/api).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(frontendDist, 'index.html'));
});

require('./metricsCache').start();     // Muss VOR websocket + metricsRecorder starten
setupWS(server);

// ─── Terminal WebSocket Proxy (Frontend -> Backend -> Agent) ───────────
const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const { getPermissions } = require('./middleware/requirePermission');
const { canAccessAgent } = require('./utils/agentAccess');
const { auditLog }       = require('./utils/audit');

// Session-Prüfung analog zu middleware/auth.js — Browser-WebSockets können keine
// Authorization-Header setzen, deshalb kommt das Token aus der Query.
// Wichtig: Rolle immer frisch aus der DB lesen (kann sich seit Ausstellung geändert
// haben) und Widerruf prüfen, sonst gilt eine abgemeldete Session hier weiter.
function authenticateTerminalToken(token) {
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);   // wirft bei ungültig/abgelaufen
  if (!decoded?.id) return null;
  if (decoded.is2fa) return null;                              // Zwischen-Token vor 2FA-Abschluss

  const db   = require('./db');
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(decoded.id);
  if (!user) return null;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  if (db.prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?').get(tokenHash)) return null;

  return user;
}

server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/api/agents/') || !request.url.includes('/terminal')) return;

  const deny = (code, text) => {
    if (!socket.destroyed) {
      socket.write(`HTTP/1.1 ${code} ${text}\r\n\r\n`);
      socket.destroy();
    }
  };

  const url = new URL(request.url, `http://${request.headers.host}`);

  let user = null;
  try { user = authenticateTerminalToken(url.searchParams.get('token')); } catch { user = null; }
  if (!user) return deny(401, 'Unauthorized');

  const match = url.pathname.match(/^\/api\/agents\/(\d+)\/docker\/containers\/(.+)\/terminal$/);
  if (!match) return deny(404, 'Not Found');
  const agentId     = match[1];
  const containerId = match[2];

  try {
    const db    = require('./db');
    const agent = db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(agentId);
    if (!agent) return deny(404, 'Not Found');

    // Dieselben Prüfungen wie bei jeder HTTP-Docker-Route: Recht + Agenten-Freigabe
    // der Rolle. Ohne sie wäre das Terminal ein Weg an der Rechteverwaltung vorbei.
    if (!getPermissions(user.role).includes('docker.control')) return deny(403, 'Forbidden');
    if (!canAccessAgent(agent.id, user.role))                  return deny(403, 'Forbidden');

    // Betriebsart kommt global aus den Einstellungen. Die alte Spalte
    // remote_agents.docker_engine wird seit v5.3.1.0 nicht mehr gepflegt und stand
    // durch die Migration bei Bestands-Agenten dauerhaft auf 'dockhand'.
    const engine = db.prepare("SELECT value FROM settings WHERE key = 'dockerEngine'").get()?.value || 'agents';
    if (engine === 'dockhand') return deny(400, 'Bad Request');

    const targetUrl = agent.url.replace(/^http/, 'ws') + `/docker/containers/${containerId}/terminal`;
    const agentWs = new WebSocket(targetUrl, {
      headers: { 'x-agent-token': agent.token },
      rejectUnauthorized: false,
      handshakeTimeout: 10000,   // sonst hängt ein nicht antwortender Agent stumm
    });

    // Ab dem erfolgreichen Upgrade ist `socket` ein WebSocket — dann darf dort keine
    // HTTP-Antwort mehr hineingeschrieben werden (das erzeugt nur Müll-Frames).
    let upgraded = false;

    agentWs.on('open', () => {
      upgraded = true;
      request.user = user;   // für auditLog
      auditLog(request, 'docker.terminal.open', 'container', containerId, { agentId: agent.id, agentName: agent.name });

      const wssTerm = new WebSocket.Server({ noServer: true });
      wssTerm.handleUpgrade(request, socket, head, (clientWs) => {
        clientWs.on('message', (data) => {
          if (agentWs.readyState === WebSocket.OPEN) agentWs.send(data);
        });
        agentWs.on('message', (data) => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });
        clientWs.on('close', () => agentWs.close());
        agentWs.on('close', () => clientWs.close());
        clientWs.on('error', () => agentWs.close());
        agentWs.on('error', () => clientWs.close());
      });
    });

    agentWs.on('error', () => {
      if (upgraded) { try { agentWs.close(); } catch {} return; }
      deny(502, 'Bad Gateway');
    });
  } catch (err) {
    deny(500, 'Internal Server Error');
  }
});

require('./metricsRecorder').start();
require('./metricsAggregator').start();
require('./alertEvaluator').start();
// dockerMetricsRecorder entfernt — Docker-Stats kommen jetzt von Dockhand API
try { require('./remoteMetricsRecorder').start(); } catch (e) { console.warn('Remote-Metriken deaktiviert:', e.message); }
try { require('./utils/updateCheck').startPeriodicCheck(); } catch (e) { console.warn('UpdateCheck deaktiviert:', e.message); }

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Überwachungs-Panel running on port ${PORT}`));
