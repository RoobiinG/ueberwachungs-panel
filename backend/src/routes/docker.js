// ─── Docker via Dockhand API ──────────────────────────────────────────────────
// Ersetzt die direkte dockerode-Verbindung.
// Alle Container-Daten kommen jetzt von der Dockhand REST-API.

const router    = require('express').Router();
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog }          = require('../utils/audit');
const db                    = require('../db');
const dockhand              = require('../utils/dockhandClient');
const { notifyAction } = require('../utils/actionNotify');

// broadcast lazy laden (zirkuläre Abhängigkeit vermeiden)
let _broadcast = null;
const broadcast = (data) => {
  if (!_broadcast) { try { _broadcast = require('../websocket').broadcast; } catch {} }
  _broadcast?.(data);
};

const localEnvId = () =>
  db.prepare("SELECT value FROM settings WHERE key = 'dockhandLocalEnvId'").get()?.value ?? null;

const requireEnv = (res) => {
  const envId = localEnvId();
  if (!envId) {
    res.status(400).json({
      error: 'Dockhand Local-Environment nicht konfiguriert. Bitte unter Einstellungen → Dockhand zuweisen.',
    });
    return null;
  }
  return envId;
};

// ── GET /api/docker/containers ────────────────────────────────────────────────
router.get('/containers', requirePermission('docker.view'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    const { data } = await dockhand.getContainers(envId);
    res.json((Array.isArray(data) ? data : []).map(dockhand.normalizeContainer));
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── GET /api/docker/containers/:id ───────────────────────────────────────────
router.get('/containers/:id', requirePermission('docker.view'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    const { data } = await dockhand.getContainer(envId, req.params.id);
    res.json(dockhand.normalizeContainer(data));
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── GET /api/docker/containers/:id/stats  (Live-Monitoring) ──────────────────
router.get('/containers/:id/stats', requirePermission('docker.view'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    const { data } = await dockhand.getContainerStats(envId, req.params.id);
    res.json(data ?? {});
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── GET /api/docker/containers/:id/logs ──────────────────────────────────────
router.get('/containers/:id/logs', requirePermission('docker.logs'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    const tail = Math.max(1, Math.min(10000, parseInt(req.query.tail) || 100));
    const { data } = await dockhand.getContainerLogs(envId, req.params.id, tail);
    res.json(data ?? []);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── POST /api/docker/containers/:id/:action ───────────────────────────────────
router.post('/containers/:id/:action', requirePermission('docker.control'), async (req, res) => {
  const { id, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'kill', 'pause', 'unpause'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Ungültige Aktion' });
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    await dockhand.containerAction(envId, id, action);
    auditLog(req, `docker.${action}`, 'container', id.slice(0, 12), { containerId: id.slice(0, 12) });
    notifyAction(req, action, req.body?.containerName || id.slice(0, 12), 'docker');

    // Bei start/restart: exponierte Host-Ports per WS melden → Firewall-Vorschlag im Frontend
    if (action === 'start' || action === 'restart') {
      try {
        const { data: c } = await dockhand.getContainer(envId, id);
        const container   = dockhand.normalizeContainer(c);
        const hostPorts   = (container.ports || [])
          .map(p => {
            if (typeof p === 'string') {
              // Format: "hostPort:containerPort/proto" oder "containerPort/proto"
              const m = p.match(/^(?:(\d+):)?(\d+)(?:\/(tcp|udp))?$/i);
              if (!m || !m[1]) return null; // kein Host-Port → nicht öffentlich exponiert
              return { hostPort: m[1], containerPort: m[2], proto: m[3] || 'tcp' };
            }
            return p.hostPort ? p : null;
          })
          .filter(Boolean);

        if (hostPorts.length > 0) {
          broadcast({
            type: 'docker_ports',
            payload: {
              containerId:   id.slice(0, 12),
              containerName: container.name || req.body?.containerName || id.slice(0, 12),
              ports:         hostPorts,
            },
          });
        }
      } catch {} // Port-Benachrichtigung ist optional — Fehler ignorieren
    }

    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── GET /api/docker/images ────────────────────────────────────────────────────
router.get('/images', requirePermission('docker.images.view'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    const { data } = await dockhand.getImages(envId);
    res.json(data || []);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// Sicherheit: Image-Referenz streng validieren, bevor sie an Dockhand geht
const validImageRef = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,220}$/.test(s);

// ── POST /api/docker/images/pull  { image } ───────────────────────────────────
router.post('/images/pull', requirePermission('docker.images.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  const image = (req.body?.image || '').trim();
  if (!validImageRef(image)) return res.status(400).json({ error: 'Ungültige Image-Referenz' });
  try {
    await dockhand.pullImage(envId, image);
    auditLog(req, 'docker.image.pull', 'image', image);
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── POST /api/docker/images/prune ─────────────────────────────────────────────
router.post('/images/prune', requirePermission('docker.images.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    const { data } = await dockhand.pruneImages(envId);
    auditLog(req, 'docker.image.prune', 'image', 'ungenutzte');
    res.json(data ?? { success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── DELETE /api/docker/images/:id ─────────────────────────────────────────────
router.delete('/images/:id', requirePermission('docker.images.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    await dockhand.removeImage(envId, req.params.id);
    auditLog(req, 'docker.image.delete', 'image', String(req.params.id).slice(0, 20));
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── Volumes ───────────────────────────────────────────────────────────────────
router.get('/volumes', requirePermission('docker.volumes.view'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try { res.json((await dockhand.getVolumes(envId)).data || []); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
router.delete('/volumes/:name', requirePermission('docker.volumes.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    await dockhand.removeVolume(envId, req.params.name);
    auditLog(req, 'docker.volume.delete', 'volume', String(req.params.name).slice(0, 40));
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});
router.post('/volumes/prune', requirePermission('docker.volumes.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    const { data } = await dockhand.pruneVolumes(envId);
    auditLog(req, 'docker.volume.prune', 'volume', 'ungenutzte');
    res.json(data ?? { success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── Netzwerke ─────────────────────────────────────────────────────────────────
router.get('/networks', requirePermission('docker.networks.view'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try { res.json((await dockhand.getNetworks(envId)).data || []); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
router.delete('/networks/:id', requirePermission('docker.networks.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    await dockhand.removeNetwork(envId, req.params.id);
    auditLog(req, 'docker.network.delete', 'network', String(req.params.id).slice(0, 20));
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});
router.post('/networks/prune', requirePermission('docker.networks.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    const { data } = await dockhand.pruneNetworks(envId);
    auditLog(req, 'docker.network.prune', 'network', 'ungenutzte');
    res.json(data ?? { success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── Stacks ────────────────────────────────────────────────────────────────────
router.get('/stacks', requirePermission('docker.stacks.view'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try { res.json((await dockhand.getStacks(envId)).data || []); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
router.delete('/stacks/:id', requirePermission('docker.stacks.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  try {
    await dockhand.removeStack(envId, req.params.id);
    auditLog(req, 'docker.stack.delete', 'stack', String(req.params.id).slice(0, 40));
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});
router.post('/stacks/:id/:action', requirePermission('docker.stacks.control'), async (req, res) => {
  const envId = requireEnv(res);
  if (!envId) return;
  const { id, action } = req.params;
  if (!['start', 'stop', 'update'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    if (action === 'start') await dockhand.startStack(envId, id);
    else if (action === 'stop') await dockhand.stopStack(envId, id);
    else if (action === 'update') await dockhand.updateStack(envId, id, req.body);
    auditLog(req, `docker.stack.${action}`, 'stack', String(id).slice(0, 40));
    res.json({ success: true });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── GET /api/docker/info  (Dashboard-Stats) ───────────────────────────────────
router.get('/info', requirePermission('docker.view'), async (req, res) => {
  try {
    const { data } = await dockhand.getDashboardStats();
    res.json(data ?? {});
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// ── GET /api/docker/activity ──────────────────────────────────────────────────
router.get('/activity', requirePermission('docker.view'), async (req, res) => {
  const envId = localEnvId(); // Optional — auch ohne Env verfügbar
  try {
    const { data } = await dockhand.getActivity(envId);
    res.json(data ?? []);
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// Hinweis: Container-Labels werden in routes/dockerLabels.js verwaltet
// und sind ohne requireLocalAccess gemountet (panel-seitige SQLite-Daten).

module.exports = router;
