const router = require('express').Router();
const axios = require('axios');
const db = require('../db');

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

router.get('/servers', (req, res) => handle(res, () => api().get('/servers')));

router.post('/servers/:id/:action', (req, res) => {
  const valid = ['poweron', 'poweroff', 'reboot', 'reset', 'shutdown'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  handle(res, () => api().post(`/servers/${req.params.id}/actions/${req.params.action}`));
});

router.post('/servers/:id/backup/:toggle', (req, res) => {
  if (!['enable', 'disable'].includes(req.params.toggle)) return res.status(400).json({ error: 'Invalid toggle' });
  handle(res, () => api().post(`/servers/${req.params.id}/actions/${req.params.toggle}_backup`));
});

router.get('/servers/:id/backups', (req, res) =>
  handle(res, () => api().get(`/images?type=backup&bound_to=${req.params.id}`))
);

module.exports = router;
