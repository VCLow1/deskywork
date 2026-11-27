const { supabaseAdmin } = require('../config/supabase');
const { mergeRoleMatrix, evaluatePermission } = require('../models/permissionsMatrix');

/**
 * Récupère la matrice de permissions d'un établissement (table roles_permissions + repli tenants.settings).
 */
async function loadTenantRolesMatrix(tenantId) {
  const storedRoles = {};

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('roles_permissions')
      .select('role_code, role_label, permissions, is_system')
      .eq('tenant_id', tenantId);
    if (!error && Array.isArray(rows)) {
      for (const r of rows) {
        storedRoles[r.role_code] = {
          code: r.role_code,
          label: r.role_label,
          permissions: r.permissions || {},
          is_system: r.is_system,
        };
      }
    }
  } catch {
    // Table absente pré-migration SQL
  }

  let tenantSettings = {};
  try {
    const { data: tenantRow } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();
    tenantSettings = tenantRow?.settings || {};
    if (tenantSettings.roles_matrix && typeof tenantSettings.roles_matrix === 'object') {
      for (const [code, cfg] of Object.entries(tenantSettings.roles_matrix)) {
        if (!storedRoles[code]) {
          storedRoles[code] = cfg;
        }
      }
    }
  } catch {
    // ignore
  }

  return {
    matrix: mergeRoleMatrix(storedRoles),
    tenantSettings,
  };
}

/**
 * Middleware Express : vérifie l'appartenance à un rôle autorisé ET une permission explicite LOT 4.
 * Un compte Réceptionniste (`staff`) qui appelle un module verrouillé reçoit strictement HTTP 403 Forbidden.
 */
function requirePermission(permKey, options = {}) {
  const allowedBaseRoles = options.roles || ['super_admin', 'admin', 'staff'];
  return async (req, res, next) => {
    try {
      const profile = req.profile;
      if (!profile) {
        return res.status(401).json({ error: 'Authentification requise', code: 'UNAUTHORIZED' });
      }
      if (!allowedBaseRoles.includes(profile.role)) {
        return res.status(403).json({
          error: 'Accès refusé pour votre rôle.',
          code: 'FORBIDDEN_ROLE',
          permission: permKey,
        });
      }
      if (profile.role === 'super_admin' || profile.role === 'admin') {
        req.isResponsable = true;
        return next();
      }

      const tenantId = req.tenantId || profile.tenant_id || profile.etablissement_id;
      const { matrix, tenantSettings } = await loadTenantRolesMatrix(tenantId);
      const staffPermissionsMap = tenantSettings?.staff_permissions || {};
      const staffMeta = staffPermissionsMap[profile.id] || {};

      const allowed = evaluatePermission({
        profileRole: profile.role,
        staffMeta,
        rolesMatrix: matrix,
        permKey,
      });

      if (!allowed) {
        return res.status(403).json({
          error: 'Permission insuffisante : accès réservé au Responsable ou à un rôle habilité.',
          code: 'FORBIDDEN_PERMISSION',
          permission: permKey,
        });
      }

      req.isResponsable = false;
      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Erreur de vérification des permissions.' });
    }
  };
}

module.exports = {
  requirePermission,
  loadTenantRolesMatrix,
};
