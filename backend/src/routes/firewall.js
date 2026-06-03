const router = require('express').Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const { detectFirewall, getAdapter } = require('../utils/firewallAdapters');

// nsenter: Führt Befehle im Host-Namespace aus (nötig wenn Panel in Docker läuft)
const host = (cmd) => execAsync(`nsenter --target 1 --mount --uts --ipc --net --pid -- ${cmd}`, { timeout: 10000 });

// ─── Firewall erkennen ─────────────────────────────────────────────────────────
router.get('/detect', requirePermission('firewall.view'), async (req, res) => {
  try {
    const result = await detectFirewall(host);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Adapter holen (cached pro Request) ───────────────────────────────────────
async function getLocalAdapter() {
  const { tool } = await detectFirewall(host);
  const adapter  = getAdapter(tool, host);
  if (!adapter) throw new Error('Kein unterstütztes Firewall-Tool gefunden (UFW, iptables, nftables oder firewalld)');
  return { adapter, tool };
}

// ─── Status ───────────────────────────────────────────────────────────────────
router.get('/status', requirePermission('firewall.view'), async (req, res) => {
  try {
    const { adapter } = await getLocalAdapter();
    const status = await adapter.getStatus();
    res.json(status);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Regeln auflisten ──────────────────────────────────────────────────────────
router.get('/rules', requirePermission('firewall.view'), async (req, res) => {
  try {
    const { adapter, tool } = await getLocalAdapter();
    const rules = await adapter.getRules();
    res.json({ tool, rules });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Regel erlauben ───────────────────────────────────────────────────────────
router.post('/allow', requirePermission('firewall.manage'), async (req, res) => {
  const { port, proto, from } = req.body;
  if (!port) return res.status(400).json({ error: 'Port erforderlich' });
  try {
    const { adapter, tool } = await getLocalAdapter();
    const output = await adapter.allow(String(port), proto, from);
    auditLog(req, 'firewall.allow', 'rule', `${port}${proto ? '/' + proto : ''}`, { from: from || 'any', tool });
    res.json({ success: true, output });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Regel verweigern ─────────────────────────────────────────────────────────
router.post('/deny', requirePermission('firewall.manage'), async (req, res) => {
  const { port, proto } = req.body;
  if (!port) return res.status(400).json({ error: 'Port erforderlich' });
  try {
    const { adapter, tool } = await getLocalAdapter();
    const output = await adapter.deny(String(port), proto);
    auditLog(req, 'firewall.deny', 'rule', `${port}${proto ? '/' + proto : ''}`, { tool });
    res.json({ success: true, output });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Regel löschen ────────────────────────────────────────────────────────────
router.delete('/rules/:id', requirePermission('firewall.manage'), async (req, res) => {
  const id = req.params.id;
  try {
    const { adapter, tool } = await getLocalAdapter();
    const output = await adapter.deleteRule(id);
    auditLog(req, 'firewall.delete', 'rule', `Regel ${id}`, { tool });
    res.json({ success: true, output });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
