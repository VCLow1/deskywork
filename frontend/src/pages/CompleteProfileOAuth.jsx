// pages/CompleteProfileOAuth.jsx — Complétion de profil post-Google OAuth (CDC DeskyWork v3.0)
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import BrandLogo from '../components/layout/BrandLogo';
import RoleRegistrationFields from '../components/auth/RoleRegistrationFields';
import { authUnifiedApi } from '../services/api/authUnified';
import {
  REGISTRATION_ROLES,
  VALID_ROLE_IDS,
  getRoleConfig,
  readPendingOAuthRole,
  clearPendingOAuthRole,
  savePendingOAuthRole,
} from '../constants/registrationRoles';

export default function CompleteProfileOAuth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const paramRole = searchParams.get('role');
  const initialRole = VALID_ROLE_IDS.includes(paramRole) ? paramRole : readPendingOAuthRole();

  const [selectedRole, setSelectedRole] = useState(initialRole);
  const [checkingSession, setCheckingSession] = useState(true);
  const [values, setValues] = useState({
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
  });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (!session?.user) {
        navigate('/register', { replace: true });
        return;
      }

      const meta = session.user.user_metadata || {};
      const fullName = meta.full_name || meta.name || `${meta.prenom || ''} ${meta.nom || ''}`.trim();
      setValues((prev) => ({
        ...prev,
        email: session.user.email || prev.email,
        nom_complet: fullName || prev.nom_complet,
        photo_url: prev.photo_url || meta.avatar_url || meta.picture || '',
      }));
      setCheckingSession(false);
    });
    return () => { cancelled = true; };
  }, [navigate]);

  const roleConfig = getRoleConfig(selectedRole);

  const handleChooseRole = (roleId) => {
    setSelectedRole(roleId);
    savePendingOAuthRole(roleId);
    setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedRole) {
      setErrorMsg('Veuillez choisir votre profil pour continuer.');
      return;
    }
    if (values.justificatif_error) {
      setErrorMsg(values.justificatif_error);
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const payload = {
        role: selectedRole,
        nom_complet: values.nom_complet.trim(),
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

      const res = await authUnifiedApi.completeOAuthRegistration(payload);
      clearPendingOAuthRole();

      navigate(`/verify-email?email=${encodeURIComponent(res.email)}&role=${encodeURIComponent(selectedRole)}`, {
        state: {
          email: res.email,
          userId: res.userId,
          requestedRole: selectedRole,
          emailSent: res.emailSent,
          emailWarning: res.emailWarning,
        },
        replace: true,
      });
    } catch (err) {
      setErrorMsg(err.message || 'Impossible de finaliser votre inscription.');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    clearPendingOAuthRole();
    await supabase.auth.signOut();
    navigate('/register', { replace: true });
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] font-inter">
        <span className="animate-spin material-symbols-outlined text-[#f95d00] text-[36px]">refresh</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen page-gradient flex flex-col font-inter text-on-surface bg-[#f8fafc]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200/70 bg-white/70 backdrop-blur-sm">
        <BrandLogo to="/" height={38} />
        <button
          type="button"
          onClick={handleSwitchAccount}
          className="text-xs sm:text-sm font-semibold text-slate-600 hover:text-[#f95d00]"
        >
          Utiliser un autre compte
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        <div className={`w-full ${selectedRole ? 'max-w-2xl' : 'max-w-4xl'} animate-fade-up`}>
          {errorMsg && (
            <div className="mb-5 p-4 rounded-2xl flex items-start gap-3 text-sm bg-red-50 text-red-700 border border-red-200">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {!selectedRole ? (
            <section className="space-y-6">
              <div className="text-center max-w-xl mx-auto">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-800 mb-3">
                  Connecté via Google ({values.email})
                </span>
                <h1 className="font-sora text-2xl sm:text-3xl font-extrabold text-[#100f0d]">
                  Choisissez votre profil DeskyWork
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  Finalisez la création de votre compte en sélectionnant votre statut.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {REGISTRATION_ROLES.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => handleChooseRole(role.id)}
                    className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-[#f95d00] hover:shadow-md transition-all"
                  >
                    <div>
                      <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#f95d00] flex items-center justify-center mb-3 group-hover:bg-[#f95d00] group-hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-[20px]">{role.icon}</span>
                      </div>
                      <h2 className="font-sora text-base font-bold text-[#100f0d] mb-1">{role.title}</h2>
                      <p className="text-xs text-slate-600 leading-relaxed">{role.description}</p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-semibold text-[#f95d00] flex items-center justify-between">
                      <span>Sélectionner</span>
                      <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="glass-card rounded-3xl shadow-elevated p-6 sm:p-8 space-y-6 bg-white border border-slate-200/80">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[#f95d00] text-white flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[22px]">{roleConfig.icon}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                      Compte Google vérifié · Complétion requise
                    </span>
                    <h1 className="font-sora text-lg sm:text-xl font-bold text-[#100f0d]">
                      Finaliser mon profil {roleConfig.title}
                    </h1>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedRole(null)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#f95d00] hover:text-[#f95d00]"
                >
                  <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                  Changer de profil
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <RoleRegistrationFields
                  role={selectedRole}
                  values={values}
                  onChange={setValues}
                  isOAuth={true}
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-3.5 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm shadow-md disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <span className="animate-spin material-symbols-outlined text-[18px]">refresh</span>
                      Enregistrement en cours…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      Enregistrer et recevoir l&apos;e-mail d&apos;activation
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-xs text-slate-500">
                Besoin d&apos;aide ? <Link to="/" className="text-[#f95d00] hover:underline">Retour à l&apos;accueil</Link>
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

