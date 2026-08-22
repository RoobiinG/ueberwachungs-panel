/**
 * Audit-Log-Hilfsfunktion
 *
 * Schreibt einen Eintrag in die audit_log-Tabelle inkl. GeoIP-Standort.
 * Fehler beim Logging blockieren nie die eigentliche Operation.
 *
 * action:     Aktionsbezeichner, z.B. 'user.create', 'docker.stop', 'login'
 * targetType: Art des Ziels,     z.B. 'user', 'container', 'service', 'agent'
 * targetName: Name des Ziels,    z.B. 'Max Mustermann', 'nginx', 'hetzner-01'
 * details:    Objekt oder String mit zusätzlichen Infos (wird als JSON gespeichert)
 */
const db = require('../db');

// GeoIP lazy-loaded — wirft keinen Fehler wenn Paket noch nicht installiert
let _geoip = null;
function getGeoip() {
  if (_geoip !== null) return _geoip;
  try { _geoip = require('geoip-lite'); }
  catch { _geoip = false; } // Paket nicht verfügbar → false als Sentinel
  return _geoip;
}

/**
 * Standort aus IP ermitteln.
 * Lokale / private IPs → 'Lokal'
 * Unbekannte IPs       → null
 * Bekannte IPs         → 'Berlin, DE' o.ä.
 */
function resolveLocation(ip) {
  if (!ip || ip === '—') return null;

  // IPv6-localhost und IPv4-mapped-IPv6 normalisieren
  const clean = ip
    .replace(/^::ffff:/, '')   // ::ffff:1.2.3.4  → 1.2.3.4
    .replace(/^::1$/, '127.0.0.1');

  // Lokale / private Adressen
  if (
    clean === '127.0.0.1' ||
    clean.startsWith('192.168.') ||
    clean.startsWith('10.')      ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(clean) ||
    clean === 'localhost'
  ) return 'Lokal';

  const geoip = getGeoip();
  if (!geoip) return null;

  // Nur wohlgeformte Adressen weiterreichen.
  //
  // Hintergrund: Die Standort-Bibliothek bringt eine Abhängigkeit mit, die Adressen mit
  // führender Null (`010.0.0.1`) anders auslegt als der Rest des Systems — dezimal statt
  // oktal. Für dieses Panel ist das ungefährlich, weil hier nur ein Ort zur Anzeige
  // nachgeschlagen wird und keine Zugriffsentscheidung davon abhängt; die zweite bekannte
  // Schwachstelle betrifft eine HTML-Ausgabe, die hier gar nicht aufgerufen wird.
  //
  // Bewusst wurde deshalb *nicht* auf die ältere Fassung zurückgegangen, die das Werkzeug
  // vorschlägt — sie brächte zwei Jahre alte Standortdaten, um Lücken zu schließen, die
  // hier nicht greifen. Stattdessen kommt nur herein, was sauber aussieht: Damit ist der
  // Punkt unabhängig von der Fassung der Bibliothek erledigt.
  const istIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(clean)
    && clean.split('.').every(o => o.length <= 3 && !(o.length > 1 && o[0] === '0') && +o <= 255);
  const istIPv6 = /^[0-9a-fA-F:]{2,45}$/.test(clean) && clean.includes(':');
  if (!istIPv4 && !istIPv6) return null;

  try {
    const geo = geoip.lookup(clean);
    if (!geo) return null;
    // Stadt + Land (ISO-Code), z.B. "Berlin, DE"
    const parts = [geo.city, geo.country].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  } catch {
    return null;
  }
}

function auditLog(req, action, targetType = null, targetName = null, details = null) {
  try {
    // IP: X-Forwarded-For (Proxy/Docker) hat Vorrang, dann direkte Socket-Adresse
    const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                  || req.socket?.remoteAddress
                  || req.connection?.remoteAddress
                  || '—';

    const location = resolveLocation(rawIp);

    const detailsStr = details != null
      ? (typeof details === 'string' ? details : JSON.stringify(details))
      : null;

    db.prepare(`
      INSERT INTO audit_log
        (user_id, username, action, target_type, target_name, details, ip, user_agent, location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user?.id    ?? null,
      req.user?.username ?? 'Gast',
      action,
      targetType,
      targetName,
      detailsStr,
      rawIp,
      req.headers['user-agent'] || '',
      location
    );
  } catch (err) {
    // Audit-Fehler dürfen die Haupt-Operation nie unterbrechen
    console.error('[Audit] Fehler beim Schreiben:', err.message);
  }
}

module.exports = { auditLog, resolveLocation };
