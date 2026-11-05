// middleware/requireRoles.js — Vérification des rôles utilisateurs
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.profile.role)) {
      return res.status(403).json({ error: 'Droits insuffisants pour cette action.' });
    }
    next();
  };
}

module.exports = { requireRoles };
