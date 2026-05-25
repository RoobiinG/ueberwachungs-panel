const router = require('express').Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const requireRole = require('../middleware/roles');

// Befehle im Host-Namespace ausführen (erfordert pid:host + privileged in docker-compose)
const host = (cmd) => execAsync(`nsenter --target 1 --mount --uts --ipc --net --pid -- ${cmd}`);

const validName = (name) => {
  if (!/^[a-zA-Z0-9@._:-]+$/.test(name)) throw new Error('Ungültiger Service-Name');
  return name;
};

router.get('/', async (req, res) => {
  try {
    const { stdout } = await host('systemctl list-units --type=service --no-pager --plain --no-legend');
    const services = stdout.trim().split('\n').map(line => {
      const parts = line.trim().split(/\s+/);
      return { name: parts[0], load: parts[1], active: parts[2], sub: parts[3], description: parts.slice(4).join(' ') };
    }).filter(s => s.name);
    res.json(services);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:name/status', async (req, res) => {
  try {
    const { stdout } = await host(`systemctl status ${validName(req.params.name)} --no-pager`);
    res.json({ status: stdout });
  } catch (err) { res.json({ status: err.stdout || err.message }); }
});

router.post('/:name/:action', requireRole('admin', 'operator'), async (req, res) => {
  const { name, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    const { stdout } = await host(`systemctl ${action} ${validName(name)}`);
    res.json({ success: true, output: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
