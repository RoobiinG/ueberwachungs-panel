/**
 * Audit-Log-Hilfsfunktion
 *
 * Schreibt einen Eintrag in die audit_log-Tabelle.
 * Fehler beim Logging blockieren nie die eigentliche Operation.
 *
 * action:     Aktionsbezeichner, z.B. 'user.create', 'docker.stop', 'login'
 * targetType: Art des Ziels,     z.B. 'user', 'container', 'service', 'agent'
 * targetName: Name des Ziels,    z.B. 'Max Mustermann', 'nginx', 'hetzner-01'
 * details:    Objekt oder String mit zusätzlichen Infos (wird als JSON gespeichert)
 */
const db = require('../db');

function auditLog(req, action, targetType = null, targetName = null, details = null) {
  try {
    // IP: X-Forwarded-For (Proxy/Docker) hat Vorrang, dann direkte Socket-Adresse
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
               || req.socket?.remoteAddress
               || req.connection?.remoteAddress
               || '—';

    const detailsStr = details != null
      ? (typeof details === 'string' ? details : JSON.stringify(details))
      : null;

    db.prepare(`
      INSERT INTO audit_log
        (user_id, username, action, target_type, target_name, details, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user?.id    ?? null,
      req.user?.username ?? 'Gast',
      action,
      targetType,
      targetName,
      detailsStr,
      ip,
      req.headers['user-agent'] || ''
    );
  } catch (err) {
    // Audit-Fehler dürfen die Haupt-Operation nie unterbrechen
    console.error('[Audit] Fehler beim Schreiben:', err.message);
  }
}

module.exports = { auditLog };
