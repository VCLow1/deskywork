// pages/Register.jsx — Inscription Étape 1 : Formulaire minimal, OTP Email obligatoire & Téléphone
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

export default function Register() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Étape de flux : 'form' | 'email_otp' | 'phone_otp'
  const [currentStep, setCurrentStep] = useState('form');

  // Champs formulaire minimal
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('+216 ');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  // OTP
  const [emailOtpCode, setEmailOtpCode] = useState('');
  const [phoneOtpCode, setPhoneOtpCode] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(60);
  const [userId, setUserId] = useState(null);

  // États de chargement et erreurs
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Compte à rebours pour le renvoi d'OTP
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  // Récupérer le token d'invitation éventuel dans l'URL
  const inviteToken = searchParams.get('invite_token');

  // ── 1. Soumission Formulaire Minimal ─────────────────────────────────────────
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await authUnifiedApi.registerStep1({
        nom: nom.trim(),
        prenom: prenom.trim(),
        email: email.trim().toLowerCase(),
        telephone: telephone.trim(),
        password,
      });

      setUserId(res.userId);
      setCurrentStep('email_otp');
      setOtpCountdown(60);
      setSuccessMsg(t('otp.codeSent'));
    } catch (err) {
      setErrorMsg(err.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  // ── 2. Vérification OTP Email ──────────────────────────────────────────────
  const handleVerifyEmailOtp = async (e) => {
    e.preventDefault();
    if (!emailOtpCode || emailOtpCode.length < 6) {
      setErrorMsg(t('otp.invalidCode'));
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      await authUnifiedApi.verifyEmailOtp({
        email: email.trim().toLowerCase(),
        code: emailOtpCode.trim(),
        userId,
      });

      // Connexion de la session locale avec Supabase
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInErr) {
        console.warn('Auto sign-in notice:', signInErr.message);
      }

      // Si l'utilisateur est arrivé via une invitation, redirection vers l'invitation
      if (inviteToken) {
        navigate(`/invite/${inviteToken}`, { replace: true });
        return;
      }

      // Sinon, passage à l'étape 2 "Vous êtes… ?"
      navigate('/onboarding/choose-profile', {
        state: { userId: userId || signInData?.user?.id, email, telephone },
        replace: true,
      });
    } catch (err) {
      setErrorMsg(err.message || t('otp.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  // Renvoyer le code OTP email
  const handleResendEmailOtp = async () => {
    if (otpCountdown > 0) return;
    setLoading(true);
    setErrorMsg('');
    try {
      await authUnifiedApi.registerStep1({
        nom,
        prenom,
        email: email.trim().toLowerCase(),
        telephone,
        password,
      });
      setOtpCountdown(60);
      setSuccessMsg(t('otp.codeSent'));
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 3. Connexion Sociale Google ────────────────────────────────────────────
  const handleGoogleSignUp = async () => {
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
        {/* Blobs décoratifs */}
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

        {/* Logo haut gauche */}
        <div style={{ position: 'relative', zIndex: 10 }}>
          <BrandLogo to="/" light height={54} />
        </div>

        {/* Contenu central */}
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
            {t('register.badge')}
          </span>

          <h2
            className="font-sora"
            style={{ color: '#fbffff', fontWeight: 700, fontSize: 'clamp(28px, 3.2vw, 42px)', lineHeight: 1.18, marginBottom: 16 }}
          >
            {t('register.heroTitle1')}<br />
            <span style={{ color: '#f95d00' }}>{t('register.heroTitleHighlight')}</span><br />
            {t('register.heroTitle2')}
          </h2>

          <p style={{ color: 'rgba(251,255,255,0.75)', fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
            {t('register.heroDesc')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: 'account_circle', text: 'Un compte unique : particulier, gérant ou formateur' },
              { icon: 'domain', text: 'Multi-organisations & sélecteur d\'espace instantané' },
              { icon: 'verified_user', text: 'Sécurité renforcée par OTP et permissions isolées' },
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

        {/* Footer panneau */}
        <div style={{ position: 'relative', zIndex: 10, display: 'flex', gap: 24 }}>
          <div>
            <div className="font-sora text-white text-xl font-bold">100%</div>
            <div className="text-xs text-white/60">Multi-tenant sécurisé</div>
          </div>
          <div>
            <div className="font-sora text-white text-xl font-bold">0 €</div>
            <div className="text-xs text-white/60">Inscription gratuite</div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          PANNEAU DROIT — Formulaire & Vérification
          ══════════════════════════════════════════ */}
      <div className="w-full min-w-0 flex-1 page-gradient flex flex-col relative overflow-hidden">
        {/* Header avec sélecteur de langue */}
        <header className="flex items-center justify-between px-6 py-4 relative z-10 border-b border-outline-variant/15">
          <div className="lg:hidden">
            <BrandLogo to="/" height={38} />
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <Link to="/login" className="text-sm font-semibold text-secondary hover:underline">
              {t('common.login')}
            </Link>
          </div>
        </header>

        {/* Contenu principal */}
        <main className="w-full flex-1 flex items-center justify-center px-4 sm:px-6 py-8 relative z-10">
          <div className="w-full max-w-[480px] animate-fade-up">

            {/* ── ALERTE MESSAGE ── */}
            {errorMsg && (
              <div className="mb-5 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in bg-red-50 text-red-700 border border-red-200">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{errorMsg}</span>
              </div>
            )}
            {successMsg && (
              <div className="mb-5 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="material-symbols-outlined text-[18px] shrink-0">check_circle</span>
                <span>{successMsg}</span>
              </div>
            )}

            {/* ── ÉTAPE 1 : FORMULAIRE MINIMAL ── */}
            {currentStep === 'form' && (
              <div className="glass-card rounded-3xl shadow-elevated p-6 sm:p-8 space-y-6">
                <div className="text-center">
                  <h1 className="font-sora text-2xl sm:text-3xl font-bold text-[#100f0d] mb-1">
                    {t('register.title')}
                  </h1>
                  <p className="text-xs sm:text-sm text-on-surface-variant">
                    {t('register.subtitle')}
                  </p>
                </div>

                {/* Bouton Google */}
                <button
                  type="button"
                  onClick={handleGoogleSignUp}
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

                <form onSubmit={handleSubmitForm} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-on-surface" htmlFor="reg-prenom">
                        {t('register.prenomLabel')}
                      </label>
                      <input
                        id="reg-prenom"
                        type="text"
                        required
                        value={prenom}
                        onChange={(e) => setPrenom(e.target.value)}
                        placeholder={t('register.prenomPlaceholder')}
                        className="form-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-on-surface" htmlFor="reg-nom">
                        {t('register.nomLabel')}
                      </label>
                      <input
                        id="reg-nom"
                        type="text"
                        required
                        value={nom}
                        onChange={(e) => setNom(e.target.value)}
                        placeholder={t('register.nomPlaceholder')}
                        className="form-input"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-on-surface" htmlFor="reg-email">
                      {t('register.emailLabel')}
                    </label>
                    <input
                      id="reg-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('register.emailPlaceholder')}
                      className="form-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-on-surface" htmlFor="reg-tel">
                      {t('register.phoneLabel')}
                    </label>
                    <input
                      id="reg-tel"
                      type="tel"
                      required
                      value={telephone}
                      onChange={(e) => setTelephone(e.target.value)}
                      placeholder={t('register.phonePlaceholder')}
                      className="form-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-on-surface" htmlFor="reg-password">
                      {t('register.passwordLabel')}
                    </label>
                    <div className="relative">
                      <input
                        id="reg-password"
                        type={showPwd ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('register.passwordPlaceholder')}
                        className="form-input pr-10"
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

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full mt-2 py-3 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm shadow-md"
                  >
                    {loading ? (
                      <><span className="animate-spin material-symbols-outlined text-[18px]">refresh</span> {t('register.submitting')}</>
                    ) : (
                      <><span className="material-symbols-outlined text-[18px]">arrow_forward</span> {t('register.submitBtn')}</>
                    )}
                  </button>
                </form>

                <p className="text-center text-xs text-on-surface-variant pt-2">
                  {t('register.alreadyAccount')}{' '}
                  <Link to="/login" className="text-secondary font-semibold hover:underline">
                    {t('register.loginLink')}
                  </Link>
                </p>
              </div>
            )}

            {/* ── ÉTAPE 2 : VÉRIFICATION OTP EMAIL (OBLIGATOIRE) ── */}
            {currentStep === 'email_otp' && (
              <div className="glass-card rounded-3xl shadow-elevated p-6 sm:p-8 space-y-6 text-center animate-fade-in">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-100 flex items-center justify-center text-amber-700">
                  <span className="material-symbols-outlined text-[30px]">mail</span>
                </div>

                <div>
                  <h2 className="font-sora text-2xl font-bold text-[#100f0d] mb-1">
                    {t('otp.emailTitle')}
                  </h2>
                  <p className="text-xs sm:text-sm text-on-surface-variant">
                    {t('otp.emailDesc')} <strong>{email}</strong>
                  </p>
                </div>

                <form onSubmit={handleVerifyEmailOtp} className="space-y-5">
                  <div>
                    <input
                      type="text"
                      maxLength={6}
                      autoFocus
                      required
                      value={emailOtpCode}
                      onChange={(e) => setEmailOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••••"
                      className="form-input text-center text-2xl tracking-[0.5em] font-mono py-3 font-bold"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || emailOtpCode.length < 6}
                    className="btn-primary w-full py-3 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm shadow-md"
                  >
                    {loading ? (
                      <><span className="animate-spin material-symbols-outlined text-[18px]">refresh</span> {t('otp.verifying')}</>
                    ) : (
                      <><span className="material-symbols-outlined text-[18px]">check</span> {t('otp.verifyBtn')}</>
                    )}
                  </button>
                </form>

                <div className="pt-2 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResendEmailOtp}
                    disabled={otpCountdown > 0 || loading}
                    className={`text-xs font-semibold ${
                      otpCountdown > 0 ? 'text-outline-variant cursor-not-allowed' : 'text-secondary hover:underline'
                    }`}
                  >
                    {otpCountdown > 0
                      ? t('common.retryIn', { seconds: otpCountdown })
                      : t('common.resend')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('form')}
                    className="text-xs text-on-surface-variant hover:underline"
                  >
                    Modifier mes informations
                  </button>
                </div>
              </div>
            )}

          </div>
        </main>

        <footer className="relative z-10 text-center py-4 px-6 text-xs text-on-surface-variant/70 border-t border-outline-variant/10">
          © {new Date().getFullYear()} {t('common.appName')} · {t('common.rightsReserved')}
        </footer>
      </div>
    </div>
  );
}
