import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { supabase } from '../supabaseClient';
import { formatDT } from '../utils/currency';
import { paymentApi } from '../services/api';

export default function TrainerPayouts({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = userId
    ? { id: userId, email, role: 'formateur', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata }
    : null;

  const [activeTab, setActiveTab] = useState('payouts'); // 'payouts' ou 'personal'
  const [loading, setLoading] = useState(true);
  const [formations, setFormations] = useState([]);
  const [personalPayments, setPersonalPayments] = useState([]);

  useEffect(() => {
    async function loadTrainerData() {
      if (!userId) return;
      setLoading(true);
      try {
        // Charger les formations du formateur
        const { data: forms } = await supabase
          .from('formations')
          .select('*, tenants(id, nom, ville)')
          .eq('formateur_id', userId)
          .order('date_debut', { ascending: false });

        setFormations(forms || []);

        // Charger les paiements de réservations personnelles
        const pList = await paymentApi.listSelf().catch(() => []);
        setPersonalPayments(Array.isArray(pList) ? pList : pList?.paiements || []);
      } catch (err) {
        console.error('Erreur chargement rémunérations:', err);
      } finally {
        setLoading(false);
      }
    }
    loadTrainerData();
  }, [userId]);

  // Calcul des rémunérations (Payouts)
  // Formateur touche soit tarif_formateur_total, soit commission par inscrit
  const payoutsList = formations.map((f) => {
    const prix = parseFloat(f.prix) || 0;
    const inscrits = parseInt(f.nb_inscrits || f.inscrits || 0, 10);
    const brut = prix * inscrits;
    // Rémunération estimée (ex: 70% pour le formateur, 30% pour l'établissement)
    const remuneration = brut > 0 ? brut * 0.7 : (parseFloat(f.tarif_formateur || 150));
    const isPast = new Date(f.date_debut) < new Date();
    const isPaid = isPast && (f.statut_payout === 'paid' || f.statut === 'terminee');

    return {
      id: f.id,
      titre: f.titre || 'Session de Formation',
      tenant_nom: f.tenants?.nom || 'Établissement Partenaire',
      tenant_ville: f.tenants?.ville || 'Tunis',
      date: f.date_debut,
      inscrits,
      montant: remuneration,
      statut: isPaid ? 'paid' : 'pending',
    };
  });

  const totalPaid = payoutsList.filter(p => p.statut === 'paid').reduce((acc, p) => acc + p.montant, 0);
  const totalPending = payoutsList.filter(p => p.statut === 'pending').reduce((acc, p) => acc + p.montant, 0);

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="space-y-6">
        <div>
          <h1 className="font-sora font-bold text-2xl text-slate-900">Rémunérations & Suivi Financier</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Suivi des rémunérations dues par les établissements partenaires pour vos formations, et historique de vos réservations personnelles.
          </p>
        </div>

        {/* Onglets principaux : Payouts Formateur vs Réservations personnelles */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('payouts')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'payouts'
                ? 'bg-[#f95d00] text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">payments</span>
            Rémunérations Formations (Payouts)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('personal')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'personal'
                ? 'bg-[#f95d00] text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">person</span>
            Mes Réservations Personnelles
          </button>
        </div>

        {activeTab === 'payouts' ? (
          <div className="space-y-6">
            {/* KPI Payouts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <span className="text-xs font-bold uppercase text-slate-500">Rémunérations Encaissées</span>
                <div className="font-sora text-2xl font-bold text-emerald-600 mt-1">
                  {formatDT(totalPaid)}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">Versé par les établissements</p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <span className="text-xs font-bold uppercase text-slate-500">En Attente de Règlement</span>
                <div className="font-sora text-2xl font-bold text-amber-600 mt-1">
                  {formatDT(totalPending)}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">Sessions en cours ou à émarger</p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <span className="text-xs font-bold uppercase text-slate-500">Sessions Total</span>
                <div className="font-sora text-2xl font-bold text-slate-900 mt-1">
                  {payoutsList.length}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">Formations créées et animées</p>
              </div>
            </div>

            {/* Tableau Payouts */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="font-sora text-base font-bold text-slate-900">
                  Détail des reversements par formation
                </h2>
                <p className="text-xs text-slate-500">
                  Rémunérations reversées par chaque coworking partenaire lors de la clôture des sessions.
                </p>
              </div>

              {loading ? (
                <div className="p-8 text-center text-slate-400 text-xs">Chargement…</div>
              ) : payoutsList.length === 0 ? (
                <div className="p-10 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Aucune rémunération enregistrée.</p>
                  <Link to="/trainer/formations?create=1" className="text-xs text-[#f95d00] font-bold hover:underline">
                    Créer une session de formation
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/70 text-[11px] font-bold uppercase text-slate-500">
                        <th className="px-5 py-3.5">Formation</th>
                        <th className="px-5 py-3.5">Établissement</th>
                        <th className="px-5 py-3.5">Date</th>
                        <th className="px-5 py-3.5">Participants</th>
                        <th className="px-5 py-3.5">Rémunération due</th>
                        <th className="px-5 py-3.5">Statut reversement</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {payoutsList.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/50">
                          <td className="px-5 py-4 font-semibold text-slate-900">{p.titre}</td>
                          <td className="px-5 py-4">{p.tenant_nom} ({p.tenant_ville})</td>
                          <td className="px-5 py-4 text-slate-600">{new Date(p.date).toLocaleDateString('fr-FR')}</td>
                          <td className="px-5 py-4 font-bold">{p.inscrits} participant(s)</td>
                          <td className="px-5 py-4 font-sora font-bold text-slate-900">{formatDT(p.montant)}</td>
                          <td className="px-5 py-4">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              p.statut === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {p.statut === 'paid' ? 'Payé par l’établissement' : 'En attente de versement'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Onglet 2 : Réservations Personnelles */
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-sora text-base font-bold text-slate-900">
                Mes dépenses & réservations personnelles d'espaces
              </h2>
              <p className="text-xs text-slate-500">
                Historique de vos postes de travail et bureaux réservés pour vos besoins propres.
              </p>
            </div>

            {personalPayments.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-400">
                Aucune dépense personnelle pour le moment.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 text-[11px] font-bold uppercase text-slate-500">
                      <th className="px-5 py-3">Réf.</th>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Montant</th>
                      <th className="px-5 py-3">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {personalPayments.map((pay) => (
                      <tr key={pay.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3 font-mono font-bold">{pay.id.slice(0, 8).toUpperCase()}</td>
                        <td className="px-5 py-3 text-slate-600">{new Date(pay.created_at).toLocaleDateString('fr-FR')}</td>
                        <td className="px-5 py-3 font-bold">{formatDT(pay.montant || 0)}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            pay.statut === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {pay.statut === 'paid' ? 'Payée' : 'À régler sur place'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

