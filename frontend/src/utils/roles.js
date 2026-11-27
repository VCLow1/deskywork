export const ADMIN_ROLES = ['admin', 'staff', 'super_admin'];

export const ROLE_LABELS = {
  member: 'Membre',
  admin: 'Administrateur',
  staff: 'Staff',
  formateur: 'Formateur',
  super_admin: 'Super Admin',
  guest: 'Invité',
  company: 'Entreprise',
  entreprise: 'Entreprise',
};

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

export function isCompanyRole(role, typeMembre = null) {
  return role === 'company' || role === 'entreprise' || typeMembre === 'entreprise';
}

export function isMemberRole(role) {
  return !isAdminRole(role) && role !== 'formateur' && !isCompanyRole(role);
}

export function canBookSpaces(role) {
  return isMemberRole(role) || role === 'formateur' || isCompanyRole(role);
}

export function getBookerNav(role, typeMembre = null) {
  if (isCompanyRole(role, typeMembre)) {
    return {
      home: '/company/dashboard',
      bookings: '/company/bookings',
      payments: '/company/invoices',
    };
  }
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

export function getHomePath(role, typeMembre = null) {
  if (role === 'super_admin') return '/super-admin/dashboard';
  if (isCompanyRole(role, typeMembre)) return '/company/dashboard';
  if (isAdminRole(role)) return '/admin/dashboard';
  if (role === 'formateur') return '/trainer-dashboard';
  return '/dashboard';
}

export async function getPostLoginPath(supabase, userId, role) {
  if (role === 'super_admin') return '/super-admin/dashboard';

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, type_membre')
      .eq('id', userId)
      .maybeSingle();

    if (isCompanyRole(profile?.role || role, profile?.type_membre)) {
      return '/company/dashboard';
    }

    const { data: memberships } = await supabase
      .from('memberships')
      .select('id, organization_id, role, organizations(id, nom, settings, type)')
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
      if (m.organizations?.type === 'entreprise') {
        return '/company/dashboard';
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
// Navigation Entreprise (B2B)
export const COMPANY_NAV = [
  {
    group: 'Général',
    items: [
      { id: 'company_dashboard', label: 'Tableau de bord', icon: 'dashboard', to: '/company/dashboard' },
    ],
  },
  {
    group: 'Réservations B2B',
    items: [
      { id: 'book', label: 'Réserver un espace', icon: 'calendar_today', to: '/book/step1' },
      { id: 'company_bookings', label: 'Mes Réservations', icon: 'event_available', to: '/company/bookings' },
      { id: 'company_calendar', label: 'Calendrier', icon: 'calendar_month', to: '/company/calendar' },
    ],
  },
  {
    group: 'Services Partenaires',
    items: [
      { id: 'company_domiciliation', label: 'Offres de domiciliation', icon: 'corporate_fare', to: '/company/domiciliation', badge: 'Partenaires' },
      { id: 'company_formations', label: 'Formations', icon: 'school', to: '/company/formations' },
    ],
  },
  {
    group: 'Finance & Facturation',
    items: [
      { id: 'company_invoices', label: 'Mes Factures & Reçus', icon: 'receipt_long', to: '/company/invoices' },
    ],
  },
  {
    group: 'Organisation',
    items: [
      { id: 'company_profile', label: 'Profil Société', icon: 'business', to: '/company/profile' },
      { id: 'company_messages', label: 'Messagerie & Notifications', icon: 'chat', to: '/company/messages' },
    ],
  },
];

// LOT 2 Espace Membre : Navigation mobile-first en 8 entrées claires (sans scroll interne caché)
export const MEMBER_NAV = [
  {
    group: 'Espace membre',
    items: [
      { id: 'dashboard', label: 'Accueil', icon: 'home', to: '/dashboard' },
      { id: 'book', label: 'Réserver', icon: 'add_circle', to: '/book/step1' },
      { id: 'member_bookings', label: 'Mes réservations', icon: 'calendar_month', to: '/dashboard/bookings' },
      { id: 'abonnement', label: 'Mon abonnement', icon: 'card_membership', to: '/dashboard/abonnement' },
      { id: 'member_payments', label: 'Mes paiements', icon: 'payments', to: '/member/payments' },
      { id: 'member_formations', label: 'Formations', icon: 'school', to: '/dashboard/formations' },
      { id: 'member_messages', label: 'Messages', icon: 'chat', to: '/dashboard/messages' },
      { id: 'member_profile', label: 'Mon compte', icon: 'account_circle', to: '/dashboard/profile' },
    ],
  },
];

// LOT 2 : Nouvelle architecture de navigation Admin — 8 entrées maximum, sans scroll interne caché
export const ADMIN_NAV = [
  {
    group: 'Pilotage & Opérations',
    items: [
      { id: 'admin_dashboard', label: "Aujourd'hui", icon: 'dashboard', to: '/admin/dashboard' },
      { id: 'admin_reservations', label: 'Réservations', icon: 'event_available', to: '/admin/reservations' },
      { id: 'admin_clients', label: 'Membres', icon: 'people', to: '/admin/clients' },
      { id: 'admin_abonnements', label: 'Abonnements', icon: 'card_membership', to: '/admin/abonnements' },
      { id: 'admin_payments', label: 'Finance', icon: 'account_balance_wallet', to: '/admin/payments' },
      { id: 'admin_espaces', label: 'Espaces et offres', icon: 'meeting_room', to: '/admin/espaces' },
      { id: 'admin_formations', label: 'Formations', icon: 'school', to: '/admin/formations' },
      { id: 'admin_rapports', label: 'Analyses', icon: 'analytics', to: '/admin/rapports' },
    ],
  },
];

// Navigation Staff / Réceptionniste (Niveau 2) — accès opérationnel uniquement
export const STAFF_NAV = [
  {
    group: 'Opérations',
    items: [
      { id: 'staff_dashboard', label: "Aujourd'hui", icon: 'dashboard', to: '/admin/dashboard' },
      { id: 'staff_reservations', label: 'Réservations', icon: 'event_available', to: '/admin/reservations' },
      { id: 'staff_clients', label: 'Membres', icon: 'people', to: '/admin/clients' },
      { id: 'staff_abonnements', label: 'Abonnements', icon: 'card_membership', to: '/admin/abonnements' },
      { id: 'staff_payments', label: 'Finance', icon: 'point_of_sale', to: '/admin/payments' },
      { id: 'staff_espaces', label: 'Espaces et offres', icon: 'meeting_room', to: '/admin/espaces' },
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
      { id: 'trainer_payments', label: 'Mes Versements', icon: 'payments', to: '/trainer/payments' },
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
/**
 * Filtre la navigation Admin selon l'activation du module Formations et l'activité :
 * - moduleFormationsActif === false ou activite === 'coworking' : masque Formations
 */
export function getAdminNav(activite = 'mixte', moduleFormationsActif = true) {
  const hideFormations = moduleFormationsActif === false || activite === 'coworking';
  if (!hideFormations) return ADMIN_NAV;
  return ADMIN_NAV.map((section) => ({
    ...section,
    items: (section.items || []).filter((item) => item.id !== 'admin_formations'),
  }));
}

export function flattenNav(sections) {
  return (sections || []).flatMap((section) => section.items || []);
}

