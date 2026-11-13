import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { paymentApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import { exportPaymentsToExcel } from '../utils/exportPaymentsExcel';

const PER_PAGE = 10;

const STATUS_CONFIG = {
  paid: {
    label: 'Payée',
    bg: 'bg-[#2FBE8F]/10',
    text: 'text-[#2FBE8F]',
  },
  pending: {
    label: 'En attente',
    bg: 'bg-[#FFB020]/10',
    text: 'text-[#FFB020]',
  },
  failed: {
    label: 'Échouée',
    bg: 'bg-[#FF6F59]/10',
    text: 'text-[#FF6F59]',
  },
  refunded: {
    label: 'Remboursée',
    bg: 'bg-[#8B5CF6]/10',
    text: 'text-[#8B5CF6]',
  },
};

const FILTER_TABS = [
  { key: 'all', label: 'Toutes' },
  { key: 'paid', label: 'Payées' },
  { key: 'pending', label: 'En attente' },
  { key: 'failed', label: 'Échouées' },
];

const PAYMENT_METHOD_ICONS = {
  card: 'credit_card',
  stripe: 'credit_card',
  bank_transfer: 'account_balance',
  virement: 'account_balance',
  paypal: 'account_balance_wallet',
  cash: 'payments',
};

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' DT';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function generateRef(payment) {
  if (payment.numero_recu) return payment.numero_recu;
  const d = new Date(payment.date_paiement || payment.created_at);
  const year = d.getFullYear();
  const seq = String(payment.id).slice(-4).padStart(4, '0');
  return `REF-${year}-${seq}`;
}

export default function MemberPayments({ session }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [payingId, setPayingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      if (profErr) throw profErr;
      setProfile(prof);

      const res = await paymentApi.getMemberPayments(session.user.id);
      setPayments(res.payments || []);
    } catch (err) {
      setErrorMsg(err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // CDC v3.0 D1 : encaissement 100 % sur place (reçus PDF disponibles après règlement)
  const handleDownload = async (id) => {
    try {
      await paymentApi.downloadReceipt(id);
    } catch (err) {
      alert('Erreur lors du téléchargement du PDF');
    }
  };

  /* ── Derived data ── */
  const filteredPayments = useMemo(() => {
    let result = [...payments];
    if (activeFilter !== 'all') {
      result = result.filter((p) => p.statut === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          generateRef(p).toLowerCase().includes(q) ||
          formatDate(p.date_paiement || p.created_at).toLowerCase().includes(q) ||
          (p.mode_paiement || '').toLowerCase().includes(q) ||
          String(p.montant).includes(q)
      );
    }
    return result;
  }, [payments, activeFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPayments = filteredPayments.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const stats = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearPaid = payments
      .filter((p) => p.statut === 'paid' && new Date(p.date_paiement || p.created_at) >= yearStart)
      .reduce((sum, p) => sum + (Number(p.montant) || 0), 0);
    const pendingTotal = payments
      .filter((p) => p.statut === 'pending')
      .reduce((sum, p) => sum + (Number(p.montant) || 0), 0);
    const nextPending = payments
      .filter((p) => p.statut === 'pending')
      .sort((a, b) => new Date(a.date_paiement || a.created_at) - new Date(b.date_paiement || b.created_at))[0];
    const nextDate = nextPending ? formatDate(nextPending.date_paiement || nextPending.created_at) : 'Aucune';
    return { yearPaid, pendingTotal, nextDate };
  }, [payments]);

  const handleFilterChange = (key) => {
    setActiveFilter(key);
    setCurrentPage(1);
  };

  const handleSearch = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleExport = () => {
    exportPaymentsToExcel(filteredPayments.length > 0 ? filteredPayments : payments);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#F4F6F9' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#f95d00]" />
      </div>
    );
  }

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      {/* ══════════════════════════════════════════
          ERROR BANNER
          ══════════════════════════════════════════ */}
      {errorMsg && (
        <div className="mb-6 p-4 bg-[#FF6F59]/10 text-[#FF6F59] text-sm rounded-xl flex items-center gap-2">
          <span className="material-symbols-outlined text-lg">error</span>
          {errorMsg}
          <button onClick={() => setErrorMsg('')} className="ml-auto">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          PAGE HEADER
          ══════════════════════════════════════════ */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
        <div className="space-y-1">
          <h1 className="font-[Sora] text-2xl md:text-[28px] leading-[36px] font-semibold text-[#000d23] tracking-[-0.01em]">
            Mes Reçus &amp; Montants dus
          </h1>
          <p className="text-[16px] leading-[24px] text-[#44474d]">
            Consultez vos montants dus à régler sur place et téléchargez vos reçus numérotés.
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#f95d00] text-white rounded-xl font-semibold text-sm hover:shadow-lg active:scale-[0.97] transition-all"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>download</span>
          Télécharger tout
        </button>
      </div>

      {/* ══════════════════════════════════════════
          FINANCIAL HIGHLIGHTS BENTO
          ══════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {/* Total dépensé YTD */}
        <div className="bg-white p-6 rounded-2xl shadow-[0px_2px_4px_rgba(16,35,63,0.04)] border border-[#c5c6ce]/10">
          <div className="flex justify-between items-start mb-4">
            <span className="text-[#44474d] text-xs font-medium uppercase tracking-[0.08em]">
              Total dépensé (année)
            </span>
            <span className="material-symbols-outlined text-[#f95d00]">payments</span>
          </div>
          <p className="font-[Sora] text-[28px] leading-[36px] font-semibold text-[#000d23] tracking-[-0.01em]">
            {formatCurrency(stats.yearPaid)}
          </p>
        </div>

        {/* Montant en attente */}
        <div className="bg-white p-6 rounded-2xl shadow-[0px_2px_4px_rgba(16,35,63,0.04)] border border-[#c5c6ce]/10">
          <div className="flex justify-between items-start mb-4">
            <span className="text-[#44474d] text-xs font-medium uppercase tracking-[0.08em]">
              Montant en attente
            </span>
            <span className="material-symbols-outlined text-[#FF6F59]">pending_actions</span>
          </div>
          <p className="font-[Sora] text-[28px] leading-[36px] font-semibold text-[#FFB020] tracking-[-0.01em]">
            {formatCurrency(stats.pendingTotal)}
          </p>
        </div>

        {/* Prochain règlement */}
        <div className="bg-white p-6 rounded-2xl shadow-[0px_2px_4px_rgba(16,35,63,0.04)] border border-[#c5c6ce]/10">
          <div className="flex justify-between items-start mb-4">
            <span className="text-[#44474d] text-xs font-medium uppercase tracking-[0.08em]">
              Prochain règlement
            </span>
            <span className="material-symbols-outlined text-[#10233f]">calendar_month</span>
          </div>
          <p className="font-[Sora] text-[28px] leading-[36px] font-semibold text-[#000d23] tracking-[-0.01em]">
            {stats.nextDate}
          </p>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          SEARCH & FILTER BAR
          ══════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl p-4 md:p-5 border border-[#c5c6ce]/25 shadow-[0px_2px_8px_rgba(16,35,63,0.04)] mb-6 space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          {/* Search input with clear visual indicators */}
          <div className="relative flex-1 max-w-lg">
            <span
              className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[#44474d]"
              style={{ fontSize: 20 }}
            >
              search
            </span>
            <input
              type="text"
              placeholder="Rechercher par référence, montant, mode de paiement, date..."
              value={searchQuery}
              onChange={handleSearch}
              className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-[#c5c6ce]/40 bg-[#f8f9fa] text-sm text-[#1b1b1e] placeholder:text-[#75777e] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#75777e] hover:text-[#1b1b1e] p-0.5 rounded-full hover:bg-[#e4e4e7] transition-colors"
                title="Effacer la recherche"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter pills with badges */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[#c5c6ce]/15">
          <span className="text-xs font-semibold text-[#75777e] uppercase tracking-wider mr-1 hidden sm:inline">
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
                onClick={() => handleFilterChange(tab.key)}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-[#f95d00] text-white shadow-md shadow-[#f95d00]/25 ring-2 ring-[#f95d00]/30'
                    : 'bg-[#f4f6f9] text-[#44474d] hover:bg-[#e9ecf2] hover:text-[#000d23]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-[#c5c6ce]/30 text-[#44474d]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          INVOICE TABLE
          ══════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl shadow-[0px_8px_16px_rgba(16,35,63,0.08)] overflow-hidden border border-[#c5c6ce]/10">
        {filteredPayments.length === 0 ? (
          <div className="p-12 text-center">
            <span className="material-symbols-outlined text-[48px] text-[#c5c6ce] mb-3 block">receipt_long</span>
            <p className="text-[#44474d] text-sm">
              {searchQuery || activeFilter !== 'all'
                ? 'Aucun reçu ou montant dû ne correspond à votre recherche.'
                : 'Aucun paiement trouvé sur votre compte.'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left border-collapse">
                <thead>
                  <tr className="bg-[#000d23]">
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-[0.08em] text-white">Date</th>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-[0.08em] text-white">Référence</th>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-[0.08em] text-white">Montant</th>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-[0.08em] text-white">Mode de paiement</th>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-[0.08em] text-white">Statut</th>
                    <th className="px-6 py-4 text-xs font-medium uppercase tracking-[0.08em] text-white text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#c5c6ce]/10">
                  {paginatedPayments.map((p) => {
                    const statusCfg = STATUS_CONFIG[p.statut] || STATUS_CONFIG.paid;
                    const isPaid = p.statut === 'paid' || p.statut === 'refunded';
                    const isPending = p.statut === 'pending';
                    const isFailed = p.statut === 'failed';
                    const methodKey = (p.mode_paiement || 'cash').toLowerCase().replace(/\s+/g, '_');
                    const methodIcon = PAYMENT_METHOD_ICONS[methodKey] || 'payments';
                    const methodLabel = p.mode_paiement || 'Sur place (accueil)';

                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-[#f5f3f6] transition-colors group"
                      >
                        <td className="px-6 py-4 text-sm text-[#1b1b1e]">
                          {formatDate(p.date_paiement || p.created_at)}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-semibold text-[#f95d00]">
                            {generateRef(p)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-semibold text-[#1b1b1e]">
                            {formatCurrency(p.montant)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[#44474d]" style={{ fontSize: 18 }}>
                              {methodIcon}
                            </span>
                            <span className="text-[13px] text-[#44474d]">{methodLabel}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${statusCfg.bg} ${statusCfg.text}`}
                          >
                            {statusCfg.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {(isPaid || isFailed) && (
                              <button
                                onClick={() => handleDownload(p.id)}
                                className="p-2 text-[#44474d] hover:text-[#f95d00] hover:bg-[#f95d00]/5 rounded-full transition-all"
                                title="Télécharger le reçu"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>download</span>
                              </button>
                            )}
                            {isPending && (
                              <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                                À régler sur place
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* PAGINATION */}
            <Pagination
              currentPage={safePage}
              totalItems={filteredPayments.length}
              itemsPerPage={PER_PAGE}
              onPageChange={setCurrentPage}
              label="paiements"
            />
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════
          SUPPORT CTA
          ══════════════════════════════════════════ */}
      <div className="mt-8 p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 border border-[#f95d00]/10"
        style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="flex gap-4 items-center text-center md:text-left">
          <div className="w-12 h-12 bg-[#f95d00]/10 rounded-full flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[#f95d00]">support_agent</span>
          </div>
          <div>
            <p className="font-[Sora] text-base font-semibold text-[#000d23]">
              Besoin d&apos;aide avec un reçu ou un règlement ?
            </p>
            <p className="text-sm text-[#44474d] mt-0.5">
              Notre équipe support est disponible pour répondre à vos questions 7j/7.
            </p>
          </div>
        </div>
        <a
          href="mailto:contact@deskywork.tn"
          className="px-6 py-2.5 border border-[#f95d00] text-[#f95d00] rounded-xl font-semibold text-sm hover:bg-[#f95d00]/5 active:scale-[0.97] transition-all whitespace-nowrap"
        >
          Contacter le support
        </a>
      </div>
    </PortalLayout>
  );
}
