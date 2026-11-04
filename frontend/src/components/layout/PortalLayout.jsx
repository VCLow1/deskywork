import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../supabaseClient';
import { joinUser, onNotificationCreated, onNotificationChanged } from '../../services/socket';
import { memberPortalApi } from '../../services/api';
import {
  ADMIN_NAV,
  STAFF_NAV,
  MEMBER_NAV,
  FORMATEUR_NAV,
  SUPER_ADMIN_NAV,
  flattenNav,
  getHomePath,
  getRoleLabel,
  isAdminRole,
} from '../../utils/roles';

function getProfilePath(role) {
  if (role === 'member') return '/dashboard/profile';
  if (role === 'formateur') return '/trainer/profile';
  if (isAdminRole(role)) return '/admin/profile-coworking';
  return '/dashboard/profile';
}

// Titres des pages hors navigation (breadcrumb / recherche)
const PAGE_TITLES = {
  '/book/step1': 'Réserver un espace',
  '/book/step2': 'Réserver un espace',
  '/book/step3': 'Réserver un espace',
  '/admin/profile-coworking': 'Profil du Coworking',
  '/admin/formations': 'Formations',
  '/admin/formateurs': 'Formateurs',
  '/admin/onboarding': 'Configuration initiale',
  '/admin/notifications': 'Notifications',
  '/trainer-dashboard': 'Tableau de bord',
  '/trainer/notifications': 'Notifications',
  '/member/profile': 'Mon Profil',
  '/dashboard/profile': 'Mon Profil',
  '/trainer/profile': 'Mon Profil',
  '/dashboard/notifications': 'Notifications',
};

function derivePageTitle(pathname, navItems) {
  const match = navItems.find((item) =>
    pathname === item.to || pathname.startsWith(`${item.to}/`)
  );
  if (match) return match.label;
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const last = pathname.split('/').filter(Boolean).pop();
  if (!last) return 'Tableau de bord';
  return last
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffH < 24) return `il y a ${diffH}h`;
  if (diffD < 7) return `il y a ${diffD}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getNotifIcon(type) {
  if (!type) return 'notifications';
  if (type.includes('reservation') || type.includes('session')) return 'calendar_month';
  if (type.includes('payment') || type.includes('paiement') || type.includes('facture')) return 'receipt_long';
  if (type.includes('formation') || type.includes('inscription') || type === 'nouvelle_formation') return 'school';
  if (type.includes('message')) return 'chat';
  if (type.includes('abonnement')) return 'payments';
  return 'notifications';
}

function getNotificationTarget(type, role) {
  const normalizedType = String(type || '').toLowerCase();
  const isAdmin = ['admin', 'staff'].includes(role);

  if (normalizedType.includes('nouveau_coworking') || normalizedType.includes('tenant')) {
    return role === 'super_admin' ? '/super-admin/tenants' : getHomePath(role);
  }
  if (normalizedType.includes('nouveau_membre') || normalizedType.includes('nouveau_formateur')) {
    return role === 'super_admin' ? '/super-admin/users' : (isAdmin ? '/admin/formateurs' : getHomePath(role));
  }
  if (normalizedType.includes('reservation') || normalizedType.includes('session')) {
    if (isAdmin || role === 'super_admin') return '/admin/reservations';
    return role === 'formateur' ? '/trainer/bookings' : '/dashboard/bookings';
  }
  if (normalizedType.includes('paiement') || normalizedType.includes('payment') || normalizedType.includes('facture')) {
    if (isAdmin || role === 'super_admin') return '/admin/payments';
    return role === 'formateur' ? '/trainer/payments' : '/member/payments';
  }
  if (normalizedType.includes('message')) {
    return isAdmin || role === 'super_admin'
      ? '/admin/messages'
      : role === 'formateur' ? '/trainer/messages' : '/dashboard/messages';
  }
  if (normalizedType.includes('formation') || normalizedType.includes('inscription')) {
    if (isAdmin || role === 'super_admin') return '/admin/formations';
    return role === 'formateur' ? '/trainer/formations' : '/dashboard/formations';
  }
  if (normalizedType.includes('abonnement')) return '/dashboard/abonnement';

  return getHomePath(role);
}

const routeChunkPreloaders = {
  '/super-admin/dashboard': () => import('../../pages/SuperAdminDashboard'),
  '/super-admin/tenants': () => import('../../pages/TenantManagement'),
  '/super-admin/billing': () => import('../../pages/TenantBilling'),
  '/super-admin/users': () => import('../../pages/SuperAdminUsers'),
  '/super-admin/monitoring': () => import('../../pages/SuperAdminMonitoring'),
  '/super-admin/contacts': () => import('../../pages/SuperAdminContacts'),
  '/admin/dashboard': () => import('../../pages/AdminDashboard'),
  '/admin/reservations': () => import('../../pages/AdminReservations'),
  '/admin/payments': () => import('../../pages/AdminPayments'),
  '/admin/pricing': () => import('../../pages/AdminPricing'),
  '/admin/espaces': () => import('../../pages/AdminEspaces'),
  '/admin/formations': () => import('../../pages/AdminFormations'),
  '/admin/formateurs': () => import('../../pages/AdminFormateurs'),
  '/admin/messages': () => import('../../pages/AdminMessages'),
  '/admin/agenda': () => import('../../pages/AdminAgenda'),
  '/admin/notifications': () => import('../../pages/AdminNotifications'),
  '/admin/multi-sites': () => import('../../pages/AdminMultiSites'),
  '/admin/profile-coworking': () => import('../../pages/AdminCoworkingProfile'),
  '/dashboard': () => import('../../pages/Dashboard'),
  '/dashboard/bookings': () => import('../../pages/MemberBookings'),
  '/dashboard/formations': () => import('../../pages/MemberFormations'),
  '/dashboard/abonnement': () => import('../../pages/MemberSubscription'),
  '/dashboard/messages': () => import('../../pages/MemberMessages'),
  '/dashboard/notifications': () => import('../../pages/MemberNotifications'),
  '/dashboard/documents': () => import('../../pages/MemberDocuments'),
  '/dashboard/rgpd': () => import('../../pages/MemberRGPD'),
  '/member/payments': () => import('../../pages/MemberPayments'),
  '/trainer-dashboard': () => import('../../pages/TrainerDashboard'),
  '/trainer/planning': () => import('../../pages/TrainerPlanning'),
  '/trainer/formations': () => import('../../pages/TrainerFormations'),
  '/trainer/bookings': () => import('../../pages/TrainerBookings'),
};

const prefetchedRoutes = new Set();
function prefetchRoute(to) {
  if (!to || prefetchedRoutes.has(to)) return;
  const loader = routeChunkPreloaders[to];
  if (loader) {
    prefetchedRoutes.add(to);
    loader().catch(() => { });
  }
}

/* === NavLink Sidebar === */
function NavLink({ item, isActive, onClick, dark }) {
  const itemColor = isActive ? '#f95d00' : (dark ? '#fbffff' : '#100f0d');
  const translatedLabel = item.label;

  const handleMouseEnter = (e) => {
    prefetchRoute(item.to);
    if (!isActive) {
      e.currentTarget.style.background = dark ? 'rgba(249,93,0,0.10)' : 'rgba(249,93,0,0.06)';
      e.currentTarget.style.color = '#f95d00';
      const span = e.currentTarget.querySelector('span');
      if (span) span.style.color = '#f95d00';
    }
  };

  return (
    <Link
      to={item.to}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onFocus={() => prefetchRoute(item.to)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 12,
        fontWeight: 600,
        fontSize: 14,
        textDecoration: 'none',
        transition: 'all 0.15s ease',
        background: isActive
          ? (dark ? 'rgba(249,93,0,0.18)' : 'rgba(249,93,0,0.10)')
          : 'transparent',
        color: itemColor,
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = itemColor;
          const span = e.currentTarget.querySelector('span');
          if (span) span.style.color = itemColor;
        }
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 20, flexShrink: 0,
          fontVariationSettings: isActive
            ? "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24"
            : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
          color: itemColor,
        }}
      >
        {item.icon}
      </span>
      <span style={{ flex: 1, color: itemColor }}>{translatedLabel}</span>
      {isActive && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f95d00', flexShrink: 0 }} />
      )}
    </Link>
  );
}


export default function PortalLayout({ children, profile, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const defaultLogout = () => {
    supabase.auth.signOut()
      .then(() => navigate('/login'))
      .catch(() => navigate('/login'));
  };
  const handleLogout = onLogout || defaultLogout;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tenantLogo, setTenantLogo] = useState(null);

  const dropdownRef = useRef(null);
  const notifRef = useRef(null);
  const { dark, toggle } = useTheme();

  // Fermer le menu mobile lors d'un changement d'URL
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const initials = `${profile?.prenom?.[0] || ''}${profile?.nom?.[0] || ''}`.toUpperCase() || 'U';


  // Chargement du logo tenant fallback
  useEffect(() => {
    async function loadTenantLogo() {
      if (profile?.tenant_id && !profile?.photo_url && !profile?.avatar_url) {
        try {
          const { data: tenantData } = await supabase
            .from('tenants')
            .select('logo_url')
            .eq('id', profile.tenant_id)
            .single();
          if (tenantData?.logo_url) {
            setTenantLogo(tenantData.logo_url);
          }
        } catch (e) {
          // silencieux
        }
      }
    }
    loadTenantLogo();
  }, [profile]);

  // Chargement + Écoute Temps Réel des Notifications
  useEffect(() => {
    if (!profile?.id) return;

    async function fetchNotifications() {
      try {
        const response = await memberPortalApi.getNotifications({ page: 1, limit: 20 });
        const data = response.data?.notifications ?? response.notifications ?? [];
        if (data) {
          setNotifications(data);
          setUnreadCount(response.data?.unreadCount ?? response.unreadCount ?? data.filter(n => !n.lu).length);
        }
      } catch (err) {
        // silencieux
      }
    }

    fetchNotifications();

    joinUser(profile.id);
    const removeCreatedListener = onNotificationCreated((notification) => {
      if (notification?.user_id !== profile.id) return;
      setNotifications(prev => {
        const alreadyPresent = prev.some(item => item.id === notification.id);
        if (!alreadyPresent && !notification.lu) setUnreadCount(count => count + 1);
        return [notification, ...prev.filter(item => item.id !== notification.id)].slice(0, 20);
      });
    });
    const removeChangedListener = onNotificationChanged(() => fetchNotifications());

    // Realtime: re-fetch on any INSERT/UPDATE/DELETE for this user's notifications
    const channel = supabase
      .channel(`user-notifs-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          // For new notifications, add directly to state for instant update
          if (payload.eventType === 'INSERT' && payload.new) {
            setNotifications(prev => {
              if (prev.some(item => item.id === payload.new.id)) return prev;
              if (!payload.new.lu) setUnreadCount(count => count + 1);
              return [payload.new, ...prev].slice(0, 20);
            });
          } else {
            // For UPDATE/DELETE, re-fetch to stay in sync
            fetchNotifications();
          }
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn('Notification realtime subscription error:', err.message);
        }
      });

    return () => {
      removeCreatedListener();
      removeChangedListener();
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  const avatarUrl = profile?.photo_url || profile?.avatar_url || profile?.avatar || profile?.tenant?.logo_url || tenantLogo || null;

  const isSuperAdmin = profile?.role === 'super_admin';
  const isStaff = profile?.role === 'staff';
  const adminView = isAdminRole(profile?.role);
  const isTrainer = profile?.role === 'formateur';
  const navSections = isSuperAdmin
    ? SUPER_ADMIN_NAV
    : isStaff
      ? STAFF_NAV
      : adminView
        ? ADMIN_NAV
        : isTrainer
          ? FORMATEUR_NAV
          : MEMBER_NAV;
  const navItems = flattenNav(navSections);
  const homePath = getHomePath(profile?.role);
  const profilePath = getProfilePath(profile?.role);
  const portalLabel = isSuperAdmin
    ? 'VCLOW Platform'
    : isStaff
      ? 'Réception'
      : adminView
        ? 'Administration'
        : isTrainer
          ? 'Espace Formateur'
          : 'Espace membre';
  const pageTitle = derivePageTitle(location.pathname, navItems);

  const isNavActive = (to) => {
    if (to === homePath) return location.pathname === to;
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  };

  const markAsRead = async (id) => {
    try {
      await memberPortalApi.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, lu: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (_) { }
  };

  const markAllAsRead = async () => {
    try {
      await memberPortalApi.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, lu: true })));
      setUnreadCount(0);
    } catch (_) { }
  };

  // Ouvrir/fermer le panneau — sans marquer comme lu automatiquement
  const handleOpenNotif = () => {
    const next = !notifOpen;
    setNotifOpen(next);
    setDropdownOpen(false);
  };

  const handleNotificationClick = async (n) => {
    if (!n.lu) await markAsRead(n.id);
    setNotifOpen(false);

    navigate(getNotificationTarget(n.type, profile?.role));
  };

  const notifCenterUrl = ['super_admin', 'admin', 'staff'].includes(profile?.role)
    ? '/admin/notifications'
    : profile?.role === 'formateur'
      ? '/trainer/notifications'
      : '/dashboard/notifications';

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: dark ? '#100f0d' : '#f6f4f1',
      color: dark ? '#fbffff' : '#100f0d',
      transition: 'background 0.3s ease, color 0.3s ease',
      fontFamily: 'Inter, sans-serif',
    }}>

      {/* Ambient blobs */}
      <div style={{ position: 'fixed', top: 0, right: 0, width: 384, height: 384, borderRadius: '50%', pointerEvents: 'none', zIndex: -1, background: 'radial-gradient(circle, rgba(249,93,0,0.05), transparent)', transform: 'translate(30%, -30%)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, width: 384, height: 384, borderRadius: '50%', pointerEvents: 'none', zIndex: -1, background: 'radial-gradient(circle, rgba(16,15,13,0.05), transparent)', transform: 'translate(-30%, 30%)' }} />

      {/* === HEADER === */}
      <header className="portal-header" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        height: 68, padding: '0 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: dark ? 'rgba(16,15,13,0.92)' : 'rgba(251,255,255,0.88)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: dark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(16,15,13,0.08)',
        boxShadow: '0 2px 12px rgba(16,15,13,0.05)',
        transition: 'background 0.3s ease',
        minWidth: 0,
      }}>
        {/* Left: Hamburger menu (mobile) + Brand Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(v => !v)}
            className="flex lg:hidden items-center justify-center"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
              background: mobileMenuOpen
                ? (dark ? 'rgba(249,93,0,0.25)' : 'rgba(249,93,0,0.15)')
                : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.06)'),
              color: mobileMenuOpen ? '#f95d00' : (dark ? '#fbffff' : '#100f0d'),
            }}
            aria-label="Menu de navigation"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
          <BrandLogo to={homePath} height={38} />
        </div>


        {/* Search supprimé */}

        {/* Right: User profile + Notification Bell + Dark toggle + Clickable Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', flexShrink: 0 }}>

          {/* Nom et rôle */}
          <div
            className="hidden sm:flex"
            onClick={() => { setDropdownOpen(v => !v); setNotifOpen(false); }}
            style={{ flexDirection: 'column', alignItems: 'flex-end', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: dark ? '#fbffff' : '#100f0d', lineHeight: 1.2 }}>
              {profile?.prenom} {profile?.nom}
            </span>
            <span style={{ fontSize: 12, color: dark ? 'rgba(251,255,255,0.6)' : '#44474d', marginTop: 2 }}>
              {getRoleLabel(profile?.role)}
            </span>
          </div>

          {/* 🛎️ BOUTON NOTIFICATION AVEC COMPTEUR TEMPS RÉEL */}
          <div style={{ position: 'relative' }} ref={notifRef}>
            <button
              onClick={handleOpenNotif}
              title="Notifications"
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 38, height: 38, borderRadius: 12, border: 'none',
                cursor: 'pointer', transition: 'all 0.2s ease',
                background: notifOpen
                  ? (dark ? 'rgba(249,93,0,0.25)' : 'rgba(249,93,0,0.15)')
                  : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.06)'),
                color: notifOpen ? '#f95d00' : (dark ? '#fbffff' : '#100f0d'),
                boxShadow: dark ? 'inset 0 1px 2px rgba(255,255,255,0.1)' : 'inset 0 1px 2px rgba(0,0,0,0.05)',
              }}
              onMouseEnter={e => {
                if (!notifOpen) {
                  e.currentTarget.style.background = dark ? 'rgba(249,93,0,0.2)' : 'rgba(249,93,0,0.12)';
                  e.currentTarget.style.color = '#f95d00';
                }
              }}
              onMouseLeave={e => {
                if (!notifOpen) {
                  e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.06)';
                  e.currentTarget.style.color = dark ? '#fbffff' : '#100f0d';
                }
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>notifications</span>

              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -3, right: -3,
                  minWidth: 18, height: 18, padding: '0 4px',
                  borderRadius: 99, background: '#f95d00', color: '#ffffff',
                  fontSize: 10, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(249,93,0,0.5)',
                  border: dark ? '2px solid #100f0d' : '2px solid #ffffff',
                  animation: 'pulseNotif 2s infinite',
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {/* POP-UP NOTIFICATIONS */}
            {notifOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: 68,
                  right: 8,
                  width: 'min(360px, calc(100vw - 16px))',
                  background: dark ? '#1b1a18' : '#ffffff',
                  color: dark ? '#fbffff' : '#100f0d',
                  borderRadius: 20,
                  border: dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(16,15,13,0.08)',
                  boxShadow: dark ? '0 16px 40px rgba(0,0,0,0.6)' : '0 16px 40px rgba(16,15,13,0.15)',
                  zIndex: 100, overflow: 'hidden',
                  animation: 'popDropdown 0.2s ease-out both',
                }}
              >
                <style>{"@keyframes popDropdown { from { opacity: 0; transform: translateY(-8px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }"}</style>

                <div style={{
                  padding: '16px 20px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderBottom: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(16,15,13,0.08)',
                  background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(16,15,13,0.02)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>Notifications</span>
                    {unreadCount > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(249,93,0,0.12)', color: '#f95d00' }}>
                        {unreadCount} nouvelle{unreadCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      style={{ fontSize: 12, fontWeight: 600, color: '#f95d00', border: 'none', background: 'transparent', cursor: 'pointer' }}
                    >
                      Tout lire
                    </button>
                  )}
                </div>

                <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: '36px 20px', textAlign: 'center', color: dark ? 'rgba(251,255,255,0.5)' : '#666' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 36, opacity: 0.4, marginBottom: 8, display: 'block' }}>notifications_off</span>
                      <p style={{ fontSize: 13, margin: 0 }}>Aucune notification pour le moment.</p>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        style={{
                          padding: '14px 18px',
                          display: 'flex', alignItems: 'flex-start', gap: 12,
                          cursor: 'pointer', transition: 'background 0.15s ease',
                          background: n.lu
                            ? 'transparent'
                            : (dark ? 'rgba(249,93,0,0.08)' : 'rgba(249,93,0,0.04)'),
                          borderBottom: dark ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(16,15,13,0.04)',
                        }}
                      >
                        <div style={{
                          width: 34, height: 34, borderRadius: 10,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                          background: n.lu
                            ? (dark ? 'rgba(255,255,255,0.06)' : 'rgba(16,15,13,0.05)')
                            : 'rgba(249,93,0,0.12)',
                          color: n.lu ? (dark ? 'rgba(251,255,255,0.6)' : '#666') : '#f95d00',
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{getNotifIcon(n.type)}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: n.lu ? 500 : 700, margin: 0, lineHeight: 1.35, color: dark ? '#fbffff' : '#100f0d' }}>
                            {n.message || n.title || 'Notification'}
                          </p>
                          <span style={{ fontSize: 11, color: dark ? 'rgba(251,255,255,0.5)' : '#888', marginTop: 4, display: 'block' }}>
                            {getRelativeTime(n.created_at)}
                          </span>
                        </div>
                        {!n.lu && (
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f95d00', flexShrink: 0, marginTop: 4 }} />
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div style={{
                  padding: '12px 20px', textAlign: 'center',
                  borderTop: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(16,15,13,0.08)',
                  background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(16,15,13,0.02)',
                }}>
                  <Link
                    to={notifCenterUrl}
                    onClick={() => setNotifOpen(false)}
                    style={{ fontSize: 12, fontWeight: 700, color: '#f95d00', textDecoration: 'none' }}
                  >
                    Voir toutes les notifications →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Bouton Toggle Mode Sombre / Clair ajusté */}
          <button
            onClick={toggle}
            title={dark ? 'Mode clair' : 'Mode sombre'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 38, height: 38, borderRadius: 12, border: 'none',
              cursor: 'pointer', transition: 'all 0.2s ease',
              background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.06)',
              color: dark ? '#ffd966' : '#100f0d',
              boxShadow: dark ? 'inset 0 1px 2px rgba(255,255,255,0.1)' : 'inset 0 1px 2px rgba(0,0,0,0.05)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = dark ? 'rgba(249,93,0,0.2)' : 'rgba(249,93,0,0.12)';
              e.currentTarget.style.color = '#f95d00';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.06)';
              e.currentTarget.style.color = dark ? '#ffd966' : '#100f0d';
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
              {dark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>

          {/* Cercle Photo / Logo cliquable */}
          <div style={{ position: 'relative' }} ref={dropdownRef}>
            <button
              onClick={() => { setDropdownOpen(v => !v); setNotifOpen(false); }}
              title="Menu profil"
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 40, height: 40, borderRadius: '50%',
                flexShrink: 0, border: '2px solid #ffffff',
                boxShadow: dropdownOpen ? '0 0 0 3px #f95d00' : '0 2px 10px rgba(16,15,13,0.15)',
                background: avatarUrl ? '#ffffff' : 'linear-gradient(135deg, #100f0d, #f95d00)',
                color: '#fbffff', cursor: 'pointer', overflow: 'hidden',
                transition: 'all 0.2s ease', padding: 0,
                fontFamily: 'Sora, sans-serif', fontWeight: 700, fontSize: 14,
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={`${profile?.prenom || ''} ${profile?.nom || ''}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span>{initials}</span>
              )}
            </button>

            {/* === MENU DÉROULANT DU PROFIL === */}
            {dropdownOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: 68,
                  right: 8,
                  width: 'min(260px, calc(100vw - 16px))',
                  background: dark ? '#1b1a18' : '#ffffff',
                  color: dark ? '#fbffff' : '#100f0d',
                  borderRadius: 20,
                  border: dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(16,15,13,0.08)',
                  boxShadow: dark ? '0 16px 40px rgba(0,0,0,0.6)' : '0 16px 40px rgba(16,15,13,0.15)',
                  padding: '16px',
                  zIndex: 100,
                  animation: 'popDropdown 0.2s ease-out both',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 14, marginBottom: 12, borderBottom: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(16,15,13,0.08)' }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Sora, sans-serif', fontWeight: 700, fontSize: 15,
                    background: avatarUrl ? '#ffffff' : 'linear-gradient(135deg, #100f0d, #f95d00)', color: '#fbffff',
                    overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(249,93,0,0.2)',
                  }}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whitespace: 'nowrap' }}>
                      {profile?.prenom} {profile?.nom}
                    </p>
                    <p style={{ fontSize: 11, color: dark ? 'rgba(251,255,255,0.6)' : '#666', margin: '2px 0 4px 0', textOverflow: 'ellipsis', overflow: 'hidden', whitespace: 'nowrap' }}>
                      {profile?.email || ''}
                    </p>
                    <span style={{
                      display: 'inline-block', fontSize: 10, fontWeight: 700,
                      padding: '2px 8px', borderRadius: 99,
                      background: 'rgba(249,93,0,0.12)', color: '#f95d00',
                    }}>
                      {getRoleLabel(profile?.role)}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Link
                    to="/select-space"
                    onClick={() => setDropdownOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 12,
                      fontSize: 13, fontWeight: 600,
                      textDecoration: 'none',
                      color: dark ? '#fbffff' : '#100f0d',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f95d00' }}>swap_horiz</span>
                    <span>Changer d'espace</span>
                  </Link>

                  <Link
                    to={profilePath}
                    onClick={() => setDropdownOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 12,
                      fontSize: 13, fontWeight: 600,
                      textDecoration: 'none',
                      color: dark ? '#fbffff' : '#100f0d',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f95d00' }}>account_circle</span>
                    <span>Mon Profil</span>
                  </Link>

                  <div style={{ margin: '6px 0', borderTop: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(16,15,13,0.08)' }} />

                  <button
                    onClick={() => { setDropdownOpen(false); handleLogout(); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 12,
                      fontSize: 13, fontWeight: 600,
                      border: 'none', background: 'transparent',
                      color: '#ba1a1a', cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(186,26,26,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#ba1a1a' }}>logout</span>
                    <span>Déconnexion</span>
                  </button>
                </div>

              </div>
            )}
          </div>

        </div>
      </header>

      <div className="portal-shell" style={{ display: 'flex', paddingTop: 68 }}>

        {/* Mobile Overlay Backdrop */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 90,
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
            }}
            className="lg:hidden"
          />
        )}

        {/* Sidebar (Desktop + Mobile Drawer) */}
        <aside
          className={`portal-sidebar ${mobileMenuOpen ? 'portal-sidebar-open' : 'portal-sidebar-desktop'}`}
          style={{
            flexDirection: 'column',
            flexShrink: 0,
            width: 250,
            maxWidth: '85vw',
            minHeight: mobileMenuOpen ? '100vh' : 'calc(100vh - 68px)',
            position: mobileMenuOpen ? 'fixed' : 'sticky',
            top: mobileMenuOpen ? 0 : 68,
            left: 0,
            bottom: mobileMenuOpen ? 0 : 'auto',
            height: mobileMenuOpen ? '100vh' : 'auto',
            zIndex: mobileMenuOpen ? 100 : 20,
            alignSelf: 'flex-start',
            background: dark ? '#131210' : '#ffffff',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRight: dark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(16,15,13,0.08)',
            padding: mobileMenuOpen ? '20px 14px' : '24px 12px',
            overflowY: 'auto',
            boxShadow: mobileMenuOpen ? '4px 0 30px rgba(0,0,0,0.35)' : 'none',
            transition: 'background 0.3s ease',
          }}
        >
          {mobileMenuOpen && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 4px 12px', borderBottom: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(16,15,13,0.08)' }}>
              <BrandLogo to={homePath} height={32} />
              <button
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  width: 32, height: 32, borderRadius: 10, border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.06)',
                  color: dark ? '#fbffff' : '#100f0d',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
          )}

          {/* Label section */}
          <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.18em', padding: '0 12px', marginBottom: 12, color: dark ? 'rgba(251,255,255,0.5)' : '#44474d' }}>
            {portalLabel}
          </p>

          {/* Navigation links — Menu / Sous-menu (Spec §13) */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {navSections.map((section, idx) => (
              <div key={section.group || idx}>
                <p style={{
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em',
                  color: dark ? 'rgba(251,255,255,0.45)' : '#6b7280',
                  margin: '0 0 6px 12px',
                }}>
                  {section.group}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(section.items || []).map((item) => (
                    <NavLink
                      key={item.id}
                      item={item}
                      isActive={isNavActive(item.to)}
                      onClick={() => setMobileMenuOpen(false)}
                      dark={dark}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Logout button at bottom of sidebar */}
          <div style={{
            marginTop: 'auto',
            paddingTop: 20,
            borderTop: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(16,15,13,0.08)',
          }}>
            <button
              onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 14px',
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 14,
                border: '1px solid rgba(186,26,26,0.2)',
                background: 'rgba(186,26,26,0.05)',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                color: '#ba1a1a',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#ba1a1a';
                e.currentTarget.style.color = '#ffffff';
                const spans = e.currentTarget.querySelectorAll('span');
                spans.forEach(s => s.style.color = '#ffffff');
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(186,26,26,0.05)';
                e.currentTarget.style.color = '#ba1a1a';
                const spans = e.currentTarget.querySelectorAll('span');
                spans.forEach(s => s.style.color = '#ba1a1a');
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, flexShrink: 0, color: '#ba1a1a' }}>logout</span>
              <span style={{ color: '#ba1a1a' }}>Déconnexion</span>
            </button>
          </div>
        </aside>


        {/* Main content */}
        <main className="portal-main px-3 sm:px-5 py-4 sm:py-6" style={{
          flex: 1, overflowX: 'hidden',
          minHeight: 'calc(100vh - 68px)',
          minWidth: 0,
        }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
            {/* Breadcrumb — Fil d'ariane (Spec §13) */}
            <nav aria-label="Fil d'ariane" style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 500,
              color: dark ? 'rgba(251,255,255,0.55)' : '#6b7280',
              margin: '-4px 0 16px',
              flexWrap: 'wrap',
              minWidth: 0,
            }}>
              <Link to={homePath} style={{ color: '#f95d00', textDecoration: 'none', fontWeight: 600 }}>
                {portalLabel}
              </Link>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_right</span>
              <span style={{ color: dark ? '#fbffff' : '#100f0d', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 120px)' }}>{pageTitle}</span>
            </nav>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
