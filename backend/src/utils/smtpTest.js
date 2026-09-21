// SMTP-Testversand — aus routes/settings.js herausgelöst, damit der Diagnostik-Report
// (routes/diagnose.js) dieselbe Logik nutzen kann, ohne eine echte Mail zu verschicken.
const db = require('../db');

const get = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';

// Reine Konfigurationsauskunft, kein Netzwerkzugriff — sicher als Teil eines
// automatisch generierten Diagnostik-Reports.
function smtpConfigured() {
  const host = get('smtp_host');
  return {
    configured: !!host,
    host,
    port:   parseInt(get('smtp_port')) || 587,
    secure: get('smtp_secure') === 'true',
    user:   get('smtp_user') || null,
    from:   get('smtp_from') || get('smtp_user') || null,
  };
}

// Verschickt eine echte Testmail — nur auf ausdrücklichen Wunsch aufrufen
// (Settings-Button oder ?smtpTest=1 am Diagnose-Endpunkt).
async function sendTestMail(toEmail) {
  const smtpHost = get('smtp_host');
  if (!smtpHost) throw new Error('SMTP nicht konfiguriert');

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host:   smtpHost,
    port:   parseInt(get('smtp_port')) || 587,
    secure: get('smtp_secure') === 'true',
    auth:   get('smtp_user') ? { user: get('smtp_user'), pass: get('smtp_pass') } : undefined,
  });
  await transporter.sendMail({
    from:    get('smtp_from') || get('smtp_user'),
    to:      toEmail,
    subject: 'Test-E-Mail — Überwachungs-Panel',
    text:    'SMTP-Konfiguration erfolgreich!',
  });
}

module.exports = { smtpConfigured, sendTestMail };
