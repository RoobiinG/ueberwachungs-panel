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
app.use('/api/agents',  auth, require('./routes/agents'));
app.use('/api/metrics',      auth, require('./routes/metrics'));  // Kein requireLocalAccess: Daten kommen aus lokaler SQLite (auch Remote-Agent-Daten)
app.use('/api/uptime-kuma', auth, require('./routes/uptimeKuma'));
app.use('/api/alerts',      auth, require('./routes/alerts'));
app.use('/api/docker/metrics', auth, requireLocalAccess, require('./routes/containerMetrics'));
app.use('/api/audit',       auth, require('./routes/audit'));
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
try { require('./dockerMetricsRecorder').start(); } catch (e) { console.warn('Docker-Metriken deaktiviert:', e.message); }
try { require('./remoteMetricsRecorder').start(); } catch (e) { console.warn('Remote-Metriken deaktiviert:', e.message); }

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Überwachungs-Panel running on port ${PORT}`));
