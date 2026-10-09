import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BrandLogo from '../components/layout/BrandLogo';
import { getHomePath, getPostLoginPath } from '../utils/roles';

/* ─── Icône SVG Google ─── */
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/* ─── Icône SVG LinkedIn ─── */
const LinkedInIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" rx="8" fill="#0077B5" />
    <path fill="white" d="M13 18h5v17h-5V18zm2.5-7a2.9 2.9 0 1 1 0 5.8A2.9 2.9 0 0 1 15.5 11zM21 18h4.8v2.3h.1c.7-1.3 2.3-2.7 4.7-2.7C35.7 17.6 37 20 37 24.3V35h-5v-9.7c0-2.3-.8-3.9-2.7-3.9-1.5 0-2.4 1-2.8 2-.1.4-.2.9-.2 1.4V35h-5V18z" />
  </svg>
);

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const reason = searchParams.get('reason') || localStorage.getItem('pending_auth_status');
    if (reason === 'pending' || reason === 'en_attente') {
      localStorage.removeItem('pending_auth_status');
      setErrorMsg('pending_approval');
    } else if (reason === 'suspended' || reason === 'suspendu') {
      localStorage.removeItem('pending_auth_status');
      setErrorMsg("Votre compte a été suspendu. Contactez l'administrateur.");
    }
  }, [searchParams]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, statut_compte')
        .eq('id', data.user.id)
        .single();

      // Compte en attente d'approbation
      if (profile?.statut_compte === 'en_attente') {
        localStorage.setItem('pending_auth_status', 'en_attente');
        await supabase.auth.signOut();
        navigate('/login?reason=pending', { replace: true });
        setErrorMsg('pending_approval');
        return;
      }
      // Compte suspendu
      if (profile?.statut_compte && profile.statut_compte !== 'actif') {
        localStorage.setItem('pending_auth_status', 'suspendu');
        await supabase.auth.signOut();
        navigate('/login?reason=suspended', { replace: true });
        setErrorMsg("Votre compte a été suspendu. Contactez l'administrateur.");
        return;
      }

      navigate(await getPostLoginPath(supabase, data.user.id, profile?.role));
    } catch (error) {
      const msg = typeof error?.message === 'string' ? error.message
        : typeof error === 'string' ? error
          : JSON.stringify(error) || 'Erreur de connexion.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider) => {
    setErrorMsg('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de la connexion sociale.');
    }
  };

  return (
    <div className="min-h-screen min-w-0 flex font-inter text-on-surface">

      {/* ══════════════════════════════════════════
          PANNEAU GAUCHE — Illustratif (desktop only)
          ══════════════════════════════════════════ */}
      <div
        className="hidden lg:flex flex-col justify-between shrink-0"
        aria-hidden="true"
        style={{
          width: '46%',
          minWidth: 340,
          padding: '40px 48px',
          background: 'linear-gradient(145deg, #100f0d 0%, #1c1b18 50%, #291a0c 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Blobs décoratifs */}
        <div style={{
          position: 'absolute', top: -80, right: -60,
          width: 400, height: 400, borderRadius: '50%', opacity: 0.25,
          background: 'radial-gradient(circle, #f95d00, transparent)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -60, left: -40,
          width: 300, height: 300, borderRadius: '50%', opacity: 0.15,
          background: 'radial-gradient(circle, #ffedd8, transparent)',
          pointerEvents: 'none',
        }} />

        {/* Logo haut gauche */}
        <div style={{ position: 'relative', zIndex: 10 }}>
          <BrandLogo to="/" light height={56} />
        </div>

        {/* Contenu central */}
        <div style={{ position: 'relative', zIndex: 10, width: '100%' }} className="animate-fade-up">
          {/* Badge */}
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 16px', borderRadius: 99,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              background: 'rgba(249,93,0,0.12)', color: '#f95d00',
              border: '1px solid rgba(249,93,0,0.25)',
              marginBottom: 24,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite', flexShrink: 0 }} />
            Espace sécurisé
          </span>

          {/* Titre */}
          <h2
            className="font-sora"
            style={{ color: '#fbffff', fontWeight: 700, fontSize: 'clamp(28px, 3.5vw, 44px)', lineHeight: 1.18, marginBottom: 16 }}
          >
            Votre espace<br />
            <span style={{ color: '#f95d00' }}>de travail</span><br />
            vous attend.
          </h2>

          {/* Description */}
          <p
            style={{
              color: 'rgba(251,255,255,0.75)',
              fontSize: 15, lineHeight: 1.65,
              marginBottom: 28,
              width: '100%',
              overflowWrap: 'break-word',
            }}
          >
            Accédez à des espaces premium, gérez vos réservations et suivez votre abonnement en temps réel.
          </p>

          {/* Features */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: 'wifi', text: 'Wi-Fi fibre gigabit symétrique' },
              { icon: 'lock', text: 'Accès biométrique 24h/7j' },
              { icon: 'support_agent', text: 'Conciergerie dédiée on-site' },
            ].map(({ icon, text }) => (
              <div key={icon} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'rgba(249,93,0,0.15)', color: '#f95d00',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{icon}</span>
                </span>
                <span style={{ color: 'rgba(251,255,255,0.85)', fontSize: 14 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats bas */}
        <div
          style={{ position: 'relative', zIndex: 10, display: 'flex', gap: 32 }}
          className="animate-fade-up delay-200"
        >
          {[
            { value: '3', label: 'Sites premium' },
            { value: '200+', label: 'Membres actifs' },
            { value: '24/7', label: 'Accès garanti' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="font-sora" style={{ fontSize: 22, fontWeight: 700, color: '#fbffff' }}>{value}</div>
              <div style={{ fontSize: 11, color: 'rgba(251,255,255,0.6)', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          PANNEAU DROIT — Formulaire
          ══════════════════════════════════════════ */}
      <div className="w-full min-w-0 flex-1 page-gradient flex flex-col relative overflow-hidden">
        {/* Blobs background */}
        <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(249,93,0,0.08), transparent)' }} />
        <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(16,15,13,0.06), transparent)' }} />

        {/* Header mobile — logo visible uniquement sur petit écran */}
        <header className="auth-mobile-header lg:hidden flex items-center justify-between px-6 py-4 relative z-10">
          <BrandLogo to="/" />
          <Link to="/register" className="text-secondary font-semibold text-sm hover:underline">
            Créer un compte
          </Link>
        </header>

        {/* Formulaire centré */}
        <main className="w-full flex-1 flex items-center justify-center px-6 py-4 relative z-10">
          <div className="w-full max-w-[440px] animate-fade-up">

            {/* En-tête form */}
            <div className="text-center mb-5">
              <h1 className="font-sora text-2xl font-bold text-[#100f0d] mb-1">Bon retour</h1>
              <p className="text-body-sm text-on-surface-variant">
                Connectez-vous pour accéder à votre espace
              </p>
            </div>

            {/* Alerte — En attente d'approbation (Admin Coworking) */}
            {errorMsg === 'pending_approval' && (
              <div className="mb-6 p-4 rounded-2xl animate-fade-in border"
                style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)', borderColor: 'rgba(245,158,11,0.25)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(245,158,11,0.15)' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#d97706' }}>domain</span>
                  </div>
                  <div>
                    <p className="font-bold text-sm" style={{ color: '#92400e' }}>Espace de coworking en attente d'approbation</p>
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#b45309' }}>
                      Votre demande de création d'espace de coworking a été enregistrée et est en attente d'approbation par le Super Administrateur. Vous pourrez vous connecter dès que l'espace sera validé.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Alerte erreur classique */}
            {errorMsg && errorMsg !== 'pending_approval' && (
              <div className="mb-6 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in"
                style={{ background: '#ffdad6', color: '#93000a', border: '1px solid rgba(186,26,26,0.15)' }}>
                <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
                <span>{errorMsg}</span>
              </div>
            )}


            {/* Card form */}
            <div className="glass-card rounded-3xl shadow-elevated p-6 space-y-5">
              {/* Connexion sociale */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-outline-variant/30" />
                <span className="text-label-sm text-on-surface-variant font-medium whitespace-nowrap">OU CONTINUER AVEC</span>
                <div className="flex-1 h-px bg-outline-variant/30" />
              </div>

              <div className="auth-social-grid grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleSocialLogin('google')}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-outline-variant/30 rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-low hover:-translate-y-px transition-all active:scale-[0.97] shadow-sm"
                >
                  <GoogleIcon /> Google
                </button>
                <button
                  type="button"
                  onClick={() => handleSocialLogin('linkedin_oidc')}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-outline-variant/30 rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-low hover:-translate-y-px transition-all active:scale-[0.97] shadow-sm"
                >
                  <LinkedInIcon /> LinkedIn
                </button>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                {/* Email */}
                <div className="space-y-1.5">
                  <label className="block text-label-sm font-semibold text-on-surface" htmlFor="login-email">
                    Adresse email
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
                      <span className="material-symbols-outlined" style={{ fontSize: 19 }}>mail</span>
                    </span>
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="form-input"
                      placeholder="nom@entreprise.com"
                    />
                  </div>
                </div>

                {/* Mot de passe */}
                <div className="space-y-1.5">
                  <label className="block text-label-sm font-semibold text-on-surface" htmlFor="login-password">
                    Mot de passe
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
                      <span className="material-symbols-outlined" style={{ fontSize: 19 }}>lock</span>
                    </span>
                    <input
                      id="login-password"
                      type={showPwd ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="form-input"
                      style={{ paddingRight: 44 }}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-outline hover:text-secondary transition-colors"
                      tabIndex={-1}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 19 }}>
                        {showPwd ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="text-right -mt-1">
                  <Link to="/forgot-password" className="text-sm font-semibold text-secondary hover:underline">
                    Mot de passe oublié ?
                  </Link>
                </div>

                {/* CTA */}
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full mt-2"
                  style={{ padding: '14px 24px', borderRadius: 12 }}
                >
                  {loading
                    ? <><span className="animate-spin material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span> Connexion…</>
                    : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>login</span> Se connecter</>
                  }
                </button>
              </form>

            </div>

            {/* Lien inscription */}
            <p className="text-center text-body-sm text-on-surface-variant mt-5">
              Pas encore de compte ?{' '}
              <Link to="/register" className="text-secondary font-semibold hover:underline">
                Créer un compte
              </Link>
            </p>
          </div>
        </main>

        {/* Footer */}
        <footer className="relative z-10 text-center py-2 px-6">
          <p className="text-[10px] text-outline-variant">
            © {new Date().getFullYear()} DeskyWork · Tous droits réservés
          </p>
        </footer>
      </div>
    </div>
  );
}
