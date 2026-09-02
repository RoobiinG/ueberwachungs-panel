require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const http        = require('http');
const path        = require('path');
const auth               = require('./middleware/auth');
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
// ─── Sicherheits-Kopfzeilen ───────────────────────────────────────────────────
// Ohne diese Zeilen ließ sich das Panel in einen fremden Rahmen einbetten (Klickentführung),
// und im Fall einer Skript-Lücke fehlte jede zweite Verteidigungslinie.
//
// Bewusst zurückhaltend eingestellt — eine zu strenge Vorgabe zerlegt die Oberfläche, und
// eine kaputte Oberfläche ist keine Sicherheit:
//   • Inhaltsrichtlinie (CSP) bleibt aus. Sie muss zur Vite-Anwendung passen und wird
//     getrennt und geprüft nachgezogen.
//   • Die beiden „Cross-Origin"-Vorgaben bleiben aus, sonst blockieren sie eingebundene
//     Schriften, Bilder und den Zugriff auf die statischen Dateien.
//   • HSTS nur, wenn das Panel ausdrücklich über HTTPS betrieben wird. Der Kopf wirkt
//     dauerhaft im Browser; wer sein Panel über HTTP erreicht, sperrte sich damit aus.
const helmet = require('helmet');
const httpsBetrieb = String(process.env.ALLOWED_ORIGIN || '').startsWith('https://');
app.use(helmet({
  contentSecurityPolicy:     false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  frameguard:                { action: 'deny' },
  referrerPolicy:            { policy: 'same-origin' },
  hsts: httpsBetrieb ? { maxAge: 15552000, includeSubDomains: false } : false,
}));

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
app.use('/api/docker/labels', auth, require('./routes/dockerLabels'));
// Die serverübergreifende Suche ebenso: Sie betrifft alle Server, nicht den lokalen.
app.use('/api/docker/search', auth, require('./routes/dockerSuche'));

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
app.use('/api/pelican',     auth, require('./routes/pelican'));
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

setupWS(server);

// ─── Terminal-WebSocket ───────────────────────────────────────────────────────
// Ausschließlich über Remote-Agenten:
//   /api/agents/:id/docker/containers/:cid/terminal
const WebSocket = require('ws');
const { getPermissions }         = require('./middleware/requirePermission');
const { canAccessAgent }         = require('./utils/agentAccess');
const { checkServerIdentityFor } = require('./utils/agentTls');
const { auditLog }               = require('./utils/audit');
const terminalTickets            = require('./utils/terminalTickets');

const PFAD_AGENT = /^\/api\/agents\/(\d+)\/docker\/containers\/(.+)\/terminal$/;

server.on('upgrade', (request, socket, head) => {
  if (!request.url.includes('/terminal')) return;

  const deny = (code, text) => {
    if (!socket.destroyed) {
      socket.write('HTTP/1.1 ' + code + ' ' + text + '\r\n\r\n');
      socket.destroy();
    }
  };

  const url    = new URL(request.url, 'http://' + request.headers.host);
  const agentM = url.pathname.match(PFAD_AGENT);
  if (!agentM) return;   // kein Terminal-Pfad → nicht unsere Zuständigkeit

  const agentId     = agentM[1];
  const containerId = agentM[2];

  // Authentifizierung über ein Einmal-Ticket, das zuvor per regulärer API geholt wurde.
  // So landet kein Session-JWT in den Access-Logs des Reverse Proxy.
  const ticket = terminalTickets.redeem(url.searchParams.get('ticket'), agentId, containerId);
  if (!ticket) return deny(401, 'Unauthorized');

  try {
    const db = require('./db');

    // Rechte erneut prüfen: Das Ticket ist zwar kurzlebig, die Rolle kann sich in der
    // Zwischenzeit aber geändert haben. Rolle dafür frisch aus der DB lesen — dieselben
    // Bedingungen wie bei jeder HTTP-Docker-Route, sonst wäre das Terminal ein Weg an
    // der Rechteverwaltung vorbei.
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(ticket.userId);
    if (!user) return deny(401, 'Unauthorized');
    if (!getPermissions(user.role).includes('docker.control')) return deny(403, 'Forbidden');

    request.user = user;   // für auditLog

    // ── Container auf einem Remote-Server, über dessen Agent ─────────────────
    const agent = db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(agentId);
    if (!agent) return deny(404, 'Not Found');
    if (!canAccessAgent(agent.id, user.role)) return deny(403, 'Forbidden');

    // Die Betriebsart wird hier bewusst nicht geprüft. Die Container-Konsole ist
    // seit v5.4.1.0 ausschließlich nativ: Sie läuft immer über den Panel-Agent, egal ob
    // die Container-Daten selbst von ihm oder von Dockhand Pro kommen.
    const targetUrl = agent.url.replace(/^http/, 'ws') + '/docker/containers/' + containerId + '/terminal';
    const wsOptions = {
      headers: { 'x-agent-token': agent.token },
      handshakeTimeout: 10000,   // sonst hängt ein nicht antwortender Agent stumm
    };
    if (targetUrl.startsWith('wss://')) {
      // Selbstsigniert — deshalb kein rejectUnauthorized, aber Fingerprint gepinnt,
      // genau wie bei den HTTP-Aufrufen über agentApi.
      wsOptions.rejectUnauthorized  = false;
      wsOptions.checkServerIdentity = checkServerIdentityFor(agent);
    }
    const agentWs = new WebSocket(targetUrl, wsOptions);

    // Ab dem erfolgreichen Upgrade ist `socket` ein WebSocket — dann darf dort keine
    // HTTP-Antwort mehr hineingeschrieben werden (das erzeugt nur Müll-Frames).
    let upgraded = false;

    agentWs.on('open', () => {
      upgraded = true;
      auditLog(request, 'docker.terminal.open', 'container', containerId, { agentId: agent.id, agentName: agent.name });

      const wssTerm = new WebSocket.Server({ noServer: true });
      wssTerm.handleUpgrade(request, socket, head, (clientWs) => {
        // `isBinary` muss mitgereicht werden. Ohne das macht `ws` aus dem empfangenen
        // Buffer beim Weitersenden einen Binärframe — im Browser kommt dann ein Blob an,
        // und xterm schreibt davon nichts. Das Terminal-Fenster blieb dadurch leer,
        // obwohl die Verbindung stand und Daten flossen.
        clientWs.on('message', (data, isBinary) => {
          if (agentWs.readyState === WebSocket.OPEN) agentWs.send(data, { binary: isBinary });
        });
        agentWs.on('message', (data, isBinary) => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary });
        });

        // Ohne Datenverkehr trennt der Reverse Proxy die Verbindung (NGINX Proxy
        // Manager: proxy_read_timeout, Standard 60 s). Regelmäßige Pings halten ein
        // im Leerlauf stehendes Terminal offen.
        const keepAlive = setInterval(() => {
          try { if (clientWs.readyState === WebSocket.OPEN) clientWs.ping(); } catch {}
          try { if (agentWs.readyState  === WebSocket.OPEN) agentWs.ping();  } catch {}
        }, 30000);
        const stop = () => clearInterval(keepAlive);

        clientWs.on('close', () => { stop(); agentWs.close(); });
        agentWs.on('close',  () => { stop(); clientWs.close(); });
        clientWs.on('error', () => { stop(); agentWs.close(); });
        agentWs.on('error',  () => { stop(); clientWs.close(); });
      });
    });

    agentWs.on('error', (err) => {
      if (upgraded) { try { agentWs.close(); } catch {} return; }
      console.warn('[Terminal] Agent "' + agent.name + '" nicht erreichbar:', err.message);
      deny(502, 'Bad Gateway');
    });
  } catch (err) {
    deny(500, 'Internal Server Error');
  }
});

require('./metricsAggregator').start();
require('./alertEvaluator').start();
// dockerMetricsRecorder entfernt — Docker-Stats kommen jetzt von Dockhand API
try { require('./remoteMetricsRecorder').start(); } catch (e) { console.warn('Remote-Metriken deaktiviert:', e.message); }
try { require('./utils/updateCheck').startPeriodicCheck(); } catch (e) { console.warn('UpdateCheck deaktiviert:', e.message); }
// Nach jedem Start prüfen, ob die Agenten älter sind als das Script in diesem Image.
try { require('./utils/agentAutoUpdate').start(); } catch (e) { console.warn('Automatisches Agent-Update deaktiviert:', e.message); }

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Überwachungs-Panel running on port ${PORT}`));
