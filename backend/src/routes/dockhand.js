// ─── Dockhand Settings & Environments ────────────────────────────────────────
// GET  /api/dockhand/config          → URL + hasToken
// POST /api/dockhand/config          → URL, apiToken, localEnvId speichern
// GET  /api/dockhand/environments    → Environments von Dockhand abfragen
// POST /api/dockhand/test            → Verbindung testen
// PUT  /api/agents/:id/dockhand-env  → dockhand_env_id eines Agents setzen

const router      = require('express').Router();
const db          = require('../db');
const requireRole = require('../middleware/roles');
const dockhand    = require('../utils/dockhandClient');

const getSetting = k =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;
const setSetting = (k, v) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);

// ── GET /api/dockhand/config ──────────────────────────────────────────────────
router.get('/config', requireRole('admin'), (req, res) => {
  res.json({
    url:          getSetting('dockhandUrl')        || '',
    hasToken:     !!getSetting('dockhandApiToken'),
    localEnvId:   getSetting('dockhandLocalEnvId') || '',
  });
});

// ── POST /api/dockhand/config ─────────────────────────────────────────────────
router.post('/config', requireRole('admin'), (req, res) => {
  const { url, apiToken, localEnvId } = req.body;
  if (url        !== undefined) setSetting('dockhandUrl',        url.trim());
  if (apiToken   !== undefined) setSetting('dockhandApiToken',   apiToken.trim());
  if (localEnvId !== undefined) setSetting('dockhandLocalEnvId', String(localEnvId).trim());
  res.json({ ok: true });
});

// ── GET /api/dockhand/environments ────────────────────────────────────────────
router.get('/environments', requireRole('admin'), async (req, res) => {
  try {
    const { data } = await dockhand.getEnvironments();
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/dockhand/test ───────────────────────────────────────────────────
router.post('/test', requireRole('admin'), async (req, res) => {
  // Temporäre Werte aus Request nutzen, falls noch nicht gespeichert
  const { url, apiToken } = req.body;
  if (url)      setSetting('dockhandUrl',      url.trim());
  if (apiToken) setSetting('dockhandApiToken', apiToken.trim());

  try {
    const { data } = await dockhand.getEnvironments();
    const envs = Array.isArray(data) ? data : [];
    res.json({ ok: true, environments: envs.length, names: envs.map(e => e.name) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── PUT /api/dockhand/agent-env ───────────────────────────────────────────────
// Setzt dockhand_env_id für einen Remote-Agent
router.put('/agent-env', requireRole('admin'), (req, res) => {
  const { agentId, envId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId fehlt' });
  const agent = db.prepare('SELECT id FROM remote_agents WHERE id = ?').get(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent nicht gefunden' });
  db.prepare('UPDATE remote_agents SET dockhand_env_id = ? WHERE id = ?')
    .run(envId ? Number(envId) : null, agentId);
  res.json({ ok: true });
});

module.exports = router;
