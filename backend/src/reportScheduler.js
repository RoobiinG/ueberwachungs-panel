const db = require('./db');
const { generateAndSendReport } = require('./utils/reportGenerator');
const { makeStatusTracker } = require('./utils/workerStatus');
const _status = makeStatusTracker();

let intervalId = null;

function checkAndSendReport() {
  try {
    const enabled = db.prepare("SELECT value FROM settings WHERE key = 'report_weekly_enabled'").get()?.value === 'true';
    if (!enabled) return;

    const email = db.prepare("SELECT value FROM settings WHERE key = 'report_email'").get()?.value;
    if (!email) return;

    const now = new Date();
    // Monday = 1, hour = 8, minute = 0
    if (now.getDay() === 1 && now.getHours() === 8 && now.getMinutes() === 0) {
      // Prevent double sending within the same minute
      const lastSentStr = db.prepare("SELECT value FROM settings WHERE key = 'report_last_sent'").get()?.value || '0';
      const lastSent = parseInt(lastSentStr, 10);
      
      // If we haven't sent it in the last hour
      if (Date.now() - lastSent > 60 * 60 * 1000) {
        console.log(`[ReportScheduler] Generiere und versende wöchentlichen Bericht an ${email}...`);
        
        generateAndSendReport(email).then(() => {
          console.log('[ReportScheduler] Bericht erfolgreich versendet.');
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('report_last_sent', ?)").run(Date.now().toString());
        }).catch(err => {
          console.error('[ReportScheduler] Fehler beim Versenden des Berichts:', err.message);
        });
      }
    }
  } catch (err) {
    console.error('[ReportScheduler] Fehler beim Überprüfen des Zeitplans:', err.message);
  }
}

function start() {
  if (intervalId) return;
  // Check every minute
  intervalId = setInterval(() => _status.wrap(checkAndSendReport), 60_000);
  console.log('Report-Scheduler gestartet (prüft minütlich).');
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  start,
  stop,
  getStatus: _status.get,
};
