const router = require('express').Router();
const updateCheck = require('../utils/updateCheck');
const requireRole = require('../middleware/roles');

// Update-Status abrufen
router.get('/status', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const status = await updateCheck.checkUpdates(force);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
