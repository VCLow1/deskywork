// components/auth/RoleRegistrationFields.jsx — Formulaire dynamique selon l'un des 5 rôles DeskyWork
import React, { useState } from 'react';
import { SAAS_PACKS } from '../../constants/saasPacks';
import { formatDT } from '../../utils/format';
import { evaluatePasswordStrength, isEstablishmentRole } from '../../constants/registrationRoles';

const TUNISIA_CITIES = [
  'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Nabeul', 'Hammamet',
  'Sousse', 'Monastir', 'Mahdia', 'Sfax', 'Bizerte', 'Gabès', 'Gafsa', 'Kairouan', 'Autre',
];

export default function RoleRegistrationFields({
  role,
  values,
  onChange,
  isOAuth = false,
  onRegeneratePassword,
  password,
  onPasswordChange,
}) {
  const [showPwd, setShowPwd] = useState(false);
  const [copiedPwd, setCopiedPwd] = useState(false);

  const isEstab = isEstablishmentRole(role);
  const isTrainer = role === 'TRAINER';
  const isCompany = role === 'COMPANY';
  const strength = !isOAuth ? evaluatePasswordStrength(password || '') : null;

  const setField = (key, val) => onChange({ ...values, [key]: val });

  const handleCopyPassword = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopiedPwd(true);
      setTimeout(() => setCopiedPwd(false), 2500);
    } catch (_) {}
  };

  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      setField('justificatif_error', 'Le fichier ne doit pas dépasser 2,5 Mo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || '').split(',')[1] || '';
      onChange({
        ...values,
        justificatif_error: '',
        justificatif_file: {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          base64,
        },
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      {/* ── Champs spécifiques Établissement (Coworking Space / Centre de formation) ── */}
      {isEstab && (
        <div className="space-y-3.5 rounded-2xl border border-orange-200/70 bg-orange-50/40 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#f95d00]">
            <span className="material-symbols-outlined text-[16px]">
              {role === 'COWORKING_ADMIN' ? 'apartment' : 'cast_for_education'}
            </span>
            {role === 'COWORKING_ADMIN' ? 'Informations de l\'espace de coworking' : 'Informations du centre de formation'}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-on-surface" htmlFor="reg-etab-nom">
              {role === 'COWORKING_ADMIN' ? 'Nom de l\'établissement *' : 'Nom du centre de formation *'}
            </label>
            <input
              id="reg-etab-nom"
              type="text"
              required
              value={values.nom_etablissement || ''}
              onChange={(e) => setField('nom_etablissement', e.target.value)}
              placeholder={role === 'COWORKING_ADMIN' ? 'Ex : Hive Workspace Tunis' : 'Ex : Académie Numérique Carthage'}
              className="form-input bg-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface" htmlFor="reg-etab-ville">
                Ville *
              </label>
              <select
                id="reg-etab-ville"
                required
                value={values.ville || 'Tunis'}
                onChange={(e) => setField('ville', e.target.value)}
                className="form-input bg-white"
              >
                {TUNISIA_CITIES.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface" htmlFor="reg-etab-nb">
                {role === 'COWORKING_ADMIN' ? 'Nombre d\'espaces estimé *' : 'Nombre de salles de formation *'}
              </label>
              <input
                id="reg-etab-nb"
                type="number"
                min={1}
                max={500}
                required
                value={values.nb_espaces ?? 5}
                onChange={(e) => setField('nb_espaces', Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="form-input bg-white"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-on-surface" htmlFor="reg-etab-adresse">
              Adresse complète *
            </label>
            <input
              id="reg-etab-adresse"
              type="text"
              required
              value={values.adresse || ''}
              onChange={(e) => setField('adresse', e.target.value)}
              placeholder="Ex : 14 Avenue Habib Bourguiba, Les Berges du Lac"
              className="form-input bg-white"
            />
          </div>

          {/* Choix du Pack indicatif (D6) */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-on-surface">
                Pack SaaS indicatif *
              </span>
              {(() => {
                const chosen = SAAS_PACKS.find((p) => p.id === (values.pack_saas || 'standard'));
                return chosen ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f95d00]/12 border border-[#f95d00]/30 px-2.5 py-0.5 text-[11px] font-bold text-[#c2410c] transition-all duration-200">
                    <span className="material-symbols-outlined text-[13px] text-[#f95d00]">check_circle</span>
                    Choisi : {chosen.title}
                  </span>
                ) : null;
              })()}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {SAAS_PACKS.map((pack) => {
                const active = (values.pack_saas || 'standard') === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setField('pack_saas', pack.id)}
                    className={`relative rounded-xl border-2 p-3 text-left transition-all duration-200 ease-out cursor-pointer active:scale-[0.98] ${
                      active
                        ? 'border-[#f95d00] bg-gradient-to-br from-[#fff3e8] via-white to-[#fff9f3] shadow-md shadow-[#f95d00]/15 -translate-y-0.5 scale-[1.02]'
                        : 'border-slate-200 bg-white/80 opacity-80 hover:opacity-100 hover:border-[#f95d00]/45 hover:-translate-y-0.5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`material-symbols-outlined text-[17px] shrink-0 transition-transform duration-200 ${
                            active ? 'text-[#f95d00] scale-110' : 'text-slate-300 scale-95'
                          }`}
                        >
                          {active ? 'check_circle' : 'radio_button_unchecked'}
                        </span>
                        <span className={`text-xs font-bold truncate ${active ? 'text-[#100f0d]' : 'text-slate-800'}`}>
                          {pack.title}
                        </span>
                      </div>
                      {pack.badge && (
                        <span className="rounded-full bg-[#f95d00] px-1.5 py-0.5 text-[9px] font-bold text-white shrink-0">
                          Top
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-extrabold text-[#f95d00] mt-1.5">
                      {formatDT(pack.price)} <span className="text-[10px] font-normal text-slate-500">/mois HT</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">
                      {pack.features[0]}
                    </div>
                    {active && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-[#f95d00] px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                        Sélectionné
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Case optionnelle mode Mixte */}
          <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 cursor-pointer hover:border-[#f95d00]/50 transition-colors">
            <input
              type="checkbox"
              checked={Boolean(values.mixte)}
              onChange={(e) => setField('mixte', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#f95d00] focus:ring-[#f95d00]"
            />
            <div className="text-xs">
              <span className="font-semibold text-slate-900 block">
                {role === 'COWORKING_ADMIN'
                  ? 'Je propose aussi des formations'
                  : 'Je propose aussi des espaces de coworking'}
              </span>
              <span className="text-slate-500">
                Active le mode Mixte (coworking + centre de formation avec calendrier anti-conflit).
              </span>
            </div>
          </label>
        </div>
      )}

      {/* ── Coordonnées du titulaire / gérant ── */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-on-surface" htmlFor="reg-fullname">
          {isEstab ? 'Nom complet du gérant (contact principal) *' : 'Nom complet *'}
        </label>
        <input
          id="reg-fullname"
          type="text"
          required
          value={values.nom_complet || ''}
          onChange={(e) => setField('nom_complet', e.target.value)}
          placeholder="Ex : Sarra Ben Ali"
          className="form-input"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-on-surface" htmlFor="reg-email">
            {isEstab ? 'E-mail professionnel *' : 'Adresse e-mail *'}
          </label>
          <input
            id="reg-email"
            type="email"
            required
            readOnly={isOAuth}
            autoComplete="email"
            value={values.email || ''}
            onChange={(e) => setField('email', e.target.value)}
            placeholder="exemple@domaine.tn"
            className={`form-input ${isOAuth ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : ''}`}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-on-surface" htmlFor="reg-tel">
            Téléphone *
          </label>
          <input
            id="reg-tel"
            type="tel"
            required
            value={values.telephone || '+216 '}
            onChange={(e) => setField('telephone', e.target.value)}
            placeholder="+216 99 999 999"
            className="form-input"
          />
        </div>
      </div>

      {isCompany && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] text-[#f95d00] shrink-0 mt-0.5">info</span>
          <span>
            Les coordonnées de facturation de votre entreprise (raison sociale, matricule fiscal) seront demandées lors de vos réservations.
          </span>
        </div>
      )}

      {/* ── Champs spécifiques Formateur ── */}
      {isTrainer && (
        <div className="space-y-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <span className="material-symbols-outlined text-[16px] text-[#f95d00]">school</span>
            Profil Formateur
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-on-surface" htmlFor="reg-spec">
              Spécialité(s) *
            </label>
            <input
              id="reg-spec"
              type="text"
              required
              value={values.specialite || ''}
              onChange={(e) => setField('specialite', e.target.value)}
              placeholder="Ex : React, Design UX, Gestion de projet Agile"
              className="form-input bg-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-on-surface" htmlFor="reg-bio">
              Courte biographie *
            </label>
            <textarea
              id="reg-bio"
              rows={3}
              required
              value={values.biographie || ''}
              onChange={(e) => setField('biographie', e.target.value)}
              placeholder="Présentez brièvement votre parcours, vos certifications et les ateliers que vous animez..."
              className="form-input bg-white resize-y min-h-[84px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface" htmlFor="reg-photo">
                Photo de profil (URL, optionnel)
              </label>
              <input
                id="reg-photo"
                type="url"
                value={values.photo_url || ''}
                onChange={(e) => setField('photo_url', e.target.value)}
                placeholder="https://..."
                className="form-input bg-white"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-on-surface" htmlFor="reg-justif-url">
                Lien justificatif / portfolio (optionnel)
              </label>
              <input
                id="reg-justif-url"
                type="url"
                value={values.justificatif_url || ''}
                onChange={(e) => setField('justificatif_url', e.target.value)}
                placeholder="https://linkedin.com/in/..."
                className="form-input bg-white"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-on-surface block" htmlFor="reg-justif-file">
              Ou joindre un justificatif / CV (PDF, image — optionnel)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="reg-justif-file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={handleFilePick}
                className="text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#100f0d] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-[#2a2722] cursor-pointer"
              />
              {values.justificatif_file?.filename && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                  <span className="material-symbols-outlined text-[13px]">attach_file</span>
                  {values.justificatif_file.filename}
                </span>
              )}
            </div>
            {values.justificatif_error && (
              <p className="text-xs text-red-600">{values.justificatif_error}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Mot de passe généré automatiquement (inscription classique uniquement) ── */}
      {!isOAuth && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold text-on-surface" htmlFor="reg-password">
              Mot de passe sécurisé *
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onRegeneratePassword}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#f95d00] hover:text-[#f95d00] transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">autorenew</span>
                Régénérer
              </button>
              <button
                type="button"
                onClick={handleCopyPassword}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  copiedPwd
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#f95d00] hover:text-[#f95d00]'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {copiedPwd ? 'check' : 'content_copy'}
                </span>
                {copiedPwd ? 'Copié !' : 'Copier'}
              </button>
            </div>
          </div>

          <div className="relative">
            <input
              id="reg-password"
              type={showPwd ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete="new-password"
              value={password || ''}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Minimum 8 caractères"
              className="form-input bg-white pr-10 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-outline hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[19px]">
                {showPwd ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-500">
              Généré automatiquement (14 car.) — modifiable à tout moment.
            </span>
            {strength && (
              <span
                className={`font-semibold ${
                  strength.score >= 4 ? 'text-emerald-700' : strength.valid ? 'text-amber-700' : 'text-red-600'
                }`}
              >
                {strength.score >= 4 ? 'Mot de passe fort' : strength.valid ? 'Acceptable' : 'Trop faible (8 car. min)'}
              </span>
            )}
          </div>
        </div>
      )}

      {isEstab && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] text-amber-700 shrink-0 mt-0.5">verified_user</span>
          <span>
            Après confirmation de votre adresse e-mail, votre demande d&apos;établissement restera en statut <strong>En attente</strong> jusqu&apos;à validation par l&apos;équipe DeskyWork.
          </span>
        </div>
      )}
    </div>
  );
}

