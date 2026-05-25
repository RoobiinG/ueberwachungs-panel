const router = require('express').Router();
const axios = require('axios');

const api = () => axios.create({
  baseURL: 'https://api.hetzner.cloud/v1',
  headers: { Authorization: `Bearer ${process.env.HETZNER_API_TOKEN}` },
});

const handle = async (res, fn) => {
  try { res.json((await fn()).data); }
  catch (err) { res.status(err.response?.status || 500).json({ error: err.response?.data?.error?.message || err.message }); }
};

// Server auflisten
router.get('/servers', (req, res) => handle(res, () => api().get('/servers')));

// Power-Aktionen
router.post('/servers/:id/:action', async (req, res) => {
  const valid = ['poweron', 'poweroff', 'reboot', 'reset', 'shutdown'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  handle(res, () => api().post(`/servers/${req.params.id}/actions/${req.params.action}`));
});

// Backups aktivieren / deaktivieren
router.post('/servers/:id/backup/:toggle', async (req, res) => {
  const { toggle } = req.params;
  if (!['enable', 'disable'].includes(toggle)) return res.status(400).json({ error: 'Invalid toggle' });
  handle(res, () => api().post(`/servers/${req.params.id}/actions/${toggle}_backup`));
});

// Backup-Images eines Servers auflisten
router.get('/servers/:id/backups', (req, res) =>
  handle(res, () => api().get(`/images?type=backup&bound_to=${req.params.id}`))
);

module.exports = router;
