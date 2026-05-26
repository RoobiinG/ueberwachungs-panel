const router = require('express').Router();
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const db = require('../db');
let Docker;
try { Docker = require('dockerode'); } catch { Docker = null; }

const getDocker = () => {
  if (!Docker) throw new Error('dockerode not available');
  return new Docker({ socketPath: '/var/run/docker.sock' });
};

router.get('/containers', requirePermission('docker.view'), async (req, res) => {
  try {
    const containers = await getDocker().listContainers({ all: true });
    res.json(containers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/containers/:id', requirePermission('docker.view'), async (req, res) => {
  try {
    const info = await getDocker().getContainer(req.params.id).inspect();
    res.json(info);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/containers/:id/:action', requirePermission('docker.control'), async (req, res) => {
  const { id, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'kill', 'pause', 'unpause'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    // Containernamen für Log ermitteln
    let containerName = id;
    try {
      const info = await getDocker().getContainer(id).inspect();
      containerName = (info.Name || info.Names?.[0] || id).replace(/^\//, '');
    } catch {}
    await getDocker().getContainer(id)[action]();
    auditLog(req, `docker.${action}`, 'container', containerName, { containerId: id.slice(0, 12) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/images', requirePermission('docker.view'), async (req, res) => {
  try {
    const images = await getDocker().listImages({ all: true });
    res.json(images);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/info', requirePermission('docker.view'), async (req, res) => {
  try {
    const info = await getDocker().info();
    res.json(info);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Container-Labels (Spitznamen / Tags — panel-seitig gespeichert) ──────────

// GET /api/docker/labels?server=local  → alle Labels für einen Server
router.get('/labels', requirePermission('docker.view'), (req, res) => {
  const server = req.query.server || 'local';
  const rows = db.prepare('SELECT container_id, nickname, tag FROM container_labels WHERE server = ?').all(server);
  const map = {};
  for (const r of rows) map[r.container_id] = { nickname: r.nickname, tag: r.tag };
  res.json(map);
});

// PUT /api/docker/labels  body: { server, containerId, nickname, tag }
router.put('/labels', requirePermission('docker.view'), (req, res) => {
  const { server = 'local', containerId, nickname = '', tag = '' } = req.body;
  if (!containerId) return res.status(400).json({ error: 'containerId erforderlich' });
  db.prepare(`
    INSERT INTO container_labels (server, container_id, nickname, tag) VALUES (?, ?, ?, ?)
    ON CONFLICT(server, container_id) DO UPDATE SET nickname = excluded.nickname, tag = excluded.tag
  `).run(server, containerId, nickname.trim(), tag.trim());
  res.json({ ok: true });
});

// DELETE /api/docker/labels/:server/:containerId
router.delete('/labels/:server/:containerId', requirePermission('docker.view'), (req, res) => {
  db.prepare('DELETE FROM container_labels WHERE server = ? AND container_id = ?')
    .run(req.params.server, req.params.containerId);
  res.json({ ok: true });
});

module.exports = router;
