// ─── Bedrohungsdaten (Security Center → Tab „Bedrohungsdaten") ────────────────
//
// Status der drei Stufen der IP-Prüfung und manueller Anstoß der Downloads.
// Lesen verlangt security.view, Aktualisieren das eigene Recht security.intel_update
// (zunächst nur Admin-Rollen). Pfade auf dem Server und der ipapi.is-Key gehen nie hinaus.

const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');
const threatIntel = require('../utils/threatIntel');
const ipIntel = require('../utils/ipIntel');

const router = express.Router();

router.get('/status', requirePermission('security.view'), (req, res) => {
  const e = ipIntel.getStatus();
  const cache = db.prepare("SELECT COUNT(*) AS n FROM ip_intel WHERE quelle = 'ipapi.is'").get().n;
  res.json({
    ...threatIntel.getStatus(),
    cache: { eintraege: cache, gueltigTage: 14 },
    extern: {
      eingerichtet:   e.eingerichtet,
      heuteAbgefragt: e.heuteAbgefragt,
      tagesBudget:    e.tagesBudget,
      warteschlange:  e.warteschlange,
      pausiertBis:    e.pausiertBis,
      fehler:         e.lastError || null,
    },
  });
});

// Läuft im Hintergrund (bis zu ~60 MB) — die Antwort kommt sofort mit 202, das Frontend
// fragt danach den Status ab. So läuft kein Reverse Proxy in einen Timeout.
router.post('/update', requirePermission('security.intel_update'), (req, res) => {
  const r = threatIntel.manuellStarten(req.user.username);
  if (r.deaktiviert) return res.status(409).json({ error: 'Downloads sind auf diesem Server abgeschaltet (THREAT_INTEL_DOWNLOADS=off)' });
  if (r.laeuft)      return res.status(409).json({ error: 'Eine Aktualisierung läuft bereits' });
  if (r.wartenSek)   return res.status(429).json({ error: `Gerade erst aktualisiert — bitte noch ${r.wartenSek} s warten` });
  auditLog(req, 'security.intel_update', 'threat_intel', 'Bedrohungsdaten');
  res.status(202).json({ success: true, message: 'Aktualisierung gestartet' });
});

module.exports = router;
