const router = require('express').Router();
const axios = require('axios');

const api = () => axios.create({
  baseURL: 'https://mc-host24.de/api/v1',
  headers: { Authorization: process.env.MCHOST_API_TOKEN, 'Content-Type': 'application/json' },
});

const handle = (res) => async (fn) => {
  try { res.json((await fn()).data); }
  catch (err) { res.status(err.response?.status || 500).json({ error: err.response?.data || err.message }); }
};

// --- Profil ---
router.get('/profile', async (req, res) => handle(res)(() => api().get('/profile')));

// --- Minecraft Server ---
router.get('/minecraft', async (req, res) => handle(res)(() => api().get('/minecraftServer')));
router.get('/minecraft/:id/status', async (req, res) => handle(res)(() => api().get(`/minecraftServer/${req.params.id}/status`)));
router.post('/minecraft/:id/:action', async (req, res) => {
  const valid = ['start', 'stop', 'restart'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  handle(res)(() => api().post(`/minecraftServer/${req.params.id}/${req.params.action}`));
});
router.get('/minecraft/:id/backups', async (req, res) => handle(res)(() => api().get(`/minecraftServer/${req.params.id}/backups`)));
router.post('/minecraft/:id/backups', async (req, res) => handle(res)(() => api().post(`/minecraftServer/${req.params.id}/backups`)));

// --- VServer / Rootserver ---
router.get('/vserver', async (req, res) => handle(res)(() => api().get('/vserver')));
router.get('/vserver/:id/status', async (req, res) => handle(res)(() => api().get(`/vserver/${req.params.id}/status`)));
router.post('/vserver/:id/:action', async (req, res) => {
  const valid = ['start', 'stop', 'shutdown', 'restart'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  handle(res)(() => api().post(`/vserver/${req.params.id}/${req.params.action}`));
});
router.get('/vserver/:id/backups', async (req, res) => handle(res)(() => api().get(`/vserver/${req.params.id}/backups`)));
router.post('/vserver/:id/backups', async (req, res) => handle(res)(() => api().post(`/vserver/${req.params.id}/backups`)));
router.get('/vserver/:id/vnc', async (req, res) => handle(res)(() => api().get(`/vserver/${req.params.id}/vnc`)));
router.get('/vserver/:id/stats', async (req, res) => {
  const tf = req.query.tf || 'hour';
  handle(res)(() => api().get(`/vserver/${req.params.id}/rrddata?tf=${tf}`));
});

// --- Teamspeak ---
router.get('/teamspeak', async (req, res) => handle(res)(() => api().get('/teamspeak')));
router.get('/teamspeak/:id/status', async (req, res) => handle(res)(() => api().get(`/teamspeak/${req.params.id}/status`)));
router.post('/teamspeak/:id/:action', async (req, res) => {
  const valid = ['start', 'stop', 'restart'];
  if (!valid.includes(req.params.action)) return res.status(400).json({ error: 'Invalid action' });
  handle(res)(() => api().post(`/teamspeak/${req.params.id}/${req.params.action}`));
});

// --- Domains ---
router.get('/domains', async (req, res) => handle(res)(() => api().get('/domain')));
router.get('/domains/:id', async (req, res) => handle(res)(() => api().get(`/domain/${req.params.id}/info`)));

// --- Support Tickets ---
router.get('/tickets', async (req, res) => handle(res)(() => api().get('/support/tickets')));
router.post('/tickets', async (req, res) => {
  const { betr, text, service, ticket_category_id } = req.body;
  handle(res)(() => api().post('/support/tickets', { betr, text, service, ticket_category_id }));
});
router.get('/tickets/:id', async (req, res) => handle(res)(() => api().get(`/support/tickets/${req.params.id}`)));
router.post('/tickets/:id/reply', async (req, res) => handle(res)(() => api().post(`/support/tickets/${req.params.id}/reply`, { reply: req.body.reply })));
router.post('/tickets/:id/close', async (req, res) => handle(res)(() => api().post(`/support/tickets/${req.params.id}/close`)));

module.exports = router;
