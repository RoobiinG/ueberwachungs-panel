const router = require('express').Router();
const axios = require('axios');

const api = () => axios.create({
  baseURL: 'https://mc-host24.de/api/v1',
  headers: { Authorization: process.env.MCHOST_API_TOKEN, 'Content-Type': 'application/json' },
});

const handle = async (res, fn) => {
  try { res.json((await fn()).data); }
  catch (err) { res.status(err.response?.status || 500).json({ error: err.response?.data || err.message }); }
};

// VServer auflisten
router.get('/vserver', (req, res) => handle(res, () => api().get('/vserver')));

// VServer Status
router.get('/vserver/:id/status', (req, res) =>
  handle(res, () => api().get(`/vserver/${req.params.id}/status`))
);

// Power-Aktionen
router.post('/vserver/:id/:action', async (req, res) => {
  const valid = ['start', 'stop', 'shutdown', 'restart'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  handle(res, () => api().post(`/vserver/${req.params.id}/${req.params.action}`));
});

// Backups auflisten
router.get('/vserver/:id/backups', (req, res) =>
  handle(res, () => api().get(`/vserver/${req.params.id}/backups`))
);

// Backup erstellen
router.post('/vserver/:id/backups', (req, res) =>
  handle(res, () => api().post(`/vserver/${req.params.id}/backups`))
);

module.exports = router;
