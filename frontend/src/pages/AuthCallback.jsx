import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { authUnifiedApi } from '../services/api/authUnified';
import {
  VALID_ROLE_IDS,
  readPendingOAuthRole,
  clearPendingOAuthRole,
} from '../constants/registrationRoles';

/**
 * Page intermédiaire après un redirect OAuth (Google).
 * - Vérifie le statut du compte via /api/auth/oauth-status.
 * - N'écrase jamais un rôle existant si le compte existe déjà.
 * - Redirige un nouvel utilisateur Google vers /register/complete-profile avec le rôle choisi.
 * - Bloque tout accès non vérifié vers /verify-email.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [message, setMessage] = useState('Connexion Google en cours…');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;

    const handleCallback = async () => {
      try {
        const oauthError = searchParams.get('error') || searchParams.get('error_description');
        if (oauthError) {
          clearPendingOAuthRole();
          await supabase.auth.signOut().catch(() => {});
          navigate(`/login?error=oauth_failed&error_description=${encodeURIComponent(oauthError)}`, { replace: true });
          return;
        }

        let { data: { session }, error } = await supabase.auth.getSession();

        // Attendre l'échange PKCE (?code=...) via onAuthStateChange ou polling jusqu'à 4.5s
        if (!session && !error) {
          session = await new Promise((resolve) => {
            let settled = false;
            const finish = (s) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              clearInterval(poller);
              subscription?.unsubscribe();
              resolve(s || null);
            };
            const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, s) => {
              if (s) finish(s);
            });
            const poller = setInterval(async () => {
              const { data } = await supabase.auth.getSession();
              if (data?.session) finish(data.session);
            }, 400);
            const timer = setTimeout(() => finish(null), 4500);
          });
        }

        if (cancelled) return;

        if (error || !session) {
          clearPendingOAuthRole();
          await supabase.auth.signOut().catch(() => {});
          navigate('/login?error=oauth_failed', { replace: true });
          return;
        }

        const paramRole = searchParams.get('intent_role');
        const requestedRole = VALID_ROLE_IDS.includes(paramRole)
          ? paramRole
          : readPendingOAuthRole();

        setMessage('Vérification de votre profil…');

        // Attendre brièvement si le trigger DB handle_new_user vient juste d'insérer profiles
        let statusRes = null;
        try {
          statusRes = await authUnifiedApi.checkOAuthStatus({ requestedRole });
        } catch (_) {
          await new Promise((r) => setTimeout(r, 1100));
          statusRes = await authUnifiedApi.checkOAuthStatus({ requestedRole });
        }

        if (cancelled) return;

        if (statusRes?.status === 'needs_profile_completion') {
          navigate(statusRes.redirectTo || '/register/complete-profile', { replace: true });
          return;
        }

        if (statusRes?.status === 'needs_email_verification') {
          clearPendingOAuthRole();
          navigate(statusRes.redirectTo || '/verify-email', {
            state: {
              email: statusRes.email || session.user.email,
              requestedRole: statusRes.requestedRole,
            },
            replace: true,
          });
          return;
        }

        // Compte existant : Si l'utilisateur tentait de s'inscrire avec un e-mail déjà existant, bloquer selon CDC §2.2
        if (requestedRole) {
          clearPendingOAuthRole();
          await supabase.auth.signOut().catch(() => {});
          navigate(`/login?error=account_exists&message=${encodeURIComponent('Cette adresse e-mail est déjà associée à un compte existant. Veuillez vous connecter.')}`, { replace: true });
          return;
        }

        clearPendingOAuthRole();

        if (statusRes?.statutCompte === 'suspendu') {
          await supabase.auth.signOut();
          navigate('/login?reason=suspended', { replace: true });
          return;
        }

        if (statusRes?.statutCompte === 'en_attente' && statusRes?.role === 'admin') {
          await supabase.auth.signOut();
          navigate('/register/pending-b2b', {
            state: { email: session.user.email },
            replace: true,
          });
          return;
        }

        if (statusRes?.notice) {
          setNotice(statusRes.notice);
          setMessage('Redirection vers votre espace existant…');
          await new Promise((r) => setTimeout(r, 1600));
          if (cancelled) return;
        }

        const inviteToken = (() => {
          try { return sessionStorage.getItem('deskywork_invite_token'); } catch (_) { return null; }
        })();

        if (inviteToken) {
          try { sessionStorage.removeItem('deskywork_invite_token'); } catch (_) {}
          navigate(`/invitation/${inviteToken}`, { replace: true });
          return;
        }

        navigate(statusRes?.redirectTo || '/dashboard', { replace: true });
      } catch (err) {
        if (!cancelled) {
          clearPendingOAuthRole();
          const errText = err?.message ? `&error_description=${encodeURIComponent(err.message)}` : '';
          await supabase.auth.signOut().catch(() => {});
          navigate(`/login?error=oauth_failed${errText}`, { replace: true });
        }
      }
    };

    handleCallback();

    return () => { cancelled = true; };
  }, [navigate, searchParams]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f6f4f1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          border: '4px solid #e5e2de',
          borderTop: '4px solid #f95d00',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <p style={{ color: '#6b6560', fontSize: 15, margin: 0, textAlign: 'center' }}>{message}</p>
      {notice && (
        <div
          style={{
            maxWidth: 440,
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            color: '#9a3412',
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          {notice}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
