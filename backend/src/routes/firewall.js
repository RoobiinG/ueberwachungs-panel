const router = require('express').Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');

const host = (cmd) => execAsync(`nsenter --target 1 --mount --uts --ipc --net --pid -- ${cmd}`);

const validPort = (p) => { if (!/^\d{1,5}$/.test(p) || +p < 1 || +p > 65535) throw new Error('Ungültiger Port'); return p; };
const validProto = (p) => { if (p && !['tcp', 'udp'].includes(p)) throw new Error('Ungültiges Protokoll'); return p; };
// Erlaubt: IPv4 (1.2.3.4), IPv4-CIDR (1.2.3.4/24), IPv6, IPv6-CIDR — kein Shell-Sonderzeichen
const IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IPV6_RE   = /^[0-9a-fA-F:]+(%[a-z0-9]+)?(\/\d{1,3})?$/;
const validFrom = (f) => {
  if (!f) return f;
  if (!IPV4_RE.test(f) && !IPV6_RE.test(f)) throw new Error('Ungültige IP/CIDR');
  return f;
};

router.get('/status', requirePermission('firewall.view'), async (req, res) => {
  try {
    const { stdout } = await host('ufw status verbose');
    res.json({ status: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rules', requirePermission('firewall.view'), async (req, res) => {
  try {
    const { stdout } = await host('ufw status numbered');
    const rules = stdout.split('\n').filter(l => l.match(/^\[\s*\d+\]/)).map(line => {
      const match = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/);
      if (!match) return { raw: line.trim() };
      return { num: match[1].trim(), to: match[2].trim(), action: match[3].trim(), from: match[4].trim() };
    });
    res.json(rules);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/allow', requirePermission('firewall.manage'), async (req, res) => {
  const { port, proto, from } = req.body;
  if (!port) return res.status(400).json({ error: 'Port required' });
  try {
    const p = validPort(String(port)), pr = validProto(proto), fr = validFrom(from);
    const cmd = fr
      ? `ufw allow from ${fr} to any port ${p}${pr ? ' proto ' + pr : ''}`
      : `ufw allow ${p}${pr ? '/' + pr : ''}`;
    const { stdout } = await host(cmd);
    auditLog(req, 'firewall.allow', 'rule', `${p}${pr ? '/' + pr : ''}`, { from: fr || 'any' });
    res.json({ success: true, output: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/deny', requirePermission('firewall.manage'), async (req, res) => {
  const { port, proto } = req.body;
  if (!port) return res.status(400).json({ error: 'Port required' });
  try {
    const p = validPort(String(port)), pr = validProto(proto);
    const { stdout } = await host(`ufw deny ${p}${pr ? '/' + pr : ''}`);
    auditLog(req, 'firewall.deny', 'rule', `${p}${pr ? '/' + pr : ''}`);
    res.json({ success: true, output: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rules/:num', requirePermission('firewall.manage'), async (req, res) => {
  const num = req.params.num;
  if (!/^\d+$/.test(num)) return res.status(400).json({ error: 'Ungültige Regel-Nummer' });
  try {
    const { stdout } = await host(`sh -c 'echo y | ufw delete ${num}'`);
    auditLog(req, 'firewall.delete', 'rule', `Regel #${num}`);
    res.json({ success: true, output: stdout });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
