const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/requirePermission');
const { generateAndSendReport } = require('../utils/reportGenerator');
const db = require('../db');

// Manuelles Auslösen eines Test-Berichts (nur für Admins oder User mit Settings-Rechten)
router.post('/trigger', requirePermission('settings.view'), async (req, res) => {
  try {
    const email = db.prepare("SELECT value FROM settings WHERE key = 'report_email'").get()?.value;
    if (!email) {
      return res.status(400).json({ error: 'Es ist keine Empfänger-E-Mail in den Einstellungen hinterlegt.' });
    }

    await generateAndSendReport(email);
    res.json({ message: `Test-Bericht erfolgreich an ${email} versendet.` });
  } catch (err) {
    console.error('[Reports] Fehler beim Generieren des Berichts:', err.message);
    res.status(500).json({ error: 'Fehler beim Versenden des Berichts: ' + err.message });
  }
});

module.exports = router;
