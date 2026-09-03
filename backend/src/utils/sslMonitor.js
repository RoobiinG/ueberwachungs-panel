const tls = require('tls');
const db = require('../db');
const { sendWebhook } = require('./sendWebhook');
const { fetchCertificates } = require('./npmApi');

async function checkWebhooksAndNotify(monitorId, monitorRecord, domain, name, validTo, daysRemaining, systemWebhooks) {
  let triggerWebhook = false;
  const setNotified = (col) => db.prepare(`UPDATE ssl_monitors SET ${col} = 1 WHERE id = ?`).run(monitorId);

  if (daysRemaining <= 3 && !monitorRecord.notify_3) {
    triggerWebhook = true; setNotified('notify_3');
  } else if (daysRemaining <= 7 && !monitorRecord.notify_7) {
    triggerWebhook = true; setNotified('notify_7');
  } else if (daysRemaining <= 14 && !monitorRecord.notify_14) {
    triggerWebhook = true; setNotified('notify_14');
  } else if (daysRemaining <= 30 && !monitorRecord.notify_30) {
    triggerWebhook = true; setNotified('notify_30');
  }

  if (daysRemaining > 30 && (monitorRecord.notify_3 || monitorRecord.notify_7 || monitorRecord.notify_14 || monitorRecord.notify_30)) {
    db.prepare(`UPDATE ssl_monitors SET notify_3 = 0, notify_7 = 0, notify_14 = 0, notify_30 = 0 WHERE id = ?`).run(monitorId);
  }

  if (triggerWebhook && systemWebhooks.length > 0) {
    const displayName = name ? `${name} (${domain})` : domain;
    const msg = `🔒 **SSL-Zertifikat läuft ab!**\n\n**Domain:** ${displayName}\n**Ablaufdatum:** ${validTo.toISOString().split('T')[0]}\n**Noch gültig:** ${daysRemaining} Tage\n\nBitte rechtzeitig erneuern!`;
    for (const w of systemWebhooks) {
      try {
        await sendWebhook({ type: w.type, url: w.url, method: w.method, headers: w.headers, template: w.template }, msg, { alertType: 'system' });
      } catch (e) {
        console.error('[SSL] Webhook-Fehler:', e.message);
      }
    }
  }
}

async function syncNpmCertificates(systemWebhooks) {
  try {
    const certs = await fetchCertificates();
    if (!certs || !Array.isArray(certs)) return;

    const existingNpmIds = [];

    for (const cert of certs) {
      if (!cert.expires_on) continue;
      
      const validTo = new Date(cert.expires_on);
      const diffMs = validTo.getTime() - new Date().getTime();
      const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      let status = 'ok';
      if (daysRemaining <= 0) status = 'expired';
      else if (daysRemaining <= 7) status = 'critical';
      else if (daysRemaining <= 30) status = 'warning';

      const domainNames = Array.isArray(cert.domain_names) ? cert.domain_names.join(', ') : (cert.nice_name || 'NPM Cert');
      const name = cert.nice_name || domainNames;
      existingNpmIds.push(cert.id);

      const existing = db.prepare("SELECT * FROM ssl_monitors WHERE npm_id = ? AND source = 'npm'").get(cert.id);
      
      if (existing) {
        db.prepare(`
          UPDATE ssl_monitors 
          SET last_check = CURRENT_TIMESTAMP, valid_to = ?, issuer = ?, days_remaining = ?, status = ?, domain = ?, name = ?, error_msg = NULL 
          WHERE id = ?
        `).run(validTo.toISOString(), cert.provider || 'NPM', daysRemaining, status, domainNames, name, existing.id);
        
        await checkWebhooksAndNotify(existing.id, existing, domainNames, name, validTo, daysRemaining, systemWebhooks);
      } else {
        const info = db.prepare(`
          INSERT INTO ssl_monitors (source, npm_id, domain, name, valid_to, issuer, days_remaining, status, last_check)
          VALUES ('npm', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(cert.id, domainNames, name, validTo.toISOString(), cert.provider || 'NPM', daysRemaining, status);
        
        await checkWebhooksAndNotify(info.lastInsertRowid, { notify_3: 0, notify_7: 0, notify_14: 0, notify_30: 0 }, domainNames, name, validTo, daysRemaining, systemWebhooks);
      }
    }

    if (existingNpmIds.length > 0) {
      const placeholders = existingNpmIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM ssl_monitors WHERE source = 'npm' AND npm_id NOT IN (${placeholders})`).run(...existingNpmIds);
    } else {
      db.prepare(`DELETE FROM ssl_monitors WHERE source = 'npm'`).run();
    }
  } catch (err) {
    console.error('[SSL] Fehler bei NPM-Synchronisation:', err.message);
  }
}

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
  const systemWebhooks = db.prepare("SELECT * FROM webhooks WHERE type = 'system' AND enabled = 1").all();

  // 1. Zuerst NPM synchronisieren
  await syncNpmCertificates(systemWebhooks);

  // 2. Dann manuelle Monitore überprüfen
  const monitors = db.prepare("SELECT * FROM ssl_monitors WHERE active = 1 AND source = 'manual'").all();
  if (monitors.length === 0) return;

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
      await checkWebhooksAndNotify(monitor.id, monitor, monitor.domain, monitor.name, result.validTo, daysRemaining, systemWebhooks);
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
