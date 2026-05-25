const router = require('express').Router();
const axios = require('axios');
const db = require('../db');
const requireRole = require('../middleware/roles');

const getAll = () => db.prepare('SELECT * FROM remote_agents ORDER BY name').all();
const getOne = (id) => db.prepare('SELECT * FROM remote_agents WHERE id = ?').get(id);

const agentApi = (agent) => axios.create({
  baseURL: agent.url.replace(/\/$/, ''),
  timeout: 8000,
  headers: agent.token ? { 'x-agent-token': agent.token } : {},
});

router.get('/', (req, res) => {
  res.json(getAll());
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, url, token = '' } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name und URL erforderlich' });
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Ungültige URL' });
  }
  const result = db.prepare(
    'INSERT INTO remote_agents (name, url, token) VALUES (?, ?, ?)'
  ).run(name.trim(), url.trim().replace(/\/$/, ''), token.trim());
  res.status(201).json({ id: result.lastInsertRowid, name, url, token: '' });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM remote_agents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/:id/ping', async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  try {
    const { data } = await agentApi(agent).get('/ping');
    res.json({ online: true, hostname: data.hostname });
  } catch {
    res.json({ online: false });
  }
});

router.get('/:id/stats', async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  try {
    const { data } = await agentApi(agent).get('/stats');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Agent nicht erreichbar: ' + (err.message || '') });
  }
});

router.get('/:id/services', async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  try {
    const { data } = await agentApi(agent).get('/services');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Agent nicht erreichbar: ' + (err.message || '') });
  }
});

router.post('/:id/services/:name/:action', requireRole('admin', 'operator'), async (req, res) => {
  const agent = getOne(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  const { name, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Ungültige Aktion' });
  try {
    const { data } = await agentApi(agent).post(`/services/${encodeURIComponent(name)}/${action}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.response?.data?.error || 'Agent nicht erreichbar' });
  }
});

module.exports = router;
