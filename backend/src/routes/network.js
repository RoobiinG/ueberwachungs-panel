const router = require('express').Router();
const si = require('systeminformation');

router.get('/interfaces', async (req, res) => {
  try { res.json(await si.networkInterfaces()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stats', async (req, res) => {
  try { res.json(await si.networkStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/connections', async (req, res) => {
  try { res.json(await si.networkConnections()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
