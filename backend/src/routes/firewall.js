const router = require('express').Router();
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const axios = require('axios');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const { detectFirewall, getAdapter } = require('../utils/firewallAdapters');
const db = require('../db');

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value || '';

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
      : await adapter.deny(String(port), proto);
    auditLog(req, 'firewall.edit', 'rule', `Regel ${id} → ${port}/${proto}`, { tool, action });
    res.json({ success: true, output });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── KI-Analyse (Gemini) ──────────────────────────────────────────────────────
router.post('/ai-tips', requirePermission('firewall.view'), async (req, res) => {
  const apiKey = getSetting('gemini_api_key');
  if (!apiKey) return res.status(400).json({ error: 'Kein Gemini API-Key hinterlegt. Bitte unter Einstellungen → KI konfigurieren.' });

  try {
    const { tool, active } = await detectFirewall(host).catch(() => ({ tool: 'unbekannt', active: false }));
    const adapter = getAdapter(tool, host);
    const rules   = adapter ? await adapter.getRules().catch(() => []) : [];

    const rulesText = rules.length === 0
      ? 'Keine Regeln vorhanden.'
      : rules.map(r => `- Port ${r.port}${r.proto !== 'any' ? '/' + r.proto : ''}: ${r.action === 'allow' ? 'ERLAUBT' : 'GESPERRT'} von ${r.from || 'any'}`).join('\n');

    const prompt = `Du bist ein Firewall-Sicherheitsexperte. Analysiere die folgende Firewall-Konfiguration und gib genau 3-5 kurze, einfache Sicherheitstipps auf Deutsch.

Regeln:
- Jeder Tipp max. 2 Sätze
- Konkret und verständlich, kein Fachjargon
- Formatiere als nummerierte Liste (1. Tipp...)
- Hebe gefährliche offene Ports oder fehlende Regeln hervor

Firewall-Tool: ${tool}
Status: ${active ? 'aktiv' : 'inaktiv'}
Aktuelle Regeln:
${rulesText}`;

    const model   = getSetting('gemini_model') || 'gemini-1.5-pro';
    const url     = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const { data } = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
    }, { timeout: 20000 });

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return res.status(502).json({ error: 'Leere Antwort von Gemini erhalten.' });

    res.json({ tips: text, tool, active, rulesCount: rules.length });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: `Gemini-Fehler: ${msg}` });
  }
});

module.exports = router;
