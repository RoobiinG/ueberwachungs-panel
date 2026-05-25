const router = require('express').Router();
let Docker;
try { Docker = require('dockerode'); } catch { Docker = null; }

const getDocker = () => {
  if (!Docker) throw new Error('dockerode not available');
  return new Docker({ socketPath: '/var/run/docker.sock' });
};

router.get('/containers', async (req, res) => {
  try {
    const containers = await getDocker().listContainers({ all: true });
    res.json(containers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/containers/:id', async (req, res) => {
  try {
    const info = await getDocker().getContainer(req.params.id).inspect();
    res.json(info);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/containers/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'kill', 'pause', 'unpause'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    await getDocker().getContainer(id)[action]();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/images', async (req, res) => {
  try {
    const images = await getDocker().listImages({ all: true });
    res.json(images);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/info', async (req, res) => {
  try {
    const info = await getDocker().info();
    res.json(info);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
