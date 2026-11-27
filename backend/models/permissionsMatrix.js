/**
 * Matrice des permissions RBAC DESKYWORK (partagée backend / frontend)
 *
 * Rôles système :
 * - super_admin / admin : Responsable (toutes permissions, non révocables)
 * - staff               : Réceptionniste (permissions métier de guichet, verrouillé à 403 sur modules sensibles)
 * - custom_*            : Rôles personnalisables éditables depuis Paramètres > Équipe et rôles
 */

const PERMISSION_DEFINITIONS = [
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

const DEFAULT_ROLE_MATRIX = {
  admin: {
    code: 'admin',
    label: 'Responsable',
    is_system: true,
    permissions: Object.fromEntries(PERMISSION_DEFINITIONS.map((p) => [p.key, true])),
  },
  staff: {
    code: 'staff',
    label: 'Réceptionniste',
    is_system: true,
    permissions: {
      reservations_gestion: true,
      clients_lecture_creation: true,
      archivage_fusion_membres: false,
      paiements_encaissement: true,
      remboursements: false,
      factures_avoirs: false,
      tarifs_acces: false,
      rapports_financiers: false,
      parametres: false,
      equipe_gestion: false,
      journal_activite: false,
      formations_gestion: false,
    },
  },
  comptable: {
    code: 'comptable',
    label: 'Comptable',
    is_system: false,
    permissions: {
      reservations_gestion: false,
      clients_lecture_creation: true,
      archivage_fusion_membres: false,
      paiements_encaissement: true,
      remboursements: true,
      factures_avoirs: true,
      tarifs_acces: false,
      rapports_financiers: true,
      parametres: false,
      equipe_gestion: false,
      journal_activite: true,
      formations_gestion: false,
    },
  },
  responsable_pedagogique: {
    code: 'responsable_pedagogique',
    label: 'Coordinateur Formations',
    is_system: false,
    permissions: {
      reservations_gestion: true,
      clients_lecture_creation: true,
      archivage_fusion_membres: false,
      paiements_encaissement: true,
      remboursements: false,
      factures_avoirs: false,
      tarifs_acces: false,
      rapports_financiers: false,
      parametres: false,
      equipe_gestion: false,
      journal_activite: false,
      formations_gestion: true,
    },
  },
};

const HARD_LOCKED_KEYS_FOR_STAFF = new Set(
  PERMISSION_DEFINITIONS.filter((p) => p.hardLockedForStaff).map((p) => p.key)
);

/**
 * Fusionne la matrice stockée en base / settings avec les définitions par défaut.
 */
function mergeRoleMatrix(storedRoles = {}) {
  const merged = {};
  for (const [code, def] of Object.entries(DEFAULT_ROLE_MATRIX)) {
    merged[code] = {
      code,
      label: def.label,
      is_system: def.is_system,
      permissions: { ...def.permissions },
    };
  }

  if (storedRoles && typeof storedRoles === 'object') {
    for (const [code, row] of Object.entries(storedRoles)) {
      if (!row || typeof row !== 'object') continue;
      if (code === 'admin' || code === 'super_admin') continue; // Responsable toujours plein accès
      const basePerms = merged[code]?.permissions || {};
      const nextPerms = { ...basePerms, ...(row.permissions || {}) };
      if (code === 'staff') {
        for (const k of HARD_LOCKED_KEYS_FOR_STAFF) {
          nextPerms[k] = false;
        }
      }
      merged[code] = {
        code,
        label: row.label || merged[code]?.label || code,
        is_system: Boolean(merged[code]?.is_system),
        permissions: nextPerms,
      };
    }
  }
  return merged;
}

/**
 * Évalue si un profil utilisateur dispose de la permission `permKey`.
 */
function evaluatePermission({ profileRole, staffMeta = {}, rolesMatrix = {}, permKey }) {
  if (!profileRole) return false;
  if (profileRole === 'super_admin' || profileRole === 'admin') return true;

  const customRoleCode = staffMeta?.custom_role_code;
  const userOverrides = staffMeta?.permissions && typeof staffMeta.permissions === 'object'
    ? staffMeta.permissions
    : null;

  // Sécurité LOT 4 : un compte Réceptionniste (staff sans rôle personnalisé) reçoit toujours 403 sur les modules sensibles
  if (profileRole === 'staff' && (!customRoleCode || customRoleCode === 'staff')) {
    if (HARD_LOCKED_KEYS_FOR_STAFF.has(permKey)) {
      return false;
    }
    if (userOverrides && typeof userOverrides[permKey] === 'boolean') {
      return userOverrides[permKey];
    }
    const staffRolePerms = rolesMatrix?.staff?.permissions || DEFAULT_ROLE_MATRIX.staff.permissions;
    return Boolean(staffRolePerms[permKey]);
  }

  // Utilisateur avec rôle personnalisable (ou override explicite)
  if (userOverrides && typeof userOverrides[permKey] === 'boolean') {
    return userOverrides[permKey];
  }
  if (customRoleCode && rolesMatrix?.[customRoleCode]?.permissions) {
    return Boolean(rolesMatrix[customRoleCode].permissions[permKey]);
  }

  const fallbackRole = rolesMatrix?.[profileRole]?.permissions || DEFAULT_ROLE_MATRIX[profileRole]?.permissions;
  return Boolean(fallbackRole?.[permKey]);
}

module.exports = {
  PERMISSION_DEFINITIONS,
  DEFAULT_ROLE_MATRIX,
  HARD_LOCKED_KEYS_FOR_STAFF,
  mergeRoleMatrix,
  evaluatePermission,
};
