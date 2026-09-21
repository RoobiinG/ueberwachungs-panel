// ─── Pelican Panel — Einstellungen & Namensauflösung ─────────────────────────
// GET  /api/pelican/config   → URL + ob ein Schlüssel hinterlegt ist
// POST /api/pelican/config   → URL und Schlüssel speichern
// POST /api/pelican/test     → Verbindung prüfen, Anzahl gefundener Server melden
// GET  /api/pelican/servers  → Zuordnung { uuid → Klarname } für die Docker-Seite
//
// Aufbau bewusst wie bei PatchMon und Uptime Kuma.

const router  = require('express').Router();
const db      = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const pelican = require('../utils/pelicanClient');
const { validatePublicUrl } = require('../utils/validateUrl');

const setSetting = (k, v) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);

router.get('/config', requirePermission('settings.view'), (req, res) => {
  const { url, token } = pelican.konfiguration();
  res.json({ url, hasToken: !!token });
});

router.post('/config', requirePermission('settings.manage'), (req, res) => {
  const { url, token } = req.body || {};
  if (url) { try { validatePublicUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); } }
  if (url   !== undefined) setSetting('pelicanUrl',   String(url).trim().replace(/\/+$/, ''));
  // Leeres Feld bedeutet „unverändert lassen" — so muss der Schlüssel nicht jedes Mal
  // neu eingegeben werden, nur um die Adresse zu ändern.
  if (token !== undefined && String(token).trim()) setSetting('pelicanToken', String(token).trim());
  pelican.cacheLeeren();
  auditLog(req, 'settings.pelican', 'settings', 'pelican');
  res.json({ success: true });
});

router.delete('/config', requirePermission('settings.manage'), (req, res) => {
  setSetting('pelicanUrl', '');
  setSetting('pelicanToken', '');
  pelican.cacheLeeren();
  auditLog(req, 'settings.pelican_delete', 'settings', 'pelican');
  res.json({ success: true });
});

router.post('/test', requirePermission('settings.manage'), async (req, res) => {
  try {
    const server = await pelican.serverAbrufen();
    pelican.cacheLeeren();
    res.json({ success: true, server: server.length, beispiel: server.slice(0, 3).map(s => s.name) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Wer Container sehen darf, darf auch ihre Klarnamen sehen — wie bei den Spitznamen.
router.get('/servers', requirePermission('docker.view'), async (req, res) => {
  if (!pelican.konfiguration().fertig) return res.json({});
  try {
    res.json(await pelican.namensKarte(req.query.frisch === '1'));
  } catch (err) {
    // Die Docker-Seite soll auch ohne erreichbares Pelican vollständig funktionieren.
    res.json({});
  }
});

module.exports = router;
