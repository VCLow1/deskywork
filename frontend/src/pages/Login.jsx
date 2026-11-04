// pages/Login.jsx — Écran de connexion unique pour tous les profils & redirection contextuelle
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BrandLogo from '../components/layout/BrandLogo';
import { useLanguage, LanguageSwitcher } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';

/* ─── Icône SVG Google ─── */
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export default function Login() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Mode de connexion : 'password' | 'phone_otp'
  const [loginMode, setLoginMode] = useState('password');

  // Champs Mot de passe
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  // Champs OTP WhatsApp/SMS
  const [phone, setPhone] = useState('+216 ');
  const [phoneOtpCode, setPhoneOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(60);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Vérifier les messages dans l'URL
  useEffect(() => {
    const reason = searchParams.get('reason');
    if (reason === 'pending') {
      setErrorMsg(t('login.pendingApprovalAlert'));
    } else if (reason === 'suspended') {
      setErrorMsg(t('login.suspendedAlert'));
    }
  }, [searchParams, t]);

  // Compte à rebours OTP
  useEffect(() => {
    if (!otpSent || otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpSent, otpCountdown]);

  // ── Redirection après connexion réussie ──────────────────────────────────────
  const handlePostLoginRedirect = async (user) => {
    try {
      const context = await authUnifiedApi.getMyContext();

      if (context.hasMultipleOrgs) {
        // L'utilisateur appartient à plusieurs organisations -> sélecteur d'espace
        navigate('/select-space', { replace: true });
        return;
      }

      if (context.memberships?.length === 1) {
        const org = context.memberships[0].organization;
        localStorage.setItem('active_org_id', org.id);
      }

      navigate(context.recommendedRedirect || '/dashboard', { replace: true });
    } catch (_) {
      // Fallback
      navigate('/dashboard', { replace: true });
    }
  };

  // ── 1. Connexion Email + Mot de passe ───────────────────────────────────────
  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) throw error;

      await handlePostLoginRedirect(data.user);
    } catch (err) {
      setErrorMsg(err.message || 'Identifiants incorrects.');
    } finally {
      setLoading(false);
    }
  };

  // ── 2. Connexion Sociale Google ────────────────────────────────────────────
  const handleGoogleLogin = async () => {
    setErrorMsg('');
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

  // ── 3. Envoi OTP Téléphone WhatsApp/SMS ─────────────────────────────────────
  const handleSendPhoneOtp = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      await authUnifiedApi.sendPhoneOtp({ phone: phone.trim(), channel: 'whatsapp' });
      setOtpSent(true);
      setOtpCountdown(60);
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de l\'envoi du code.');
    } finally {
      setLoading(false);
    }
  };

  // ── 4. Vérification OTP Téléphone pour Login ────────────────────────────────
  const handleVerifyPhoneOtpLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      const verifyRes = await authUnifiedApi.verifyPhoneOtp({
        phone: phone.trim(),
        code: phoneOtpCode.trim(),
      });

      if (!verifyRes.success) throw new Error(t('otp.invalidCode'));

      // Connexion via session Supabase
      const { data: { session } } = await supabase.auth.getSession();
      await handlePostLoginRedirect(session?.user);
    } catch (err) {
      setErrorMsg(err.message || t('otp.invalidCode'));
    } finally {
      setLoading(false);
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
            Basculez librement entre vos rôles de particulier, formateur ou gérant sans jamais avoir à recréer de compte.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: 'lock', text: 'Chiffrement de bout en bout et RLS stricte' },
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
            <div className="font-sora text-white text-xl font-bold">Multi-tenant</div>
            <div className="text-xs text-white/60">Isolation des données</div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          PANNEAU DROIT — Formulaire de connexion
          ══════════════════════════════════════════ */}
      <div className="w-full min-w-0 flex-1 page-gradient flex flex-col relative overflow-hidden">
        {/* Header */}
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

        {/* Contenu centré */}
        <main className="w-full flex-1 flex items-center justify-center px-4 sm:px-6 py-8 relative z-10">
          <div className="w-full max-w-[440px] animate-fade-up">

            <div className="text-center mb-6">
              <h1 className="font-sora text-2xl sm:text-3xl font-bold text-[#100f0d] mb-1">
                {t('login.title')}
              </h1>
              <p className="text-xs sm:text-sm text-on-surface-variant">
                {t('login.subtitle')}
              </p>
            </div>

            {errorMsg && (
              <div className="mb-5 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in bg-red-50 text-red-700 border border-red-200">
                <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="glass-card rounded-3xl shadow-elevated p-6 sm:p-8 space-y-5">
              {/* Connexion Sociale Google */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-outline-variant/30 rounded-xl text-sm font-semibold text-on-surface hover:bg-slate-50 transition-all shadow-sm active:scale-[0.98]"
              >
                <GoogleIcon /> {t('common.orContinueWith')} {t('login.withGoogle')}
              </button>

              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-outline-variant/25" />
                <span className="text-[11px] text-on-surface-variant font-medium uppercase tracking-wider">
                  {t('common.or')}
                </span>
                <div className="flex-1 h-px bg-outline-variant/25" />
              </div>

              {/* Sélecteur de méthode : Mot de passe OU OTP WhatsApp */}
              <div className="flex p-1 bg-surface-container-low rounded-xl border border-outline-variant/20 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setLoginMode('password')}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${
                    loginMode === 'password'
                      ? 'bg-white text-on-surface shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Email + Mot de passe
                </button>
                <button
                  type="button"
                  onClick={() => setLoginMode('phone_otp')}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${
                    loginMode === 'phone_otp'
                      ? 'bg-white text-on-surface shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Code WhatsApp
                </button>
              </div>

              {/* Formulaire Mot de passe classique */}
              {loginMode === 'password' && (
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
              )}

              {/* Formulaire Connexion Rapide OTP WhatsApp */}
              {loginMode === 'phone_otp' && (
                <div className="space-y-4">
                  {!otpSent ? (
                    <div className="space-y-3">
                      <p className="text-xs text-on-surface-variant leading-relaxed">
                        {t('login.phoneOtpDesc')}
                      </p>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-on-surface">
                          Numéro de téléphone
                        </label>
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+216 99 999 999"
                          className="form-input"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={loading || !phone || phone.length < 8}
                        onClick={handleSendPhoneOtp}
                        className="btn-primary w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
                      >
                        {loading ? t('common.loading') : t('login.sendOtp')}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleVerifyPhoneOtpLogin} className="space-y-4">
                      <p className="text-xs text-on-surface-variant">
                        Entrez le code reçu sur WhatsApp ({phone})
                      </p>
                      <input
                        type="text"
                        maxLength={6}
                        autoFocus
                        required
                        value={phoneOtpCode}
                        onChange={(e) => setPhoneOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••••"
                        className="form-input text-center text-2xl tracking-[0.5em] font-mono py-2.5 font-bold"
                      />
                      <button
                        type="submit"
                        disabled={loading || phoneOtpCode.length < 6}
                        className="btn-primary w-full py-3 rounded-xl font-semibold text-sm"
                      >
                        {loading ? t('otp.verifying') : t('otp.verifyBtn')}
                      </button>
                      <div className="flex items-center justify-center gap-3 text-xs">
                        <button
                          type="button"
                          disabled={otpCountdown > 0 || loading}
                          onClick={handleSendPhoneOtp}
                          className={otpCountdown > 0 ? 'text-outline-variant' : 'text-secondary hover:underline'}
                        >
                          {otpCountdown > 0 ? t('common.retryIn', { seconds: otpCountdown }) : t('common.resend')}
                        </button>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={() => setOtpSent(false)}
                          className="text-on-surface-variant hover:underline"
                        >
                          Changer de numéro
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

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
