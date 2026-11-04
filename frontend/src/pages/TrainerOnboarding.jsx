// pages/TrainerOnboarding.jsx — Onboarding Profil Formateur Indépendant
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import BrandLogo from '../components/layout/BrandLogo';
import { useLanguage, LanguageSwitcher } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';

export default function TrainerOnboarding() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [bio, setBio] = useState('');
  const [domainesInput, setDomainesInput] = useState('Développement Web, Design UX');
  const [telephonePro, setTelephonePro] = useState('+216 ');
  const [certificats, setCertificats] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!bio.trim() || !domainesInput.trim()) {
      setErrorMsg('Veuillez renseigner votre biographie et vos domaines d\'expertise.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const domaines = domainesInput
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);

      await authUnifiedApi.createTrainerProfile({
        bio: bio.trim(),
        domaines,
        telephone_pro: telephonePro.trim() || null,
        certificats: certificats ? [{ titre: certificats.trim() }] : [],
      });

      setIsSuccess(true);
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de l\'enregistrement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen page-gradient flex flex-col font-inter text-on-surface">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 relative z-10 border-b border-outline-variant/15">
        <BrandLogo to="/" height={40} />
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <Link to="/dashboard" className="text-sm font-semibold text-secondary hover:underline">
            Passer pour l'instant
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8 relative z-10 max-w-2xl mx-auto w-full">
        {isSuccess ? (
          <div className="glass-card rounded-3xl p-8 sm:p-10 text-center animate-fade-in space-y-6 max-w-lg w-full">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-100 flex items-center justify-center text-emerald-700 shadow-md">
              <span className="material-symbols-outlined text-[36px]">verified</span>
            </div>

            <div>
              <h1 className="font-sora text-2xl sm:text-3xl font-bold text-[#100f0d] mb-2">
                {t('trainerOnboarding.successTitle')}
              </h1>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {t('trainerOnboarding.successDesc')}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-left text-xs space-y-1 text-amber-900">
              <div className="font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">info</span>
                Statut : En cours de validation par VClow
              </div>
              <p>
                Vous pouvez d'ores et déjà préparer vos formations dans votre espace formateur. Elles seront rendues publiques et réservables dès l'approbation de votre profil.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate('/trainer-dashboard', { replace: true })}
              className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm shadow-md flex items-center justify-center gap-2"
            >
              Accéder à mon espace formateur
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-6 sm:p-8 space-y-6 w-full animate-fade-up">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800 mb-3">
                <span className="material-symbols-outlined text-[15px]">school</span>
                Formateur Indépendant
              </div>
              <h1 className="font-sora text-2xl sm:text-3xl font-bold text-[#100f0d] mb-1">
                {t('trainerOnboarding.title')}
              </h1>
              <p className="text-xs sm:text-sm text-on-surface-variant">
                {t('trainerOnboarding.subtitle')}
              </p>
            </div>

            {errorMsg && (
              <div className="p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in bg-red-50 text-red-700 border border-red-200">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  {t('trainerOnboarding.bioLabel')} *
                </label>
                <textarea
                  rows={4}
                  required
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('trainerOnboarding.bioPlaceholder')}
                  className="form-input"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  {t('trainerOnboarding.domainesLabel')} *
                </label>
                <input
                  type="text"
                  required
                  value={domainesInput}
                  onChange={(e) => setDomainesInput(e.target.value)}
                  placeholder={t('trainerOnboarding.domainesPlaceholder')}
                  className="form-input"
                />
                <p className="text-[11px] text-on-surface-variant">
                  Indiquez vos matières principales d'enseignement
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  {t('trainerOnboarding.phoneLabel')}
                </label>
                <input
                  type="tel"
                  value={telephonePro}
                  onChange={(e) => setTelephonePro(e.target.value)}
                  placeholder={t('trainerOnboarding.phonePlaceholder')}
                  className="form-input"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  {t('trainerOnboarding.certificatsLabel')}
                </label>
                <input
                  type="text"
                  value={certificats}
                  onChange={(e) => setCertificats(e.target.value)}
                  placeholder="Ex: Certification AWS Certified Solutions Architect, Master en Informatique…"
                  className="form-input"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm shadow-md flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <><span className="animate-spin material-symbols-outlined text-[18px]">refresh</span> {t('trainerOnboarding.submitting')}</>
                  ) : (
                    <><span className="material-symbols-outlined text-[18px]">send</span> {t('trainerOnboarding.submitBtn')}</>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      <footer className="text-center py-4 px-6 text-xs text-on-surface-variant/70 border-t border-outline-variant/10">
        © {new Date().getFullYear()} {t('common.appName')} · {t('common.rightsReserved')}
      </footer>
    </div>
  );
}

