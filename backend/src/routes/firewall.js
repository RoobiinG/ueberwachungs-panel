const router = require('express').Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const axios = require('axios');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const { detectFirewall, getAdapter, filterZustand } = require('../utils/firewallAdapters');
const { zugangGesichert, warnung } = require('../utils/firewallSchutz');
const db = require('../db');

// Der Port, über den das Panel selbst erreichbar ist — er muss offen bleiben, sonst
// sperrt das Einschalten der Firewall die Oberfläche aus, von der aus man es zurücknehmen
// könnte.
const PANEL_PORT = parseInt(process.env.PORT, 10) || 3001;

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value || '';

// nsenter: Führt Befehle im Host-Namespace aus (nötig wenn Panel in Docker läuft)
const host = (cmd) => execAsync(`nsenter --target 1 --mount --uts --ipc --net --pid -- ${cmd}`, { timeout: 10000 });

// Eingabefehler sind 400, nicht 500 — sonst sieht ein Tippfehler im Port aus wie ein
// Serverfehler, und das Frontend kann beides nicht auseinanderhalten.
const isInputError = (msg = '') => /ungültig|quell-adresse|nicht unterstützt|erforderlich/i.test(msg);
const fail = (res, err) => res.status(isInputError(err.message) ? 400 : 500).json({ error: err.message });

// ─── Firewall erkennen ─────────────────────────────────────────────────────────
router.get('/detect', requirePermission('firewall.view'), async (req, res) => {
  try {
    const result = await detectFirewall(host);
    // `active` sagt nur, dass ein Werkzeug da ist. Ob eingehender Verkehr wirklich
    // eingeschränkt wird, ist eine andere Frage — und die interessiert den Benutzer.
    const zustand = result.tool !== 'none'
      ? await filterZustand(result.tool, host, result.rawOutput)
      : { filtert: false, grund: 'Kein Firewall-Werkzeug gefunden.' };
    res.json({ ...result, ...zustand });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Adapter holen (cached pro Request) ───────────────────────────────────────
async function getLocalAdapter() {
  const { tool } = await detectFirewall(host);
  const adapter  = getAdapter(tool, host);
  if (!adapter) throw new Error('Kein unterstütztes Firewall-Tool gefunden (UFW, iptables, nftables oder firewalld)');
  return { adapter, tool };
}

// ─── An- / Ausschalten ────────────────────────────────────────────────────────
router.post('/toggle', requirePermission('firewall.manage'), async (req, res) => {
  const { enable } = req.body; // true = einschalten, false = ausschalten
  if (typeof enable !== 'boolean') return res.status(400).json({ error: 'enable (bool) erforderlich' });
  try {
    const { tool } = await detectFirewall(host);
    // Bei "ausschalten" auch inaktive Tools ansprechen → Tool-Name muss übergeben werden
    const targetTool = tool !== 'none' ? tool : req.body.tool;
    const adapter = getAdapter(targetTool, host);
    if (!adapter) throw new Error('Kein unterstütztes Firewall-Tool gefunden');

    // Vor dem Einschalten prüfen, ob danach überhaupt noch jemand hereinkommt.
    // Ohne diese Bremse macht ein einzelner Klick den Server unerreichbar — siehe
    // utils/firewallSchutz.js. Ausschalten ist davon nicht betroffen.
    if (enable && req.body?.trotzdem !== true) {
      let regeln = [];
      try { regeln = await adapter.getRules(); } catch { regeln = []; }
      const { sicher, fehlend } = zugangGesichert(regeln, [PANEL_PORT]);
      if (!sicher) {
        return res.status(409).json({ error: warnung(fehlend), fehlendePorts: fehlend, bestaetigungNoetig: true });
      }
    }

    const output = enable ? await adapter.enable() : await adapter.disable();
    auditLog(req, enable ? 'firewall.enable' : 'firewall.disable', 'firewall', targetTool);
    res.json({ success: true, output });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
  } catch (err) { fail(res, err); }
});

// ─── Regel verweigern ─────────────────────────────────────────────────────────
// `from` wurde hier früher nicht weitergereicht: Eine Sperre für eine einzelne
// Adresse wurde damit zur Sperre für alle.
router.post('/deny', requirePermission('firewall.manage'), async (req, res) => {
  const { port, proto, from } = req.body;
  if (!port) return res.status(400).json({ error: 'Port erforderlich' });
  try {
    const { adapter, tool } = await getLocalAdapter();
    const output = await adapter.deny(String(port), proto, from);
    auditLog(req, 'firewall.deny', 'rule', `${port}${proto ? '/' + proto : ''}`, { from: from || 'any', tool });
    res.json({ success: true, output });
  } catch (err) { fail(res, err); }
});

// ─── Regel löschen ────────────────────────────────────────────────────────────
router.delete('/rules/:id', requirePermission('firewall.manage'), async (req, res) => {
  const id = req.params.id;
  try {
    const { adapter, tool } = await getLocalAdapter();
    const output = await adapter.deleteRule(id);
    auditLog(req, 'firewall.delete', 'rule', `Regel ${id}`, { tool });
    res.json({ success: true, output });
  } catch (err) { fail(res, err); }
});

// ─── Regel bearbeiten (löschen + neu anlegen) ─────────────────────────────────
router.put('/rules/:id', requirePermission('firewall.manage'), async (req, res) => {
  const id = req.params.id;
  const { port, proto, from, action } = req.body;
  if (!port || !action) return res.status(400).json({ error: 'Port und Aktion erforderlich' });
  try {
    const { adapter, tool } = await getLocalAdapter();
    await adapter.deleteRule(id);
    const output = action === 'allow'
      ? await adapter.allow(String(port), proto, from)
      : await adapter.deny(String(port), proto, from);
    auditLog(req, 'firewall.edit', 'rule', `Regel ${id} → ${port}/${proto}`, { tool, action, from: from || 'any' });
    res.json({ success: true, output });
  } catch (err) { fail(res, err); }
});

module.exports = router;

