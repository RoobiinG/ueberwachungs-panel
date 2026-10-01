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
const autoSperre = require('../utils/autoSperre');
const { canAccessAgent } = require('../utils/agentAccess');
const { anfrageIp, whitelistTreffer } = require('../utils/sperren');

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

// ── Automatische Sperre (Threat-Feed + fail2ban-Eskalation) ──────────────────
// Lesen: security.view. Ändern: fail2ban.ban — die Auto-Sperre setzt Dauersperren
// in deinem Namen, also dasselbe Recht wie das Sperren von Hand.
router.get('/auto-sperre', requirePermission('security.view'), (req, res) => {
  const s = autoSperre.getStatus();
  const ip = anfrageIp(req);
  const sichtbar = (x) => canAccessAgent(x.agentId, req.user?.role);
  res.json({
    einstellungen: s.einstellungen,
    verteilung: threatIntel.ipsumVerteilung(),
    ipsumStand: threatIntel.ipsumStand(),
    server: s.server.filter(sichtbar).map(x => ({ agentId: x.agentId, name: x.name, feed: x.feed, eskalation: x.eskalation })),
    letzteEskalationen: s.letzteEskalationen.filter(sichtbar),
    abgleich: { laeuft: s.running, lastRunAt: s.lastRunAt, lastError: s.lastError },
    deineIp: ip ? { ip, blocklisten: threatIntel.blocklisten(ip), aufWhitelist: !!whitelistTreffer(ip) } : null,
    agentAb: autoSperre.AGENT_AB,
  });
});

router.put('/auto-sperre', requirePermission('fail2ban.ban'), (req, res) => {
  const b = req.body || {};
  const schwelle = (v) => (Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);
  if (typeof b.feed !== 'boolean' || typeof b.eskalation !== 'boolean') {
    return res.status(400).json({ error: 'feed und eskalation müssen true oder false sein' });
  }
  const neu = {
    feed: b.feed, feedSchwelle: schwelle(b.feedSchwelle),
    eskalation: b.eskalation, eskalationSchwelle: schwelle(b.eskalationSchwelle),
  };
  if (!neu.feedSchwelle || !neu.eskalationSchwelle) return res.status(400).json({ error: 'Schwellen müssen zwischen 1 und 10 liegen' });

  // Wer den Feed einschaltet, soll sich nicht selbst aussperren.
  const ip = anfrageIp(req);
  const listen = ip ? threatIntel.blocklisten(ip) : 0;
  if (neu.feed && b.trotzdem !== true && listen >= neu.feedSchwelle && !whitelistTreffer(ip)) {
    return res.status(409).json({
      error: `Deine aktuelle Adresse ${ip} steht auf ${listen} Blocklisten und würde gesperrt. Trage sie vorher in die Whitelist ein.`,
      bestaetigungNoetig: true,
    });
  }
  const vorher = autoSperre.einstellungen();
  autoSperre.einstellungenSpeichern(neu);
  auditLog(req, 'security.auto_sperre', 'auto_sperre', null, { vorher, nachher: neu });
  autoSperre.anstossen();
  if (neu.eskalation && !vorher.eskalation) autoSperre.eskalierenJetzt();
  res.json({ success: true, einstellungen: neu });
});

module.exports = router;
