/**
 * SSRF-Schutz: Verhindert Requests an private/interne IP-Adressen.
 * Wirft einen Fehler wenn die URL auf eine private Range zeigt.
 * HINWEIS: Schützt nicht gegen DNS-Rebinding — für intern deployten
 * Monitoring-Panel ist das ein akzeptables Restrisiko.
 */

const PRIVATE = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^0:0:0:0:0:0:0:1$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,          // APIPA / AWS Metadata (169.254.169.254)
  /^fc[0-9a-f]{2}:/i,    // IPv6 Unique Local
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,              // IPv6 link-local
  /^0+$/,                 // 0.0.0.0 / ::
];

/**
 * Validiert eine vom User eingegebene URL auf SSRF-Sicherheit.
 * Gibt das geparste URL-Objekt zurück oder wirft einen Error.
 * @param {string} urlStr
 * @returns {URL}
 */
function validatePublicUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Ungültige URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Nur HTTP/HTTPS-URLs sind erlaubt');
  }

  const host = parsed.hostname.toLowerCase();
  if (PRIVATE.some(p => p.test(host))) {
    throw new Error('Private oder interne IP-Adressen/Hosts sind nicht erlaubt');
  }

  return parsed;
}

module.exports = { validatePublicUrl };
