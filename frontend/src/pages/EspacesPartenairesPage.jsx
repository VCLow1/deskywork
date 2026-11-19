// pages/EspacesPartenairesPage.jsx — Formulaire B2B "Espaces partenaires" (CDC v3.0 — Chantier 1 & D6)
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Navbar from '../components/layout/Navbar';
import { guestApi } from '../services/api/guests';
import { SAAS_PACKS } from '../constants/saasPacks';
import { formatDT } from '../utils/format';

export default function EspacesPartenairesPage({ session }) {
  const [searchParams] = useSearchParams();
  const initialPack = ['essentiel', 'standard', 'premium'].includes(searchParams.get('pack'))
    ? searchParams.get('pack')
    : 'standard';

  const [form, setForm] = useState({
    nom_etablissement: '',
    ville: 'Tunis',
    adresse: '',
    nb_espaces: 5,
    activite: 'coworking', // coworking | centre_formation | mixte
    pack_saas: initialPack,
    nom_contact: '',
    email: '',
    telephone: '+216 ',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.nom_etablissement.trim() || !form.ville.trim() || !form.adresse.trim() || !form.nom_contact.trim() || !form.email.trim() || !form.telephone.trim()) {
      setError('Veuillez remplir tous les champs obligatoires.');
      return;
    }
    setLoading(true);
    try {
      const res = await guestApi.submitPartnerRequest(form);
      setSuccess(res);
    } catch (err) {
      setError(err.message || 'Impossible d’envoyer la demande.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] font-inter text-[#100f0d]">
      <Navbar session={session} activeLink="/espaces-partenaires" />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-28 sm:px-6">
        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#f95d00]">
            <span className="material-symbols-outlined text-[16px]">domain</span>
            Espaces Partenaires B2B
          </span>
          <h1 className="mt-3 font-sora text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Digitalisez votre coworking ou centre de formation
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Déployez votre back-office dédié (réservations, sessions de travail en direct, encaissement sur place avec reçu PDF numéroté, sessions de formation) et publiez vos espaces sur la marketplace DeskyWork.
          </p>
        </div>

        {/* Rappel Packs SaaS B2B */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {SAAS_PACKS.map((pack) => {
            const active = form.pack_saas === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, pack_saas: pack.id }))}
                className={`rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? 'border-[#f95d00] bg-orange-50/70 ring-2 ring-[#f95d00]/20 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sora text-base font-bold text-slate-900">{pack.title}</span>
                  {pack.badge && (
                    <span className="rounded-full bg-[#f95d00] px-2.5 py-0.5 text-[10px] font-bold uppercase text-white">
                      {pack.badge}
                    </span>
                  )}
                </div>
                <p className="mt-1 font-sora text-xl font-extrabold text-[#f95d00]">
                  {formatDT(pack.price)} <span className="text-xs font-medium text-slate-500">HT / mois</span>
                </p>
                <p className="mt-1 text-xs text-slate-600">{pack.features.slice(0, 3).join(' · ')}</p>
              </button>
            );
          })}
        </div>

        {success ? (
          <div className="rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <span className="material-symbols-outlined text-[34px]">check_circle</span>
            </div>
            <h2 className="font-sora text-2xl font-bold text-slate-900">Demande partenaire enregistrée !</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-600">{success.message}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Retour à l'accueil
              </Link>
              <Link to="/register" className="rounded-xl bg-[#f95d00] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#e55500]">
                Créer un compte administrateur
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 space-y-5">
            {error && (
              <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span className="material-symbols-outlined text-[18px]">error</span>
                <span>{error}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Nom de l'établissement *</label>
                <input
                  type="text"
                  required
                  value={form.nom_etablissement}
                  onChange={(e) => setForm((f) => ({ ...f, nom_etablissement: e.target.value }))}
                  placeholder="Ex: Thirty Three Space / Académie Tech"
                  className="form-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Ville *</label>
                <input
                  type="text"
                  required
                  value={form.ville}
                  onChange={(e) => setForm((f) => ({ ...f, ville: e.target.value }))}
                  placeholder="Ex: Tunis, Sousse, Sfax, Ariana"
                  className="form-input"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Adresse complète *</label>
                <input
                  type="text"
                  required
                  value={form.adresse}
                  onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))}
                  placeholder="Ex: Avenue Habib Bourguiba, Montplaisir, Tunis"
                  className="form-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Nombre d'espaces / salles *</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={form.nb_espaces}
                  onChange={(e) => setForm((f) => ({ ...f, nb_espaces: Number(e.target.value) || 1 }))}
                  className="form-input"
                />
              </div>
            </div>

            {/* Activités : Coworking / Formation / Deux (D5) */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700">Activités de l'établissement *</label>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { id: 'coworking', icon: 'desk', label: 'Coworking uniquement', desc: 'Open space, bureaux, salles de réunion' },
                  { id: 'centre_formation', icon: 'school', label: 'Centre de formation', desc: 'Formations, sessions & apprenants' },
                  { id: 'mixte', icon: 'hub', label: 'Les deux (Mixte)', desc: 'Coworking + Centre de formation unifiés' },
                ].map((opt) => {
                  const active = form.activite === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, activite: opt.id }))}
                      className={`rounded-2xl border p-3.5 text-left transition ${
                        active ? 'border-[#f95d00] bg-orange-50 ring-2 ring-[#f95d00]/15' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                        <span className="material-symbols-outlined text-[18px] text-[#f95d00]">{opt.icon}</span>
                        {opt.label}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Nom du contact *</label>
                <input
                  type="text"
                  required
                  value={form.nom_contact}
                  onChange={(e) => setForm((f) => ({ ...f, nom_contact: e.target.value }))}
                  placeholder="Prénom & Nom"
                  className="form-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">E-mail professionnel *</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="direction@espace.tn"
                  className="form-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Téléphone *</label>
                <input
                  type="tel"
                  required
                  value={form.telephone}
                  onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
                  placeholder="+216 52 882 880"
                  className="form-input"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Précisions complémentaires (optionnel)</label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Vos besoins spécifiques, configuration multi-sites, planning souhaité…"
                className="form-input"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full rounded-xl py-3.5 text-sm font-bold shadow-md flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
              {loading ? 'Envoi en cours…' : 'Envoyer ma demande partenaire B2B'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

