const router = require('express').Router();
const axios  = require('axios');
const db     = require('../db');

const getSetting = (key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;

const setSetting = (key, val) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, val);

// GET /api/uptime-kuma/config
router.get('/config', (req, res) => {
  res.json({
    url:  getSetting('uptimeKumaUrl')  || '',
    slug: getSetting('uptimeKumaSlug') || 'default',
  });
});

// POST /api/uptime-kuma/config
router.post('/config', (req, res) => {
  const { url, slug } = req.body;
  if (url  !== undefined) setSetting('uptimeKumaUrl',  url.trim());
  if (slug !== undefined) setSetting('uptimeKumaSlug', slug?.trim() || 'default');
  res.json({ ok: true });
});

// GET /api/uptime-kuma/monitors
// Liest die öffentliche Status-Seite der konfigurierten Uptime-Kuma-Instanz
router.get('/monitors', async (req, res) => {
  const url  = getSetting('uptimeKumaUrl');
  const slug = getSetting('uptimeKumaSlug') || 'default';

  if (!url)
    return res.status(400).json({ error: 'Uptime Kuma URL nicht konfiguriert.' });

  try {
    const { data } = await axios.get(
      `${url.replace(/\/+$/, '')}/api/status-page/${encodeURIComponent(slug)}`,
      { timeout: 10000 }
    );

    const monitors = [];
    for (const group of data.publicGroupList || []) {
      for (const m of group.monitorList || []) {
        const hb = m.heartbeatList?.at(-1);
        monitors.push({
          id:        m.id,
          name:      m.name,
          type:      m.type,
          group:     group.name,
          status:    hb?.status  ?? 3,
          ping:      hb?.ping    ?? null,
          msg:       hb?.msg     ?? '',
          // Zeit als ISO-String normalisieren damit der Browser sie sicher parsen kann
          lastCheck: hb?.time    ? new Date(hb.time.replace(' ', 'T')).toISOString() : null,
          uptime24h: m.uptimeList?.['24']  ?? null,
          uptime30d: m.uptimeList?.['720'] ?? null,
        });
      }
    }

    res.json({ monitors, incident: data.incident ?? null });
  } catch (err) {
    if (err.response?.status === 404)
      return res.status(404).json({
        error: `Status-Seite "${slug}" nicht gefunden — Slug in Uptime Kuma unter Einstellungen → Status-Seiten prüfen.`,
      });
    res.status(502).json({ error: `Verbindung fehlgeschlagen: ${err.message}` });
  }
});

module.exports = router;
