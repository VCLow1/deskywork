// pages/SpaceOnboarding.jsx — Onboarding de création d'espace (Coworking ou Centre de Formation)
import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import BrandLogo from '../components/layout/BrandLogo';
import { useLanguage, LanguageSwitcher } from '../context/LanguageContext';
import { authUnifiedApi } from '../services/api/authUnified';

export default function SpaceOnboarding() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const spaceType = searchParams.get('type') === 'centre_formation' ? 'centre_formation' : 'coworking';

  // Form states
  const [nom, setNom] = useState('');
  const [ville, setVille] = useState('Tunis');
  const [adresse, setAdresse] = useState('');
  const [description, setDescription] = useState('');
  const [telephone, setTelephone] = useState('+216 ');
  const [emailContact, setEmailContact] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');

  // Horaires
  const [horaires, setHoraires] = useState({
    lundi_vendredi: '08:00 - 20:00',
    samedi: '09:00 - 18:00',
    dimanche: 'Fermé',
  });

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nom.trim() || !ville.trim() || !adresse.trim()) {
      setErrorMsg('Veuillez renseigner le nom, la ville et l\'adresse complète.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      await authUnifiedApi.createSpaceOnboarding({
        type: spaceType,
        nom: nom.trim(),
        ville: ville.trim(),
        adresse: adresse.trim(),
        description: description.trim(),
        telephone: telephone.trim(),
        email: emailContact.trim() || null,
        logo_url: logoUrl.trim() || null,
        cover_url: coverUrl.trim() || null,
        horaires,
      });

      setIsSuccess(true);
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de la création de l\'espace.');
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

      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8 relative z-10 max-w-3xl mx-auto w-full">
        {isSuccess ? (
          <div className="glass-card rounded-3xl p-8 sm:p-10 text-center animate-fade-in space-y-6 max-w-lg w-full">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-amber-100 flex items-center justify-center text-amber-700 shadow-md">
              <span className="material-symbols-outlined text-[36px]">hourglass_top</span>
            </div>

            <div>
              <h1 className="font-sora text-2xl sm:text-3xl font-bold text-[#100f0d] mb-2">
                {t('spaceOnboarding.successTitle')}
              </h1>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {t('spaceOnboarding.successDesc')}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-left text-xs space-y-1 text-amber-900">
              <div className="font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">info</span>
                Statut : En cours de validation (Brouillon)
              </div>
              <p>
                Vous avez accès immédiat à votre tableau de bord administrateur pour configurer vos salles, bureaux et tarifs. L'espace apparaîtra sur la marketplace dès sa validation par VClow.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate('/admin/dashboard', { replace: true })}
              className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm shadow-md flex items-center justify-center gap-2"
            >
              Accéder à l'administration de mon espace
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-6 sm:p-8 space-y-6 w-full animate-fade-up">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-orange-100 text-orange-800 mb-3">
                <span className="material-symbols-outlined text-[15px]">
                  {spaceType === 'centre_formation' ? 'school' : 'domain'}
                </span>
                {spaceType === 'centre_formation' ? 'Centre de Formation' : 'Espace Coworking'}
              </div>
              <h1 className="font-sora text-2xl sm:text-3xl font-bold text-[#100f0d] mb-1">
                {spaceType === 'centre_formation'
                  ? t('spaceOnboarding.centreTitle')
                  : t('spaceOnboarding.coworkingTitle')}
              </h1>
              <p className="text-xs sm:text-sm text-on-surface-variant">
                {t('spaceOnboarding.subtitle')}
              </p>
            </div>

            {errorMsg && (
              <div className="p-4 rounded-2xl flex items-center gap-3 text-sm animate-fade-in bg-red-50 text-red-700 border border-red-200">
                <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  {t('spaceOnboarding.nomLabel')} *
                </label>
                <input
                  type="text"
                  required
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder={t('spaceOnboarding.nomPlaceholder')}
                  className="form-input"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface">
                    {t('spaceOnboarding.villeLabel')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={ville}
                    onChange={(e) => setVille(e.target.value)}
                    placeholder={t('spaceOnboarding.villePlaceholder')}
                    className="form-input"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface">
                    {t('spaceOnboarding.phoneLabel')}
                  </label>
                  <input
                    type="tel"
                    value={telephone}
                    onChange={(e) => setTelephone(e.target.value)}
                    className="form-input"
                    placeholder="+216 71 000 000"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  {t('spaceOnboarding.adresseLabel')} *
                </label>
                <input
                  type="text"
                  required
                  value={adresse}
                  onChange={(e) => setAdresse(e.target.value)}
                  placeholder={t('spaceOnboarding.adressePlaceholder')}
                  className="form-input"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-on-surface">
                  {t('spaceOnboarding.descLabel')}
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('spaceOnboarding.descPlaceholder')}
                  className="form-input"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface">
                    Lundi - Vendredi
                  </label>
                  <input
                    type="text"
                    value={horaires.lundi_vendredi}
                    onChange={(e) => setHoraires({ ...horaires, lundi_vendredi: e.target.value })}
                    className="form-input text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface">
                    Samedi
                  </label>
                  <input
                    type="text"
                    value={horaires.samedi}
                    onChange={(e) => setHoraires({ ...horaires, samedi: e.target.value })}
                    className="form-input text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface">
                    Dimanche
                  </label>
                  <input
                    type="text"
                    value={horaires.dimanche}
                    onChange={(e) => setHoraires({ ...horaires, dimanche: e.target.value })}
                    className="form-input text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface">
                    {t('spaceOnboarding.logoLabel')} (URL)
                  </label>
                  <input
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://..."
                    className="form-input"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-on-surface">
                    {t('spaceOnboarding.coverLabel')} (URL)
                  </label>
                  <input
                    type="url"
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                    placeholder="https://..."
                    className="form-input"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm shadow-md flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <><span className="animate-spin material-symbols-outlined text-[18px]">refresh</span> {t('spaceOnboarding.submitting')}</>
                  ) : (
                    <><span className="material-symbols-outlined text-[18px]">add_business</span> {t('spaceOnboarding.submitBtn')}</>
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

