module.exports = (...allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};
