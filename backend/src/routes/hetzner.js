const router      = require('express').Router();
const axios       = require('axios');
const db          = require('../db');
const { requirePermission } = require('../middleware/requirePermission');

const getToken = () =>
  db.prepare("SELECT value FROM settings WHERE key = 'hetzner_api_token'").get()?.value ||
  process.env.HETZNER_API_TOKEN || '';

const api = () => {
  const token = getToken();
  if (!token) throw new Error('Hetzner API Token nicht konfiguriert');
  return axios.create({
    baseURL: 'https://api.hetzner.cloud/v1',
    headers: { Authorization: `Bearer ${token}` },
  });
};

const handle = async (res, fn) => {
  try { res.json((await fn()).data); }
  catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
};

const validId = (id) => /^\d+$/.test(id);

router.get('/servers', requirePermission('hetzner.view'), (req, res) => handle(res, () => api().get('/servers')));

router.post('/servers/:id/:action', requirePermission('hetzner.control'), (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige Server-ID' });
  const valid = ['poweron', 'poweroff', 'reboot', 'reset', 'shutdown'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Ungültige Aktion' });
  handle(res, () => api().post(`/servers/${req.params.id}/actions/${req.params.action}`));
});

router.post('/servers/:id/backup/:toggle', requirePermission('hetzner.control'), (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige Server-ID' });
  if (!['enable', 'disable'].includes(req.params.toggle)) return res.status(400).json({ error: 'Ungültiger Wert' });
  handle(res, () => api().post(`/servers/${req.params.id}/actions/${req.params.toggle}_backup`));
});

router.get('/servers/:id/backups', requirePermission('hetzner.view'), (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Ungültige Server-ID' });
  handle(res, () => api().get(`/images?type=backup&bound_to=${req.params.id}`));
});

module.exports = router;
