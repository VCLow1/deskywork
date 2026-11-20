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

  const [activeTab, setActiveTab] = useState('payouts'); // 'payouts' | 'personal'
  const [filterStatut, setFilterStatut] = useState('all'); // 'all' | 'paye' | 'en_attente'
  const [loading, setLoading] = useState(true);
  const [payoutsList, setPayoutsList] = useState([]);
  const [personalPayments, setPersonalPayments] = useState([]);

  useEffect(() => {
    async function loadData() {
      if (!userId) return;
      setLoading(true);
      try {
        // 1. Récupération des rémunérations en base
        const { data: remuData } = await supabase
          .from('remuneration_formateurs')
          .select('*, formations(id, titre, date_debut, date_fin, statut, tenant_id, tenants(id, nom, ville))')
          .eq('formateur_id', userId)
          .order('created_at', { ascending: false });

        // 2. Récupération des formations animées par ce formateur
        const { data: formsData } = await supabase
          .from('formations')
          .select('*, tenants(id, nom, ville)')
          .eq('formateur_id', userId)
          .order('date_debut', { ascending: false });

        // 3. Fusion et consolidation des rémunérations (Payouts)
        const recordedFormationIds = new Set((remuData || []).map(r => r.formation_id).filter(Boolean));
        const merged = [];

        // Rémunérations formalisées dans remuneration_formateurs
        (remuData || []).forEach(r => {
          const f = r.formations;
          const isPaid = r.statut === 'paye' || r.statut === 'paid';
          merged.push({
            id: r.id,
            formationId: r.formation_id,
            titre: f?.titre || 'Session de formation',
            tenantNom: f?.tenants?.nom || 'Établissement Partenaire',
            tenantVille: f?.tenants?.ville || 'Tunis',
            dateSession: f?.date_debut ? new Date(f.date_debut) : null,
            montant: parseFloat(r.montant) || 0,
            statut: isPaid ? 'paye' : 'en_attente',
            statutLabel: isPaid ? 'Payé' : 'En attente',
            dateReglement: r.date_versement ? new Date(r.date_versement).toLocaleDateString('fr-FR') : null,
            note: r.note || (isPaid ? 'Règlement effectué' : 'En attente de clôture session'),
          });
        });

        // Formations n'ayant pas encore de fiche remuneration_formateurs
        (formsData || []).forEach(f => {
          if (!recordedFormationIds.has(f.id)) {
            const prix = parseFloat(f.prix || f.prix_inscription || 0);
            const inscrits = parseInt(f.nb_inscrits || f.inscrits || 0, 10);
            const brut = prix * (inscrits || 1);
            const remuneration = brut > 0 ? (brut * 0.7) : (parseFloat(f.tarif_formateur || 150));
            const isCompleted = f.statut === 'terminee';

            merged.push({
              id: 'calc-' + f.id,
              formationId: f.id,
              titre: f.titre || 'Session de formation',
              tenantNom: f.tenants?.nom || 'Établissement Partenaire',
              tenantVille: f.tenants?.ville || 'Tunis',
              dateSession: f.date_debut ? new Date(f.date_debut) : null,
              montant: remuneration,
              statut: isCompleted ? 'paye' : 'en_attente',
              statutLabel: isCompleted ? 'Payé' : 'En attente',
              dateReglement: isCompleted ? new Date(f.date_fin || f.date_debut).toLocaleDateString('fr-FR') : null,
              note: isCompleted ? 'Clôturée — Rémunération validée' : 'Session planifiée',
            });
          }
        });

        setPayoutsList(merged);

        // 4. Paiements personnels de réservations d'espaces (bureau / réunion)
        const pList = await paymentApi.listSelf().catch(() => []);
        setPersonalPayments(Array.isArray(pList) ? pList : pList?.paiements || []);
      } catch (err) {
        console.error('Erreur chargement rémunérations formateur:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [userId]);

  // Totaux Payouts
  const totalPaid = payoutsList
    .filter(p => p.statut === 'paye')
    .reduce((acc, p) => acc + p.montant, 0);

  const totalPending = payoutsList
    .filter(p => p.statut === 'en_attente')
    .reduce((acc, p) => acc + p.montant, 0);

  const totalGlobal = totalPaid + totalPending;

  const filteredPayouts = payoutsList.filter(p => {
    if (filterStatut === 'paye') return p.statut === 'paye';
    if (filterStatut === 'en_attente') return p.statut === 'en_attente';
    return true;
  });

  // Téléchargement / Impression reçu de dépense personnelle
  const handlePrintPersonalReceipt = (pay) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Reçu de paiement - ${pay.numero_recu || pay.id.slice(0, 8)}</title>
          <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #1e293b; }
            .header { border-bottom: 2px solid #f95d00; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
            .title { font-size: 24px; font-weight: bold; color: #0f172a; }
            .details { margin: 20px 0; line-height: 1.8; font-size: 14px; }
            .total { font-size: 20px; font-weight: bold; color: #f95d00; margin-top: 24px; padding-top: 16px; border-top: 1px dashed #cbd5e1; }
            .footer { margin-top: 40px; font-size: 11px; color: #64748b; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">REÇU DE PAIEMENT</div>
            <div><strong>DeskyWork</strong> · Réseau Coworking Tunisie</div>
          </div>
          <div class="details">
            <p><strong>Référence :</strong> ${pay.numero_recu || 'REC-' + pay.id.slice(0, 8).toUpperCase()}</p>
            <p><strong>Bénéficiaire :</strong> ${profile?.prenom || ''} ${profile?.nom || ''} (${email || ''})</p>
            <p><strong>Date de paiement :</strong> ${new Date(pay.created_at || Date.now()).toLocaleDateString('fr-FR')}</p>
            <p><strong>Mode de règlement :</strong> Paiement sur place (espèces ou TPE)</p>
            <p><strong>Statut :</strong> PAYÉ</p>
          </div>
          <div class="total">
            Montant réglé : ${formatDT(pay.montant || 0)}
          </div>
          <div class="footer">
            Document généré automatiquement par DeskyWork — Plateforme unifiée de réservation & gestion de coworking en Tunisie.
          </div>
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="space-y-6">
        
        {/* Titre & Description */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-sora font-bold text-2xl text-slate-900">
              Mes Rémunérations (Payouts)
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Suivi officiel des honoraires et reversements dus par les établissements partenaires pour vos ateliers et formations.
            </p>
          </div>

          <Link
            to="/trainer/formations?create=1"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e05300] transition-all shadow-sm active:scale-95 shrink-0 self-start sm:self-auto"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            Planifier une formation
          </Link>
        </div>

        {/* Sélecteur d'onglets principaux */}
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
            Mes Rémunérations (Payouts)
            {payoutsList.length > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'payouts' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}>
                {payoutsList.length}
              </span>
            )}
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
            <span className="material-symbols-outlined text-[17px]">receipt_long</span>
            Mes dépenses / reçus personnels
            {personalPayments.length > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'personal' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}>
                {personalPayments.length}
              </span>
            )}
          </button>
        </div>

        {/* CONTENU ONGLET 1 : RÉMUNÉRATIONS (PAYOUTS) */}
        {activeTab === 'payouts' && (
          <div className="space-y-6">
            
            {/* 3 Cartes KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                  <span className="material-symbols-outlined text-2xl">check_circle</span>
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Rémunérations Payées
                  </span>
                  <div className="font-sora text-2xl font-bold text-emerald-600 mt-1">
                    {formatDT(totalPaid)}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">Versé par les établissements partenaires</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
                  <span className="material-symbols-outlined text-2xl">hourglass_top</span>
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    En Attente de Versement
                  </span>
                  <div className="font-sora text-2xl font-bold text-amber-600 mt-1">
                    {formatDT(totalPending)}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">Sessions en cours ou à émarger</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center shrink-0 border border-slate-200">
                  <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Total Honoraires Dûs
                  </span>
                  <div className="font-sora text-2xl font-bold text-slate-900 mt-1">
                    {formatDT(totalGlobal)}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{payoutsList.length} session(s) animée(s)</p>
                </div>
              </div>
            </div>

            {/* Tableau principal des reversements */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="font-sora text-base font-bold text-slate-900">
                    Détail des sommes dues par établissement partenaire
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Reversements garantis pour vos formations hébergées dans les coworkings partenaires.
                  </p>
                </div>

                {/* Filtre statut */}
                <div className="flex items-center gap-1.5 self-start sm:self-auto bg-slate-50 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setFilterStatut('all')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      filterStatut === 'all' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Toutes ({payoutsList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatut('en_attente')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      filterStatut === 'en_attente' ? 'bg-amber-100 text-amber-800 font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    En attente
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatut('paye')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      filterStatut === 'paye' ? 'bg-emerald-100 text-emerald-800 font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Payées
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="p-12 text-center text-slate-400 text-xs">
                  <div className="inline-block w-6 h-6 border-2 border-[#f95d00] border-t-transparent rounded-full animate-spin mb-2" />
                  <p>Chargement des rémunérations…</p>
                </div>
              ) : filteredPayouts.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <span className="material-symbols-outlined text-slate-300" style={{ fontSize: 48 }}>
                    payments
                  </span>
                  <p className="text-sm font-semibold text-slate-700">Aucune rémunération trouvée dans cette catégorie.</p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Dès que vous animez une session de formation chez un coworking partenaire, les sommes dues s'affichent automatiquement ici.
                  </p>
                  <Link
                    to="/trainer/formations?create=1"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e05300] transition-all"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    Créer ma première session de formation
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                        <th className="px-5 py-3.5">Établissement</th>
                        <th className="px-5 py-3.5">Formation</th>
                        <th className="px-5 py-3.5">Date session</th>
                        <th className="px-5 py-3.5">Montant dû</th>
                        <th className="px-5 py-3.5">Statut</th>
                        <th className="px-5 py-3.5">Date de règlement</th>
                        <th className="px-5 py-3.5">Modalité / Référence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {filteredPayouts.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-5 py-4 font-semibold text-slate-900">
                            <div>{p.tenantNom}</div>
                            <div className="text-[11px] text-slate-400 font-normal">{p.tenantVille}</div>
                          </td>
                          <td className="px-5 py-4 font-medium text-slate-900 max-w-[240px]">
                            {p.titre}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {p.dateSession ? p.dateSession.toLocaleDateString('fr-FR') : '—'}
                          </td>
                          <td className="px-5 py-4 font-sora font-bold text-slate-900 text-sm">
                            {formatDT(p.montant)}
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              p.statut === 'paye'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}>
                              <span className="material-symbols-outlined text-[13px]">
                                {p.statut === 'paye' ? 'check_circle' : 'schedule'}
                              </span>
                              {p.statutLabel}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-slate-600 font-medium">
                            {p.dateReglement || <span className="text-slate-400 italic">— (En attente)</span>}
                          </td>
                          <td className="px-5 py-4 text-slate-500 text-[11px]">
                            {p.note || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONTENU ONGLET 2 : DÉPENSES & RÉSERVATIONS PERSONNELLES */}
        {activeTab === 'personal' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="font-sora text-base font-bold text-slate-900">
                    Mes dépenses & reçus personnels
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Historique de vos postes de travail, bureaux privés ou salles de réunion réservés pour vos besoins propres.
                  </p>
                </div>
                
                <Link
                  to="/book/step1"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold hover:bg-slate-200 transition-all self-start sm:self-auto"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  Réserver un espace
                </Link>
              </div>

              {personalPayments.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-400 space-y-2">
                  <span className="material-symbols-outlined text-slate-300" style={{ fontSize: 44 }}>
                    receipt_long
                  </span>
                  <p className="text-sm font-semibold text-slate-700">Aucune dépense personnelle enregistrée.</p>
                  <p className="text-xs text-slate-400">Vos réservations d'espaces individuels apparaîtront ici.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                        <th className="px-5 py-3.5">Réf. Reçu</th>
                        <th className="px-5 py-3.5">Date</th>
                        <th className="px-5 py-3.5">Mode</th>
                        <th className="px-5 py-3.5">Montant</th>
                        <th className="px-5 py-3.5">Statut</th>
                        <th className="px-5 py-3.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {personalPayments.map((pay) => (
                        <tr key={pay.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-5 py-4 font-mono font-bold text-slate-900">
                            {pay.numero_recu || pay.id.slice(0, 8).toUpperCase()}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {new Date(pay.created_at || Date.now()).toLocaleDateString('fr-FR')}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {pay.mode === 'sur_place' ? 'Paiement sur place' : (pay.mode || 'Sur place')}
                          </td>
                          <td className="px-5 py-4 font-sora font-bold text-slate-900">
                            {formatDT(pay.montant || 0)}
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              pay.statut === 'paid'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}>
                              <span className="material-symbols-outlined text-[13px]">
                                {pay.statut === 'paid' ? 'check_circle' : 'schedule'}
                              </span>
                              {pay.statut === 'paid' ? 'Payée' : 'À régler sur place'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => handlePrintPersonalReceipt(pay)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold text-xs transition-colors"
                            >
                              <span className="material-symbols-outlined text-sm">print</span>
                              Reçu
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </PortalLayout>
  );
}
