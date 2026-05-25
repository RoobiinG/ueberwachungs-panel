const router = require('express').Router();
const si = require('systeminformation');

router.get('/stats', async (req, res) => {
  try {
    const [cpu, mem, disk, network, os] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo(),
    ]);
    res.json({
      cpu: { usage: Math.round(cpu.currentLoad), cores: cpu.cpus?.length || 0 },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        usedPercent: Math.round((mem.used / mem.total) * 100),
      },
      disk: disk.map(d => ({ fs: d.fs, type: d.type, size: d.size, used: d.used, usedPercent: d.use, mount: d.mount })),
      network: network.map(n => ({ iface: n.iface, rxBytes: n.rx_bytes, txBytes: n.tx_bytes, rxSec: n.rx_sec, txSec: n.tx_sec })),
      os: { distro: os.distro, release: os.release, arch: os.arch, hostname: os.hostname, uptime: os.uptime },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/info', async (req, res) => {
  try {
    const [cpu, system] = await Promise.all([si.cpu(), si.system()]);
    res.json({ cpu, system });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
