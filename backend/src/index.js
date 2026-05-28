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
const fs   = require('fs');
const path = require('path');
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
app.use('/api/ssh',     auth, require('./routes/ssh'));
app.use('/api/agents',  auth, require('./routes/agents'));
app.use('/api/sftp',    auth, require('./routes/sftp'));
app.use('/api/metrics',    auth, require('./routes/metrics'));    // Kein requireLocalAccess: Daten kommen aus lokaler SQLite (auch Remote-Agent-Daten)
app.use('/api/dashboard',  auth, require('./routes/dashboard'));
app.use('/api/uptime-kuma', auth, require('./routes/uptimeKuma'));
app.use('/api/alerts',      auth, require('./routes/alerts'));
app.use('/api/dockhand',    auth, require('./routes/dockhand'));
app.use('/api/audit',       auth, require('./routes/audit'));
// Öffentlicher Share-Endpunkt (kein Login nötig) — muss VOR auth stehen
app.get('/api/logs/share/:token', require('./routes/panelLogsPublic'));
app.use('/api/logs',        auth, require('./routes/panelLogs'));
app.use('/api/version',          require('./routes/version'));

// Serve React frontend in production
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

setupWS(server);
require('./metricsRecorder').start();
require('./alertEvaluator').start();
// dockerMetricsRecorder entfernt — Docker-Stats kommen jetzt von Dockhand API
try { require('./remoteMetricsRecorder').start(); } catch (e) { console.warn('Remote-Metriken deaktiviert:', e.message); }

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Überwachungs-Panel running on port ${PORT}`));
