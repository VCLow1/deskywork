export const ADMIN_ROLES = ['admin', 'staff', 'super_admin'];

export const ROLE_LABELS = {
  member: 'Membre',
  admin: 'Administrateur',
  staff: 'Staff',
  formateur: 'Formateur',
  super_admin: 'Super Admin',
  guest: 'Invité',
};

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

export function isMemberRole(role) {
  return !isAdminRole(role) && role !== 'formateur';
}

export function canBookSpaces(role) {
  return isMemberRole(role) || role === 'formateur';
}

export function getBookerNav(role) {
  if (role === 'formateur') {
    return {
      home: '/trainer-dashboard',
      bookings: '/trainer/bookings',
      payments: '/trainer/payments',
    };
  }
  return {
    home: '/dashboard',
    bookings: '/dashboard/bookings',
    payments: '/member/payments',
  };
}

export function getHomePath(role) {
  if (role === 'super_admin') return '/super-admin/dashboard';
  if (isAdminRole(role)) return '/admin/dashboard';
  if (role === 'formateur') return '/trainer-dashboard';
  return '/dashboard';
}

export async function getPostLoginPath(supabase, userId, role) {
  if (role === 'super_admin') return '/super-admin/dashboard';

  try {
    const { data: memberships } = await supabase
      .from('memberships')
      .select('id, organization_id, role, organizations(id, nom, settings)')
      .eq('user_id', userId)
      .eq('statut', 'actif');

    if (memberships && memberships.length > 1) {
      return '/select-space';
    }

    if (memberships && memberships.length === 1) {
      const m = memberships[0];
      if (m.organization_id) {
        localStorage.setItem('active_org_id', m.organization_id);
      }
      if (['proprietaire', 'admin', 'staff'].includes(m.role)) {
        return '/admin/dashboard';
      }
      if (m.role === 'formateur') {
        return '/trainer-dashboard';
      }
    }
  } catch (_) {}

  return getHomePath(role);
}

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || role || 'Membre';
}

// Navigation structurée par Menu / Sous-menu (conforme Spec §13 — sidebar persistante)
// Chaque section = { group: 'Titre du menu', items: [Sous-menu] }
export const MEMBER_NAV = [
  {
    group: 'Général',
    items: [
      { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard', to: '/dashboard' },
    ],
  },
  {
    group: 'Réservations',
    items: [
      { id: 'member_bookings', label: 'Mes réservations', icon: 'calendar_month', to: '/dashboard/bookings' },
      { id: 'book', label: 'Réserver un espace', icon: 'calendar_today', to: '/book/step1' },
      { id: 'qr', label: 'Mon accès QR', icon: 'qr_code_2', to: '/dashboard/qr' },
    ],
  },
  {
    group: 'Formations',
    items: [
      { id: 'member_formations', label: 'Formations', icon: 'school', to: '/dashboard/formations' },
    ],
  },
  {
    group: 'Comptes & Finance',
    items: [
      { id: 'abonnement', label: 'Abonnement & tarifs', icon: 'payments', to: '/dashboard/abonnement' },
      { id: 'member_payments', label: 'Mes factures', icon: 'receipt_long', to: '/member/payments' },
    ],
  },
  {
    group: 'Communication',
    items: [
      { id: 'member_messages', label: 'Messagerie', icon: 'chat', to: '/dashboard/messages' },
      { id: 'member_notifications', label: 'Notifications', icon: 'notifications', to: '/dashboard/notifications' },
    ],
  },
  {
    group: 'Mon compte',
    items: [
      { id: 'member_documents', label: 'Mes documents', icon: 'folder', to: '/dashboard/documents' },
      { id: 'member_rgpd', label: 'Données & RGPD', icon: 'privacy_tip', to: '/dashboard/rgpd' },
    ],
  },
];

export const ADMIN_NAV = [
  {
    group: 'Pilotage',
    items: [
      { id: 'admin_dashboard', label: 'Tableau de bord', icon: 'dashboard', to: '/admin/dashboard' },
    ],
  },
  {
    group: 'Réservations',
    items: [
      { id: 'admin_agenda', label: 'Agenda & Check-in', icon: 'calendar_month', to: '/admin/agenda' },
      { id: 'admin_reservations', label: 'Réservations', icon: 'event_available', to: '/admin/reservations' },
    ],
  },
  {
    group: 'Espaces & Tarifs',
    items: [
      { id: 'admin_espaces', label: 'Mes Espaces', icon: 'meeting_room', to: '/admin/espaces' },
      { id: 'admin_pricing', label: 'Tarification', icon: 'sell', to: '/admin/pricing' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { id: 'admin_payments', label: 'Gestion paiements', icon: 'account_balance_wallet', to: '/admin/payments' },
    ],
  },
  {
    group: 'Organisation',
    items: [
      { id: 'admin_sites', label: 'Multi-sites', icon: 'location_city', to: '/admin/sites' },
      { id: 'admin_cancellation', label: 'Politique annulation', icon: 'gavel', to: '/admin/cancellation-policy' },
    ],
  },
  {
    group: 'Formations',
    items: [
      { id: 'admin_formations', label: 'Formations & Workshops', icon: 'school', to: '/admin/formations' },
      { id: 'admin_formateurs', label: 'Formateurs & Candidatures', icon: 'groups', to: '/admin/formateurs' },
    ],
  },
  {
    group: 'Communication',
    items: [
      { id: 'admin_messages', label: 'Messagerie', icon: 'chat', to: '/admin/messages' },
    ],
  },
];

// Navigation Staff / Réceptionniste (Niveau 2) — accès opérationnel uniquement
export const STAFF_NAV = [
  {
    group: 'Opérations',
    items: [
      { id: 'staff_dashboard', label: 'Tableau de bord', icon: 'dashboard', to: '/admin/dashboard' },
      { id: 'staff_agenda', label: 'Agenda & Check-in', icon: 'calendar_month', to: '/admin/agenda' },
      { id: 'staff_payments', label: 'Paiements du jour', icon: 'point_of_sale', to: '/admin/payments' },
    ],
  },
  {
    group: 'Communication',
    items: [
      { id: 'staff_messages', label: 'Messagerie', icon: 'chat', to: '/admin/messages' },
    ],
  },
];

export const FORMATEUR_NAV = [
  {
    group: 'Général',
    items: [
      { id: 'trainer_dashboard', label: 'Tableau de bord', icon: 'dashboard', to: '/trainer-dashboard' },
    ],
  },
  {
    group: 'Formations',
    items: [
      { id: 'trainer_formations', label: 'Mes Formations', icon: 'school', to: '/trainer/formations' },
      { id: 'trainer_planning', label: 'Mon Planning', icon: 'event_note', to: '/trainer/planning' },
    ],
  },
  {
    group: 'Réservations',
    items: [
      { id: 'trainer_bookings', label: 'Mes Réservations', icon: 'calendar_month', to: '/trainer/bookings' },
      { id: 'book', label: 'Réserver un espace', icon: 'calendar_today', to: '/book/step1' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { id: 'trainer_payments', label: 'Mes factures', icon: 'receipt_long', to: '/trainer/payments' },
    ],
  },
  {
    group: 'Communication',
    items: [
      { id: 'trainer_messages', label: 'Messagerie', icon: 'chat', to: '/trainer/messages' },
    ],
  },
  {
    group: 'Profil',
    items: [
      { id: 'trainer_profile', label: 'Mon Profil', icon: 'person', to: '/trainer/profile' },
    ],
  },
];

export const SUPER_ADMIN_NAV = [
  {
    group: 'Pilotage',
    items: [
      { id: 'sa_dashboard', label: 'Tableau de bord', icon: 'dashboard', to: '/super-admin/dashboard' },
    ],
  },
  {
    group: 'Supervision',
    items: [
      { id: 'sa_reservations', label: 'Réservations globales', icon: 'event_available', to: '/super-admin/reservations' },
      { id: 'sa_payments', label: 'Paiements globaux', icon: 'account_balance_wallet', to: '/super-admin/payments' },
      { id: 'sa_formations', label: 'Formations globales', icon: 'school', to: '/super-admin/formations' },
      { id: 'sa_espaces', label: 'Espaces globaux', icon: 'meeting_room', to: '/super-admin/espaces' },
    ],
  },
  {
    group: 'Gestion',
    items: [
      { id: 'sa_validations', label: 'Validations & Approbations', icon: 'verified', to: '/super-admin/validations' },
      { id: 'sa_users', label: 'Utilisateurs', icon: 'groups', to: '/super-admin/users' },
      { id: 'sa_tenants', label: 'Gestion Coworkings', icon: 'domain', to: '/super-admin/tenants' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { id: 'sa_billing', label: 'Facturation B2B', icon: 'payments', to: '/super-admin/billing' },
    ],
  },
  {
    group: 'Technique',
    items: [
      { id: 'sa_monitoring', label: 'Surveillance & Audit', icon: 'monitor', to: '/super-admin/monitoring' },
      { id: 'sa_contacts', label: 'Contacts reçus', icon: 'contact_mail', to: '/super-admin/contacts' },
    ],
  },
];

// Aplatit les sections (Menu/Sous-menu) en une liste de liens (recherche header, breadcrumb)
export function flattenNav(sections) {
  return (sections || []).flatMap((section) => section.items || []);
}

