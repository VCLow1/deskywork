import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { getHomePath, isAdminRole, isMemberRole, canBookSpaces, getPostLoginPath } from '../../utils/roles';

// Extrait le rôle depuis la session JWT (user_metadata) sans appel DB
function getRoleFromSession(session) {
  return (
    session?.user?.user_metadata?.role ||
    session?.user?.app_metadata?.role ||
    null
  );
}

export function RoleGuard({ session, requireSuperAdmin = false, requireAdmin = false, requireMember = false, requireTrainer = false, requireBooker = false, children }) {
  // Lecture synchrone depuis les métadonnées JWT — 0 appel DB, 0 délai
  const role = getRoleFromSession(session) ?? 'member';

  if (requireSuperAdmin && role !== 'super_admin') {
    return <Navigate to={getHomePath(role)} replace />;
  }

  if (requireAdmin && !isAdminRole(role)) {
    return <Navigate to={getHomePath(role)} replace />;
  }

  if (requireMember && !isMemberRole(role)) {
    return <Navigate to={getHomePath(role)} replace />;
  }

  if (requireTrainer && role !== 'formateur') {
    return <Navigate to={getHomePath(role)} replace />;
  }

  if (requireBooker && !canBookSpaces(role)) {
    return <Navigate to={getHomePath(role)} replace />;
  }

  return children;
}


export function HomeRedirect({ session }) {
  const [state, setState] = useState(() => {
    // Lecture synchrone du rôle — évite le spinner
    const role = getRoleFromSession(session);
    if (!session?.user?.id || !role) {
      return { loading: false, path: '/login' };
    }
    // Pour admin: besoin de vérifier l'onboarding (1 appel DB, mais seulement pour les admins)
    if (role === 'admin') {
      return { loading: true, path: getHomePath(role) };
    }
    return { loading: false, path: getHomePath(role) };
  });

  useEffect(() => {
    const role = getRoleFromSession(session);
    if (!session?.user?.id || role !== 'admin') return;

    getPostLoginPath(supabase, session.user.id, role)
      .then((path) => setState({ loading: false, path }))
      .catch(() => setState({ loading: false, path: '/admin/dashboard' }));
  }, [session]);

  if (state.loading) return null; // Bref instant, uniquement pour les admins
  return <Navigate to={state.path} replace />;
}
