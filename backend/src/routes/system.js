const router = require('express').Router();
const si = require('systeminformation');
const { getHostDisks } = require('../hostUtils');

router.get('/stats', async (req, res) => {
  try {
    const [cpu, mem, siDisk, network, os, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo(),
      si.time(),
    ]);

    // Disk: nsenter liefert echte Host-Daten; Fallback auf si.fsSize()
    const hostDisk = await getHostDisks();
    const disk = hostDisk || siDisk.map(d => ({
      fs: d.fs, size: d.size, used: d.used, free: d.available, usedPercent: d.use, mount: d.mount,
    }));

    res.json({
      cpu: { usage: Math.round(cpu.currentLoad), cores: cpu.cpus?.length || 0 },
      memory: {
        total: mem.total,
        // mem.available = MemAvailable (Linux), entspricht dem was htop/free -h zeigen.
        // mem.used wäre nur MemTotal - MemFree (ohne Cache-Abzug) → viel zu hoch.
        used: mem.total - mem.available,
        free: mem.free,
        usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100),
      },
      disk,
      network: network.map(n => ({ iface: n.iface, rxBytes: n.rx_bytes, txBytes: n.tx_bytes, rxSec: n.rx_sec, txSec: n.tx_sec })),
      os: {
        distro: os.distro,
        release: os.release,
        arch: os.arch,
        hostname: process.env.SERVER_HOSTNAME || os.hostname,
        uptime: time.uptime,
      },
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
