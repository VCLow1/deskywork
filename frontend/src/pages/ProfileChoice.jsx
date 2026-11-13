// pages/ProfileChoice.jsx — Étape 2 : Écran "Vous êtes… ?" & Choix de rôle
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import BrandLogo from '../components/layout/BrandLogo';
import { useLanguage, LanguageSwitcher } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';
import { supabase } from '../supabaseClient';

export default function ProfileChoice() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const [sessionUser, setSessionUser] = useState(null);
  const [selectedType, setSelectedType] = useState(null);

  // Modal / vue Entreprise
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [companyCity, setCompanyCity] = useState('');

  // Note CDC v3.0 — D2 : validation téléphone par SMS/WhatsApp reportée en phase 2

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Charger la session active
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setSessionUser(session.user);
        // téléphone stocké en metadata
      }
    });
  }, []);

  const userId = sessionUser?.id || location.state?.userId;

  // ── Sélection d'un profil ──────────────────────────────────────────────────
  const handleSelect = async (type) => {
    setSelectedType(type);
    setErrorMsg('');

    // 1. Particulier : activation immédiate
    if (type === 'particulier') {
      setLoading(true);
      try {
        await authUnifiedApi.chooseProfileType({ profileType: 'particulier', userId });
        navigate('/dashboard', { replace: true });
      } catch (err) {
        setErrorMsg(err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2. Entreprise : ouvrir le modal pour nom de société
    if (type === 'entreprise') {
      setShowCompanyModal(true);
      return;
    }

    // 3. Formateur / Coworking / Centre : redirection directe vers l'onboarding (D2 : pas d'OTP SMS/WhatsApp en v1)
    proceedToRoleOnboarding(type);
  };

  const proceedToRoleOnboarding = (type) => {
    if (type === 'formateur') {
      navigate('/onboarding/trainer');
    } else if (type === 'coworking') {
      navigate('/onboarding/space?type=coworking');
    } else if (type === 'centre_formation') {
      navigate('/onboarding/space?type=centre_formation');
    }
  };

  // ── Soumission Entreprise ──────────────────────────────────────────────────
  const handleCompanySubmit = async (e) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setErrorMsg('Le nom de l\'entreprise est obligatoire.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      await authUnifiedApi.chooseProfileType({
        profileType: 'entreprise',
        userId,
        entrepriseData: {
          nom: companyName.trim(),
          matricule_fiscal: taxId.trim(),
          ville: companyCity.trim() || 'Tunis',
        },
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const cards = [
    {
      id: 'particulier',
      icon: 'person',
      badge: t('profileChoice.particulier.badge'),
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      title: t('profileChoice.particulier.title'),
      desc: t('profileChoice.particulier.desc'),
      cta: t('profileChoice.particulier.cta'),
    },
    {
      id: 'entreprise',
      icon: 'business_center',
      badge: t('profileChoice.entreprise.badge'),
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
      title: t('profileChoice.entreprise.title'),
      desc: t('profileChoice.entreprise.desc'),
      cta: t('profileChoice.entreprise.cta'),
    },
    {
      id: 'formateur',
      icon: 'school',
      badge: t('profileChoice.formateur.badge'),
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
      title: t('profileChoice.formateur.title'),
      desc: t('profileChoice.formateur.desc'),
      cta: t('profileChoice.formateur.cta'),
    },
    {
      id: 'coworking',
      icon: 'domain',
      badge: t('profileChoice.coworking.badge'),
      badgeColor: 'bg-orange-50 text-orange-700 border-orange-200',
      title: t('profileChoice.coworking.title'),
      desc: t('profileChoice.coworking.desc'),
      cta: t('profileChoice.coworking.cta'),
    },
    {
      id: 'centre_formation',
      icon: 'meeting_room',
      badge: t('profileChoice.centreFormation.badge'),
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
      title: t('profileChoice.centreFormation.title'),
      desc: t('profileChoice.centreFormation.desc'),
      cta: t('profileChoice.centreFormation.cta'),
    },
  ];

  return (
    <div className="min-h-screen page-gradient flex flex-col font-inter text-on-surface">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 relative z-10 border-b border-outline-variant/15">
        <BrandLogo to="/" height={40} />
        <LanguageSwitcher />
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10 relative z-10 max-w-6xl mx-auto w-full">
        <div className="text-center mb-8 max-w-xl animate-fade-up">
          <h1 className="font-sora text-3xl sm:text-4xl font-bold text-[#100f0d] mb-3">
            {t('profileChoice.title')}
          </h1>
          <p className="text-sm sm:text-base text-on-surface-variant leading-relaxed">
            {t('profileChoice.subtitle')}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in bg-red-50 text-red-700 border border-red-200 w-full max-w-xl">
            <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Grille des profils */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full animate-fade-up">
          {cards.map((c) => (
            <div
              key={c.id}
              className="glass-card rounded-3xl p-6 sm:p-7 flex flex-col justify-between hover:shadow-elevated transition-all duration-300 hover:-translate-y-1 border border-outline-variant/20 group relative overflow-hidden"
            >
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#100f0d] text-white flex items-center justify-center shadow-md group-hover:bg-[#f95d00] transition-colors">
                    <span className="material-symbols-outlined text-[24px]">{c.icon}</span>
                  </div>
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${c.badgeColor}`}>
                    {c.badge}
                  </span>
                </div>

                <h2 className="font-sora text-xl font-bold text-[#100f0d] mb-2">
                  {c.title}
                </h2>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed mb-6">
                  {c.desc}
                </p>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleSelect(c.id)}
                className="w-full py-3 px-4 rounded-xl btn-primary flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold shadow-sm"
              >
                {c.cta}
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>
          ))}
        </div>
      </main>

      {/* ── MODAL : CONFIGURATION ENTREPRISE ── */}
      {showCompanyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-card rounded-3xl max-w-md w-full p-6 sm:p-8 space-y-5 bg-white">
            <div className="flex items-center justify-between">
              <h3 className="font-sora text-xl font-bold text-[#100f0d]">
                Détails de l'entreprise
              </h3>
              <button
                type="button"
                onClick={() => setShowCompanyModal(false)}
                className="text-outline hover:text-on-surface"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleCompanySubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  Nom de l'entreprise / Société *
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex: Acme Corp S.A."
                  className="form-input"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  Matricule fiscal (facultatif au départ)
                </label>
                <input
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="Ex: 1234567/A/M/000"
                  className="form-input"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  Ville du siège
                </label>
                <input
                  type="text"
                  value={companyCity}
                  onChange={(e) => setCompanyCity(e.target.value)}
                  placeholder="Tunis, Sfax…"
                  className="form-input"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCompanyModal(false)}
                  className="btn-outline flex-1 py-2.5 rounded-xl text-sm"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex-1 py-2.5 rounded-xl text-sm font-semibold"
                >
                  {loading ? t('common.loading') : t('common.confirm')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center py-4 px-6 text-xs text-on-surface-variant/70 border-t border-outline-variant/10">
        © {new Date().getFullYear()} {t('common.appName')} · {t('common.rightsReserved')}
      </footer>
    </div>
  );
}

