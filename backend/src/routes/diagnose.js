const router = require('express').Router();
const crypto = require('crypto');
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

// POST /api/diagnose/share — Erstellt einen 7 Tage gültigen Freigabelink
router.post('/share', requirePermission('settings.manage'), (req, res) => {
  const { bericht } = req.body;
  if (!bericht || typeof bericht !== 'object') {
    return res.status(400).json({ error: 'Bericht-Objekt erforderlich' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

  try {
    db.prepare(`
      INSERT INTO diagnose_shares (token, data, expires_at)
      VALUES (?, ?, ?)
    `).run(token, JSON.stringify(bericht), expiresAt);

    auditLog(req, 'diagnose.share.create', 'system', token, { expiresAt });
    res.json({ token, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
