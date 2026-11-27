/**
 * Matrice des permissions RBAC DESKYWORK côté client (miroir ES module de server/models/permissionsMatrix.js)
 */

export const PERMISSION_DEFINITIONS = [
  { key: 'reservations_gestion', label: 'Gérer les réservations et check-in', category: 'Exploitation', hardLockedForStaff: false },
  { key: 'clients_lecture_creation', label: 'Consulter et créer des membres / invités', category: 'Clients', hardLockedForStaff: false },
  { key: 'archivage_fusion_membres', label: 'Archiver ou fusionner des membres', category: 'Clients', hardLockedForStaff: true },
  { key: 'paiements_encaissement', label: 'Encaisser des paiements (partiels ou totaux)', category: 'Finance', hardLockedForStaff: false },
  { key: 'remboursements', label: 'Valider des remboursements', category: 'Finance', hardLockedForStaff: true },
  { key: 'factures_avoirs', label: 'Émettre des factures et générer des avoirs', category: 'Finance', hardLockedForStaff: true },
  { key: 'tarifs_acces', label: 'Modifier les tarifs, formules et codes promo', category: 'Offres & Tarifs', hardLockedForStaff: true },
  { key: 'rapports_financiers', label: 'Accéder aux rapports financiers et analyses', category: 'Analyses', hardLockedForStaff: true },
  { key: 'parametres', label: 'Modifier les paramètres de l’établissement', category: 'Administration', hardLockedForStaff: true },
  { key: 'equipe_gestion', label: 'Gérer l’équipe et la matrice des rôles', category: 'Administration', hardLockedForStaff: true },
  { key: 'journal_activite', label: 'Consulter le journal d’activité', category: 'Administration', hardLockedForStaff: true },
  { key: 'formations_gestion', label: 'Gérer les sessions de formation et formateurs', category: 'Formations', hardLockedForStaff: false },
];

export const HARD_LOCKED_KEYS_FOR_STAFF = new Set(
  PERMISSION_DEFINITIONS.filter((p) => p.hardLockedForStaff).map((p) => p.key)
);

export function hasClientPermission(user, permKey, rolesMatrix = null) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;
  if (user.role === 'staff' && HARD_LOCKED_KEYS_FOR_STAFF.has(permKey) && !user.custom_role_code) {
    return false;
  }
  if (user.permissions && typeof user.permissions[permKey] === 'boolean') {
    return user.permissions[permKey];
  }
  if (user.custom_role_code && rolesMatrix?.[user.custom_role_code]?.permissions) {
    return Boolean(rolesMatrix[user.custom_role_code].permissions[permKey]);
  }
  if (user.role === 'staff' && rolesMatrix?.staff?.permissions) {
    return HARD_LOCKED_KEYS_FOR_STAFF.has(permKey) ? false : Boolean(rolesMatrix.staff.permissions[permKey]);
  }
  return false;
}
