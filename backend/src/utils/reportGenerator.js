const db = require('../db');
const nodemailer = require('nodemailer');

const getSmtp = () => {
  return {
    host: db.prepare('SELECT value FROM settings WHERE key = ?').get('smtp_host')?.value || '',
    port: parseInt(db.prepare('SELECT value FROM settings WHERE key = ?').get('smtp_port')?.value || '587', 10),
    secure: db.prepare('SELECT value FROM settings WHERE key = ?').get('smtp_secure')?.value === 'true',
    user: db.prepare('SELECT value FROM settings WHERE key = ?').get('smtp_user')?.value || '',
    pass: db.prepare('SELECT value FROM settings WHERE key = ?').get('smtp_pass')?.value || '',
    from: db.prepare('SELECT value FROM settings WHERE key = ?').get('smtp_from')?.value || 'panel@localhost',
  };
};

async function generateAndSendReport(toEmail) {
  if (!toEmail) throw new Error('Keine Empfänger-E-Mail angegeben.');
  const smtp = getSmtp();
  if (!smtp.host) throw new Error('SMTP ist nicht konfiguriert.');

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  // Sammle Daten für die letzten 7 Tage. sevenDaysAgoMs für Anzeige (new Date() braucht
  // Millisekunden), sevenDaysAgoSec für die Metrik-Abfrage — metrics_1hour.ts steht in
  // Sekunden seit Epoch (siehe metricsAggregator.js), ein Vergleich in Millisekunden
  // hätte nie eine Zeile getroffen.
  const sevenDaysAgoMs  = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sevenDaysAgoSec = Math.floor(sevenDaysAgoMs / 1000);

  // 1. Hole alle Server
  const servers = db.prepare('SELECT id, name FROM remote_agents').all();

  // 2. Metriken und Alarme pro Server
  const stats = [];

  for (const s of servers) {
    // Durchschnittliche/Maximale CPU/RAM. server_id in metrics_1hour ist "agent:<id>"
    // (siehe remoteMetricsRecorder.js), nicht die reine Agent-ID — und die Spalte für
    // den Speicherwert heißt "mem", nicht "memory".
    const metrics = db.prepare(`
      SELECT
        AVG(cpu) as avg_cpu, MAX(cpu) as max_cpu,
        AVG(mem) as avg_mem, MAX(mem) as max_mem,
        COUNT(*) as count
      FROM metrics_1hour
      WHERE server_id = ? AND ts >= ?
    `).get(`agent:${s.id}`, sevenDaysAgoSec);

    // Alarme der letzten 7 Tage für diesen Server. alert_history kennt weder
    // resolved_at/created_at noch verweist alert_rules per agent_id auf einen Server —
    // der tatsächliche Bezug steht direkt in alert_history.server_key (siehe
    // alertEvaluator.js writeHistory(), srv.key = String(agent.id)).
    const incidentCount = db.prepare(`
      SELECT COUNT(*) as c
      FROM alert_history h
      WHERE h.type = 'fired' AND h.server_key = ? AND h.triggered_at >= datetime(?, 'unixepoch')
    `).get(s.id.toString(), sevenDaysAgoSec)?.c || 0;

    stats.push({
      name: s.name,
      avg_cpu: metrics.avg_cpu ? Math.round(metrics.avg_cpu) : 0,
      max_cpu: metrics.max_cpu ? Math.round(metrics.max_cpu) : 0,
      avg_mem: metrics.avg_mem ? Math.round(metrics.avg_mem) : 0,
      max_mem: metrics.max_mem ? Math.round(metrics.max_mem) : 0,
      incidents: incidentCount,
      // uptime vereinfacht: 7 Tage = 168 Stunden. 1 count in metrics_1hour = 1 Std.
      uptime: metrics.count ? Math.min(100, Math.round((metrics.count / 168) * 100)) : 0
    });
  }

  // HTML generieren
  let html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 800px; margin: 0 auto; background: #f9f9f9; padding: 20px; border-radius: 8px;">
      <h2 style="color: #2c3e50; text-align: center;">📊 Wöchentlicher Auslastungsbericht</h2>
      <p style="text-align: center; color: #666; font-size: 14px;">Zeitraum: Letzte 7 Tage (${new Date(sevenDaysAgoMs).toLocaleDateString('de-DE')} - ${new Date().toLocaleDateString('de-DE')})</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <thead>
          <tr style="background: #2c3e50; color: #fff;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Server</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd;">Uptime</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd;">CPU (Avg/Max)</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd;">RAM (Avg/Max)</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd;">Zwischenfälle</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (const s of stats) {
    const uptimeColor = s.uptime >= 99 ? 'green' : s.uptime >= 95 ? 'orange' : 'red';
    html += `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;"><strong>${s.name}</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center; color: ${uptimeColor}; font-weight: bold;">${s.uptime}%</td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${s.avg_cpu}% / <span style="color: red;">${s.max_cpu}%</span></td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${s.avg_mem}% / <span style="color: red;">${s.max_mem}%</span></td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${s.incidents > 0 ? `<span style="color: red; font-weight: bold;">${s.incidents}</span>` : '0'}</td>
      </tr>
    `;
  }

  html += `
        </tbody>
      </table>
      <div style="margin-top: 30px; font-size: 12px; color: #999; text-align: center;">
        Dieser Bericht wurde automatisch von deinem Überwachungs-Panel generiert.
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: smtp.from,
    to: toEmail,
    subject: '📊 Wöchentlicher Server-Auslastungsbericht',
    html: html
  });
}

module.exports = {
  generateAndSendReport
};
