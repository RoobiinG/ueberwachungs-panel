module.exports = (...allowedRoles) => (req, res, next) => {
  // Expliziter 401 wenn auth-Middleware noch nicht gelaufen ist
  if (!req.user) {
    return res.status(401).json({ error: 'Authentifizierung erforderlich' });
  }
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  next();
};
