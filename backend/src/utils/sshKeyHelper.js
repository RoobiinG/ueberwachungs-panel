/**
 * SSH-Key-Auflösung für ssh2.Client.connect()
 *
 * ssh2 akzeptiert als `privateKey`:
 *   - OpenSSH / PEM-Text → direkt nutzbar
 *   - Gepartes Key-Objekt von sshUtils.parseKey()
 *
 * PuTTY PPK (v2 & v3) muss vorher geparst werden — als roher
 * String wird es von ssh2 abgelehnt ("Unsupported key format").
 */

let sshUtils;
try { sshUtils = require('ssh2').utils; } catch {}

/**
 * Gibt den Key in einer Form zurück, die ssh2.Client.connect() versteht.
 *
 * @param {string} raw  Entschlüsselter Inhalt aus der Datenbank
 * @returns {{ key: any, error: string|null }}
 */
function resolveKeyForSsh2(raw) {
  if (!raw) return { key: null, error: 'Kein Private Key vorhanden' };

  // PuTTY PPK-Format → muss geparst werden
  if (raw.trimStart().startsWith('PuTTY-User-Key-File-')) {
    if (!sshUtils) return { key: null, error: 'ssh2-Modul nicht verfügbar' };
    try {
      let parsed = sshUtils.parseKey(raw);
      if (Array.isArray(parsed)) parsed = parsed[0] ?? null;
      if (!parsed)              return { key: null, error: 'PPK-Key ist leer oder ungültig' };
      if (parsed instanceof Error) {
        const msg = parsed.message || '';
        if (/passphrase|encrypt/i.test(msg)) {
          return { key: null, error: 'PPK-Key ist passwortgeschützt — bitte in PuTTYgen entfernen' };
        }
        return { key: null, error: `PPK-Parse-Fehler: ${msg}` };
      }
      return { key: parsed, error: null };
    } catch (err) {
      return { key: null, error: `PPK-Parse-Fehler: ${err.message}` };
    }
  }

  // OpenSSH / PEM → direkt nutzbar
  return { key: raw, error: null };
}

module.exports = { resolveKeyForSsh2 };
