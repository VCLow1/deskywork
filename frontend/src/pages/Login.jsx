// pages/Login.jsx — Écran de connexion unique (CDC v3.0 : Email/Mot de passe + Google SSO uniquement ;
// la connexion par code WhatsApp/SMS est reportée en phase 2).
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BrandLogo from '../components/layout/BrandLogo';
import { useLanguage, LanguageSwitcher } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';
import { clearPendingOAuthRole } from '../constants/registrationRoles';

/* ─── Icône SVG Google ─── */
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/* ─── Comptes de test multi-rôles pour accès direct 1-clic ─── */
const TEST_ACCOUNTS = [
  {
    key: 'super_admin',
    name: 'Super Admin',
    roleTag: 'Plateforme',
    badge: 'Super Admin',
    email: 'test.superadmin@deskywork.tn',
    password: 'DeskyTest@2026!',
    targetPath: '/super-admin/dashboard',
    icon: 'shield_person',
    chipBg: 'bg-purple-50 hover:bg-purple-100/90 border-purple-200 text-purple-700',
    iconBg: 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white',
    description: 'Gestion globale plateforme & monitoring',
  },
  {
    key: 'admin',
    name: 'Gérant Coworking',
    roleTag: 'Établissement',
    badge: 'Gérant',
    email: 'test.admin@deskywork.tn',
    password: 'DeskyTest@2026!',
    targetPath: '/admin/dashboard',
    defaultOrgId: 'd0000000-0000-4000-8000-000000000001',
    icon: 'storefront',
    chipBg: 'bg-orange-50 hover:bg-orange-100/90 border-orange-200 text-[#f95d00]',
    iconBg: 'bg-gradient-to-br from-[#f95d00] to-amber-500 text-white',
    description: 'Pack Premium : coworking & formations',
  },
  {
    key: 'trainer',
    name: 'Formateur',
    roleTag: 'Sessions fixes',
    badge: 'Formateur',
    email: 'test.trainer@deskywork.tn',
    password: 'DeskyTest@2026!',
    targetPath: '/trainer-dashboard',
    icon: 'school',
    chipBg: 'bg-indigo-50 hover:bg-indigo-100/90 border-indigo-200 text-indigo-700',
    iconBg: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
    description: 'Création de sessions & ateliers',
  },
  {
    key: 'company',
    name: 'Entreprise',
    roleTag: 'Société B2B',
    badge: 'B2B',
    email: 'test.company@deskywork.tn',
    password: 'DeskyTest@2026!',
    targetPath: '/company/dashboard',
    defaultOrgId: 'd0000000-0000-4000-8000-000000000002',
    icon: 'business',
    chipBg: 'bg-emerald-50 hover:bg-emerald-100/90 border-emerald-200 text-emerald-700',
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
    description: 'Réservations collaborateurs & facturation',
  },
  {
    key: 'member',
    name: 'Membre',
    roleTag: 'Particulier',
    badge: 'Membre',
    email: 'test.member@deskywork.tn',
    password: 'DeskyTest@2026!',
    targetPath: '/dashboard',
    icon: 'person',
    chipBg: 'bg-sky-50 hover:bg-sky-100/90 border-sky-200 text-sky-700',
    iconBg: 'bg-gradient-to-br from-sky-500 to-blue-600 text-white',
    description: 'Réservations nomades & espace personnel',
  },
];

export default function Login() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Champs Mot de passe
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loggingInRole, setLoggingInRole] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState('');

  // Vérifier les messages dans l'URL
  useEffect(() => {
    const reason = searchParams.get('reason');
    const verified = searchParams.get('verified');
    const emailParam = searchParams.get('email');
    const oauthErr = searchParams.get('error');
    const oauthErrDesc = searchParams.get('error_description');
    const msgParam = searchParams.get('message');
    if (emailParam) setEmail((prev) => prev || emailParam);
    if (verified === '1') {
      setInfoMsg('Votre adresse e-mail est confirmée. Connectez-vous pour accéder à votre espace.');
    }
    if (msgParam) {
      setErrorMsg(msgParam);
    } else if (oauthErr === 'account_exists') {
      setErrorMsg('Cette adresse e-mail est déjà associée à un compte existant. Veuillez vous connecter.');
    } else if (reason === 'pending') {
      setErrorMsg(t('login.pendingApprovalAlert'));
    } else if (reason === 'suspended') {
      setErrorMsg(t('login.suspendedAlert'));
    } else if (oauthErr === 'oauth_failed') {
      setErrorMsg(oauthErrDesc || 'La connexion avec Google n\'a pas abouti. Veuillez réessayer.');
    }
  }, [searchParams, t]);

  // ── Redirection après connexion réussie ──────────────────────────────────────
  const handlePostLoginRedirect = async (user, targetPath = null) => {
    try {
      const context = await authUnifiedApi.getMyContext();

      if (context.requiresEmailVerification) {
        navigate(`/verify-email?email=${encodeURIComponent(user?.email || email)}`, { replace: true });
        return;
      }

      if (targetPath) {
        navigate(targetPath, { replace: true });
        return;
      }

      if (context.userContextType === 'company' || context.profile?.type_membre === 'entreprise' || context.profile?.role === 'company' || context.profile?.role === 'entreprise') {
        navigate('/company/dashboard', { replace: true });
        return;
      }

      if (context.hasMultipleOrgs) {
        navigate('/select-space', { replace: true });
        return;
      }

      if (context.memberships?.length === 1) {
        const org = context.memberships[0].organization;
        localStorage.setItem('active_org_id', org.id);
      }

      navigate(context.recommendedRedirect || '/dashboard', { replace: true });
    } catch (_) {
      navigate(targetPath || '/dashboard', { replace: true });
    }
  };

  // ── Connexion instantanée 1-clic aux comptes de test ──────────────────────
  const handleQuickTestLogin = async (acc) => {
    if (loading || loggingInRole) return;
    setLoggingInRole(acc.key);
    setErrorMsg('');
    setInfoMsg(`Connexion en cours : ${acc.name} (${acc.roleTag})...`);
    setEmail(acc.email);
    setPassword(acc.password);

    try {
      // Déconnecter toute session active locale
      await supabase.auth.signOut().catch(() => {});

      if (acc.defaultOrgId) {
        localStorage.setItem('active_org_id', acc.defaultOrgId);
      } else {
        localStorage.removeItem('active_org_id');
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: acc.email,
        password: acc.password,
      });

      if (error) throw error;

      await handlePostLoginRedirect(data.user, acc.targetPath);
    } catch (err) {
      setErrorMsg(err.message || `Impossible de se connecter au compte ${acc.name}.`);
    } finally {
      setLoggingInRole(null);
    }
  };

  // ── 1. Connexion Email + Mot de passe ───────────────────────────────────────
  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');
    setUnverifiedEmail('');

    const cleanEmail = email.trim().toLowerCase();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) throw error;

      await handlePostLoginRedirect(data.user);
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('email not confirmed')) {
        setUnverifiedEmail(cleanEmail);
        setErrorMsg('Votre adresse e-mail n\'est pas encore vérifiée. Veuillez activer votre compte avant de vous connecter.');
      } else {
        setErrorMsg(err.message || 'Identifiants incorrects.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── 2. Connexion Sociale Google ────────────────────────────────────────────
  const handleGoogleLogin = async () => {
    setErrorMsg('');
    clearPendingOAuthRole();
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setErrorMsg(err.message || 'Erreur Google OAuth.');
    }
  };

  return (
    <div className="min-h-screen min-w-0 flex font-inter text-on-surface bg-[#f8fafc]">

      {/* ══════════════════════════════════════════
          PANNEAU GAUCHE — Illustratif (Desktop)
          ══════════════════════════════════════════ */}
      <div
        className="hidden lg:flex flex-col justify-between shrink-0"
        aria-hidden="true"
        style={{
          width: '45%',
          minWidth: 380,
          padding: '40px 48px',
          background: 'linear-gradient(145deg, #100f0d 0%, #1c1b18 50%, #291a0c 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{
          position: 'absolute', top: -100, right: -80,
          width: 420, height: 420, borderRadius: '50%', opacity: 0.22,
          background: 'radial-gradient(circle, #f95d00, transparent)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -80, left: -60,
          width: 320, height: 320, borderRadius: '50%', opacity: 0.15,
          background: 'radial-gradient(circle, #ffedd8, transparent)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', zIndex: 10 }}>
          <BrandLogo to="/" light height={54} />
        </div>

        <div style={{ position: 'relative', zIndex: 10 }} className="animate-fade-up">
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 16px', borderRadius: 99,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              background: 'rgba(249,93,0,0.14)', color: '#f95d00',
              border: '1px solid rgba(249,93,0,0.3)',
              marginBottom: 20,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
            Connexion sécurisée
          </span>

          <h2
            className="font-sora"
            style={{ color: '#fbffff', fontWeight: 700, fontSize: 'clamp(28px, 3.2vw, 42px)', lineHeight: 1.18, marginBottom: 16 }}
          >
            Un seul login,<br />
            <span style={{ color: '#f95d00' }}>tous vos espaces</span><br />
            et activités.
          </h2>

          <p style={{ color: 'rgba(251,255,255,0.75)', fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
            Accédez à votre espace en tant que particulier, entreprise, formateur ou gérant d'établissement. Chaque adresse e-mail est liée à un compte et rôle figé.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: 'lock', text: 'Chiffrement et protection des données' },
              { icon: 'swap_horiz', text: 'Changement d\'organisation en 1 clic' },
              { icon: 'bolt', text: 'Accès instantané à la marketplace et aux sessions' },
            ].map(({ icon, text }) => (
              <div key={icon} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'rgba(249,93,0,0.18)', color: '#f95d00',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{icon}</span>
                </span>
                <span style={{ color: 'rgba(251,255,255,0.85)', fontSize: 14 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 10, display: 'flex', gap: 28 }}>
          <div>
            <div className="font-sora text-white text-xl font-bold">24/7</div>
            <div className="text-xs text-white/60">Accès garanti</div>
          </div>
          <div>
            <div className="font-sora text-white text-xl font-bold">Espaces dédiés</div>
            <div className="text-xs text-white/60">Isolation des données</div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          PANNEAU DROIT — Formulaire de connexion
          ══════════════════════════════════════════ */}
      <div className="w-full min-w-0 flex-1 page-gradient flex flex-col relative overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 relative z-10 border-b border-outline-variant/15">
          <div className="lg:hidden">
            <BrandLogo to="/" height={38} />
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <Link to="/register" className="text-sm font-semibold text-secondary hover:underline">
              {t('common.register')}
            </Link>
          </div>
        </header>

        <main className="w-full flex-1 flex items-center justify-center px-4 sm:px-6 py-8 relative z-10">
          <div className="w-full max-w-[500px] animate-fade-up">

            <div className="text-center mb-5">
              <h1 className="font-sora text-2xl sm:text-3xl font-bold text-[#100f0d] mb-1">
                {t('login.title')}
              </h1>
              <p className="text-xs sm:text-sm text-on-surface-variant">
                {t('login.subtitle')}
              </p>
            </div>

            {/* ─── ESPACES DE TEST (ACCÈS DIRECT 1-CLIC) ─── */}
            <div className="bg-white/95 backdrop-blur border border-outline-variant/30 rounded-3xl p-4 sm:p-5 shadow-sm mb-5">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2.5">
                  <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-br from-[#f95d00] to-amber-500 text-white shadow-sm">
                    <span className="material-symbols-outlined text-[17px]">touch_app</span>
                  </span>
                  <div>
                    <h2 className="text-xs sm:text-sm font-bold text-on-surface leading-tight">
                      Espaces de test (Accès direct 1-clic)
                    </h2>
                    <p className="text-[10px] text-on-surface-variant leading-tight mt-0.5">
                      Cliquez sur un rôle pour accéder directement à son espace
                    </p>
                  </div>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Actifs
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {TEST_ACCOUNTS.map((acc) => {
                  const isCurrentLoading = loggingInRole === acc.key;
                  return (
                    <button
                      key={acc.key}
                      type="button"
                      disabled={loading || Boolean(loggingInRole)}
                      onClick={() => handleQuickTestLogin(acc)}
                      title={`${acc.name} (${acc.roleTag}) : ${acc.description}\nEmail: ${acc.email}`}
                      className={`group relative flex flex-col items-center justify-between p-2 sm:p-2.5 rounded-2xl border text-center transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${acc.chipBg} ${
                        isCurrentLoading
                          ? 'ring-2 ring-offset-2 ring-[#f95d00] shadow-md scale-[1.02]'
                          : 'hover:-translate-y-1 hover:shadow-md'
                      }`}
                    >
                      {/* Icône du rôle */}
                      <div
                        className={`w-9 h-9 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center mb-1.5 shadow-sm transition-transform group-hover:scale-110 ${acc.iconBg}`}
                      >
                        {isCurrentLoading ? (
                          <span className="animate-spin material-symbols-outlined text-[20px]">progress_activity</span>
                        ) : (
                          <span className="material-symbols-outlined text-[20px] sm:text-[22px]">{acc.icon}</span>
                        )}
                      </div>

                      {/* Nom du rôle */}
                      <span className="text-[10px] sm:text-[11px] font-bold leading-tight block w-full truncate text-slate-800">
                        {acc.name}
                      </span>

                      {/* Tag sous-titre */}
                      <span className="text-[8.5px] sm:text-[9.5px] font-semibold opacity-80 leading-tight block w-full truncate mt-0.5">
                        {acc.roleTag}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 pt-2.5 border-t border-outline-variant/15 flex items-center justify-between text-[10px] text-on-surface-variant/80 px-1">
                <span className="flex items-center gap-1 font-medium text-slate-600">
                  <span className="material-symbols-outlined text-[13px] text-emerald-600">verified</span>
                  5 comptes multi-rôles configurés
                </span>
                <span className="text-slate-500 font-mono text-[10px]">
                  Pass : <strong className="text-slate-700">DeskyTest@2026!</strong>
                </span>
              </div>
            </div>

            {infoMsg && (
              <div className="mb-5 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="material-symbols-outlined text-[18px] shrink-0">check_circle</span>
                <span>{infoMsg}</span>
              </div>
            )}

            {errorMsg && (
              <div className="mb-5 p-4 rounded-2xl space-y-2 text-sm animate-fade-in bg-red-50 text-red-700 border border-red-200">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
                  <span>{errorMsg}</span>
                </div>
                {unverifiedEmail && (
                  <div className="pl-7">
                    <Link
                      to={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
                      className="inline-flex items-center gap-1 text-xs font-bold text-[#f95d00] hover:underline"
                    >
                      Vérifier mon e-mail / Renvoyer le lien
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </Link>
                  </div>
                )}
              </div>
            )}

            <div className="glass-card rounded-3xl shadow-elevated p-6 sm:p-8 space-y-5">
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-outline-variant/30 rounded-xl text-sm font-semibold text-on-surface hover:bg-slate-50 transition-all shadow-sm active:scale-[0.98]"
              >
                <GoogleIcon /> Continuer avec Google
              </button>

              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-outline-variant/25" />
                <span className="text-[11px] text-on-surface-variant font-medium uppercase tracking-wider">
                  {t('common.or')}
                </span>
                <div className="flex-1 h-px bg-outline-variant/25" />
              </div>

              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface" htmlFor="login-email">
                    {t('login.emailLabel')}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
                      <span className="material-symbols-outlined text-[19px]">mail</span>
                    </span>
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('login.emailPlaceholder')}
                      className="form-input pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface" htmlFor="login-password">
                    {t('login.passwordLabel')}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
                      <span className="material-symbols-outlined text-[19px]">lock</span>
                    </span>
                    <input
                      id="login-password"
                      type={showPwd ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('login.passwordPlaceholder')}
                      className="form-input pl-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-outline hover:text-on-surface"
                    >
                      <span className="material-symbols-outlined text-[19px]">
                        {showPwd ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="text-right">
                  <Link to="/forgot-password" className="text-xs font-semibold text-secondary hover:underline">
                    {t('login.forgotPassword')}
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-3 rounded-xl font-semibold text-sm shadow-md flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <><span className="animate-spin material-symbols-outlined text-[18px]">refresh</span> {t('login.submitting')}</>
                  ) : (
                    <><span className="material-symbols-outlined text-[18px]">login</span> {t('login.submitBtn')}</>
                  )}
                </button>
              </form>
            </div>

            <p className="text-center text-xs text-on-surface-variant mt-5">
              {t('login.noAccount')}{' '}
              <Link to="/register" className="text-secondary font-semibold hover:underline">
                {t('login.createAccountLink')}
              </Link>
            </p>
          </div>
        </main>

        <footer className="relative z-10 text-center py-4 px-6 text-xs text-on-surface-variant/70 border-t border-outline-variant/10">
          © {new Date().getFullYear()} {t('common.appName')} · {t('common.rightsReserved')}
        </footer>
      </div>
    </div>
  );
}
