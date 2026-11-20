import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { getHomePath, isAdminRole, isMemberRole, isCompanyRole, canBookSpaces, getPostLoginPath } from '../../utils/roles';

function getRoleFromSession(session) {
  const meta = session?.user?.user_metadata || {};
  const appMeta = session?.user?.app_metadata || {};
  if (meta.role === 'company' || meta.role === 'entreprise' || meta.type_membre === 'entreprise') {
    return 'company';
  }
  return (
    meta.role ||
    appMeta.role ||
    null
  );
}

export function isSessionEmailUnverified(session) {
  if (!session?.user) return false;
  const role = getRoleFromSession(session);
  if (role === 'super_admin') return false;
  const meta = session.user.user_metadata || {};
  return meta.email_verifie === false || meta.requires_email_verification === true;
}

export function RoleGuard({
  session,
  requireSuperAdmin = false,
  requireAdmin = false,
  requireManagerOnly = false,
  requireMember = false,
  requireTrainer = false,
  requireBooker = false,
  requireCompany = false,
  children,
}) {
  const meta = session?.user?.user_metadata || {};
  const typeMembre = meta.type_membre || null;
  const role = getRoleFromSession(session) ?? 'member';
  const isCompany = isCompanyRole(role, typeMembre);

  // Blocage strict : aucun accès dashboard tant que l'e-mail n'est pas vérifié
  if (isSessionEmailUnverified(session)) {
    const email = session?.user?.email ? `?email=${encodeURIComponent(session.user.email)}` : '';
    return <Navigate to={`/verify-email${email}`} replace />;
  }

  if (requireSuperAdmin && role !== 'super_admin') {
    return <Navigate to={getHomePath(role, typeMembre)} replace />;
  }

  if (requireAdmin && !isAdminRole(role)) {
    return <Navigate to={getHomePath(role, typeMembre)} replace />;
  }

  if (requireManagerOnly && role !== 'admin' && role !== 'super_admin') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  if (requireCompany && !isCompany) {
    return <Navigate to={getHomePath(role, typeMembre)} replace />;
  }

  if (requireMember) {
    if (isCompany) {
      return <Navigate to="/company/dashboard" replace />;
    }
    if (!isMemberRole(role, typeMembre)) {
      return <Navigate to={getHomePath(role, typeMembre)} replace />;
    }
  }

  if (requireTrainer && role !== 'formateur') {
    return <Navigate to={getHomePath(role, typeMembre)} replace />;
  }

  if (requireBooker && !canBookSpaces(role, typeMembre)) {
    return <Navigate to={getHomePath(role, typeMembre)} replace />;
  }

  return children;
}

export function HomeRedirect({ session, fallback = null }) {
  const [state, setState] = useState({ loading: true, path: null, renderFallback: false });

  useEffect(() => {
    let cancelled = false;

    const resolveDestination = async () => {
      if (!session?.user?.id) {
        if (!cancelled) {
          setState({
            loading: false,
            path: fallback ? null : '/login',
            renderFallback: Boolean(fallback),
          });
        }
        return;
      }

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, statut_compte, email_verifie, is_super_admin, email, telephone, type_membre')
          .eq('id', session.user.id)
          .maybeSingle();

        if (cancelled) return;

        if (!profile) {
          setState({ loading: false, path: '/register/complete-profile', renderFallback: false });
          return;
        }

        const effectiveRole =
          profile.is_super_admin === true || profile.role === 'super_admin'
            ? 'super_admin'
            : (profile.role || getRoleFromSession(session) || 'member');

        if (profile.statut_compte === 'suspendu') {
          await supabase.auth.signOut().catch(() => {});
          if (!cancelled) {
            setState({
              loading: false,
              path: fallback ? null : '/login?reason=suspended',
              renderFallback: Boolean(fallback),
            });
          }
          return;
        }

        if (profile.statut_compte === 'en_attente' && effectiveRole === 'admin') {
          setState({ loading: false, path: '/register/pending-b2b', renderFallback: false });
          return;
        }

        const isSuperAdmin = effectiveRole === 'super_admin';
        if (!isSuperAdmin && profile.email_verifie === false) {
          const email = profile.email || session.user.email || '';
          setState({
            loading: false,
            path: `/verify-email${email ? `?email=${encodeURIComponent(email)}` : ''}`,
            renderFallback: false,
          });
          return;
        }

        if (isCompanyRole(effectiveRole, profile.type_membre)) {
          setState({ loading: false, path: '/company/dashboard', renderFallback: false });
          return;
        }

        const isNewIncompleteGoogleUser =
          effectiveRole === 'member' &&
          !profile.type_membre &&
          !profile.telephone &&
          !session.user.user_metadata?.requested_role;

        if (isNewIncompleteGoogleUser) {
          setState({ loading: false, path: '/register/complete-profile', renderFallback: false });
          return;
        }

        const dest = await getPostLoginPath(supabase, session.user.id, effectiveRole);
        if (!cancelled) {
          setState({ loading: false, path: dest || getHomePath(effectiveRole), renderFallback: false });
        }
      } catch (_) {
        if (!cancelled) {
          const role = getRoleFromSession(session);
          if (!role) {
            setState({ loading: false, path: '/register/complete-profile', renderFallback: false });
          } else {
            setState({ loading: false, path: getHomePath(role), renderFallback: false });
          }
        }
      }
    };

    resolveDestination();
    return () => { cancelled = true; };
  }, [session, fallback]);

  if (state.loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#f6f4f1',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            border: '3px solid #e5e2de',
            borderTop: '3px solid #f95d00',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ color: '#6b6560', fontSize: 14, margin: 0 }}>Redirection en cours…</p>
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

  if (state.renderFallback && fallback) {
    return fallback;
  }

  if (!state.path || state.path === window.location.pathname) {
    return fallback || <Navigate to="/dashboard" replace />;
  }

  return <Navigate to={state.path} replace />;
}
