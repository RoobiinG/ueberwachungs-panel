const router = require('express').Router();
const axios = require('axios');

const api = () => axios.create({
  baseURL: 'https://api.mc-host24.de/v1',
  headers: { Authorization: `Bearer ${process.env.MCHOST_API_TOKEN}`, 'Content-Type': 'application/json' },
});

router.get('/servers', async (req, res) => {
  try { res.json((await api().get('/servers')).data); }
  catch (err) { res.status(500).json({ error: err.response?.data || err.message }); }
});

router.post('/servers/:id/:action', async (req, res) => {
  const valid = ['start', 'stop', 'restart'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  try { res.json((await api().post(`/servers/${req.params.id}/${req.params.action}`)).data); }
  catch (err) { res.status(500).json({ error: err.response?.data || err.message }); }
});

module.exports = router;
