const router = require('express').Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { requirePermission } = require('../middleware/requirePermission');

// Befehle im Host-Namespace ausführen (erfordert pid:host + privileged in docker-compose)
const host = (cmd, opts = {}) =>
  execAsync(`nsenter --target 1 --mount --uts --ipc --net --pid -- ${cmd}`, { timeout: 20_000, ...opts });

// ── Service-Listen-Cache (8 Sekunden TTL) ─────────────────────────────────────
let _serviceCache  = null;
let _serviceCacheTs = 0;
const SERVICE_CACHE_TTL = 8_000;

// Systemd Unit-Namen: Buchstaben, Ziffern, Bindestrich, Unterstrich, Punkt,
// @ (Template-Instanzen wie getty@tty1.service) und : (Slice-Trenner).
// Maximallänge 255 Zeichen (systemd-Limit). Kein Shell-Sonderzeichen erlaubt.
const validName = (name) => {
  if (typeof name !== 'string' || name.length > 255) throw new Error('Ungültiger Service-Name');
  if (!/^[a-zA-Z0-9@._:-]+$/.test(name)) throw new Error('Ungültiger Service-Name');
  return name;
};

router.get('/', requirePermission('services.view'), async (req, res) => {
  // Cache: frische Daten liefern wenn verfügbar, sonst von systemd holen
  if (_serviceCache && Date.now() - _serviceCacheTs < SERVICE_CACHE_TTL) {
    return res.json(_serviceCache);
  }
  try {
    const { stdout } = await host('systemctl list-units --type=service --all --no-pager --plain --no-legend');
    const services = stdout.trim().split('\n').map(line => {
      const parts = line.trim().split(/\s+/);
      return { name: parts[0], load: parts[1], active: parts[2], sub: parts[3], description: parts.slice(4).join(' ') };
    }).filter(s => s.name);
    _serviceCache  = services;
    _serviceCacheTs = Date.now();
    res.json(services);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:name/status', requirePermission('services.view'), async (req, res) => {
  try {
    const { stdout } = await host(`systemctl status ${validName(req.params.name)} --no-pager`);
    res.json({ status: stdout });
  } catch (err) { res.json({ status: err.stdout || err.message }); }
});

router.post('/:name/:action', requirePermission('services.control'), async (req, res) => {
  const { name, action } = req.params;
  const valid = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
  if (!valid.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    const { stdout } = await host(`systemctl ${action} ${validName(name)}`);
    res.json({ success: true, output: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
