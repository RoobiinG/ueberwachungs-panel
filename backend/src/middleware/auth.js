const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../db');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden' });

    // ── Widerrufener-Token-Check ───────────────────────────────────────────────
    const tokenHash = hashToken(token);
    const revoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?').get(tokenHash);
    if (revoked) return res.status(401).json({ error: 'Session widerrufen — bitte neu anmelden' });

    // ── last_used aktualisieren (gedrosselt: max 1× pro Minute) ───────────────
    try {
      db.prepare(`
        UPDATE sessions SET last_used = CURRENT_TIMESTAMP
        WHERE token_hash = ? AND last_used < datetime('now', '-60 seconds')
      `).run(tokenHash);
    } catch {}

    req.user      = { ...decoded, role: user.role };
    req.tokenHash = tokenHash;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
};
