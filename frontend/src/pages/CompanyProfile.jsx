import React, { useState, useEffect } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { supabase } from '../supabaseClient';
import { memberApi } from '../services/api';

export default function CompanyProfile({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = userId
    ? { id: userId, email, role: 'company', type_membre: 'entreprise', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata }
    : null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [orgId, setOrgId] = useState(null);
  const [formData, setFormData] = useState({
    raison_sociale: '',
    secteur_activite: 'Services & Technologies',
    matricule_fiscal: '',
    adresse: '',
    ville: 'Tunis',
    pays: 'Tunisie',
    contact_nom: '',
    contact_prenom: '',
    telephone_pro: '',
    email_pro: '',
  });

  useEffect(() => {
    async function loadData() {
      if (!userId) return;
      setLoading(true);
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        const { data: mems } = await supabase
          .from('memberships')
          .select('*, organizations(*)')
          .eq('user_id', userId);

        const org = mems?.[0]?.organizations || null;
        if (org) setOrgId(org.id);

        setFormData({
          raison_sociale: org?.nom || 'Société Test SARL',
          secteur_activite: org?.settings?.secteur_activite || 'Technologies & Conseil',
          matricule_fiscal: org?.matricule_fiscal || '1234567/A/M/000',
          adresse: org?.adresse || 'Rue du Lac Biwa, Les Berges du Lac 2',
          ville: org?.ville || 'Tunis',
          pays: org?.pays || 'Tunisie',
          contact_nom: prof?.nom || 'Entreprise',
          contact_prenom: prof?.prenom || 'Test',
          telephone_pro: prof?.telephone || org?.telephone || '+216 71 123 456',
          email_pro: prof?.email || email || '',
        });
      } catch (err) {
        console.error('Erreur chargement profil société:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [userId, email]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');

    try {
      // 1. Mettre à jour profiles
      await supabase
        .from('profiles')
        .update({
          nom: formData.contact_nom,
          prenom: formData.contact_prenom,
          telephone: formData.telephone_pro,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      // 2. Mettre à jour l'organisation si elle existe
      if (orgId) {
        await supabase
          .from('organizations')
          .update({
            nom: formData.raison_sociale,
            matricule_fiscal: formData.matricule_fiscal,
            adresse: formData.adresse,
            ville: formData.ville,
            pays: formData.pays,
            telephone: formData.telephone_pro,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orgId);
      }

      setSuccessMsg('Profil société enregistré avec succès !');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'Impossible d’enregistrer le profil société.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-sora font-bold text-2xl text-slate-900">Profil Société & Informations B2B</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-slate-900 text-white text-[11px] font-bold uppercase tracking-wider">
              Rôle FIXE
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Ces informations sont automatiquement utilisées sur vos réservations B2B, vos factures et reçus émis par les établissements partenaires.
          </p>
        </div>

        {/* Encadré d'information sur la règle 1 email = 1 rôle */}
        <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200/80 flex items-start gap-3 text-xs text-amber-900">
          <span className="material-symbols-outlined text-amber-600 shrink-0 text-xl">lock</span>
          <div>
            <strong className="block font-semibold mb-0.5">Règle de sécurité DeskyWork (CDC v3.0) :</strong>
            <span>
              Un e-mail correspond strictement à un seul rôle figé (Entreprise B2B). Le changement de type de compte est verrouillé pour garantir la traçabilité des réservations professionnelles et des matricules fiscaux.
            </span>
          </div>
        </div>

        {successMsg && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-base">check_circle</span>
            {successMsg}
          </div>
        )}

        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-base">error</span>
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <h2 className="font-sora font-bold text-base text-slate-900 mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00] text-xl">business</span>
              Identité de l'Entreprise
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Raison sociale *
                </label>
                <input
                  type="text"
                  required
                  value={formData.raison_sociale}
                  onChange={(e) => setFormData({ ...formData, raison_sociale: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Matricule Fiscal / TVA *
                </label>
                <input
                  type="text"
                  required
                  value={formData.matricule_fiscal}
                  onChange={(e) => setFormData({ ...formData, matricule_fiscal: e.target.value })}
                  placeholder="Ex: 1234567/A/M/000"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00] font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Secteur d'activité
                </label>
                <input
                  type="text"
                  value={formData.secteur_activite}
                  onChange={(e) => setFormData({ ...formData, secteur_activite: e.target.value })}
                  placeholder="Ex: Conseil, IT, Finance, Industrie…"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Ville & Pays
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={formData.ville}
                    onChange={(e) => setFormData({ ...formData, ville: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                  />
                  <input
                    type="text"
                    value={formData.pays}
                    disabled
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Adresse du siège social *
                </label>
                <input
                  type="text"
                  required
                  value={formData.adresse}
                  onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00]"
                />
              </div>
            </div>
          </div>

          <div>
            <h2 className="font-sora font-bold text-base text-slate-900 mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00] text-xl">person_pin</span>
              Interlocuteur Principal & Coordonnées
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Prénom de contact *
                </label>
                <input
                  type="text"
                  required
                  value={formData.contact_prenom}
                  onChange={(e) => setFormData({ ...formData, contact_prenom: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Nom de contact *
                </label>
                <input
                  type="text"
                  required
                  value={formData.contact_nom}
                  onChange={(e) => setFormData({ ...formData, contact_nom: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Téléphone professionnel *
                </label>
                <input
                  type="tel"
                  required
                  value={formData.telephone_pro}
                  onChange={(e) => setFormData({ ...formData, telephone_pro: e.target.value })}
                  placeholder="+216 71 000 000"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>E-mail professionnel (Fixe)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Identifiant unique</span>
                </label>
                <input
                  type="email"
                  disabled
                  value={formData.email_pro}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 text-sm cursor-not-allowed font-medium"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 rounded-xl bg-[#f95d00] hover:bg-[#e05300] text-white font-bold text-sm shadow-md shadow-orange-500/20 transition-all disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
            </button>
          </div>
        </form>
      </div>
    </PortalLayout>
  );
}
