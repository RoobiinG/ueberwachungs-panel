const router = require('express').Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const requireRole = require('../middleware/roles');

router.get('/status', async (req, res) => {
  try {
    const { stdout } = await execAsync('ufw status verbose');
    res.json({ status: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rules', async (req, res) => {
  try {
    const { stdout } = await execAsync('ufw status numbered');
    const rules = stdout.split('\n').filter(l => l.match(/^\[\s*\d+\]/)).map(line => {
      const match = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/);
      if (!match) return { raw: line.trim() };
      return { num: match[1].trim(), to: match[2].trim(), action: match[3].trim(), from: match[4].trim() };
    });
    res.json(rules);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/allow', requireRole('admin'), async (req, res) => {
  const { port, proto, from } = req.body;
  if (!port) return res.status(400).json({ error: 'Port required' });
  const cmd = from
    ? `ufw allow from ${from} to any port ${port}${proto ? ' proto ' + proto : ''}`
    : `ufw allow ${port}${proto ? '/' + proto : ''}`;
  try {
    const { stdout } = await execAsync(cmd);
    res.json({ success: true, output: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/deny', requireRole('admin'), async (req, res) => {
  const { port, proto } = req.body;
  if (!port) return res.status(400).json({ error: 'Port required' });
  try {
    const { stdout } = await execAsync(`ufw deny ${port}${proto ? '/' + proto : ''}`);
    res.json({ success: true, output: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rules/:num', requireRole('admin'), async (req, res) => {
  try {
    const { stdout } = await execAsync(`echo y | ufw delete ${req.params.num}`);
    res.json({ success: true, output: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
