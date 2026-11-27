import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { paymentApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import Money from '../components/common/Money';
import { formatDateDMY } from '../utils/format';

const PER_PAGE = 10;

const TABS = [
  { key: 'due', label: 'Montants dus', icon: 'pending_actions' },
  { key: 'receipts', label: 'Reçus', icon: 'receipt_long' },
  { key: 'invoices', label: 'Factures', icon: 'description' },
];

const RECEIPT_STATUS_CONFIG = {
  paid: { label: 'Encaissé', cls: 'bg-emerald-100 text-emerald-800' },
  refunded: { label: 'Remboursé', cls: 'bg-violet-100 text-violet-800' },
};

const MODE_LABELS = {
  cash: 'Espèces (accueil)',
  bank_transfer: 'Virement bancaire',
  check: 'Chèque',
};

export default function MemberPayments({ session }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'member', ...metadata } : null
  );

  const initialTab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'due';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [payments, setPayments] = useState([]);
  const [montantsDus, setMontantsDus] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  // Filtres onglet Reçus (statut + période + recherche)
  const [receiptStatusFilter, setReceiptStatusFilter] = useState('all'); // 'all' | 'paid' | 'refunded'
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const [payRes, duRes, invRes] = await Promise.allSettled([
        paymentApi.getMemberPayments(userId || session.user.id),
        paymentApi.getMyMontantDu(),
        paymentApi.getMyInvoices(),
      ]);
      if (payRes.status === 'fulfilled') setPayments(payRes.value?.payments || []);
      if (duRes.status === 'fulfilled') setMontantsDus(duRes.value?.items || []);
      if (invRes.status === 'fulfilled') setInvoices(invRes.value?.invoices || []);
    } catch (err) {
      setErrorMsg(err.message || 'Erreur lors du chargement des paiements.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user?.id) loadData();
  }, [session?.user?.id]);

  // 3 KPI cibles (RM-23)
  const kpis = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearPaid = payments
      .filter((p) => p.statut === 'paid' && new Date(p.date_paiement || p.created_at) >= yearStart)
      .reduce((sum, p) => sum + (Number(p.montant) || 0), 0);

    const remainingTotal = montantsDus.reduce((sum, d) => sum + Number(d.reste_a_payer ?? d.montant_du ?? d.montant ?? 0), 0);

    const sortedDue = [...montantsDus].sort(
      (a, b) => new Date(a.due_date || a.created_at) - new Date(b.due_date || b.created_at)
    );
    const nextDue = sortedDue[0] || null;
    const overdueDays = montantsDus.reduce((max, d) => Math.max(max, Number(d.days_overdue || 0)), 0);

    return { yearPaid, remainingTotal, nextDue, overdueDays };
  }, [payments, montantsDus]);

  // Reçus filtrés (encaissés / remboursés uniquement)
  const filteredReceipts = useMemo(() => {
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    const q = searchQuery.trim().toLowerCase();

    return payments.filter((p) => {
      if (!['paid', 'refunded'].includes(p.statut)) return false;
      if (receiptStatusFilter !== 'all' && p.statut !== receiptStatusFilter) return false;
      const dt = new Date(p.date_paiement || p.created_at).getTime();
      if (fromMs && Number.isFinite(dt) && dt < fromMs) return false;
      if (toMs && Number.isFinite(dt) && dt > toMs) return false;
      if (q) {
        const ref = String(p.numero_recu || '').toLowerCase();
        const lbl = String(p.libelle || '').toLowerCase();
        const mode = String(MODE_LABELS[p.mode] || p.mode || '').toLowerCase();
        if (!ref.includes(q) && !lbl.includes(q) && !mode.includes(q)) return false;
      }
      return true;
    });
  }, [payments, receiptStatusFilter, fromDate, toDate, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredReceipts.length / PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedReceipts = filteredReceipts.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const handleDownloadReceipt = async (p) => {
    if (!['paid', 'refunded'].includes(p.statut)) return;
    setErrorMsg('');
    setDownloadingId(p.id);
    try {
      await paymentApi.downloadReceipt(p.id, p.numero_recu);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAllZip = async () => {
    setErrorMsg('');
    setDownloadingZip(true);
    try {
      await paymentApi.downloadReceiptsZip({
        from: fromDate,
        to: toDate,
        statut: receiptStatusFilter,
        q: searchQuery.trim(),
      });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDownloadInvoice = async (inv) => {
    setErrorMsg('');
    setDownloadingId(inv.id);
    try {
      await paymentApi.downloadMyInvoicePdf(inv.id, `${inv.type || 'facture'}-${inv.numero || inv.id}.pdf`);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="font-sora text-2xl font-bold text-primary dark:text-white">Mes paiements</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Suivez vos montants dus sur place, téléchargez vos reçus numérotés et vos factures.
            </p>
          </div>
          {activeTab === 'receipts' && (
            <button
              type="button"
              onClick={handleDownloadAllZip}
              disabled={downloadingZip || filteredReceipts.length === 0}
              style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-xs hover:opacity-95 disabled:opacity-40 cursor-pointer"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 19 }}>folder_zip</span>
              {downloadingZip ? 'Préparation du ZIP…' : 'Télécharger tout (ZIP)'}
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 3 KPI cibles (RM-23) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-[#1a1917] p-5 rounded-2xl border border-outline-variant/15 shadow-xs">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Total payé (année)</span>
              <span className="material-symbols-outlined text-[#f95d00]">payments</span>
            </div>
            <p className="font-sora text-2xl font-extrabold text-primary dark:text-white">
              <Money amount={kpis.yearPaid} zeroLabel="0,000 DT" />
            </p>
          </div>

          <div className="bg-white dark:bg-[#1a1917] p-5 rounded-2xl border border-outline-variant/15 shadow-xs">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Reste à payer</span>
              <span className="material-symbols-outlined text-amber-600">pending_actions</span>
            </div>
            <p className={`font-sora text-2xl font-extrabold ${kpis.remainingTotal > 0 ? 'text-[#f95d00]' : 'text-emerald-600'}`}>
              <Money amount={kpis.remainingTotal} zeroLabel="0,000 DT" />
            </p>
          </div>

          <div className="bg-white dark:bg-[#1a1917] p-5 rounded-2xl border border-outline-variant/15 shadow-xs">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Prochaine échéance</span>
              <span className="material-symbols-outlined text-primary dark:text-white">calendar_month</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-sora text-2xl font-extrabold text-primary dark:text-white">
                {kpis.nextDue ? formatDateDMY(kpis.nextDue.due_date || kpis.nextDue.created_at) : 'Aucune'}
              </p>
              {kpis.overdueDays > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                  En retard de {kpis.overdueDays} jour{kpis.overdueDays > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 3 Onglets : Montants dus, Reçus, Factures */}
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const count = t.key === 'due'
              ? montantsDus.length
              : t.key === 'receipts'
                ? payments.filter((p) => ['paid', 'refunded'].includes(p.statut)).length
                : invoices.length;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => { setActiveTab(t.key); setCurrentPage(1); }}
                style={isActive ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold border transition cursor-pointer ${
                  isActive
                    ? 'border-[#f95d00] shadow-xs'
                    : 'bg-white dark:bg-[#1a1917] text-primary dark:text-white border-outline-variant/20 hover:border-[#f95d00]'
                }`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{t.icon}</span>
                <span>{t.label}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isActive ? 'bg-white/20 text-white' : 'bg-surface-container text-primary dark:bg-white/10 dark:text-white'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#f95d00] border-t-transparent" />
          </div>
        ) : activeTab === 'due' ? (
          <div className="bg-white dark:bg-[#1a1917] rounded-2xl border border-outline-variant/15 overflow-hidden shadow-xs">
            {montantsDus.length === 0 ? (
              <div className="p-12 text-center text-sm text-on-surface-variant">
                Aucun montant dû en attente de règlement.
              </div>
            ) : (
              <div className="divide-y divide-outline-variant/10">
                {montantsDus.map((d) => (
                  <div key={d.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-sora font-bold text-sm text-primary dark:text-white">{d.libelle || 'Montant dû'}</p>
                        {d.statut === 'partial' && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Partiel</span>
                        )}
                        {d.days_overdue > 0 && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                            En retard de {d.days_overdue} j
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-on-surface-variant">
                        Échéance : {formatDateDMY(d.due_date || d.created_at)}
                        {d.montant_paye > 0 && (
                          <> · Déjà réglé : <Money amount={d.montant_paye} /></>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <span className="text-xs text-on-surface-variant block">Reste à payer</span>
                        <span className="font-sora font-extrabold text-base text-[#f95d00]">
                          <Money amount={d.reste_a_payer ?? d.montant_du ?? d.montant} />
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                        À régler sur place
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'receipts' ? (
          <div className="space-y-4">
            {/* Barre filtres Reçus */}
            <div className="bg-white dark:bg-[#1a1917] rounded-2xl p-4 border border-outline-variant/15 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2 relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 18 }}>search</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                    placeholder="Rechercher par n° REC-..., espace, mode…"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-outline-variant/25 text-sm bg-white dark:bg-[#141311]"
                  />
                </div>
                <div>
                  <input
                    type="date"
                    aria-label="Date de début"
                    value={fromDate}
                    onChange={(e) => { setFromDate(e.target.value); setCurrentPage(1); }}
                    className="w-full px-3 py-2 rounded-xl border border-outline-variant/25 text-sm bg-white dark:bg-[#141311]"
                  />
                </div>
                <div>
                  <input
                    type="date"
                    aria-label="Date de fin"
                    value={toDate}
                    onChange={(e) => { setToDate(e.target.value); setCurrentPage(1); }}
                    className="w-full px-3 py-2 rounded-xl border border-outline-variant/25 text-sm bg-white dark:bg-[#141311]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { key: 'all', label: 'Tous' },
                  { key: 'paid', label: 'Encaissé' },
                  { key: 'refunded', label: 'Remboursé' },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => { setReceiptStatusFilter(f.key); setCurrentPage(1); }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                      receiptStatusFilter === f.key
                        ? 'bg-[#100f0d] text-white border-[#100f0d]'
                        : 'bg-surface-container-low/50 text-on-surface-variant border-outline-variant/20'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-[#1a1917] rounded-2xl border border-outline-variant/15 overflow-hidden shadow-xs">
              {filteredReceipts.length === 0 ? (
                <div className="p-12 text-center text-sm text-on-surface-variant">
                  Aucun reçu encaissé ne correspond aux filtres sélectionnés.
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#100f0d] text-white text-xs uppercase tracking-wider">
                          <th className="px-5 py-3.5">Date</th>
                          <th className="px-5 py-3.5">Numéro de reçu</th>
                          <th className="px-5 py-3.5">Libellé</th>
                          <th className="px-5 py-3.5">Mode</th>
                          <th className="px-5 py-3.5">Montant</th>
                          <th className="px-5 py-3.5">Statut</th>
                          <th className="px-5 py-3.5 text-right">Reçu PDF</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {paginatedReceipts.map((p) => {
                          const cfg = RECEIPT_STATUS_CONFIG[p.statut] || RECEIPT_STATUS_CONFIG.paid;
                          const canDownload = ['paid', 'refunded'].includes(p.statut);
                          return (
                            <tr key={p.id} className="hover:bg-surface-container-low/40 transition">
                              <td className="px-5 py-3.5 whitespace-nowrap">{formatDateDMY(p.date_paiement || p.created_at)}</td>
                              <td className="px-5 py-3.5 font-sora font-bold text-[#f95d00] whitespace-nowrap">
                                {p.numero_recu || 'En attente de numérotation'}
                              </td>
                              <td className="px-5 py-3.5">{p.libelle || 'Paiement'}</td>
                              <td className="px-5 py-3.5 text-on-surface-variant">{MODE_LABELS[p.mode] || p.mode || 'Accueil'}</td>
                              <td className="px-5 py-3.5 font-bold whitespace-nowrap"><Money amount={p.montant} /></td>
                              <td className="px-5 py-3.5">
                                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${cfg.cls}`}>
                                  {cfg.label}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleDownloadReceipt(p)}
                                  disabled={!canDownload || downloadingId === p.id}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant/25 text-xs font-bold hover:border-[#f95d00] hover:text-[#f95d00] disabled:opacity-40 cursor-pointer"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                                  {downloadingId === p.id ? 'Téléchargement…' : 'Télécharger le reçu'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    currentPage={safePage}
                    totalItems={filteredReceipts.length}
                    itemsPerPage={PER_PAGE}
                    onPageChange={setCurrentPage}
                    label="reçus"
                  />
                </>
              )}
            </div>
          </div>
        ) : (
          /* Onglet Factures */
          <div className="bg-white dark:bg-[#1a1917] rounded-2xl border border-outline-variant/15 overflow-hidden shadow-xs">
            {invoices.length === 0 ? (
              <div className="p-12 text-center text-sm text-on-surface-variant">
                Aucune facture ou avoir émis sur votre compte pour le moment.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#100f0d] text-white text-xs uppercase tracking-wider">
                      <th className="px-5 py-3.5">Numéro</th>
                      <th className="px-5 py-3.5">Type</th>
                      <th className="px-5 py-3.5">Date</th>
                      <th className="px-5 py-3.5">Montant HT</th>
                      <th className="px-5 py-3.5">Montant TTC</th>
                      <th className="px-5 py-3.5">Statut</th>
                      <th className="px-5 py-3.5 text-right">Document</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-surface-container-low/40 transition">
                        <td className="px-5 py-3.5 font-sora font-bold text-[#f95d00]">{inv.numero}</td>
                        <td className="px-5 py-3.5 font-semibold">{inv.type === 'avoir' ? 'Avoir' : 'Facture'}</td>
                        <td className="px-5 py-3.5">{formatDateDMY(inv.date_emission || inv.created_at)}</td>
                        <td className="px-5 py-3.5"><Money amount={inv.montant_ht} showTaxType="HT" /></td>
                        <td className="px-5 py-3.5 font-bold"><Money amount={inv.montant_ttc} showTaxType="TTC" /></td>
                        <td className="px-5 py-3.5">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 capitalize">
                            {inv.statut || 'Émise'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleDownloadInvoice(inv)}
                            disabled={downloadingId === inv.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant/25 text-xs font-bold hover:border-[#f95d00] hover:text-[#f95d00] disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                            {downloadingId === inv.id ? 'PDF…' : 'Télécharger PDF'}
                          </button>
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
