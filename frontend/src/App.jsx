import React, { useState, useEffect, lazy, Suspense } from 'react';

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import { supabase } from './supabaseClient';

import { RoleGuard, HomeRedirect } from './components/auth/RoleGuard';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminPayments = lazy(() => import('./pages/AdminPayments'));
const AdminPricing = lazy(() => import('./pages/AdminPricing'));
const AdminReservations = lazy(() => import('./pages/AdminReservations'));
const MemberPayments = lazy(() => import('./pages/MemberPayments'));
const MemberSubscription = lazy(() => import('./pages/MemberSubscription'));
const StripeVerify = lazy(() => import('./pages/StripeVerify'));
const AdminCancellationPolicy = lazy(() => import('./pages/AdminCancellationPolicy'));
const AdminMessages = lazy(() => import('./pages/AdminMessages'));
const AdminAgenda = lazy(() => import('./pages/AdminAgenda'));
const BookingStep1 = lazy(() => import('./pages/BookingStep1'));
const BookingStep2 = lazy(() => import('./pages/BookingStep2'));
const BookingStep3 = lazy(() => import('./pages/BookingStep3'));
const QrCodeView = lazy(() => import('./pages/QrCodeView'));
const AdminFormations = lazy(() => import('./pages/AdminFormations'));
const AdminFormateurs = lazy(() => import('./pages/AdminFormateurs'));
const MemberFormations = lazy(() => import('./pages/MemberFormations'));
const MemberBookings = lazy(() => import('./pages/MemberBookings'));
const MemberProfile = lazy(() => import('./pages/MemberProfile'));
const MemberNotifications = lazy(() => import('./pages/MemberNotifications'));
const MemberMessages = lazy(() => import('./pages/MemberMessages'));
const TrainerPlanning = lazy(() => import('./pages/TrainerPlanning'));
const TrainerProfile = lazy(() => import('./pages/TrainerProfile'));
const TrainerDashboard = lazy(() => import('./pages/TrainerDashboard'));
const TrainerFormations = lazy(() => import('./pages/TrainerFormations'));
const TrainerBookings = lazy(() => import('./pages/TrainerBookings'));
const AdminNotifications = lazy(() => import('./pages/AdminNotifications'));
// Modules H, J, K, L, N
const GuestBookingPage = lazy(() => import('./pages/GuestBookingPage'));
const SignDocumentPage = lazy(() => import('./pages/SignDocumentPage'));
const MemberDocuments = lazy(() => import('./pages/MemberDocuments'));
const MemberRGPD = lazy(() => import('./pages/MemberRGPD'));
const AdminMultiSites = lazy(() => import('./pages/AdminMultiSites'));
const AdminOnboarding = lazy(() => import('./pages/AdminOnboarding'));
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'));
const TenantManagement = lazy(() => import('./pages/TenantManagement'));
const TenantBilling = lazy(() => import('./pages/TenantBilling'));
const SuperAdminMonitoring = lazy(() => import('./pages/SuperAdminMonitoring'));
const SuperAdminUsers = lazy(() => import('./pages/SuperAdminUsers'));
const SuperAdminContacts = lazy(() => import('./pages/SuperAdminContacts'));
const SuperAdminReservations = lazy(() => import('./pages/SuperAdminReservations'));
const SuperAdminPayments = lazy(() => import('./pages/SuperAdminPayments'));
const SuperAdminFormationsList = lazy(() => import('./pages/SuperAdminFormationsList'));
const SuperAdminEspaces = lazy(() => import('./pages/SuperAdminEspaces'));
const AdminEspaces = lazy(() => import('./pages/AdminEspaces'));
const AdminCoworkingProfile = lazy(() => import('./pages/AdminCoworkingProfile'));
const CoworkingDetail = lazy(() => import('./pages/CoworkingDetail'));

function LoadingFallback() {
  // Skeleton transparent — évite le flash blanc au lazy-load des pages
  return (
    <div style={{ minHeight: '100vh', background: '#f6f4f1' }} />
  );
}

export default function App() {

  // Lire la session Supabase de façon synchrone depuis localStorage
  // pour éviter le spinner de chargement au refresh
  const [session, setSession] = useState(() => {
    try {
      // Supabase stocke la session sous la clé "sb-<project-ref>-auth-token"
      // On scanne toutes les clés localStorage pour trouver la bonne
      const authKey = Object.keys(localStorage).find(
        k => k.startsWith('sb-') && k.endsWith('-auth-token')
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

  // Afficher le spinner seulement si aucune session n'a été trouvée en sync
  const [loading, setLoading] = useState(!session);



  useEffect(() => {
    const isRecoveryLink = window.location.hash.includes('access_token=')
      || window.location.search.includes('type=recovery')
      || window.location.search.includes('code=');
    if (isRecoveryLink && window.location.pathname === '/') {
      window.location.replace(`/reset-password${window.location.search}${window.location.hash}`);
      return undefined;
    }

    const hasAuthParams = window.location.search.includes('code=') || window.location.hash.includes('access_token=');

    // Vérifie le statut_compte EN ARRIÈRE-PLAN après l'affichage (ne bloque pas le rendu)
    const checkStatusInBackground = async (s) => {
      if (!s?.user?.id) return;
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('statut_compte')
          .eq('id', s.user.id)
          .single();

        if (!error && profile && profile.statut_compte && profile.statut_compte !== 'actif') {
          const reason = profile.statut_compte === 'en_attente' ? 'pending' : 'suspended';
          localStorage.setItem('pending_auth_status', profile.statut_compte);
          await supabase.auth.signOut();
          setSession(null);
          if (!window.location.pathname.includes('/login')) {
            window.location.replace(`/login?reason=${reason}`);
          }
        }
      } catch (_) {}
    };

    // Lecture synchrone : si la session vient du localStorage (déjà lue en useState),
    // on évite getSession() et on affiche immédiatement
    if (session) {
      setLoading(false);
      // Vérification du statut en arrière-plan, sans bloquer l'affichage
      checkStatusInBackground(session);
    } else {
      // Pas de session en cache → on attend la réponse Supabase (OAuth redirect, etc.)
      supabase.auth.getSession().then(({ data: { session: s } }) => {
        setSession(s);
        setLoading(false);
        if (s) checkStatusInBackground(s);
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // SIGNED_IN = nouvelle connexion → check statut immédiat
      // TOKEN_REFRESHED / INITIAL_SESSION = déjà géré ci-dessus, on met juste à jour la session
      setSession(s);
      setLoading(false);
      if (event === 'SIGNED_IN' && s) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f6f4f1' }} />
    );
  }



  const ProtectedRoute = ({ children }) => {

    if (!session) return <Navigate to="/login" replace />;

    return children;

  };



  const MemberRoute = ({ children }) => (

    <ProtectedRoute>

      <RoleGuard session={session} requireMember>

        {children}

      </RoleGuard>

    </ProtectedRoute>

  );



  const AdminRoute = ({ children }) => (

    <ProtectedRoute>

      <RoleGuard session={session} requireAdmin>

        {children}

      </RoleGuard>

    </ProtectedRoute>

  );

  const TrainerRoute = ({ children }) => (

    <ProtectedRoute>

      <RoleGuard session={session} requireTrainer>

        {children}

      </RoleGuard>

    </ProtectedRoute>

  );

  const BookerRoute = ({ children }) => (

    <ProtectedRoute>

      <RoleGuard session={session} requireBooker>

        {children}

      </RoleGuard>

    </ProtectedRoute>

  );

  const SuperAdminRoute = ({ children }) => (

    <ProtectedRoute>

      <RoleGuard session={session} requireSuperAdmin>

        {children}

      </RoleGuard>

    </ProtectedRoute>

  );



  return (

    <Router>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>

          <Route path="/" element={<Landing session={session} />} />

          <Route

            path="/login"

            element={session ? <HomeRedirect session={session} /> : <Login />}

          />

          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          <Route path="/super-admin/contacts" element={<SuperAdminRoute><SuperAdminContacts session={session} /></SuperAdminRoute>} />

          <Route

            path="/register"

            element={session ? <HomeRedirect session={session} /> : <Register />}

          />



          {/* Espace membre */}

          <Route

            path="/dashboard"

            element={

              <MemberRoute>

                <Dashboard session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/dashboard/abonnement"

            element={

              <MemberRoute>

                <MemberSubscription session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/dashboard/qr"

            element={

              <MemberRoute>

                <QrCodeView session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/dashboard/bookings"

            element={

              <MemberRoute>

                <MemberBookings session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/dashboard/profile"

            element={

              <MemberRoute>

                <MemberProfile session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/dashboard/notifications"

            element={

              <MemberRoute>

                <MemberNotifications session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/dashboard/messages"

            element={

              <MemberRoute>

                <MemberMessages session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/dashboard/formations"

            element={

              <MemberRoute>

                <MemberFormations session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/member/payments"

            element={

              <MemberRoute>

                <MemberPayments session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/member/payments/verify"

            element={

              <MemberRoute>

                <StripeVerify session={session} />

              </MemberRoute>

            }

          />

          <Route

            path="/book/step1"

            element={

              <BookerRoute>

                <BookingStep1 session={session} />

              </BookerRoute>

            }

          />

          <Route

            path="/book/step2"

            element={

              <BookerRoute>

                <BookingStep2 session={session} />

              </BookerRoute>

            }

          />

          <Route

            path="/book/step3"

            element={

              <BookerRoute>

                <BookingStep3 session={session} />

              </BookerRoute>

            }

          />



          {/* Espace administration */}

          <Route

            path="/admin/onboarding"

            element={

              <AdminRoute>

                <AdminOnboarding session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/dashboard"

            element={

              <AdminRoute>

                <AdminDashboard session={session} />

              </AdminRoute>

            }
          />

          <Route
            path="/admin/reservations"
            element={
              <AdminRoute>
                <AdminReservations session={session} />
              </AdminRoute>
            }
          />

          <Route

            path="/admin/pricing"

            element={

              <AdminRoute>

                <AdminPricing session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/payments"

            element={

              <AdminRoute>

                <AdminPayments session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/formations"

            element={

              <AdminRoute>

                <AdminFormations session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/espaces"

            element={

              <AdminRoute>

                <AdminEspaces session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/profile-coworking"

            element={

              <AdminRoute>

                <AdminCoworkingProfile session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/formateurs"

            element={

              <AdminRoute>

                <AdminFormateurs session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/cancellation-policy"

            element={

              <AdminRoute>

                <AdminCancellationPolicy session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/messages"

            element={

              <AdminRoute>

                <AdminMessages session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/agenda"

            element={

              <AdminRoute>

                <AdminAgenda session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/admin/notifications"

            element={

              <AdminRoute>

                <AdminNotifications session={session} />

              </AdminRoute>

            }

          />

          <Route

            path="/trainer/planning"

            element={

              <TrainerRoute>

                <TrainerPlanning session={session} />

              </TrainerRoute>

            }

          />

          <Route

            path="/trainer/profile"

            element={

              <TrainerRoute>

                <TrainerProfile session={session} />

              </TrainerRoute>

            }

          />

          <Route

            path="/trainer-dashboard"

            element={

              <TrainerRoute>

                <TrainerDashboard session={session} />

              </TrainerRoute>

            }

          />

          <Route

            path="/trainer/formations"

            element={

              <TrainerRoute>

                <TrainerFormations session={session} />

              </TrainerRoute>

            }

          />

          <Route

            path="/trainer/bookings"

            element={

              <TrainerRoute>

                <TrainerBookings session={session} />

              </TrainerRoute>

            }

          />

          <Route

            path="/trainer/payments"

            element={

              <TrainerRoute>

                <MemberPayments session={session} />

              </TrainerRoute>

            }

          />

          <Route

            path="/trainer/payments/verify"

            element={

              <TrainerRoute>

                <StripeVerify session={session} />

              </TrainerRoute>

            }

          />

          <Route

            path="/trainer/messages"

            element={

              <TrainerRoute>

                <MemberMessages session={session} />

              </TrainerRoute>

            }

          />

          <Route

            path="/super-admin/dashboard"

            element={

              <SuperAdminRoute>

                <SuperAdminDashboard session={session} />

              </SuperAdminRoute>

            }

          />

          <Route

            path="/super-admin/tenants"

            element={

              <SuperAdminRoute>

                <TenantManagement session={session} />

              </SuperAdminRoute>

            }

          />

          <Route

            path="/super-admin/users"

            element={

              <SuperAdminRoute>

                <SuperAdminUsers session={session} />

              </SuperAdminRoute>

            }

          />

          <Route

            path="/super-admin/billing"

            element={

              <SuperAdminRoute>

                <TenantBilling session={session} />

              </SuperAdminRoute>

            }

          />

          <Route

            path="/super-admin/monitoring"

            element={

              <SuperAdminRoute>

                <SuperAdminMonitoring session={session} />

              </SuperAdminRoute>

            }

          />

          <Route path="/super-admin/reservations" element={
            <SuperAdminRoute><SuperAdminReservations session={session} /></SuperAdminRoute>
          } />

          <Route path="/super-admin/payments" element={
            <SuperAdminRoute><SuperAdminPayments session={session} /></SuperAdminRoute>
          } />

          <Route path="/super-admin/formations" element={
            <SuperAdminRoute><SuperAdminFormationsList session={session} /></SuperAdminRoute>
          } />

          <Route path="/super-admin/espaces" element={
            <SuperAdminRoute><SuperAdminEspaces session={session} /></SuperAdminRoute>
          } />



          <Route path="*" element={<Navigate to="/" replace />} />

          {/* ── Modules H, K, L, N — Pages publiques & membre ── */}
          <Route path="/book-guest" element={<GuestBookingPage />} />
          <Route path="/coworking/:id" element={<CoworkingDetail />} />
          <Route path="/sign/:token" element={<SignDocumentPage />} />

          <Route path="/dashboard/documents" element={
            <MemberRoute><MemberDocuments session={session} /></MemberRoute>
          } />
          <Route path="/dashboard/rgpd" element={
            <MemberRoute><MemberRGPD session={session} /></MemberRoute>
          } />

          {/* ── Module N — Admin multi-sites ── */}
          <Route path="/admin/sites" element={
            <AdminRoute><AdminMultiSites session={session} /></AdminRoute>
          } />

        </Routes>
      </Suspense>
    </Router>

  );

}


