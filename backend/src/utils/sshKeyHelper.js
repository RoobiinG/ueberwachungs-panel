/**
 * SSH-Key-Auflösung für ssh2.Client.connect()
 *
 * ssh2 akzeptiert als `privateKey`:
 *   - OpenSSH / PEM-Text → direkt nutzbar
 *   - Gepartes Key-Objekt von sshUtils.parseKey()
 *
 * PuTTY PPK v2 wird von ssh2 nativ geparst.
 * PuTTY PPK v3 → wird on-the-fly in PPK v2 konvertiert (MAC wird neu berechnet).
 */

const crypto = require('crypto');

let sshUtils;
try { sshUtils = require('ssh2').utils; } catch {}

// ─── PPK v3 → PPK v2 Konvertierung ───────────────────────────────────────────
//
// Die Key-Blobs (Public + Private) sind in v2 und v3 für unverschlüsselte Keys
// identisch. Der einzige Unterschied ist der Header (version number) und die
// MAC-Berechnung (HMAC-SHA-1 in v2 vs. HMAC-SHA-256 in v3).
//
// Quellen:
//   PuTTY SSH2 key format: https://the.earth.li/~sgtatham/putty/0.79/htmldoc/AppendixC.html
//   PuTTY Source: sshpubk.c

function convertPpk3ToPpk2(raw) {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('PuTTY-User-Key-File-3:')) return null;

  const lines = trimmed.split(/\r?\n/);

  // Erste Zeile: "PuTTY-User-Key-File-3: <algo>"
  const firstColon = lines[0].indexOf(':');
  const keyType    = lines[0].slice(firstColon + 1).trim(); // z.B. "ssh-rsa"

  let encryption = 'none', comment = '';
  let pubLines   = [];
  let privLines  = [];
  let i = 1;

  while (i < lines.length) {
    const line  = lines[i];
    const colon = line.indexOf(':');
    if (colon === -1) { i++; continue; }
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();

    if (key === 'Encryption') {
      encryption = val; i++;
    } else if (key === 'Comment') {
      comment = val; i++;
    } else if (key === 'Public-Lines') {
      const n = parseInt(val);
      pubLines = lines.slice(i + 1, i + 1 + n);
      i += n + 1;
    } else if (key === 'Private-Lines') {
      const n = parseInt(val);
      privLines = lines.slice(i + 1, i + 1 + n);
      i += n + 1;
    } else {
      i++;
    }
  }

  // Verschlüsselte Keys können nicht ohne Passphrase konvertiert werden
  if (encryption !== 'none') return null;

  const pubBlob  = Buffer.from(pubLines.join(''),  'base64');
  const privBlob = Buffer.from(privLines.join(''), 'base64');

  // ── PPK v2 MAC berechnen ──────────────────────────────────────────────────
  // MAC-Key = SHA-1("putty-private-key-file-mac-key")  [für leere Passphrase]
  // MAC     = HMAC-SHA-1(MAC-Key, MAC-Data)
  // MAC-Data = string(keyType) || string(encryption) || string(comment)
  //          || string(pubBlob) || string(privBlob)
  // wobei string(x) = uint32BE(len(x)) || x

  const macKey = crypto
    .createHash('sha1')
    .update('putty-private-key-file-mac-key', 'utf8')
    .digest();

  const s = (x) => {
    const b = typeof x === 'string' ? Buffer.from(x, 'utf8') : x;
    const h = Buffer.allocUnsafe(4);
    h.writeUInt32BE(b.length, 0);
    return Buffer.concat([h, b]);
  };

  const macData = Buffer.concat([
    s(keyType), s(encryption), s(comment), s(pubBlob), s(privBlob),
  ]);
  const mac = crypto.createHmac('sha1', macKey).update(macData).digest('hex');

  // ── PPK v2 Datei zusammensetzen ───────────────────────────────────────────
  const pub64  = pubBlob.toString('base64').match(/.{1,64}/g)  ?? [];
  const priv64 = privBlob.toString('base64').match(/.{1,64}/g) ?? [];

  return [
    `PuTTY-User-Key-File-2: ${keyType}`,
    `Encryption: none`,
    `Comment: ${comment}`,
    `Public-Lines: ${pub64.length}`,
    ...pub64,
    `Private-Lines: ${priv64.length}`,
    ...priv64,
    `Private-MAC: ${mac}`,
  ].join('\r\n');
}

// ─── Haupt-Funktion ───────────────────────────────────────────────────────────

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

    // PPK v3: on-the-fly in v2 konvertieren (ssh2 unterstützt v2 nativ)
    let toParse = raw;
    if (raw.trimStart().startsWith('PuTTY-User-Key-File-3:')) {
      const converted = convertPpk3ToPpk2(raw);
      if (!converted) {
        return {
          key:   null,
          error: 'PPK v3 mit Passphrase-Schutz kann nicht verwendet werden. '
               + 'Bitte in PuTTYgen: Conversions → Export OpenSSH key → als .pem-Datei importieren.',
        };
      }
      toParse = converted;
    }

    try {
      let parsed = sshUtils.parseKey(toParse);
      if (Array.isArray(parsed)) parsed = parsed[0] ?? null;
      if (!parsed) return { key: null, error: 'PPK-Key ist leer oder ungültig' };
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

module.exports = { resolveKeyForSsh2, convertPpk3ToPpk2 };
