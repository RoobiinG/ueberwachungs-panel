const crypto = require('crypto');
const { generateQrSvg } = require('./qr');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateSecret(length = 16) {
  let secret = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    secret += BASE32_ALPHABET[randomBytes[i] % 32];
  }
  return secret;
}

function base32ToBuf(base32) {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function getHOTP(secretBuf, counter) {
  const counterBuf = Buffer.alloc(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }

  const hmac = crypto.createHmac('sha1', secretBuf).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = code % 1000000;
  return String(otp).padStart(6, '0');
}

function getTOTP(secret, timeStep = Math.floor(Date.now() / 30000)) {
  const secretBuf = base32ToBuf(secret);
  return getHOTP(secretBuf, timeStep);
}

function verifyTOTP(secret, code, window = 1) {
  if (!secret || !code) return false;
  const cleanCode = String(code).trim();
  if (!/^\d{6}$/.test(cleanCode)) return false;

  const nowStep = Math.floor(Date.now() / 30000);
  for (let d = -window; d <= window; d++) {
    const expected = getTOTP(secret, nowStep + d);
    if (expected === cleanCode) {
      return true;
    }
  }
  return false;
}

function getOtpAuthUrl(issuer, username, secret) {
  const encIssuer = encodeURIComponent(issuer);
  const encUser = encodeURIComponent(username);
  return `otpauth://totp/${encIssuer}:${encUser}?secret=${secret}&issuer=${encIssuer}`;
}

module.exports = {
  generateSecret,
  verifyTOTP,
  getTOTP,
  getOtpAuthUrl,
  generateQrSvg,
};
