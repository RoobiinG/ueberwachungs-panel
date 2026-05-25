const crypto = require('crypto');

// Schlüssel einmalig ableiten (32 Bytes für AES-256-GCM)
let _key = null;
const getKey = () => {
  if (_key) return _key;
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET nicht gesetzt');
  _key = crypto.scryptSync(process.env.JWT_SECRET, 'ssh-key-salt-v1', 32);
  return _key;
};

/**
 * Verschlüsselt einen Plaintext-String mit AES-256-GCM.
 * @param {string} plaintext
 * @returns {string} iv:authTag:ciphertext (alles hex)
 */
function encrypt(plaintext) {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Entschlüsselt einen mit encrypt() verschlüsselten String.
 * @param {string} ciphertext
 * @returns {string}
 */
function decrypt(ciphertext) {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Ungültiges Ciphertext-Format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(dataHex, 'hex', 'utf8') + decipher.final('utf8');
}

module.exports = { encrypt, decrypt };
