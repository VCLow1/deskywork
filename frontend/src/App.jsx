import React, { useState, useEffect, useRef, createContext, useContext, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { RoleGuard, HomeRedirect } from './components/auth/RoleGuard';
import { LanguageProvider } from './context/LanguageContext';

const SessionContext = createContext(null);

function isSameSession(a, b) {
  return (a?.user?.id || null) === (b?.user?.id || null)
    && (a?.access_token || null) === (b?.access_token || null);
}

function ProtectedRoute({ children }) {
  const session = useContext(SessionContext);
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function MemberRoute({ children }) {
  const session = useContext(SessionContext);
  return (
    <ProtectedRoute>
      <RoleGuard session={session} requireMember>
        {children}
      </RoleGuard>
    </ProtectedRoute>
  );
}

function AdminRoute({ children, adminOnly = false }) {
  const session = useContext(SessionContext);
  return (
    <ProtectedRoute>
      <RoleGuard session={session} requireAdmin requireManagerOnly={adminOnly}>
        {children}
      </RoleGuard>
    </ProtectedRoute>
  );
}

function TrainerRoute({ children }) {
  const session = useContext(SessionContext);
  return (
    <ProtectedRoute>
      <RoleGuard session={session} requireTrainer>
        {children}
      </RoleGuard>
    </ProtectedRoute>
  );
}

function BookerRoute({ children }) {
  const session = useContext(SessionContext);
  return (
    <ProtectedRoute>
      <RoleGuard session={session} requireBooker>
        {children}
      </RoleGuard>
    </ProtectedRoute>
  );
}

function SuperAdminRoute({ children }) {
  const session = useContext(SessionContext);
  return (
    <ProtectedRoute>
      <RoleGuard session={session} requireSuperAdmin>
        {children}
      </RoleGuard>
    </ProtectedRoute>
  );
}

// Pages publiques & auth
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const CompleteProfileOAuth = lazy(() => import('./pages/CompleteProfileOAuth'));
const PendingB2BConfirmation = lazy(() => import('./pages/PendingB2BConfirmation'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

// Architecture Unifiée : Profils, Onboarding, Espaces, Invitations & Validation
const ProfileChoice = lazy(() => import('./pages/ProfileChoice'));
const SpaceOnboarding = lazy(() => import('./pages/SpaceOnboarding'));
const TrainerOnboarding = lazy(() => import('./pages/TrainerOnboarding'));
const SelectSpace = lazy(() => import('./pages/SelectSpace'));
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation'));
const SuperAdminValidation = lazy(() => import('./pages/SuperAdminValidation'));

// Espace Membre
const Dashboard = lazy(() => import('./pages/Dashboard'));
const MemberPayments = lazy(() => import('./pages/MemberPayments'));
const MemberSubscription = lazy(() => import('./pages/MemberSubscription'));
// CDC v3.0 D1 : paiement en ligne / Stripe désactivé en v1
const MemberBookings = lazy(() => import('./pages/MemberBookings'));
const MemberProfile = lazy(() => import('./pages/MemberProfile'));
const MemberNotifications = lazy(() => import('./pages/MemberNotifications'));
const MemberMessages = lazy(() => import('./pages/MemberMessages'));
const MemberFormations = lazy(() => import('./pages/MemberFormations'));
const MemberDocuments = lazy(() => import('./pages/MemberDocuments'));
const MemberRGPD = lazy(() => import('./pages/MemberRGPD'));
const QrCodeView = lazy(() => import('./pages/QrCodeView'));

// Réservations membres & invités
const BookingStep1 = lazy(() => import('./pages/BookingStep1'));
const BookingStep2 = lazy(() => import('./pages/BookingStep2'));
const BookingStep3 = lazy(() => import('./pages/BookingStep3'));
const GuestBookingPage = lazy(() => import('./pages/GuestBookingPage'));
const CoworkingDetail = lazy(() => import('./pages/CoworkingDetail'));
const SignDocumentPage = lazy(() => import('./pages/SignDocumentPage'));
const DevenirFormateurPage = lazy(() => import('./pages/DevenirFormateurPage'));
const EspacesPartenairesPage = lazy(() => import('./pages/EspacesPartenairesPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

// Espace Admin Coworking / Centre de formation
const AdminOnboarding = lazy(() => import('./pages/AdminOnboarding'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminPayments = lazy(() => import('./pages/AdminPayments'));
const AdminPricing = lazy(() => import('./pages/AdminPricing'));
const AdminReservations = lazy(() => import('./pages/AdminReservations'));
const AdminCancellationPolicy = lazy(() => import('./pages/AdminCancellationPolicy'));
const AdminMessages = lazy(() => import('./pages/AdminMessages'));
const AdminAgenda = lazy(() => import('./pages/AdminAgenda'));
const AdminFormations = lazy(() => import('./pages/AdminFormations'));
const AdminFormateurs = lazy(() => import('./pages/AdminFormateurs'));
const AdminNotifications = lazy(() => import('./pages/AdminNotifications'));
const AdminEspaces = lazy(() => import('./pages/AdminEspaces'));
const AdminCoworkingProfile = lazy(() => import('./pages/AdminCoworkingProfile'));
const AdminMultiSites = lazy(() => import('./pages/AdminMultiSites'));
const AdminClients = lazy(() => import('./pages/AdminClients'));
const AdminTeam = lazy(() => import('./pages/AdminTeam'));
const AdminSubscription = lazy(() => import('./pages/AdminSubscription'));
const AdminReports = lazy(() => import('./pages/AdminReports'));
const AdminMarketplaceStats = lazy(() => import('./pages/AdminMarketplaceStats'));
const AdminNotificationsSupport = lazy(() => import('./pages/AdminNotificationsSupport'));

// Espace Formateur
const TrainerPlanning = lazy(() => import('./pages/TrainerPlanning'));
const TrainerProfile = lazy(() => import('./pages/TrainerProfile'));
const TrainerDashboard = lazy(() => import('./pages/TrainerDashboard'));
const TrainerFormations = lazy(() => import('./pages/TrainerFormations'));
const TrainerBookings = lazy(() => import('./pages/TrainerBookings'));

// Espace Super Admin
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'));
const SuperAdminTenants = lazy(() => import('./pages/TenantManagement'));
const SuperAdminBilling = lazy(() => import('./pages/TenantBilling'));
const SuperAdminMonitoring = lazy(() => import('./pages/SuperAdminMonitoring'));
const SuperAdminUsers = lazy(() => import('./pages/SuperAdminUsers'));
const SuperAdminContacts = lazy(() => import('./pages/SuperAdminContacts'));
const SuperAdminReservations = lazy(() => import('./pages/SuperAdminReservations'));
const SuperAdminPayments = lazy(() => import('./pages/SuperAdminPayments'));
const SuperAdminFormationsList = lazy(() => import('./pages/SuperAdminFormationsList'));
const SuperAdminEspaces = lazy(() => import('./pages/SuperAdminEspaces'));

function LoadingFallback() {
  return <div style={{ minHeight: '100vh', background: '#f6f4f1' }} />;
}

export default function App() {
  // Lecture synchrone de la session depuis le cache local pour éviter le flash
  const [session, setSession] = useState(() => {
    try {
      const authKey = Object.keys(localStorage).find(
        (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
      );
      if (authKey) {
        const parsed = JSON.parse(localStorage.getItem(authKey));
        const expiresAt = parsed?.expires_at;
        if (expiresAt && Date.now() / 1000 < expiresAt) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  });

  const [loading, setLoading] = useState(!session);

  useEffect(() => {
    const isRecoveryLink =
      window.location.search.includes('type=recovery') ||
      window.location.hash.includes('type=recovery');
    const isRootOAuthFallback =
      !isRecoveryLink &&
      window.location.pathname === '/' &&
      (window.location.hash.includes('access_token=') ||
        window.location.search.includes('code=') ||
        window.location.search.includes('error='));

    if (isRecoveryLink && window.location.pathname === '/') {
      window.location.replace(`/reset-password${window.location.search}${window.location.hash}`);
      return undefined;
    }
    if (isRootOAuthFallback) {
      window.location.replace(`/auth/callback${window.location.search}${window.location.hash}`);
      return undefined;
    }

    const hasAuthParams =
      window.location.search.includes('code=') || window.location.hash.includes('access_token=');

    let checkedUserId = null;
    const checkStatusInBackground = async (s) => {
      if (!s?.user?.id) return;
      if (checkedUserId === s.user.id) return;
      checkedUserId = s.user.id;
      try {
        const currentPath = window.location.pathname;
        const authFlowPaths = ['/verify-email', '/register/complete-profile', '/register/pending-b2b', '/auth/callback', '/login'];

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role, statut_compte, email_verifie, is_super_admin, email')
          .eq('id', s.user.id)
          .single();

        if (error || !profile) return;

        const isSuperAdmin = profile.role === 'super_admin' || profile.is_super_admin === true;
        const meta = s.user.user_metadata || {};
        const mustVerifyEmail = !isSuperAdmin && profile.email_verifie === false && (
          meta.email_verifie === false ||
          meta.requires_email_verification === true ||
          !s.user.email_confirmed_at
        );

        if (mustVerifyEmail) {
          if (!authFlowPaths.some((p) => currentPath.includes(p))) {
            window.location.replace(`/verify-email?email=${encodeURIComponent(profile.email || s.user.email || '')}`);
          }
          return;
        }

        if (profile.statut_compte && profile.statut_compte !== 'actif') {
          const reason = profile.statut_compte === 'en_attente' ? 'pending' : 'suspended';
          localStorage.setItem('pending_auth_status', profile.statut_compte);
          await supabase.auth.signOut();
          setSession(null);
          if (!authFlowPaths.some((p) => currentPath.includes(p))) {
            if (reason === 'pending' && profile.role === 'admin') {
              window.location.replace('/register/pending-b2b');
            } else {
              window.location.replace(`/login?reason=${reason}`);
            }
          }
        }
      } catch (_) {}
    };

    if (session) {
      setLoading(false);
      checkStatusInBackground(session);
    } else {
      supabase.auth.getSession().then(({ data: { session: s } }) => {
        setSession(s);
        setLoading(false);
        if (s) checkStatusInBackground(s);
      });
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession((prev) => (isSameSession(prev, s) ? prev : s));
      setLoading(false);
      if (!s?.user?.id) {
        checkedUserId = null;
      } else if (event === 'SIGNED_IN') {
        checkStatusInBackground(s);
      }
    });

    let fallbackTimeout;
    if (hasAuthParams) {
      fallbackTimeout = setTimeout(() => {
        setLoading(false);
      }, 3000);
    }

    return () => {
      subscription.unsubscribe();
      if (fallbackTimeout) clearTimeout(fallbackTimeout);
    };
  }, []);

  if (loading) {
    return <LoadingFallback />;
  }

  return (
    <Router>
      <LanguageProvider>
        <SessionContext.Provider value={session}>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
            {/* ── Routes publiques & Auth ── */}
            <Route path="/" element={<Landing session={session} />} />
            <Route path="/login" element={session ? <HomeRedirect session={session} fallback={<Login />} /> : <Login />} />
            <Route path="/register" element={session ? <HomeRedirect session={session} fallback={<Register />} /> : <Register />} />
            <Route path="/register/complete-profile" element={<CompleteProfileOAuth />} />
            <Route path="/register/pending-b2b" element={<PendingB2BConfirmation />} />
            <Route path="/verify-email" element={<VerifyEmailPage session={session} />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/book-guest" element={<GuestBookingPage />} />
            <Route path="/coworking/:id" element={<CoworkingDetail />} />
            <Route path="/devenir-formateur" element={<DevenirFormateurPage session={session} />} />
            <Route path="/espaces-partenaires" element={<EspacesPartenairesPage session={session} />} />
            <Route path="/cgu" element={<LegalPage session={session} doc="cgu" />} />
            <Route path="/confidentialite" element={<LegalPage session={session} doc="confidentialite" />} />
            <Route path="/cookies" element={<LegalPage session={session} doc="cookies" />} />
            <Route path="/sign/:token" element={<SignDocumentPage />} />
            <Route path="/invitation/:token" element={<AcceptInvitation />} />
            <Route path="/invitations/:token" element={<AcceptInvitation />} />

            {/* ── Architecture Unifiée : Profils, Multi-Organisations & Onboarding ── */}
            <Route path="/profile-choice" element={<ProtectedRoute><ProfileChoice /></ProtectedRoute>} />
            <Route path="/onboarding/space" element={<ProtectedRoute><SpaceOnboarding /></ProtectedRoute>} />
            <Route path="/onboarding/trainer" element={<ProtectedRoute><TrainerOnboarding /></ProtectedRoute>} />
            <Route path="/select-space" element={<ProtectedRoute><SelectSpace /></ProtectedRoute>} />

            {/* ── Espace Membre ── */}
            <Route path="/dashboard" element={<MemberRoute><Dashboard session={session} /></MemberRoute>} />
            <Route path="/dashboard/abonnement" element={<MemberRoute><MemberSubscription session={session} /></MemberRoute>} />
            <Route path="/dashboard/qr" element={<MemberRoute><QrCodeView session={session} /></MemberRoute>} />
            <Route path="/dashboard/bookings" element={<MemberRoute><MemberBookings session={session} /></MemberRoute>} />
            <Route path="/dashboard/profile" element={<MemberRoute><MemberProfile session={session} /></MemberRoute>} />
            <Route path="/dashboard/notifications" element={<MemberRoute><MemberNotifications session={session} /></MemberRoute>} />
            <Route path="/dashboard/messages" element={<MemberRoute><MemberMessages session={session} /></MemberRoute>} />
            <Route path="/dashboard/formations" element={<MemberRoute><MemberFormations session={session} /></MemberRoute>} />
            <Route path="/dashboard/documents" element={<MemberRoute><MemberDocuments session={session} /></MemberRoute>} />
            <Route path="/dashboard/rgpd" element={<MemberRoute><MemberRGPD session={session} /></MemberRoute>} />
            <Route path="/member/payments" element={<MemberRoute><MemberPayments session={session} /></MemberRoute>} />
            <Route path="/member/payments/verify" element={<Navigate to="/member/payments" replace />} />

            {/* ── Réservations membres ── */}
            <Route path="/book/step1" element={<BookerRoute><BookingStep1 session={session} /></BookerRoute>} />
            <Route path="/book/step2" element={<BookerRoute><BookingStep2 session={session} /></BookerRoute>} />
            <Route path="/book/step3" element={<BookerRoute><BookingStep3 session={session} /></BookerRoute>} />

            {/* ── Espace Administration Coworking / Centre de Formation ── */}
            <Route path="/admin/onboarding" element={<AdminRoute><AdminOnboarding session={session} /></AdminRoute>} />
            <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboard session={session} /></AdminRoute>} />
            <Route path="/admin/rapports" element={<AdminRoute adminOnly><AdminReports session={session} /></AdminRoute>} />
            <Route path="/admin/statistiques" element={<AdminRoute adminOnly><AdminMarketplaceStats session={session} /></AdminRoute>} />
            <Route path="/admin/reservations" element={<AdminRoute><AdminReservations session={session} /></AdminRoute>} />
            <Route path="/admin/clients" element={<AdminRoute><AdminClients session={session} /></AdminRoute>} />
            <Route path="/admin/pricing" element={<AdminRoute adminOnly><AdminPricing session={session} /></AdminRoute>} />
            <Route path="/admin/payments" element={<AdminRoute><AdminPayments session={session} /></AdminRoute>} />
            <Route path="/admin/formations" element={<AdminRoute><AdminFormations session={session} /></AdminRoute>} />
            <Route path="/admin/espaces" element={<AdminRoute><AdminEspaces session={session} /></AdminRoute>} />
            <Route path="/admin/profile-coworking" element={<AdminRoute adminOnly><AdminCoworkingProfile session={session} /></AdminRoute>} />
            <Route path="/admin/team" element={<AdminRoute adminOnly><AdminTeam session={session} /></AdminRoute>} />
            <Route path="/admin/subscription" element={<AdminRoute adminOnly><AdminSubscription session={session} /></AdminRoute>} />
            <Route path="/admin/formateurs" element={<AdminRoute><AdminFormateurs session={session} /></AdminRoute>} />
            <Route path="/admin/cancellation-policy" element={<AdminRoute adminOnly><AdminCancellationPolicy session={session} /></AdminRoute>} />
            <Route path="/admin/messages" element={<AdminRoute><AdminMessages session={session} /></AdminRoute>} />
            <Route path="/admin/agenda" element={<AdminRoute><AdminAgenda session={session} /></AdminRoute>} />
            <Route path="/admin/notifications" element={<AdminRoute><AdminNotifications session={session} /></AdminRoute>} />
            <Route path="/admin/notifications-support" element={<AdminRoute><AdminNotificationsSupport session={session} /></AdminRoute>} />
            <Route path="/admin/support" element={<AdminRoute><AdminNotificationsSupport session={session} /></AdminRoute>} />
            <Route path="/admin/sites" element={<AdminRoute adminOnly><AdminMultiSites session={session} /></AdminRoute>} />

            {/* ── Espace Formateur ── */}
            <Route path="/trainer-dashboard" element={<TrainerRoute><TrainerDashboard session={session} /></TrainerRoute>} />
            <Route path="/trainer/planning" element={<TrainerRoute><TrainerPlanning session={session} /></TrainerRoute>} />
            <Route path="/trainer/profile" element={<TrainerRoute><TrainerProfile session={session} /></TrainerRoute>} />
            <Route path="/trainer/formations" element={<TrainerRoute><TrainerFormations session={session} /></TrainerRoute>} />
            <Route path="/trainer/bookings" element={<TrainerRoute><TrainerBookings session={session} /></TrainerRoute>} />
            <Route path="/trainer/payments" element={<TrainerRoute><MemberPayments session={session} /></TrainerRoute>} />
            <Route path="/trainer/payments/verify" element={<Navigate to="/trainer/payments" replace />} />
            <Route path="/trainer/messages" element={<TrainerRoute><MemberMessages session={session} /></TrainerRoute>} />

            {/* ── Espace Super Admin ── */}
            <Route path="/super-admin/dashboard" element={<SuperAdminRoute><SuperAdminDashboard session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/tenants" element={<SuperAdminRoute><SuperAdminTenants session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/users" element={<SuperAdminRoute><SuperAdminUsers session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/billing" element={<SuperAdminRoute><SuperAdminBilling session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/monitoring" element={<SuperAdminRoute><SuperAdminMonitoring session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/reservations" element={<SuperAdminRoute><SuperAdminReservations session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/payments" element={<SuperAdminRoute><SuperAdminPayments session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/formations" element={<SuperAdminRoute><SuperAdminFormationsList session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/espaces" element={<SuperAdminRoute><SuperAdminEspaces session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/contacts" element={<SuperAdminRoute><SuperAdminContacts session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/validations" element={<SuperAdminRoute><SuperAdminValidation session={session} /></SuperAdminRoute>} />
            <Route path="/super-admin/validation" element={<SuperAdminRoute><SuperAdminValidation session={session} /></SuperAdminRoute>} />

            {/* Redirection fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </SessionContext.Provider>
    </LanguageProvider>
  </Router>
  );
}
