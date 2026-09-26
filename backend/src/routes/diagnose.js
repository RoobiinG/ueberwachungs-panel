const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const diagnostics = require('../utils/diagnostics');
const { requirePermission } = require('../middleware/requirePermission');
const { auditLog } = require('../utils/audit');

router.get('/', requirePermission('diagnose.run'), async (req, res) => {
  const smtpTest = String(req.query.smtpTest || '') === '1';
  // Die Testmail geht nur an die eigene hinterlegte Adresse — früher ließ sich über
  // ?smtpTestTo= jeder beliebige Empfänger über das Panel-SMTP anschreiben.
  const eigeneEmail = smtpTest ? db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id)?.email : null;

  try {
    const bericht = await diagnostics.erstellen({
      logs: req.query.logs,
      smtpTest: smtpTest && !!eigeneEmail,
      smtpTestTo: eigeneEmail,
    });
    auditLog(req, 'diagnose.generate', 'system', 'diagnose', { smtpTest });
    res.json({ bericht, text: diagnostics.alsText(bericht) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/diagnose/share — Erstellt einen 7 Tage gültigen Freigabelink.
// Der Bericht wird hier neu erzeugt, statt den vom Browser geschickten zu speichern:
// Sonst ließe sich die serverseitige Schwärzung der Secrets umgehen und beliebiger
// Inhalt unter der Panel-Adresse veröffentlichen.
router.post('/share', requirePermission('diagnose.run'), async (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

  try {
    const bericht = await diagnostics.erstellen({ logs: req.body?.logs, smtpTest: false });
    db.prepare(`
      INSERT INTO diagnose_shares (token, data, expires_at)
      VALUES (?, ?, ?)
    `).run(token, JSON.stringify(bericht), expiresAt);

    auditLog(req, 'diagnose.share.create', 'system', token.slice(0, 8) + '…', { expiresAt });
    res.json({ token, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
