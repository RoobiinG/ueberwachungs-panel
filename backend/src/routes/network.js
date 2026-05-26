const router = require('express').Router();
const si = require('systeminformation');
const axios = require('axios');
const { requirePermission } = require('../middleware/requirePermission');

let publicIpCache = { ip: null, ts: 0 };

router.get('/public-ip', requirePermission('metrics.view'), async (req, res) => {
  // Cache für 5 Minuten
  if (publicIpCache.ip && Date.now() - publicIpCache.ts < 300_000) {
    return res.json({ ip: publicIpCache.ip });
  }
  try {
    const { data } = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    publicIpCache = { ip: data.ip, ts: Date.now() };
    res.json({ ip: data.ip });
  } catch {
    res.status(502).json({ ip: null });
  }
});

router.get('/interfaces', requirePermission('metrics.view'), async (req, res) => {
  try { res.json(await si.networkInterfaces()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stats', requirePermission('metrics.view'), async (req, res) => {
  try { res.json(await si.networkStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/connections', requirePermission('metrics.view'), async (req, res) => {
  try { res.json(await si.networkConnections()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
