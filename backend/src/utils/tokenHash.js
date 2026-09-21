const crypto = require('crypto');

// Gemeinsame Token-Hash-Funktion für HTTP-Auth-Middleware und WebSocket-Auth,
// damit ein widerrufenes Token (revoked_tokens) an beiden Stellen gleich geprüft wird.
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

module.exports = { hashToken };
