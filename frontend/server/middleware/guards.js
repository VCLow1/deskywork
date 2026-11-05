// middleware/requireSuperAdmin.js — Guard super admin VCLOW
function requireSuperAdmin(req, res, next) {
  if (req.profile.role !== 'super_admin') {
    return res.status(403).json({ error: 'Réservé au Super Admin (VCLOW).' });
  }
  next();
}

// middleware/applyTenantFilter.js — Filtre multi-tenant automatique
function applyTenantFilter(query, req, tenantIdField = 'tenant_id') {
  if (req.profile.role !== 'super_admin' && req.tenantId) {
    return query.eq(tenantIdField, req.tenantId);
  }
  return query;
}

// Audit log — Super Admin uniquement
const { supabaseAdmin } = require('../config/supabase');
async function auditLog(userId, action, targetType, targetId, targetName, details, ipAddress, status = 'success') {
  try {
    await supabaseAdmin.from('super_admin_audit_log').insert({
      user_id: userId,
      action,
      target_type: targetType,
      target_id: targetId,
      target_name: targetName,
      details: details || {},
      ip_address: ipAddress || null,
      status,
    });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { requireSuperAdmin, applyTenantFilter, auditLog };
