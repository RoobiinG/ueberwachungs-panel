const jwt = require('jsonwebtoken');
const db  = require('../db');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Rolle aus DB statt aus JWT-Claim lesen — damit Rollenänderungen sofort wirken,
    // auch wenn das Token noch nicht abgelaufen ist.
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden' });
    req.user = { ...decoded, role: user.role };
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
};
