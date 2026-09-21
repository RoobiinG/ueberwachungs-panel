const router = require('express').Router();
const db = require('../db');
const diagnostics = require('../utils/diagnostics');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');

// Der Report macht Live-TCP/TLS-Probes gegen jeden registrierten Agent plus einen
// DB-Check — kein Endpunkt, den man im Sekundentakt klicken soll. Einfache
// In-Memory-Bremse pro Nutzer, gleicher Stil wie das last_used-Throttling in
// middleware/auth.js.
const COOLDOWN_MS = 15_000;
const letzterAbruf = new Map(); // userId → Zeitstempel

router.get('/', requirePermission('settings.manage'), async (req, res) => {
  const userId = req.user.id;
  const zuletzt = letzterAbruf.get(userId) || 0;
  const wartezeit = COOLDOWN_MS - (Date.now() - zuletzt);
  if (wartezeit > 0) {
    return res.status(429).json({ error: `Bitte ${Math.ceil(wartezeit / 1000)}s warten, bevor ein neuer Bericht erstellt wird.` });
  }
  letzterAbruf.set(userId, Date.now());

  const smtpTest = String(req.query.smtpTest || '') === '1';
  const adminEmail = smtpTest ? db.prepare('SELECT email FROM users WHERE id = ?').get(userId)?.email : null;

  try {
    const bericht = await diagnostics.erstellen({
      logs: req.query.logs,
      smtpTest,
      smtpTestTo: req.query.smtpTestTo || adminEmail,
    });
    auditLog(req, 'diagnose.generate', 'system', 'diagnose', { smtpTest });
    res.json({ bericht, text: diagnostics.alsText(bericht) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
