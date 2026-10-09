import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BrandLogo from '../components/layout/BrandLogo';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/* ─── SVG Icons ─── */
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const LinkedInIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" rx="8" fill="#0077B5" />
    <path fill="white" d="M13 18h5v17h-5V18zm2.5-7a2.9 2.9 0 1 1 0 5.8A2.9 2.9 0 0 1 15.5 11zM21 18h4.8v2.3h.1c.7-1.3 2.3-2.7 4.7-2.7C35.7 17.6 37 20 37 24.3V35h-5v-9.7c0-2.3-.8-3.9-2.7-3.9-1.5 0-2.4 1-2.8 2-.1.4-.2.9-.2 1.4V35h-5V18z" />
  </svg>
);

/* ─── Field composant réutilisable ─── */
function Field({ id, label, icon, type = 'text', value, onChange, placeholder, required = false, rightAddon }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-label-sm font-semibold text-on-surface-variant" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
        </span>
        <input
          id={id}
          type={type}
          required={required}
          value={value}
          onChange={onChange}
          className="form-input"
          style={rightAddon ? { paddingRight: 44 } : {}}
          placeholder={placeholder}
        />
        {rightAddon}
      </div>
    </div>
  );
}

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [typeMembre, setTypeMembre] = useState('individuel');
  const [role, setRole] = useState('member');
  const [specialite, setSpecialite] = useState('');
  const [biographie, setBiographie] = useState('');
  const [coworkingName, setCoworkingName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [step, setStep] = useState('form'); // 'form' | 'done'

  const navigate = useNavigate();

  // ── Création du compte (Approbation Super Admin UNIQUEMENT pour admin coworking) ──────
  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    const cleanEmail = email.trim().toLowerCase();
    setEmail(cleanEmail);

    const isCoworkingAdmin = role === 'admin';
    const initialStatus = isCoworkingAdmin ? 'en_attente' : 'actif';

    try {
      // 1. Préparer les données utilisateur avec le statut adapté
      const userData = {
        nom: nom.trim(),
        prenom: prenom.trim(),
        telephone: telephone.trim(),
        role,
        statut_compte: initialStatus,
        type_membre: ['formateur', 'admin'].includes(role) ? null : typeMembre,
      };
      if (role === 'formateur') {
        userData.specialite = specialite;
        userData.biographie = biographie;
      }
      if (role === 'admin') {
        userData.coworking_name = coworkingName;
      }

      // 2. Créer le compte Supabase Auth
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: userData },
      });

      if (signUpError) {
        if (
          signUpError.message?.toLowerCase().includes('already registered') ||
          signUpError.message?.toLowerCase().includes('already been registered') ||
          signUpError.message?.toLowerCase().includes('user already exists')
        ) {
          throw new Error('Cette adresse email est déjà utilisée. Veuillez vous connecter ou utiliser une autre adresse.');
        }
        throw signUpError;
      }

      if (signUpData?.user && signUpData.user.identities?.length === 0) {
        throw new Error('Cette adresse email est déjà associée à un compte. Veuillez vous connecter.');
      }

      // 3. Mettre à jour le profil et confirmer côté backend
      if (signUpData?.user?.id) {
        await supabase
          .from('profiles')
          .update({ statut_compte: initialStatus })
          .eq('id', signUpData.user.id);

        try {
          await fetch(`${API_URL}/api/otp/auto-confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: signUpData.user.id, email: cleanEmail, role }),
          });
        } catch (apiErr) {
          console.warn('⚠️ Enregistrement backend:', apiErr.message);
        }
      }

      // 4. Distinction selon le rôle :
      if (isCoworkingAdmin) {
        // Seule la création d'espace de coworking attend l'approbation du Super Admin
        await supabase.auth.signOut().catch(() => {});
        setStep('done_coworking');
      } else {
        // Tous les autres comptes (membres, formateurs) sont actifs immédiatement
        setStep('done_normal');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de la création du compte.');
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

  const memberTypes = [
    { value: 'individuel', label: 'Individuel', icon: 'person', desc: 'Freelance, consultant, indépendant' },
    { value: 'entreprise', label: 'Entreprise', icon: 'business', desc: 'Équipe ou société' },
    { value: 'etudiant', label: 'Étudiant', icon: 'school', desc: 'Tarif réduit étudiant' },
  ];

  const roleTypes = [
    { value: 'member', label: 'Membre', icon: 'person', desc: 'Accéder aux espaces de coworking' },
    { value: 'formateur', label: 'Formateur', icon: 'school', desc: 'Créer et animer des formations' },
    { value: 'admin', label: 'Admin Coworking', icon: 'domain', desc: 'Gérer mon espace de coworking' }
  ];

  return (
    <div className="min-h-screen min-w-0 flex font-inter text-on-surface">

      {/* ══════════════════════════════════════════
          PANNEAU GAUCHE — Illustratif (desktop only)
          ══════════════════════════════════════════ */}
      <div
        className="hidden lg:flex flex-col justify-center shrink-0"
        aria-hidden="true"
        style={{
          width: '46%',
          minWidth: 340,
          padding: '32px 40px',
          background: 'linear-gradient(145deg, #100f0d 0%, #1c1b18 50%, #291a0c 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Blobs décoratifs */}
        <div style={{
          position: 'absolute', top: -80, right: -60,
          width: 350, height: 350, borderRadius: '50%', opacity: 0.25,
          background: 'radial-gradient(circle, #f95d00, transparent)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -60, left: -40,
          width: 280, height: 280, borderRadius: '50%', opacity: 0.15,
          background: 'radial-gradient(circle, #ffedd8, transparent)',
          pointerEvents: 'none',
        }} />

        {/* Logo haut */}
        <div style={{ position: 'relative', zIndex: 10, marginBottom: '40px' }}>
          <BrandLogo to="/" light height={56} />
        </div>

        {/* Contenu central */}
        <div style={{ position: 'relative', zIndex: 10, width: '100%' }} className="animate-fade-up">
          {/* Badge */}
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', borderRadius: 99,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              background: 'rgba(249,93,0,0.12)', color: '#f95d00',
              border: '1px solid rgba(249,93,0,0.25)',
              marginBottom: 12,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>star</span>
            Rejoindre la communauté
          </span>

          {/* Titre */}
          <h2
            className="font-sora"
            style={{ color: '#fbffff', fontWeight: 700, fontSize: 'clamp(24px, 3vw, 36px)', lineHeight: 1.18, marginBottom: 12 }}
          >
            Rejoignez<br />
            <span style={{ color: '#f95d00' }}>l&apos;élite</span><br />
            des workspace.
          </h2>

          {/* Description */}
          <p
            style={{
              color: 'rgba(251,255,255,0.75)',
              fontSize: 14, lineHeight: 1.6,
              marginBottom: 16,
              width: '100%',
              overflowWrap: 'break-word',
            }}
          >
            Créez votre profil membre et accédez à l&apos;ensemble de l&apos;écosystème DeskyWork.
          </p>

          {/* Avantages */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { icon: 'bolt', text: 'Réservation en 3 clics' },
              { icon: 'qr_code_2', text: 'QR Code d\'accès instantané' },
              { icon: 'notifications', text: 'Alertes temps réel' },
              { icon: 'receipt_long', text: 'Factures et historique complets' },
            ].map(({ icon, text }) => (
              <div key={icon} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: 'rgba(249,93,0,0.15)', color: '#f95d00',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{icon}</span>
                </span>
                <span style={{ color: 'rgba(251,255,255,0.85)', fontSize: 13 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ══════════════════════════════════════════
          PANNEAU DROIT — Formulaire / OTP / Succès
          ══════════════════════════════════════════ */}
      <div className="w-full min-w-0 flex-1 page-gradient flex flex-col relative overflow-hidden">
        {/* Blobs */}
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(249,93,0,0.07), transparent)' }} />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(16,15,13,0.05), transparent)' }} />

        {/* Header mobile */}
        <header className="auth-mobile-header lg:hidden flex items-center justify-between px-6 py-4 relative z-10">
          <BrandLogo to="/" />
          <Link to="/login" className="text-secondary font-semibold text-sm hover:underline">
            Se connecter
          </Link>
        </header>

        <main className="w-full flex-1 flex items-center justify-center px-6 py-2 relative z-10">
          <div className="w-full max-w-[520px] animate-fade-up">

            {/* ── VUE SUCCÈS : EN ATTENTE D'APPROBATION SUPER ADMIN (ADMIN COWORKING UNIQUEMENT) ── */}
            {step === 'done_coworking' && (
              <div className="glass-card rounded-3xl shadow-elevated p-8 text-center animate-fade-in">
                <div style={{
                  width: 80, height: 80, borderRadius: '50%', margin: '0 auto 20px',
                  background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                  border: '2px solid rgba(245,158,11,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#d97706' }}>
                    domain
                  </span>
                </div>

                <h1 className="font-sora text-2xl font-bold text-primary mb-2">
                  Demande d'espace coworking enregistrée !
                </h1>
                
                <p className="text-on-surface-variant text-sm leading-relaxed mb-6">
                  Merci <strong>{prenom} {nom}</strong>. Votre demande pour l'espace <strong>{coworkingName || 'de coworking'}</strong> a bien été enregistrée.<br />
                  Elle est actuellement <strong>en attente d'approbation par le Super Administrateur</strong>.
                </p>

                <div style={{
                  background: '#fffbeb', border: '1px solid rgba(245,158,11,0.35)',
                  borderRadius: 16, padding: '18px 20px', marginBottom: 28,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <span className="material-symbols-outlined" style={{ color: '#d97706', fontSize: 22, flexShrink: 0, marginTop: 2 }}>
                    verified_user
                  </span>
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ margin: '0 0 4px', color: '#92400e', fontSize: 14, fontWeight: 700 }}>
                      Validation manuelle requise
                    </p>
                    <p style={{ margin: 0, color: '#b45309', fontSize: 13, lineHeight: 1.55 }}>
                      Seule la création d'un espace de coworking requiert la validation du Super Administrateur. Dès son approbation, vous pourrez vous connecter pour configurer vos espaces et vos offres.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => navigate('/login')}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                  style={{ padding: '12px 24px', borderRadius: 12 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>login</span>
                  Retour à la page de connexion
                </button>
              </div>
            )}

            {/* ── VUE SUCCÈS : COMPTE NORMAL (MEMBRE OU FORMATEUR) CRÉÉ IMMÉDIATEMENT ── */}
            {step === 'done_normal' && (
              <div className="glass-card rounded-3xl shadow-elevated p-8 text-center animate-fade-in">
                <div style={{
                  width: 80, height: 80, borderRadius: '50%', margin: '0 auto 20px',
                  background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
                  border: '2px solid rgba(16,185,129,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#059669' }}>
                    check_circle
                  </span>
                </div>

                <h1 className="font-sora text-2xl font-bold text-primary mb-2">
                  Compte créé avec succès !
                </h1>
                
                <p className="text-on-surface-variant text-sm leading-relaxed mb-6">
                  Bienvenue <strong>{prenom} {nom}</strong> ! Votre compte a été activé immédiatement.<br />
                  Vous pouvez dès à présent vous connecter et profiter de l'écosystème DeskyWork.
                </p>

                <div style={{
                  background: '#f0fdf4', border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: 16, padding: '18px 20px', marginBottom: 28,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <span className="material-symbols-outlined" style={{ color: '#16a34a', fontSize: 22, flexShrink: 0, marginTop: 2 }}>
                    verified
                  </span>
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ margin: '0 0 4px', color: '#15803d', fontSize: 14, fontWeight: 700 }}>
                      Compte actif immédiatement
                    </p>
                    <p style={{ margin: 0, color: '#166534', fontSize: 13, lineHeight: 1.55 }}>
                      Aucune approbation n'est requise pour votre compte. Connectez-vous avec vos identifiants pour accéder directement à votre espace.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => navigate('/login')}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                  style={{ padding: '12px 24px', borderRadius: 12 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>login</span>
                  Se connecter maintenant
                </button>
              </div>
            )}

            {/* ── VUE FORMULAIRE ─────────────────────────────────────────── */}
            {step === 'form' && (
              <>
                <div className="text-center mb-2">
                  <h1 className="font-sora text-2xl font-bold text-[#100f0d]">
                    Créer votre compte
                  </h1>
                </div>

                {/* Messages */}
                {errorMsg && (
                  <div className="mb-5 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in"
                    style={{ background: '#ffdad6', color: '#93000a', border: '1px solid rgba(186,26,26,0.15)' }}>
                    <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
                    <span>{errorMsg}</span>
                  </div>
                )}
                {successMsg && (
                  <div className="mb-5 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in"
                    style={{ background: '#dae2ff', color: '#001847', border: '1px solid rgba(0,84,203,0.2)' }}>
                    <span className="material-symbols-outlined text-[18px] shrink-0">check_circle</span>
                    <span>{successMsg}</span>
                  </div>
                )}

                {/* Card */}
                <div className="glass-card rounded-3xl shadow-elevated p-4 space-y-3">

                  {/* Inscription sociale — uniquement pour les membres */}
                  {role === 'member' ? (
                    <>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-px bg-outline-variant/30" />
                        <span className="text-[10px] text-on-surface-variant font-medium whitespace-nowrap">OU CONTINUER AVEC</span>
                        <div className="flex-1 h-px bg-outline-variant/30" />
                      </div>

                      <div className="auth-social-grid grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => handleSocialLogin('google')}
                          className="flex items-center justify-center gap-2 px-4 py-1.5 bg-white border border-outline-variant/30 rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-low hover:-translate-y-px transition-all active:scale-[0.97] shadow-sm"
                        >
                          <GoogleIcon /> Google
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSocialLogin('linkedin_oidc')}
                          className="flex items-center justify-center gap-2 px-4 py-1.5 bg-white border border-outline-variant/30 rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-low hover:-translate-y-px transition-all active:scale-[0.97] shadow-sm"
                        >
                          <LinkedInIcon /> LinkedIn
                        </button>
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', borderRadius: 12,
                        background: '#f1f5f9', border: '1px solid #e2e8f0',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#64748b', flexShrink: 0 }}>
                        info
                      </span>
                      <p style={{ margin: 0, color: '#475569', fontSize: 12, lineHeight: 1.5 }}>
                        La connexion Google / LinkedIn est réservée aux membres.
                        <br />
                        <strong>Formateurs et admins</strong> utilisent email + mot de passe.
                      </p>
                    </div>
                  )}

                  <form onSubmit={handleRegister} className="space-y-3">

                    {/* Nom / Prénom */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field
                        id="reg-prenom" label="Prénom" icon="badge"
                        value={prenom} onChange={(e) => setPrenom(e.target.value)}
                        placeholder="Jean" required
                      />
                      <Field
                        id="reg-nom" label="Nom" icon="person"
                        value={nom} onChange={(e) => setNom(e.target.value)}
                        placeholder="Dupont" required
                      />
                    </div>

                    {/* Email */}
                    <Field
                      id="reg-email" label="Adresse email" icon="mail"
                      type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="jean.dupont@entreprise.com" required
                    />

                    {/* Téléphone */}
                    <Field
                      id="reg-tel" label="Téléphone" icon="phone"
                      type="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)}
                      placeholder="+216 99 999 999" required
                    />

                    {/* Type de compte */}
                    <div className="flex flex-col gap-1">
                      <label className="text-label-sm font-semibold text-on-surface-variant" htmlFor="reg-role">
                        Type de compte
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>account_circle</span>
                        </span>
                        <select
                          id="reg-role"
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                          className="form-input appearance-none"
                        >
                          {roleTypes.map(({ value, label }) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                      {role === 'admin' ? (
                        <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-xl px-3 py-2 flex items-center gap-2 mt-1">
                          <span className="material-symbols-outlined text-[16px] text-amber-600 shrink-0">info</span>
                          <span>La création d'un espace de coworking requiert l'approbation du Super Administrateur avant son ouverture.</span>
                        </p>
                      ) : (
                        <p className="text-[12px] text-emerald-800 bg-emerald-50 border border-emerald-200/80 rounded-xl px-3 py-2 flex items-center gap-2 mt-1">
                          <span className="material-symbols-outlined text-[16px] text-emerald-600 shrink-0">check_circle</span>
                          <span>Votre compte sera actif immédiatement dès l'inscription (accès sans attente).</span>
                        </p>
                      )}
                    </div>

                    {/* Type de membre (uniquement pour les membres) */}
                    {role === 'member' && (
                      <div className="flex flex-col gap-1">
                        <label className="text-label-sm font-semibold text-on-surface-variant" htmlFor="reg-type">
                          Type de membre
                        </label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>card_membership</span>
                          </span>
                          <select
                            id="reg-type"
                            value={typeMembre}
                            onChange={(e) => setTypeMembre(e.target.value)}
                            className="form-input appearance-none"
                          >
                            {memberTypes.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Nom du Coworking (uniquement pour les admins) */}
                    {role === 'admin' && (
                      <Field
                        id="reg-coworking" label="Nom de l'Espace Coworking" icon="domain"
                        value={coworkingName} onChange={(e) => setCoworkingName(e.target.value)}
                        placeholder="Ex: Encre & Cobalt Tunis" required
                      />
                    )}

                    {/* Champs spécifiques aux formateurs */}
                    {role === 'formateur' && (
                      <>
                        <div className="flex flex-col gap-1">
                          <label className="text-label-sm font-semibold text-on-surface-variant" htmlFor="reg-specialite">
                            Spécialité / Domaine
                          </label>
                          <div className="relative">
                            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>star</span>
                            </span>
                            <input
                              id="reg-specialite"
                              type="text"
                              value={specialite}
                              onChange={(e) => setSpecialite(e.target.value)}
                              className="form-input"
                              placeholder="Ex: UX Design, React, Marketing..."
                              required
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-label-sm font-semibold text-on-surface-variant" htmlFor="reg-biographie">
                            Biographie courte
                          </label>
                          <div className="relative">
                            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none" style={{ top: 12 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>description</span>
                            </span>
                            <textarea
                              id="reg-biographie"
                              value={biographie}
                              onChange={(e) => setBiographie(e.target.value)}
                              className="form-input"
                              rows={3}
                              placeholder="Parcours, compétences clés, expérience..."
                              required
                              style={{ paddingLeft: 44 }}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {/* Mot de passe */}
                    <div className="flex flex-col gap-1">
                      <label className="text-label-sm font-semibold text-on-surface-variant" htmlFor="reg-password">
                        Mot de passe
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-outline pointer-events-none">
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>lock</span>
                        </span>
                        <input
                          id="reg-password"
                          type={showPwd ? 'text' : 'password'}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="form-input"
                          style={{ paddingRight: 44 }}
                          placeholder="Minimum 8 caractères"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPwd((v) => !v)}
                          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-outline hover:text-secondary transition-colors"
                          tabIndex={-1}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                            {showPwd ? 'visibility_off' : 'visibility'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* CTA */}
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
                      style={{ padding: '10px 24px', borderRadius: 12 }}
                    >
                      {loading
                        ? <><span className="animate-spin material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span> Création du compte…</>
                        : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span> Créer mon compte</>
                      }
                    </button>
                  </form>

                </div>

                <p className="text-center text-xs text-on-surface-variant mt-3">
                  Déjà inscrit?{' '}
                  <Link to="/login" className="text-secondary font-semibold hover:underline">
                    Se connecter
                  </Link>
                </p>
              </>
            )}

          </div>
        </main>

        <footer className="relative z-10 text-center py-2 px-6">
          <p className="text-[10px] text-outline-variant">
            © {new Date().getFullYear()} DeskyWork · Tous droits réservés
          </p>
        </footer>
      </div>
    </div>
  );
}



