import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { paymentApi, memberApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import { exportPaymentsToExcel } from '../utils/exportPaymentsExcel';
import { formatDT, formatDateDMY } from '../utils/format';
import Money from '../components/common/Money';

const ITEMS_PER_PAGE = 10;

const STATUT_STYLES = {
  paid: 'bg-[#D1FAE5] text-[#065F46]',
  pending: 'bg-[#FEF3C7] text-[#92400E]',
  failed: 'bg-[#FEE2E2] text-[#991B1B]',
  refunded: 'bg-[#EDE9FE] text-[#5B21B6]',
};

const STATUT_LABELS = {
  paid: 'Payé',
  pending: 'En attente',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

const FILTER_TABS = [
  { key: 'all', label: 'Tous' },
  { key: 'paid', label: 'Payés' },
  { key: 'pending', label: 'En attente' },
  { key: 'failed', label: 'Échoués' },
  { key: 'refunded', label: 'Remboursés' },
];

const MODE_LABELS = {
  cash: 'Espèces',
  bank_transfer: 'Virement bancaire',
  check: 'Chèque',
  online: 'Sur place',
};

function computePaymentStats(payments) {
  const stats = {
    totalRevenue: payments.filter(p => p.statut === 'paid').reduce((sum, p) => sum + parseFloat(p.montant || 0), 0),
    pendingAmount: payments.filter(p => p.statut === 'pending').reduce((sum, p) => sum + parseFloat(p.montant || 0), 0),
    paidCount: payments.filter(p => p.statut === 'paid').length,
    pendingCount: payments.filter(p => p.statut === 'pending').length,
  };
  const totalInvoices = stats.paidCount + stats.pendingCount;
  const recoveryRate = totalInvoices > 0 ? Math.round((stats.paidCount / totalInvoices) * 100) : 0;
  return { stats, totalInvoices, recoveryRate };
}

import { useSessionUser } from '../hooks/useSessionUser';

export default function AdminPayments({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', ...metadata } : null
  );
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [montantDuData, setMontantDuData] = useState({ items: [], total_du: 0, count: 0 });
  const [collectTarget, setCollectTarget] = useState(null);
  const [collectMode, setCollectMode] = useState('cash');
  const [collectAmount, setCollectAmount] = useState('');
  const [collecting, setCollecting] = useState(false);
  const [collectFeedback, setCollectFeedback] = useState('');
  const [lastPaidId, setLastPaidId] = useState(null);
  const [showAddDuModal, setShowAddDuModal] = useState(false);
  const [duMembers, setDuMembers] = useState([]);
  const [newDuForm, setNewDuForm] = useState({ user_id: '', categorie: 'penalite', motif: '', montant: '' });
  const [creatingDu, setCreatingDu] = useState(false);

  const filteredPayments = useMemo(() => {
    let result = [...payments];
    if (activeFilter !== 'all') {
      result = result.filter((p) => p.statut === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) => {
        const memberName = p.profiles ? `${p.profiles.prenom} ${p.profiles.nom}`.toLowerCase() : '';
        const recu = (p.numero_recu || '').toLowerCase();
        const mode = (MODE_LABELS[p.mode] || p.mode || '').toLowerCase();
        const montant = String(p.montant || '');
        const dateStr = p.date_paiement ? formatDateDMY(p.date_paiement) : '';
        return (
          memberName.includes(q) ||
          recu.includes(q) ||
          mode.includes(q) ||
          montant.includes(q) ||
          dateStr.includes(q)
        );
      });
    }
    return result;
  }, [payments, activeFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPayments = filteredPayments.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  useEffect(() => {
    fetchProfileAndPayments();
  }, []);

  const fetchProfileAndPayments = async () => {
    try {
      setErrorMsg('');
      if (!payments.length) setLoading(true);
      const [profRes, data, mdRes] = await Promise.all([
        Promise.resolve(supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()).catch(() => null),
        paymentApi.getAll().catch(() => ({ payments: [] })),
        paymentApi.getMontantDu().catch(() => ({ items: [], total_du: 0, count: 0 })),
      ]);

      if (profRes?.data) setProfile(profRes.data);
      if (data?.payments) setPayments(data.payments);
      if (mdRes?.items) setMontantDuData(mdRes);
    } catch (err) {
      setErrorMsg(err.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };


  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleDownload = async (id) => {
    try {
      await paymentApi.downloadReceipt(id);
    } catch (err) {
      alert("Erreur lors du téléchargement du reçu PDF");
    }
  };

  const openCollectModal = (item) => {
    setCollectTarget(item);
    setCollectMode('cash');
    setCollectAmount(String(Number(item.montant_du || item.montant || 0).toFixed(3)));
  };

  const handleConfirmCollect = async (e) => {
    e.preventDefault();
    if (!collectTarget) return;
    setCollecting(true);
    try {
      const res = await paymentApi.collect(collectTarget.id, {
        mode: collectMode,
        montant_encaisse: parseFloat(collectAmount),
      });
      setCollectFeedback(res.message || 'Encaissement enregistré.');
      setLastPaidId(res.paid_payment?.id || null);
      setCollectTarget(null);
      await fetchProfileAndPayments();
    } catch (err) {
      alert(err.message || "Erreur lors de l'encaissement.");
    } finally {
      setCollecting(false);
    }
  };

  const handleExportExcel = async () => {
    if (!payments || payments.length === 0) return;

    try {
      const { stats, totalInvoices, recoveryRate } = computePaymentStats(payments);
      await exportPaymentsToExcel(payments, {
        totalRevenue: stats.totalRevenue,
        pendingAmount: stats.pendingAmount,
        recoveryRate,
        paidCount: stats.paidCount,
        totalInvoices,
      });
    } catch (err) {
      alert('Erreur lors de l\'export Excel.');
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F4F6F9]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
      </div>
    );
  }

  const { stats, totalInvoices, recoveryRate } = computePaymentStats(payments);

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-sora text-2xl sm:text-3xl font-bold text-primary mb-1">Gestion des Paiements</h1>
          <p className="text-sm text-on-surface-variant">Consultez et téléchargez les reçus des transactions.</p>
        </div>
        <button
          onClick={handleExportExcel}
          disabled={payments.length === 0}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-secondary text-on-secondary rounded-xl font-semibold text-sm hover:bg-secondary/90 transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          Exporter Excel
        </button>
      </div>

      {/* Cartes de statistiques (KPIs) — un seul filet neutre */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-surface-container-lowest p-4 rounded-2xl sm:rounded-3xl border border-outline-variant/25 shadow-sm flex items-center gap-3 sm:gap-4">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#D1FAE5] text-[#065F46] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined filled text-[22px] sm:text-[24px]">account_balance_wallet</span>
          </div>
          <div>
            <p className="text-xs text-on-surface-variant font-semibold uppercase tracking-wider mb-0.5">Recettes Encaissées</p>
            <p className="text-lg sm:text-2xl font-bold text-primary"><Money amount={stats.totalRevenue} /></p>
          </div>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-2xl sm:rounded-3xl border border-outline-variant/25 shadow-sm flex items-center gap-3 sm:gap-4">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#FEF3C7] text-[#92400E] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined filled text-[22px] sm:text-[24px]">pending_actions</span>
          </div>
          <div>
            <p className="text-xs text-on-surface-variant font-semibold uppercase tracking-wider mb-0.5">Montants dus sur place</p>
            <p className="text-lg sm:text-2xl font-bold text-primary"><Money amount={stats.pendingAmount} /></p>
          </div>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-2xl sm:rounded-3xl border border-outline-variant/25 shadow-sm flex items-center gap-3 sm:gap-4 sm:col-span-1 col-span-1">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined filled text-[22px] sm:text-[24px]">monitoring</span>
          </div>
          <div>
            <p className="text-xs text-on-surface-variant font-semibold uppercase tracking-wider mb-0.5">Taux de Recouvrement</p>
            <div className="flex items-end gap-2">
              <p className="text-lg sm:text-2xl font-bold text-primary">{recoveryRate}%</p>
              <p className="text-xs text-on-surface-variant mb-0.5">({stats.paidCount}/{totalInvoices})</p>
            </div>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="mb-md p-sm bg-error-container text-on-error-container text-body-sm rounded-xl">
          {errorMsg}
        </div>
      )}

      {collectFeedback && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 flex flex-wrap items-center justify-between gap-2">
          <span>{collectFeedback}</span>
          <div className="flex items-center gap-3">
            {lastPaidId && (
              <button
                type="button"
                onClick={() => handleDownload(lastPaidId)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e55500]"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>receipt_long</span>
                Télécharger le reçu
              </button>
            )}
            <button type="button" onClick={() => { setCollectFeedback(''); setLastPaidId(null); }} className="text-xs underline">
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Entité unifiée « Montant dû » à encaisser sur place */}
      <div className="mb-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-sora text-base font-bold text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>payments</span>
              Montants dus à encaisser sur place
            </h2>
            <p className="text-xs text-on-surface-variant">
              Réservations, dépassements, prolongations, pénalités, inscriptions aux formations et abonnements
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                setShowAddDuModal(true);
                if (duMembers.length === 0) {
                  try {
                    const r = await memberApi.getAll();
                    setDuMembers(r.members || []);
                  } catch (_) {}
                }
              }}
              className="px-3 py-1.5 rounded-xl border border-outline-variant/25 bg-surface-container-low text-primary text-xs font-bold hover:bg-surface-container flex items-center gap-1"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
              Pénalité / Frais
            </button>
            <span className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5 text-sm font-extrabold text-amber-900">
              Total dû : <Money amount={montantDuData.total_du} />
            </span>
          </div>
        </div>

        {montantDuData.items.length === 0 ? (
          <p className="text-xs text-on-surface-variant py-2">Aucun montant dû en attente d'encaissement.</p>
        ) : (
          <div className="divide-y divide-outline-variant/15">
            {montantDuData.items.map((item) => {
              const cliName = item.profiles ? `${item.profiles.prenom || ''} ${item.profiles.nom || ''}`.trim() || item.profiles.email : 'Client';
              return (
                <div key={item.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-primary">{cliName}</span>
                      <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
                        item.categorie === 'penalite'
                          ? 'bg-red-100 text-red-700'
                          : item.categorie === 'depassement'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                      }`}>
                        {item.categorie}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant">{item.libelle}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-auto">
                    <span className="font-sora text-sm font-extrabold text-[#f95d00]"><Money amount={item.montant_du} /></span>
                    <button
                      type="button"
                      onClick={() => openCollectModal(item)}
                      className="px-3.5 py-1.5 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e55500] shadow-xs transition"
                    >
                      Encaisser sur place
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Barre de recherche et filtres de statut */}
      <div className="bg-surface-container-lowest rounded-2xl p-4 md:p-5 border border-outline-variant/30 shadow-sm mb-6 space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          {/* Champ de recherche clair */}
          <div className="relative flex-1 max-w-lg">
            <span
              className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
              style={{ fontSize: 20 }}
            >
              search
            </span>
            <input
              type="text"
              placeholder="Rechercher par membre, référence, mode, montant..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-low text-body-sm text-primary placeholder:text-on-surface-variant/70 focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary p-0.5 rounded-full hover:bg-surface-container transition-colors"
                title="Effacer la recherche"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            )}
          </div>
        </div>

        {/* Boutons de filtres avec compteurs */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-outline-variant/15">
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mr-1 hidden sm:inline">
            Statut :
          </span>
          {FILTER_TABS.map((tab) => {
            const count = tab.key === 'all'
              ? payments.length
              : payments.filter((p) => p.statut === tab.key).length;
            const isActive = activeFilter === tab.key;

            return (
              <button
                key={tab.key}
                onClick={() => { setActiveFilter(tab.key); setCurrentPage(1); }}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-[#f95d00] text-white shadow-md shadow-[#f95d00]/25 ring-2 ring-[#f95d00]/30'
                    : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-primary'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-outline-variant/30 text-on-surface-variant'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tableau des paiements */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-sm overflow-hidden">
        <div className="table-responsive-wrapper">
          <table className="w-full min-w-[650px] text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 text-xs font-bold uppercase text-on-surface-variant tracking-wider">
                <th className="px-4 py-3 font-semibold">Membre</th>
                <th className="px-4 py-3 font-semibold">Référence / Date</th>
                <th className="px-4 py-3 font-semibold">Montant</th>
                <th className="px-4 py-3 font-semibold">Mode</th>
                <th className="px-4 py-3 font-semibold">Statut</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {paginatedPayments.map((p) => {
                const memberName = p.profiles ? `${p.profiles.prenom} ${p.profiles.nom}` : (p.user_id ? p.user_id.slice(0, 8) : '—');
                const dateP = p.date_paiement || p.created_at;

                return (
                  <tr key={p.id} className="border-b border-outline-variant/10 hover:bg-surface-container-low/50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-primary">
                      {memberName}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      <div className="font-mono text-xs mb-0.5 text-primary">{p.numero_recu || '—'}</div>
                      <div className="text-xs">{formatDateDMY(dateP)}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-secondary">
                      <Money amount={p.montant} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-surface-container-high px-2 py-1 rounded-md text-xs font-medium">
                        {MODE_LABELS[p.mode] || p.mode}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${STATUT_STYLES[p.statut] || 'bg-gray-200 text-gray-800'}`}>
                        {STATUT_LABELS[p.statut] || p.statut}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDownload(p.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#f95d00] hover:bg-orange-50 rounded-lg transition-colors"
                        title="Télécharger le reçu PDF"
                      >
                        <span className="material-symbols-outlined text-[16px]">download</span>
                        <span className="hidden sm:inline">Télécharger le reçu</span>
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredPayments.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-md py-xl text-center text-on-surface-variant">
                    {searchQuery || activeFilter !== 'all'
                      ? 'Aucun paiement ne correspond aux critères de recherche.'
                      : 'Aucun paiement trouvé.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination 10 par page */}
        <Pagination
          currentPage={currentPage}
          totalItems={filteredPayments.length}
          itemsPerPage={ITEMS_PER_PAGE}
          onPageChange={setCurrentPage}
          label="paiements"
        />
      </div>

      {/* Modale d'encaissement sur place (complet ou partiel) + Reçu PDF */}
      {collectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form onSubmit={handleConfirmCollect} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-sora text-lg font-bold text-slate-900">Encaissement sur place</h3>
              <button type="button" onClick={() => setCollectTarget(null)} className="text-slate-400 hover:text-slate-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3.5 text-xs space-y-1">
              <p className="font-bold text-slate-900">{collectTarget.libelle}</p>
              <p className="text-slate-600">
                Client : {collectTarget.profiles ? `${collectTarget.profiles.prenom || ''} ${collectTarget.profiles.nom || ''}`.trim() : 'Client'}
              </p>
              <p className="text-slate-700 font-semibold">Solde dû : <Money amount={collectTarget.montant_du} /></p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Mode de règlement sur place *</label>
              <select
                value={collectMode}
                onChange={(e) => setCollectMode(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              >
                <option value="cash">Espèces</option>
                <option value="bank_transfer">Virement bancaire</option>
                <option value="check">Chèque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Montant encaissé (DT — modifier pour encaissement partiel) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                max={collectTarget.montant_du}
                required
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono font-bold"
              />
            </div>
            <p className="text-xs text-slate-500">
              Un reçu de paiement numéroté sera généré et transmis par e-mail au client. Vous pourrez également le télécharger manuellement.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCollectTarget(null)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={collecting}
                className="flex-1 rounded-xl bg-[#f95d00] py-2.5 text-xs font-bold text-white hover:bg-[#e55500] disabled:opacity-50"
              >
                {collecting ? 'Encaissement…' : "Valider l'encaissement"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddDuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setCreatingDu(true);
              setErrorMsg('');
              try {
                const res = await paymentApi.createMontantDu(newDuForm);
                setCollectFeedback(res.message || 'Montant dû ajouté.');
                setShowAddDuModal(false);
                setNewDuForm({ user_id: '', categorie: 'penalite', motif: '', montant: '' });
                const mRes = await paymentApi.getMontantDu();
                setMontantDuData(mRes || { items: [], total_du: 0, count: 0 });
              } catch (err) {
                setErrorMsg(err.message);
              } finally {
                setCreatingDu(false);
              }
            }}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-sora text-lg font-bold text-slate-900">Nouveau montant dû (Pénalité / Frais)</h3>
              <button type="button" onClick={() => setShowAddDuModal(false)} className="text-slate-400 hover:text-slate-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Membre *</label>
              <select
                required
                value={newDuForm.user_id}
                onChange={(e) => setNewDuForm((p) => ({ ...p, user_id: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              >
                <option value="">— Choisir un membre —</option>
                {duMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.prenom} {m.nom} ({m.email})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Catégorie</label>
                <select
                  value={newDuForm.categorie}
                  onChange={(e) => setNewDuForm((p) => ({ ...p, categorie: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                >
                  <option value="penalite">Pénalité</option>
                  <option value="depassement">Dépassement</option>
                  <option value="prolongation">Prolongation</option>
                  <option value="autre">Autre frais</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Montant (DT) *</label>
                <input
                  type="number"
                  step="0.001"
                  min="0.1"
                  required
                  value={newDuForm.montant}
                  onChange={(e) => setNewDuForm((p) => ({ ...p, montant: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono font-bold"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Motif *</label>
              <input
                type="text"
                required
                placeholder="Ex: Retard annulation, casse matériel, heure supp..."
                value={newDuForm.motif}
                onChange={(e) => setNewDuForm((p) => ({ ...p, motif: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowAddDuModal(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700">
                Annuler
              </button>
              <button type="submit" disabled={creatingDu} className="flex-1 rounded-xl bg-[#f95d00] py-2.5 text-xs font-bold text-white disabled:opacity-50">
                {creatingDu ? 'Ajout…' : 'Ajouter aux montants dus'}
              </button>
            </div>
          </form>
        </div>
      )}
    </PortalLayout>
  );
}
