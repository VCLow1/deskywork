// pages/SelectSpace.jsx — Sélecteur d'espace multi-organisations ("Continuer en tant que…")
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BrandLogo from '../components/layout/BrandLogo';
import { useLanguage, LanguageSwitcher } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';
import { supabase } from '../supabaseClient';

export default function SelectSpace() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [contextData, setContextData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function loadContext() {
      try {
        const res = await authUnifiedApi.getMyContext();
        setContextData(res);
      } catch (err) {
        setErrorMsg(err.message || 'Impossible de charger vos organisations.');
      } finally {
        setLoading(false);
      }
    }
    loadContext();
  }, []);

  const handleSelectOrg = (membership) => {
    const org = membership.organization;
    localStorage.setItem('active_org_id', org.id);

    if (membership.role === 'formateur') {
      navigate('/trainer-dashboard');
    } else {
      navigate('/admin/dashboard');
    }
  };

  const handleSelectPersonal = () => {
    localStorage.removeItem('active_org_id');
    navigate('/dashboard');
  };

  const handleSelectTrainer = () => {
    localStorage.removeItem('active_org_id');
    navigate('/trainer-dashboard');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('active_org_id');
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center page-gradient">
        <div className="animate-spin w-8 h-8 border-4 border-[#f95d00] border-t-transparent rounded-full" />
      </div>
    );
  }

  const profile = contextData?.profile;
  const memberships = contextData?.memberships || [];
  const trainerProfile = contextData?.trainerProfile;

  return (
    <div className="min-h-screen page-gradient flex flex-col font-inter text-on-surface">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 relative z-10 border-b border-outline-variant/15">
        <BrandLogo to="/" height={40} />
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs font-semibold text-on-surface-variant hover:text-red-600 flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            {t('common.logout')}
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10 relative z-10 max-w-4xl mx-auto w-full">
        <div className="text-center mb-8 max-w-lg animate-fade-up">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-900 mb-3">
            <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
            Espaces & Rôles
          </span>
          <h1 className="font-sora text-3xl font-bold text-[#100f0d] mb-2">
            {t('switcher.title')}
          </h1>
          <p className="text-sm text-on-surface-variant">
            Bonjour <strong>{profile?.prenom} {profile?.nom}</strong>, {t('switcher.subtitle')}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in bg-red-50 text-red-700 border border-red-200 w-full max-w-lg">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full animate-fade-up">

          {/* 1. Accès Personnel Marketplace */}
          <div
            onClick={handleSelectPersonal}
            className="glass-card rounded-2xl p-5 hover:shadow-elevated transition-all duration-200 cursor-pointer border border-outline-variant/20 hover:border-[#f95d00] flex items-center justify-between group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shadow-sm shrink-0">
                <span className="material-symbols-outlined text-[24px]">person</span>
              </div>
              <div>
                <h2 className="font-sora text-base font-bold text-[#100f0d] group-hover:text-secondary transition-colors">
                  {t('switcher.personalAccount')}
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {t('switcher.personalDesc')}
                </p>
              </div>
            </div>
            <span className="material-symbols-outlined text-outline group-hover:text-secondary text-[20px] transition-transform group-hover:translate-x-1">
              arrow_forward
            </span>
          </div>

          {/* 2. Espace Formateur Personnel (si formateur validé) */}
          {trainerProfile && (
            <div
              onClick={handleSelectTrainer}
              className="glass-card rounded-2xl p-5 hover:shadow-elevated transition-all duration-200 cursor-pointer border border-outline-variant/20 hover:border-[#f95d00] flex items-center justify-between group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shadow-sm shrink-0">
                  <span className="material-symbols-outlined text-[24px]">school</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-sora text-base font-bold text-[#100f0d] group-hover:text-secondary transition-colors">
                      Espace Formateur Indépendant
                    </h2>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                      {trainerProfile.statut_validation}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Gérer mon catalogue de formations et mes réservations de salles
                  </p>
                </div>
              </div>
              <span className="material-symbols-outlined text-outline group-hover:text-secondary text-[20px] transition-transform group-hover:translate-x-1">
                arrow_forward
              </span>
            </div>
          )}

          {/* 3. Organisations & Équipes (Coworkings, Centres, Entreprises) */}
          {memberships.map((m) => {
            const org = m.organization;
            const roleLabels = {
              proprietaire: 'Propriétaire',
              admin: 'Administrateur',
              staff: 'Staff / Accueil',
              formateur: 'Formateur rattaché',
              lecture_seule: 'Lecture seule',
            };

            const typeIcons = {
              coworking: 'domain',
              centre_formation: 'meeting_room',
              entreprise: 'business_center',
            };

            return (
              <div
                key={m.membershipId}
                onClick={() => handleSelectOrg(m)}
                className="glass-card rounded-2xl p-5 hover:shadow-elevated transition-all duration-200 cursor-pointer border border-outline-variant/20 hover:border-[#f95d00] flex items-center justify-between group"
              >
                <div className="flex items-center gap-4">
                  {org.logo_url ? (
                    <img
                      src={org.logo_url}
                      alt={org.nom}
                      className="w-12 h-12 rounded-xl object-cover border border-outline-variant/20 shadow-sm shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-[#100f0d] text-white flex items-center justify-center shadow-sm shrink-0">
                      <span className="material-symbols-outlined text-[24px]">
                        {typeIcons[org.type] || 'domain'}
                      </span>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-sora text-base font-bold text-[#100f0d] group-hover:text-secondary transition-colors">
                        {org.nom}
                      </h2>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                        {roleLabels[m.role] || m.role}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      {org.ville} · {org.type === 'centre_formation' ? 'Centre de formation' : org.type === 'entreprise' ? 'Entreprise' : 'Espace Coworking'}
                    </p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-outline group-hover:text-secondary text-[20px] transition-transform group-hover:translate-x-1">
                  arrow_forward
                </span>
              </div>
            );
          })}

        </div>
      </main>

      <footer className="text-center py-4 px-6 text-xs text-on-surface-variant/70 border-t border-outline-variant/10">
        © {new Date().getFullYear()} {t('common.appName')} · {t('common.rightsReserved')}
      </footer>
    </div>
  );
}

