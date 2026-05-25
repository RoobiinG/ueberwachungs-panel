const router = require('express').Router();
const axios = require('axios');

const api = () => axios.create({
  baseURL: 'https://api.hetzner.cloud/v1',
  headers: { Authorization: `Bearer ${process.env.HETZNER_API_TOKEN}` },
});

router.get('/servers', async (req, res) => {
  try { res.json((await api().get('/servers')).data); }
  catch (err) { res.status(500).json({ error: err.response?.data?.error?.message || err.message }); }
});

router.post('/servers/:id/:action', async (req, res) => {
  const valid = ['poweron', 'poweroff', 'reboot', 'reset'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  try { res.json((await api().post(`/servers/${req.params.id}/actions/${req.params.action}`)).data); }
  catch (err) { res.status(500).json({ error: err.response?.data?.error?.message || err.message }); }
});

router.get('/volumes', async (req, res) => {
  try { res.json((await api().get('/volumes')).data); }
  catch (err) { res.status(500).json({ error: err.response?.data?.error?.message || err.message }); }
});

router.get('/networks', async (req, res) => {
  try { res.json((await api().get('/networks')).data); }
  catch (err) { res.status(500).json({ error: err.response?.data?.error?.message || err.message }); }
});

module.exports = router;
