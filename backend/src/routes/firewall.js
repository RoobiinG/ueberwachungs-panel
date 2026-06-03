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
    const allRules = adapter ? await adapter.getRules().catch(() => []) : [];

    // Max. 40 Regeln senden um Token-Quota zu schonen
    const MAX_RULES = 40;
    const rules = allRules.slice(0, MAX_RULES);
    const truncated = allRules.length > MAX_RULES;

    const rulesText = rules.length === 0
      ? 'Keine Regeln vorhanden.'
      : rules.map(r => `- Port ${r.port}${r.proto !== 'any' ? '/' + r.proto : ''}: ${r.action === 'allow' ? 'ERLAUBT' : 'GESPERRT'} von ${r.from || 'any'}`).join('\n')
        + (truncated ? `\n(... und ${allRules.length - MAX_RULES} weitere Regeln)` : '');

    const prompt = `Du bist ein Firewall-Sicherheitsexperte. Analysiere diese Firewall und gib 3-5 kurze Sicherheitstipps auf Deutsch.

Firewall-Tool: ${tool} | Status: ${active ? 'AKTIV' : 'INAKTIV'} | Regeln gesamt: ${allRules.length}
${rulesText}

Regeln für die Antwort:
- Max. 2 Sätze pro Tipp
- Kein Fachjargon, einfache Sprache
- Nummerierte Liste (1. Tipp...)
- Gefährliche offene Ports oder fehlende Regeln hervorheben`;

    const FALLBACK = 'gemini-2.0-flash';
    const callGemini = async (model) => {
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
      const { data } = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
      }, { timeout: 20000 });
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    };

    const preferredModel = getSetting('gemini_model') || FALLBACK;
    let text = '';
    let usedModel = preferredModel;

    try {
      text = await callGemini(preferredModel);
    } catch (firstErr) {
      const raw = firstErr.response?.data?.error?.message || firstErr.message || '';
      const shouldFallback = raw.toLowerCase().includes('quota')
        || raw.toLowerCase().includes('rate')
        || raw.toLowerCase().includes('not found')
        || raw.toLowerCase().includes('not supported')
        || firstErr.response?.status === 429;
      if (shouldFallback && preferredModel !== FALLBACK) {
        // Automatisch auf Flash zurückfallen
        text = await callGemini(FALLBACK);
        usedModel = FALLBACK;
      } else {
        throw firstErr;
      }
    }

    if (!text) return res.status(502).json({ error: 'Leere Antwort von Gemini erhalten.' });
    res.json({ tips: text, tool, active, rulesCount: rules.length, model: usedModel, fallback: usedModel !== preferredModel });
  } catch (err) {
    const raw = err.response?.data?.error?.message || err.message || '';
    const isQuota = raw.toLowerCase().includes('quota') || raw.toLowerCase().includes('rate') || err.response?.status === 429;
    const isModel = raw.toLowerCase().includes('not found') || raw.toLowerCase().includes('not supported');
    const msg = isQuota
      ? `Kontingent erschöpft für alle Modelle. Bitte warte kurz oder prüfe dein Google AI Studio Konto.`
      : isModel
      ? `Modell nicht verfügbar. Bitte prüfe dein Gemini-Modell in den Einstellungen.`
      : raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
    res.status(isQuota ? 429 : 500).json({ error: msg });
  }
});

module.exports = router;
