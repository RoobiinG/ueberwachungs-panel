const tls = require('tls');
const db = require('../db');
const { sendWebhook } = require('./sendWebhook');

function checkDomain(domain, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      port: port || 443,
      host: domain,
      servername: domain, // SNI
      rejectUnauthorized: false, // Wir wollen das Zertifikat auch lesen, wenn es ungültig ist
      timeout: 10000
    }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) {
        socket.destroy();
        return reject(new Error('Kein Zertifikat gefunden'));
      }
      
      const validTo = new Date(cert.valid_to);
      const issuer = cert.issuer ? (cert.issuer.O || cert.issuer.CN || 'Unknown') : 'Unknown';
      socket.destroy();
      resolve({ validTo, issuer });
    });

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Timeout nach 10 Sekunden'));
    });
  });
}

async function checkAllMonitors() {
  const monitors = db.prepare("SELECT * FROM ssl_monitors WHERE active = 1").all();
  if (monitors.length === 0) return;

  // Hole System-Webhooks
  const systemWebhooks = db.prepare("SELECT * FROM webhooks WHERE type = 'system' AND enabled = 1").all();

  for (const monitor of monitors) {
    try {
      const result = await checkDomain(monitor.domain, monitor.port);
      const now = new Date();
      const diffMs = result.validTo.getTime() - now.getTime();
      const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      let status = 'ok';
      if (daysRemaining <= 0) status = 'expired';
      else if (daysRemaining <= 7) status = 'critical';
      else if (daysRemaining <= 30) status = 'warning';

      db.prepare(`
        UPDATE ssl_monitors 
        SET last_check = CURRENT_TIMESTAMP, 
            valid_to = ?, 
            issuer = ?, 
            days_remaining = ?, 
            status = ?, 
            error_msg = NULL 
        WHERE id = ?
      `).run(result.validTo.toISOString(), result.issuer, daysRemaining, status, monitor.id);

      // Webhook-Prüfung
      let triggerWebhook = false;
      let thresholdName = '';
      
      const setNotified = (col) => db.prepare(`UPDATE ssl_monitors SET ${col} = 1 WHERE id = ?`).run(monitor.id);

      if (daysRemaining <= 3 && !monitor.notify_3) {
        triggerWebhook = true; thresholdName = '3 Tage'; setNotified('notify_3');
      } else if (daysRemaining <= 7 && !monitor.notify_7) {
        triggerWebhook = true; thresholdName = '7 Tage'; setNotified('notify_7');
      } else if (daysRemaining <= 14 && !monitor.notify_14) {
        triggerWebhook = true; thresholdName = '14 Tage'; setNotified('notify_14');
      } else if (daysRemaining <= 30 && !monitor.notify_30) {
        triggerWebhook = true; thresholdName = '30 Tage'; setNotified('notify_30');
      }

      // Reset Notify Flags, falls das Zertifikat erneuert wurde
      if (daysRemaining > 30 && (monitor.notify_3 || monitor.notify_7 || monitor.notify_14 || monitor.notify_30)) {
        db.prepare(`
          UPDATE ssl_monitors 
          SET notify_3 = 0, notify_7 = 0, notify_14 = 0, notify_30 = 0 
          WHERE id = ?
        `).run(monitor.id);
      }

      if (triggerWebhook && systemWebhooks.length > 0) {
        const msg = \`🔒 **SSL-Zertifikat läuft ab!**\\n\\n**Domain:** \${monitor.name ? monitor.name + ' (' + monitor.domain + ')' : monitor.domain}\\n**Ablaufdatum:** \${result.validTo.toISOString().split('T')[0]}\\n**Noch gültig:** \${daysRemaining} Tage\\n\\nBitte rechtzeitig erneuern!\`;
        for (const w of systemWebhooks) {
          try {
            await sendWebhook({ type: w.type, url: w.url, method: w.method, headers: w.headers, template: w.template }, msg, { alertType: 'system' });
          } catch (e) {
            console.error('[SSL] Webhook-Fehler:', e.message);
          }
        }
      }
    } catch (err) {
      db.prepare(`
        UPDATE ssl_monitors 
        SET last_check = CURRENT_TIMESTAMP, 
            status = 'error', 
            error_msg = ? 
        WHERE id = ?
      `).run(err.message, monitor.id);
    }
  }
}

let intervalTimer = null;

function startMonitor() {
  if (intervalTimer) clearInterval(intervalTimer);
  // Alle 12 Stunden (1000 * 60 * 60 * 12)
  intervalTimer = setInterval(checkAllMonitors, 43200000);
  // Start 15 Sekunden nach App-Start
  setTimeout(checkAllMonitors, 15000);
  console.log('[SSL] Zertifikats-Wächter gestartet (12h Intervall)');
}

module.exports = {
  checkDomain,
  checkAllMonitors,
  startMonitor
};
