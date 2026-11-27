import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { paymentApi, memberApi, tenantAdminApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import { exportPaymentsToExcel } from '../utils/exportPaymentsExcel';
import { formatDT, formatDateDMY } from '../utils/format';
import Money from '../components/common/Money';

const ITEMS_PER_PAGE = 10;

const STATUT_STYLES = {
  paid: 'bg-[#D1FAE5] text-[#065F46]',
  partial: 'bg-[#FFEDD5] text-[#9A3412]',
  pending: 'bg-[#FEF3C7] text-[#92400E]',
  failed: 'bg-[#FEE2E2] text-[#991B1B]',
  refunded: 'bg-[#EDE9FE] text-[#5B21B6]',
};

const STATUT_LABELS = {
  paid: 'Payé',
  partial: 'Partiel',
  pending: 'En attente',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

const FILTER_TABS = [
  { key: 'all', label: 'Tous' },
  { key: 'paid', label: 'Payés' },
  { key: 'partial', label: 'Partiels' },
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
    totalRevenue: payments.filter((p) => p.statut === 'paid').reduce((sum, p) => sum + parseFloat(p.montant || 0), 0),
    pendingAmount: payments
      .filter((p) => p.statut === 'pending' || p.statut === 'partial')
      .reduce((sum, p) => sum + parseFloat(p.reste_a_payer ?? p.montant ?? 0), 0),
    paidCount: payments.filter((p) => p.statut === 'paid').length,
    pendingCount: payments.filter((p) => p.statut === 'pending' || p.statut === 'partial').length,
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
  const [searchParams] = useSearchParams();
  const [hubTab, setHubTab] = useState('paiements'); // 'paiements' | 'factures_devis' | 'impayes' | 'remboursements'
  const [payments, setPayments] = useState([]);
  const [devisFactures, setDevisFactures] = useState([]);
  const [includeArchivedDocs, setIncludeArchivedDocs] = useState(false);
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
  const [showAddDuModal, setShowAddDuModal] = useState(() => searchParams.get('new') === '1');
  const [duMembers, setDuMembers] = useState([]);
  const [newDuForm, setNewDuForm] = useState({ user_id: '', categorie: 'penalite', motif: '', montant: '' });
  const [creatingDu, setCreatingDu] = useState(false);
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundForm, setRefundForm] = useState({ montant_rembourse: '', motif_remboursement: '' });
  const [refunding, setRefunding] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState({
    type_doc: 'facture',
    numero: '',
    client_nom: '',
    client_matricule_fiscal: '',
    client_adresse: '',
    montant_ht: '',
    tva_pct: 19,
    timbre_fiscal: 1,
    statut: 'emise',
  });
  const [savingDoc, setSavingDoc] = useState(false);
  const [unpaidSummary, setUnpaidSummary] = useState({ items: [], buckets: {}, total_unpaid_amount: 0, rules: {} });
  const [unpaidFilter, setUnpaidFilter] = useState('all');
  const [myPerms, setMyPerms] = useState({ remboursements: true, factures_avoirs: true });
  const [relanceTarget, setRelanceTarget] = useState(null);
  const [relanceSending, setRelanceSending] = useState(false);
  const [promesseTarget, setPromesseTarget] = useState(null);
  const [promesseForm, setPromesseForm] = useState({ promesse_paiement_date: '', promesse_paiement_note: '' });
  const [avoirTarget, setAvoirTarget] = useState(null);
  const [avoirMotif, setAvoirMotif] = useState('');

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
  }, [includeArchivedDocs]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowAddDuModal(true);
    }
  }, [searchParams]);

  const fetchProfileAndPayments = async () => {
    try {
      setErrorMsg('');
      if (!payments.length) setLoading(true);
      const [profRes, data, mdRes, docsRes, unpaidRes, permsRes] = await Promise.all([
        Promise.resolve(supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()).catch(() => null),
        paymentApi.getAll().catch(() => ({ payments: [] })),
        paymentApi.getMontantDu().catch(() => ({ items: [], total_du: 0, count: 0 })),
        tenantAdminApi.getDevisFactures(includeArchivedDocs ? { include_archived: 'true' } : {}).catch(() => ({ items: [] })),
        paymentApi.getUnpaidSummary().catch(() => ({ items: [], buckets: {}, total_unpaid_amount: 0, rules: {} })),
        tenantAdminApi.getMyPermissions().catch(() => null),
      ]);

      if (profRes?.data) setProfile(profRes.data);
      if (data?.payments) setPayments(data.payments);
      if (mdRes?.items) setMontantDuData(mdRes);
      setDevisFactures(docsRes?.items || []);
      if (unpaidRes?.items) setUnpaidSummary(unpaidRes);
      if (permsRes?.permissions) setMyPerms(permsRes.permissions);
    } catch (err) {
      setErrorMsg(err.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenRefund = (p) => {
    setRefundTarget(p);
    setRefundForm({
      montant_rembourse: String(Number(p.montant || 0).toFixed(3)),
      motif_remboursement: '',
    });
  };

  const handleConfirmRefund = async (e) => {
    e.preventDefault();
    if (!refundTarget) return;
    setRefunding(true);
    setErrorMsg('');
    try {
      const res = await paymentApi.refund(refundTarget.id, {
        montant_rembourse: Number(refundForm.montant_rembourse),
        motif_remboursement: refundForm.motif_remboursement,
      });
      setCollectFeedback(res.message || 'Remboursement enregistré.');
      setRefundTarget(null);
      await fetchProfileAndPayments();
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors du remboursement.');
    } finally {
      setRefunding(false);
    }
  };

  const handleCreateDoc = async (e) => {
    e.preventDefault();
    setSavingDoc(true);
    setErrorMsg('');
    try {
      const ht = Number(docForm.montant_ht || 0);
      const tva = Number(docForm.tva_pct ?? 19);
      const timbre = docForm.type_doc === 'facture' ? Number(docForm.timbre_fiscal ?? 1) : 0;
      const ttc = Math.round((ht * (1 + tva / 100) + timbre) * 1000) / 1000;
      const payload = {
        type: docForm.type_doc,
        client_nom: docForm.client_nom.trim(),
        client_matricule_fiscal: docForm.client_matricule_fiscal?.trim() || null,
        client_adresse: docForm.client_adresse?.trim() || null,
        montant_ht: ht,
        tva_pct: tva,
        timbre_fiscal: timbre,
        montant_ttc: ttc,
        statut: docForm.statut,
      };
      if (docForm.numero.trim()) payload.numero = docForm.numero.trim();
      await tenantAdminApi.createDevisFacture(payload);
      setShowDocModal(false);
      setDocForm({
        type_doc: 'facture',
        numero: '',
        client_nom: '',
        client_matricule_fiscal: '',
        client_adresse: '',
        montant_ht: '',
        tva_pct: 19,
        timbre_fiscal: 1,
        statut: 'emise',
      });
      setCollectFeedback('Document comptable enregistré.');
      await fetchProfileAndPayments();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSavingDoc(false);
    }
  };

  const handleSendReminder = async (channel) => {
    if (!relanceTarget) return;
    setRelanceSending(true);
    try {
      const res = await paymentApi.sendReminder(relanceTarget.id, { channel });
      setCollectFeedback(res.message || 'Relance enregistrée.');
      if (channel === 'whatsapp' && relanceTarget.profiles?.telephone) {
        const digits = String(relanceTarget.profiles.telephone).replace(/\D/g, '');
        const text = encodeURIComponent(res.relance?.templates?.whatsapp || relanceTarget.templates?.whatsapp || '');
        if (digits) window.open(`https://wa.me/${digits}?text=${text}`, '_blank', 'noopener,noreferrer');
      }
      setRelanceTarget(null);
      await fetchProfileAndPayments();
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de la relance.');
    } finally {
      setRelanceSending(false);
    }
  };

  const handleConfirmPromise = async (e) => {
    e.preventDefault();
    if (!promesseTarget) return;
    try {
      const res = await paymentApi.recordPromise(promesseTarget.id, promesseForm);
      setCollectFeedback(res.message || 'Promesse de paiement enregistrée.');
      setPromesseTarget(null);
      setPromesseForm({ promesse_paiement_date: '', promesse_paiement_note: '' });
      await fetchProfileAndPayments();
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de l’enregistrement de la promesse.');
    }
  };

  const handleConfirmAvoir = async (e) => {
    e.preventDefault();
    if (!avoirTarget) return;
    try {
      const res = await tenantAdminApi.createAvoir(avoirTarget.id, { motif_avoir: avoirMotif });
      setCollectFeedback(res.message || 'Avoir généré avec succès.');
      setAvoirTarget(null);
      setAvoirMotif('');
      await fetchProfileAndPayments();
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors de la génération de l’avoir.');
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
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="text-left">
          <h1 className="font-sora text-2xl sm:text-3xl font-bold text-primary mb-1">Finance</h1>
          <p className="text-sm text-on-surface-variant">Paiements sur place, factures et devis, impayés et remboursements.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDocModal(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/25 bg-white text-primary font-semibold text-sm hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 18 }}>description</span>
            Nouveau devis / facture
          </button>
          <button
            onClick={handleExportExcel}
            disabled={payments.length === 0}
            style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm hover:opacity-95 transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Exporter Excel
          </button>
        </div>
      </div>

      {/* Onglets Hub Finance */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { id: 'paiements', label: 'Paiements', icon: 'payments' },
          { id: 'factures_devis', label: `Factures et devis (${devisFactures.length})`, icon: 'receipt_long' },
          { id: 'impayes', label: `Impayés et relances (${montantDuData.items.length})`, icon: 'pending_actions' },
          { id: 'remboursements', label: `Remboursements (${payments.filter((p) => p.statut === 'refunded').length})`, icon: 'currency_exchange' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setHubTab(t.id)}
            style={hubTab === t.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition ${
              hubTab === t.id
                ? 'shadow-xs'
                : 'bg-white border border-outline-variant/20 text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
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
                      <div><Money amount={p.montant} /></div>
                      {(p.statut === 'partial' || p.reste_a_payer > 0) && (
                        <div className="text-xs font-medium text-on-surface-variant space-y-0.5 mt-0.5">
                          <div>Payé : <Money amount={p.montant_paye || 0} /></div>
                          <div className="text-amber-800 font-semibold">Reste : <Money amount={p.reste_a_payer ?? p.montant} /></div>
                        </div>
                      )}
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
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleDownload(p.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#f95d00] hover:bg-orange-50 rounded-lg transition-colors"
                          title="Télécharger le reçu PDF"
                        >
                          <span className="material-symbols-outlined text-[16px]">download</span>
                          <span className="hidden sm:inline">Télécharger le reçu</span>
                        </button>
                        {(p.statut === 'pending' || p.statut === 'partial') && (
                          <button
                            type="button"
                            onClick={() => openCollectModal({ ...p, montant_du: p.reste_a_payer ?? p.montant })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-[#f95d00] hover:bg-[#e55500] rounded-lg transition-colors"
                          >
                            Encaisser
                          </button>
                        )}
                        {p.statut === 'paid' && myPerms.remboursements !== false && profile?.role !== 'staff' && (
                          <button
                            type="button"
                            onClick={() => handleOpenRefund(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
                          >
                            Rembourser
                          </button>
                        )}
                      </div>
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

      {/* Section Factures et devis (visible dans son onglet) */}
      {hubTab === 'factures_devis' && (
        <div className="mt-6 bg-surface-container-lowest rounded-2xl border border-outline-variant/25 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-sora font-bold text-base text-primary">Factures et devis</h2>
              <p className="text-xs text-on-surface-variant">Montants HT / TVA / TTC · Archivage sécurisé sans suppression physique.</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold">
                <input type="checkbox" checked={includeArchivedDocs} onChange={(e) => setIncludeArchivedDocs(e.target.checked)} className="accent-[#f95d00]" />
                Afficher les archivés
              </label>
              <button type="button" onClick={() => setShowDocModal(true)} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="px-3.5 py-1.5 rounded-xl text-xs font-bold">
                + Nouveau document
              </button>
            </div>
          </div>
          {devisFactures.length === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-6">Aucun devis ou facture enregistré.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant/20 text-xs uppercase text-on-surface-variant">
                    <th className="py-2.5 px-3">Numéro</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Client</th>
                    <th className="py-2.5 px-3">Montant HT</th>
                    <th className="py-2.5 px-3">Montant TTC</th>
                    <th className="py-2.5 px-3">Statut</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {devisFactures.map((d) => {
                    const docType = String(d.type || d.type_doc || 'facture').toLowerCase();
                    const isLocked = Boolean(d.locked) || (docType === 'facture' && d.statut !== 'brouillon') || docType === 'avoir';
                    return (
                      <tr key={d.id} className={d.archived_at ? 'opacity-60' : ''}>
                        <td className="py-2.5 px-3 font-mono font-bold text-primary">
                          <div>{d.numero}</div>
                          {isLocked && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md mt-0.5">
                              Verrouillée
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 capitalize font-medium">
                          {docType === 'avoir' ? 'Avoir' : docType === 'devis' ? 'Devis' : 'Facture'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold">
                          <div>{d.client_nom || '—'}</div>
                          {d.client_matricule_fiscal && (
                            <div className="text-xs text-on-surface-variant font-normal">MF : {d.client_matricule_fiscal}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3"><Money amount={d.montant_ht} showTaxType="HT" /></td>
                        <td className="py-2.5 px-3 font-bold text-[#f95d00]"><Money amount={d.montant_ttc} showTaxType="TTC" /></td>
                        <td className="py-2.5 px-3 text-xs font-bold uppercase">
                          {d.archived_at ? 'Archivé' : (d.statut === 'avoir_emis' ? 'Avoir émis' : d.statut)}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => tenantAdminApi.downloadDevisFacturePdf(d.id).catch((e) => setErrorMsg(e.message))}
                            className="text-primary font-semibold text-xs hover:underline"
                          >
                            PDF
                          </button>
                          {d.archived_at ? (
                            myPerms.factures_avoirs !== false && profile?.role !== 'staff' && (
                              <button type="button" onClick={async () => { await tenantAdminApi.restoreDevisFacture(d.id); await fetchProfileAndPayments(); }} className="text-emerald-700 font-semibold text-xs hover:underline">
                                Restaurer
                              </button>
                            )
                          ) : (
                            <>
                              {docType === 'devis' && myPerms.factures_avoirs !== false && profile?.role !== 'staff' && (
                                <button type="button" onClick={async () => { await tenantAdminApi.updateDevisFacture(d.id, { type: 'facture', statut: 'emise' }); await fetchProfileAndPayments(); }} className="text-[#f95d00] font-semibold text-xs hover:underline">
                                  Convertir en facture
                                </button>
                              )}
                              {docType === 'facture' && d.statut !== 'brouillon' && d.statut !== 'avoir_emis' && myPerms.factures_avoirs !== false && profile?.role !== 'staff' && (
                                <button type="button" onClick={() => { setAvoirTarget(d); setAvoirMotif(''); }} className="text-red-700 font-semibold text-xs hover:underline">
                                  Générer un avoir
                                </button>
                              )}
                              {!isLocked && myPerms.factures_avoirs !== false && profile?.role !== 'staff' && (
                                <button type="button" onClick={async () => { if (window.confirm('Archiver ce document ?')) { await tenantAdminApi.archiveDevisFacture(d.id); await fetchProfileAndPayments(); } }} className="text-on-surface-variant font-semibold text-xs hover:underline">
                                  Archiver
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Section Remboursements dédiée */}
      {hubTab === 'impayes' && (
        <div className="mt-6 bg-surface-container-lowest rounded-2xl border border-outline-variant/25 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-sora font-bold text-base text-primary">Impayés et relances par ancienneté</h2>
              <p className="text-xs text-on-surface-variant">
                Suivi des créances (J+1, J+7, J+15), promesses de paiement et relances WhatsApp / E-mail.
                {unpaidSummary.rules?.block_booking_on_overdue
                  ? ` · Blocage automatique actif au-delà de ${unpaidSummary.rules.overdue_block_days || 7} jours (déblocable par Responsable).`
                  : ' · Blocage automatique des réservations désactivé.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: `Tous (${(unpaidSummary.items || []).length})` },
                { id: 'j1', label: `J+1 (${unpaidSummary.buckets?.j1_count || 0})` },
                { id: 'j7', label: `J+7 (${unpaidSummary.buckets?.j7_count || 0})` },
                { id: 'j15', label: `J+15 (${unpaidSummary.buckets?.j15_count || 0})` },
              ].map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setUnpaidFilter(b.id)}
                  style={unpaidFilter === b.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                    unpaidFilter === b.id ? '' : 'bg-surface-container-low text-on-surface-variant'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {((unpaidSummary.items || []).filter((i) => unpaidFilter === 'all' || i.aging_bucket === unpaidFilter)).length === 0 ? (
            <p className="text-sm text-on-surface-variant py-6 text-center">Aucun impayé dans cette tranche d&apos;ancienneté.</p>
          ) : (
            <div className="divide-y divide-outline-variant/15">
              {(unpaidSummary.items || [])
                .filter((i) => unpaidFilter === 'all' || i.aging_bucket === unpaidFilter)
                .map((item) => {
                  const clientName = item.profiles ? `${item.profiles.prenom || ''} ${item.profiles.nom || ''}`.trim() : 'Client';
                  return (
                    <div key={item.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-primary">{clientName}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            item.aging_bucket === 'j15'
                              ? 'bg-red-100 text-red-800'
                              : item.aging_bucket === 'j7'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-orange-100 text-[#9a3412]'
                          }`}>
                            {item.aging_label} ({item.days_overdue} j)
                          </span>
                          {item.promesse_paiement_date && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                              Promesse de paiement : {formatDateDMY(item.promesse_paiement_date)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-on-surface-variant">
                          Payé : <Money amount={item.montant_paye || 0} /> · Reste à payer : <strong className="text-[#f95d00]"><Money amount={item.reste_a_payer} /></strong>
                          {item.reminder_count > 0 && ` · ${item.reminder_count} relance(s)`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openCollectModal({ ...item, montant_du: item.reste_a_payer })}
                          style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold"
                        >
                          Encaisser
                        </button>
                        <button
                          type="button"
                          onClick={() => setRelanceTarget(item)}
                          className="px-3 py-1.5 rounded-xl border border-[#f95d00]/40 text-[#f95d00] text-xs font-bold hover:bg-orange-50"
                        >
                          Relancer
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPromesseTarget(item);
                            setPromesseForm({
                              promesse_paiement_date: item.promesse_paiement_date || '',
                              promesse_paiement_note: item.promesse_paiement_note || '',
                            });
                          }}
                          className="px-3 py-1.5 rounded-xl border border-outline-variant/30 text-primary text-xs font-semibold hover:bg-surface-container-low"
                        >
                          Promesse
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {hubTab === 'remboursements' && (
        <div className="mt-6 bg-surface-container-lowest rounded-2xl border border-outline-variant/25 p-5 shadow-sm">
          <h2 className="font-sora font-bold text-base text-primary mb-3">Historique des remboursements</h2>
          {payments.filter((p) => p.statut === 'refunded').length === 0 ? (
            <p className="text-sm text-on-surface-variant py-6 text-center">Aucun remboursement enregistré.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant/20 text-xs uppercase text-on-surface-variant">
                    <th className="py-2.5 px-3">Client</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Montant remboursé</th>
                    <th className="py-2.5 px-3">Avoir généré</th>
                    <th className="py-2.5 px-3">Motif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {payments.filter((p) => p.statut === 'refunded').map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 px-3 font-semibold">{p.profiles ? `${p.profiles.prenom || ''} ${p.profiles.nom || ''}`.trim() : 'Client'}</td>
                      <td className="py-2.5 px-3 text-xs">{formatDateDMY(p.refunded_at || p.updated_at || p.date_paiement || p.created_at)}</td>
                      <td className="py-2.5 px-3 font-bold text-red-700"><Money amount={p.montant_rembourse ?? p.montant} showTaxType="TTC" /></td>
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold text-primary">{p.avoir_numero || 'Avoir associé'}</td>
                      <td className="py-2.5 px-3 text-xs text-on-surface-variant">{p.motif_remboursement || p.reference_externe || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
      {refundTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form onSubmit={handleConfirmRefund} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-sora text-lg font-bold text-slate-900">Rembourser un paiement</h3>
              <button type="button" onClick={() => setRefundTarget(null)} className="text-slate-400 hover:text-slate-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Montant initial encaissé : <strong><Money amount={refundTarget.montant} showTaxType="TTC" /></strong>
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Montant à rembourser (DT TTC) *</label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                max={Number(refundTarget.montant || 0)}
                required
                value={refundForm.montant_rembourse}
                onChange={(e) => setRefundForm((f) => ({ ...f, montant_rembourse: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Motif du remboursement *</label>
              <input
                type="text"
                required
                value={refundForm.motif_remboursement}
                onChange={(e) => setRefundForm((f) => ({ ...f, motif_remboursement: e.target.value }))}
                placeholder="Ex : Annulation dans le délai, erreur de saisie…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setRefundTarget(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700">
                Annuler
              </button>
              <button type="submit" disabled={refunding} className="flex-1 rounded-xl bg-red-600 py-2.5 text-xs font-bold text-white disabled:opacity-50">
                {refunding ? 'Traitement…' : 'Confirmer le remboursement'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form onSubmit={handleCreateDoc} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-sora text-lg font-bold text-slate-900">Nouveau devis ou facture</h3>
              <button type="button" onClick={() => setShowDocModal(false)} className="text-slate-400 hover:text-slate-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                <select value={docForm.type_doc} onChange={(e) => setDocForm((f) => ({ ...f, type_doc: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white">
                  <option value="facture">Facture</option>
                  <option value="devis">Devis</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Statut</label>
                <select value={docForm.statut} onChange={(e) => setDocForm((f) => ({ ...f, statut: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white">
                  <option value="emise">Émise (verrouillée)</option>
                  <option value="brouillon">Brouillon</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Client / Société *</label>
              <input type="text" required value={docForm.client_nom} onChange={(e) => setDocForm((f) => ({ ...f, client_nom: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Matricule fiscal client</label>
                <input type="text" value={docForm.client_matricule_fiscal} onChange={(e) => setDocForm((f) => ({ ...f, client_matricule_fiscal: e.target.value }))} placeholder="1234567/A/M/000" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Numéro (auto continu)</label>
                <input type="text" value={docForm.numero} onChange={(e) => setDocForm((f) => ({ ...f, numero: e.target.value }))} placeholder="Auto continu si vide" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Montant HT (DT) *</label>
                <input type="number" step="0.001" min="0" required value={docForm.montant_ht} onChange={(e) => setDocForm((f) => ({ ...f, montant_ht: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono font-bold" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">TVA (%)</label>
                <input type="number" step="0.5" min="0" value={docForm.tva_pct} onChange={(e) => setDocForm((f) => ({ ...f, tva_pct: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Timbre (DT)</label>
                <input type="number" step="0.001" min="0" value={docForm.timbre_fiscal} onChange={(e) => setDocForm((f) => ({ ...f, timbre_fiscal: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowDocModal(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700">
                Annuler
              </button>
              <button type="submit" disabled={savingDoc} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="flex-1 rounded-xl py-2.5 text-xs font-bold disabled:opacity-50">
                {savingDoc ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {relanceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-sora text-lg font-bold text-slate-900">Relancer un impayé</h3>
              <button type="button" onClick={() => setRelanceTarget(null)} className="text-slate-400 hover:text-slate-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 text-xs space-y-2">
              <p className="font-bold text-slate-800">Modèle WhatsApp prêt à envoyer :</p>
              <p className="text-slate-700 whitespace-pre-line">{relanceTarget.templates?.whatsapp}</p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 text-xs space-y-1">
              <p className="font-bold text-slate-800">Objet E-mail : {relanceTarget.templates?.emailSubject}</p>
              <p className="text-slate-700 whitespace-pre-line">{relanceTarget.templates?.emailBody}</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => handleSendReminder('whatsapp')} disabled={relanceSending} style={{ backgroundColor: '#059669', color: '#ffffff' }} className="flex-1 rounded-xl py-2.5 text-xs font-bold">
                Envoyer par WhatsApp
              </button>
              <button type="button" onClick={() => handleSendReminder('email')} disabled={relanceSending} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="flex-1 rounded-xl py-2.5 text-xs font-bold">
                Envoyer par E-mail
              </button>
            </div>
          </div>
        </div>
      )}

      {promesseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form onSubmit={handleConfirmPromise} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-sora text-lg font-bold text-slate-900">Enregistrer une promesse de paiement</h3>
              <button type="button" onClick={() => setPromesseTarget(null)} className="text-slate-400 hover:text-slate-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date d&apos;engagement *</label>
              <input type="date" required value={promesseForm.promesse_paiement_date} onChange={(e) => setPromesseForm((f) => ({ ...f, promesse_paiement_date: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Note / Précision</label>
              <input type="text" value={promesseForm.promesse_paiement_note} onChange={(e) => setPromesseForm((f) => ({ ...f, promesse_paiement_note: e.target.value }))} placeholder="Ex : Virement promis en fin de semaine" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setPromesseTarget(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700">Annuler</button>
              <button type="submit" style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="flex-1 rounded-xl py-2.5 text-xs font-bold">Valider la promesse</button>
            </div>
          </form>
        </div>
      )}

      {avoirTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form onSubmit={handleConfirmAvoir} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-sora text-lg font-bold text-slate-900">Générer un avoir sur {avoirTarget.numero}</h3>
              <button type="button" onClick={() => setAvoirTarget(null)} className="text-slate-400 hover:text-slate-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Cette facture est verrouillée. L&apos;émission d&apos;un avoir comptable ({avoirTarget.numero}) annulera son solde avec numérotation continue.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Motif de l&apos;avoir *</label>
              <input type="text" required minLength={3} value={avoirMotif} onChange={(e) => setAvoirMotif(e.target.value)} placeholder="Ex : Erreur de facturation / Annulation client" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setAvoirTarget(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700">Annuler</button>
              <button type="submit" style={{ backgroundColor: '#dc2626', color: '#ffffff' }} className="flex-1 rounded-xl py-2.5 text-xs font-bold">Émettre l&apos;avoir</button>
            </div>
          </form>
        </div>
      )}
    </PortalLayout>
  );
}
