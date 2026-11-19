// pages/Register.jsx — Inscription guidée Multi-Rôles (CDC DeskyWork v3.0)
// Étape 1 : Sélection obligatoire du profil (5 cartes) -> Étape 2 : Google SSO contextualisé + Formulaire dédié + Mot de passe fort auto-généré
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BrandLogo from '../components/layout/BrandLogo';
import { LanguageSwitcher } from '../context/LanguageContext';
import RoleRegistrationFields from '../components/auth/RoleRegistrationFields';
import { authUnifiedApi } from '../services/api/authUnified';
import {
  REGISTRATION_ROLES,
  VALID_ROLE_IDS,
  getRoleConfig,
  generateStrongPassword,
  savePendingOAuthRole,
} from '../constants/registrationRoles';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const INITIAL_VALUES = {
  nom_complet: '',
  email: '',
  telephone: '+216 ',
  specialite: '',
  biographie: '',
  photo_url: '',
  justificatif_url: '',
  justificatif_file: null,
  justificatif_error: '',
  nom_etablissement: '',
  ville: 'Tunis',
  adresse: '',
  nb_espaces: 5,
  pack_saas: 'standard',
  mixte: false,
};

function resolveInitialRole(searchParams) {
  const rawRole = searchParams.get('role');
  if (rawRole && VALID_ROLE_IDS.includes(rawRole)) return rawRole;
  const rawType = searchParams.get('type');
  if (rawType === 'entreprise') return 'COMPANY';
  if (rawType === 'formateur') return 'TRAINER';
  if (rawType === 'coworking') return 'COWORKING_ADMIN';
  if (rawType === 'centre_formation') return 'TRAINING_CENTER_ADMIN';
  return null;
}

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialRole = resolveInitialRole(searchParams);
  const [selectedRole, setSelectedRole] = useState(initialRole);
  const [step, setStep] = useState(initialRole ? 2 : 1);

  const [values, setValues] = useState(INITIAL_VALUES);
  const [password, setPassword] = useState(() => generateStrongPassword(14));

  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [existingEmail, setExistingEmail] = useState('');

  const inviteToken = searchParams.get('invite_token');
  const activeRoleConfig = getRoleConfig(selectedRole);

  useEffect(() => {
    if (inviteToken) {
      try {
        sessionStorage.setItem('deskywork_invite_token', inviteToken);
      } catch (_) {}
    }
  }, [inviteToken]);

  const handleSelectRole = (roleId) => {
    setSelectedRole(roleId);
    setErrorMsg('');
    // Pré-générer un nouveau mot de passe fort à l'ouverture du formulaire dédié
    setPassword((prev) => (prev && prev.length >= 12 ? prev : generateStrongPassword(14)));
    setStep(2);
  };

  const handleChangeProfile = () => {
    setErrorMsg('');
    setStep(1);
  };

  const handleGoogleSignUp = async () => {
    if (!selectedRole) {
      setErrorMsg('Veuillez d\'abord choisir votre profil (Étape 1).');
      setStep(1);
      return;
    }

    setErrorMsg('');
    setOauthLoading(true);
    try {
      savePendingOAuthRole(selectedRole);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setErrorMsg(err.message || 'Impossible de lancer l\'authentification Google.');
      setOauthLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedRole) {
      setErrorMsg('Veuillez sélectionner un type de compte avant de continuer.');
      setStep(1);
      return;
    }
    if (values.justificatif_error) {
      setErrorMsg(values.justificatif_error);
      return;
    }
    if (!password || password.length < 8) {
      setErrorMsg('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setErrorCode('');
    setExistingEmail('');

    try {
      const payload = {
        role: selectedRole,
        password,
        nom_complet: values.nom_complet.trim(),
        email: values.email.trim().toLowerCase(),
        telephone: values.telephone.trim(),
        ...(selectedRole === 'TRAINER' ? {
          specialite: values.specialite.trim(),
          biographie: values.biographie.trim(),
          photo_url: values.photo_url.trim() || null,
          justificatif_url: values.justificatif_url.trim() || null,
          justificatif_file: values.justificatif_file || null,
        } : {}),
        ...(selectedRole === 'COWORKING_ADMIN' || selectedRole === 'TRAINING_CENTER_ADMIN' ? {
          nom_etablissement: values.nom_etablissement.trim(),
          ville: values.ville,
          adresse: values.adresse.trim(),
          nb_espaces: values.nb_espaces,
          pack_saas: values.pack_saas,
          mixte: Boolean(values.mixte),
        } : {}),
      };

      const res = await authUnifiedApi.register(payload);

      navigate(`/verify-email?email=${encodeURIComponent(res.email)}&role=${encodeURIComponent(selectedRole)}`, {
        state: {
          email: res.email,
          userId: res.userId,
          requestedRole: selectedRole,
          emailSent: res.emailSent,
          emailWarning: res.emailWarning,
          inviteToken,
        },
        replace: true,
      });
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de la création de votre compte.');
      setErrorCode(err.body?.code || '');
      setExistingEmail(err.body?.email || values.email.trim().toLowerCase());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-w-0 flex font-inter text-on-surface bg-[#f8fafc]">

      {/* ══════════════════════════════════════════
          PANNEAU GAUCHE — Contexte DeskyWork
          ══════════════════════════════════════════ */}
      <aside
        className="hidden lg:flex flex-col justify-between shrink-0"
        aria-hidden="true"
        style={{
          width: '38%',
          minWidth: 340,
          maxWidth: 460,
          padding: '40px 42px',
          background: 'linear-gradient(145deg, #100f0d 0%, #1c1b18 50%, #291a0c 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute', top: -100, right: -80,
            width: 380, height: 380, borderRadius: '50%', opacity: 0.22,
            background: 'radial-gradient(circle, #f95d00, transparent)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', zIndex: 10 }}>
          <BrandLogo to="/" light height={50} />
        </div>

        <div style={{ position: 'relative', zIndex: 10 }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 14px', borderRadius: 99,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              background: 'rgba(249,93,0,0.14)', color: '#f95d00',
              border: '1px solid rgba(249,93,0,0.3)',
              marginBottom: 18,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
            Inscription guidée
          </span>

          <h2
            className="font-sora"
            style={{ color: '#fbffff', fontWeight: 700, fontSize: 'clamp(26px, 2.6vw, 36px)', lineHeight: 1.2, marginBottom: 14 }}
          >
            Un écosystème conçu pour <span style={{ color: '#f95d00' }}>chaque acteur</span>.
          </h2>

          <p style={{ color: 'rgba(251,255,255,0.75)', fontSize: 14, lineHeight: 1.65, marginBottom: 24 }}>
            Que vous soyez membre, entreprise, formateur, coworking ou centre de formation, votre parcours est adapté dès la première étape.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: 'badge', text: 'Étape 1 : Choisissez votre statut exact' },
              { icon: 'key', text: 'Mot de passe fort généré automatiquement' },
              { icon: 'mark_email_read', text: 'Activation sécurisée par lien ou code e-mail' },
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
                <span style={{ color: 'rgba(251,255,255,0.88)', fontSize: 13.5 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 10, display: 'flex', gap: 24 }}>
          <div>
            <div className="font-sora text-white text-lg font-bold">Africa/Tunis</div>
            <div className="text-xs text-white/60">Horaires temps réel</div>
          </div>
          <div>
            <div className="font-sora text-white text-lg font-bold">Multi-rôles</div>
            <div className="text-xs text-white/60">Marketplace & SaaS B2B</div>
          </div>
        </div>
      </aside>

      {/* ══════════════════════════════════════════
          PANNEAU DROIT — Étape 1 (5 cartes) & Étape 2 (Formulaire + Google)
          ══════════════════════════════════════════ */}
      <div className="w-full min-w-0 flex-1 page-gradient flex flex-col relative overflow-x-hidden">
        <header className="flex items-center justify-between px-6 py-4 relative z-10 border-b border-outline-variant/15 bg-white/60 backdrop-blur-sm">
          <div className="lg:hidden">
            <BrandLogo to="/" height={36} />
          </div>
          <div className="hidden lg:flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span className={`px-2.5 py-1 rounded-full ${step === 1 ? 'bg-[#100f0d] text-white' : 'bg-emerald-100 text-emerald-800'}`}>
              1. Profil
            </span>
            <span aria-hidden="true">→</span>
            <span className={`px-2.5 py-1 rounded-full ${step === 2 ? 'bg-[#100f0d] text-white' : 'bg-slate-200 text-slate-600'}`}>
              2. Inscription
            </span>
            <span aria-hidden="true">→</span>
            <span className="px-2.5 py-1 rounded-full bg-slate-200 text-slate-600">
              3. Vérification e-mail
            </span>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link to="/" className="text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900">
              Marketplace
            </Link>
            <Link to="/login" className="text-xs sm:text-sm font-semibold text-[#f95d00] hover:underline">
              Se connecter
            </Link>
          </div>
        </header>

        <main className="w-full flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-10 py-8 relative z-10">
          <div className={`w-full ${step === 1 ? 'max-w-4xl' : 'max-w-2xl'} animate-fade-up`}>

            {errorMsg && (
              <div className="mb-5 p-4 rounded-2xl flex items-start gap-3 text-sm bg-red-50 text-red-700 border border-red-200">
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
                <div className="flex-1 space-y-2">
                  <p>{errorMsg}</p>
                  {errorCode === 'USER_EXISTS_UNVERIFIED' && existingEmail && (
                    <Link
                      to={`/verify-email?email=${encodeURIComponent(existingEmail)}`}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-[#f95d00] hover:underline"
                    >
                      Aller à la vérification de mon e-mail →
                    </Link>
                  )}
                  {errorCode === 'USER_EXISTS' && (
                    <Link
                      to="/login"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-[#f95d00] hover:underline"
                    >
                      Se connecter à mon compte existant →
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                ÉTAPE 1 : SÉLECTION DU STATUT (5 CARTES CLIQUABLES)
               ───────────────────────────────────────────────────────────── */}
            {step === 1 && (
              <section className="space-y-6" aria-labelledby="step1-title">
                <div className="text-center max-w-xl mx-auto">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#f95d00] mb-3 border border-orange-200">
                    ÉTAPE 1 SUR 3 · CHOIX DU STATUT
                  </span>
                  <h1 id="step1-title" className="font-sora text-2xl sm:text-3xl font-extrabold text-[#100f0d]">
                    Quel type de compte souhaitez-vous créer ?
                  </h1>
                  <p className="mt-2 text-sm text-slate-600">
                    Sélectionnez votre profil pour accéder au formulaire dédié ou à l&apos;inscription Google.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {REGISTRATION_ROLES.map((role) => {
                    const isSelected = selectedRole === role.id;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => handleSelectRole(role.id)}
                        className={`group relative flex flex-col justify-between rounded-2xl border p-5 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#f95d00] ${
                          isSelected
                            ? 'border-[#f95d00] bg-orange-50/70 ring-2 ring-[#f95d00]/25 shadow-md -translate-y-0.5'
                            : 'border-slate-200 bg-white hover:border-[#f95d00]/70 hover:shadow-md hover:-translate-y-0.5'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-3.5">
                            <div
                              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'bg-[#f95d00] text-white'
                                  : 'bg-orange-50 text-[#f95d00] group-hover:bg-[#f95d00] group-hover:text-white'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[22px]">{role.icon}</span>
                            </div>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                role.category === 'B2B_ESTABLISHMENT'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {role.badge}
                            </span>
                          </div>

                          <h2 className="font-sora text-base font-bold text-[#100f0d] mb-1.5">
                            {role.title}
                          </h2>
                          <p className="text-xs leading-relaxed text-slate-600">
                            {role.description}
                          </p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-[#f95d00]">
                          <span>Choisir ce profil</span>
                          <span className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-1">
                            arrow_forward
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="text-center text-xs text-slate-500 pt-2">
                  Déjà inscrit sur DeskyWork ?{' '}
                  <Link to="/login" className="text-[#f95d00] font-semibold hover:underline">
                    Se connecter à mon compte
                  </Link>
                </p>
              </section>
            )}

            {/* ─────────────────────────────────────────────────────────────
                ÉTAPE 2 : GOOGLE SSO CONTEXTUALISÉ + FORMULAIRE DÉDIÉ
               ───────────────────────────────────────────────────────────── */}
            {step === 2 && activeRoleConfig && (
              <section className="glass-card rounded-3xl shadow-elevated p-6 sm:p-8 space-y-6 bg-white border border-slate-200/80">
                {/* Barre du rôle sélectionné + bouton Changer de profil */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#f95d00] text-white flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[22px]">{activeRoleConfig.icon}</span>
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#f95d00]">
                        ÉTAPE 2 SUR 3 · Profil sélectionné
                      </div>
                      <h1 className="font-sora text-lg sm:text-xl font-bold text-[#100f0d]">
                        {activeRoleConfig.title}
                      </h1>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleChangeProfile}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#f95d00] hover:text-[#f95d00] transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                    Changer de profil
                  </button>
                </div>

                {/* Bouton Continuer avec Google contextualisé au rôle choisi */}
                <button
                  type="button"
                  disabled={oauthLoading || loading}
                  onClick={handleGoogleSignUp}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm active:scale-[0.99] disabled:opacity-60"
                >
                  <GoogleIcon />
                  {oauthLoading ? 'Redirection vers Google…' : activeRoleConfig.googleLabel}
                </button>

                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">
                    ou par formulaire e-mail
                  </span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <RoleRegistrationFields
                    role={selectedRole}
                    values={values}
                    onChange={setValues}
                    isOAuth={false}
                    password={password}
                    onPasswordChange={setPassword}
                    onRegeneratePassword={() => setPassword(generateStrongPassword(14))}
                  />

                  <button
                    type="submit"
                    disabled={loading || oauthLoading}
                    className="btn-primary w-full py-3.5 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm shadow-md disabled:opacity-60"
                  >
                    {loading ? (
                      <>
                        <span className="animate-spin material-symbols-outlined text-[18px]">refresh</span>
                        Création du compte en cours…
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
                        Créer mon compte {activeRoleConfig.shortTitle}
                      </>
                    )}
                  </button>
                </form>

                <p className="text-center text-xs text-slate-500">
                  Vous avez déjà un compte ?{' '}
                  <Link to="/login" className="text-[#f95d00] font-semibold hover:underline">
                    Se connecter
                  </Link>
                </p>
              </section>
            )}

          </div>
        </main>

        <footer className="relative z-10 text-center py-4 px-6 text-xs text-slate-500 border-t border-slate-200/70">
          © {new Date().getFullYear()} DeskyWork · Tous droits réservés
        </footer>
      </div>
    </div>
  );
}
