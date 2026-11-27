import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { memberPortalApi, bookingApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import Money from '../components/common/Money';
import { formatDateDMY, formatTime24h } from '../utils/format';

const ITEMS_PER_PAGE = 10;

const TABS = [
  { key: 'upcoming', label: 'À venir', icon: 'event' },
  { key: 'ongoing', label: 'En cours', icon: 'play_circle' },
  { key: 'past', label: 'Passées', icon: 'history' },
  { key: 'cancelled_refused', label: 'Annulées et refusées', icon: 'block' },
];

const STATUS_CONFIG = {
  confirmed: { label: 'Confirmée', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ring-emerald-600/20', dot: 'bg-emerald-500' },
  pending: { label: 'En attente', color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-amber-600/20', dot: 'bg-amber-500' },
  en_attente_confirmation: { label: 'En attente de confirmation', color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-amber-600/20', dot: 'bg-amber-500' },
  refused: { label: 'Refusée', color: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 ring-rose-600/20', dot: 'bg-rose-500' },
  cancelled: { label: 'Annulée', color: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 ring-red-600/20', dot: 'bg-red-500' },
  completed: { label: 'Terminée', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 ring-slate-500/20', dot: 'bg-slate-400' },
  no_show: { label: 'Absent', color: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 ring-orange-600/20', dot: 'bg-orange-500' },
  waitlisted: { label: "Liste d'attente", color: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 ring-violet-600/20', dot: 'bg-violet-500' },
};

const SPACE_TYPES_FR = {
  open_space: 'Open space',
  private_office: 'Bureau privé',
  meeting_room: 'Salle de réunion',
  training_room: 'Salle de formation',
  event_space: 'Espace événementiel',
  hot_desk: 'Poste nomade',
  dedicated_desk: 'Poste fixe',
  bureau: 'Bureau privé',
  salle_reunion: 'Salle de réunion',
  espace_commun: 'Open space',
};

function formatSpaceType(type) {
  if (!type) return 'Espace';
  return SPACE_TYPES_FR[type] || type.replace('_', ' ');
}

export default function MemberBookings({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const navigate = useNavigate();
  const [profile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'member', ...metadata } : null
  );
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [tab, setTab] = useState('upcoming');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelInfo, setCancelInfo] = useState(null);
  const [cancelInfoLoading, setCancelInfoLoading] = useState(false);

  const loadData = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const res = await memberPortalApi.getBookingsHistory({ page, limit: ITEMS_PER_PAGE, tab });
      setBookings(res.bookings || []);
      setStats(res.stats || null);
      setPagination(res.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      setError(err.message || 'Impossible de charger vos réservations.');
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => { loadData(1); }, [loadData]);

  const openCancelModal = async (b) => {
    setCancelModal(b);
    setCancelInfo(null);
    setCancelInfoLoading(true);
    try {
      const res = await bookingApi.getCancelInfo(b.id);
      setCancelInfo(res);
    } catch (err) {
      setCancelInfo({ info: { allowed: false, reason: err.message || 'Conditions indisponibles.' } });
    }
    setCancelInfoLoading(false);
  };

  const handleCancel = async (id) => {
    setCancelling(id);
    setError('');
    try {
      const res = await bookingApi.cancel(id);
      setCancelModal(null);
      setSuccess(res.message || 'Réservation annulée.');
      await loadData(pagination.page);
    } catch (err) {
      setError(err.message || 'Annulation impossible.');
    }
    setCancelling(null);
  };

  const filtered = bookings.filter((b) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    const name = (b.espaces?.nom || '').toLowerCase();
    const type = formatSpaceType(b.espaces?.type).toLowerCase();
    const cowork = (b.coworking_nom || '').toLowerCase();
    return name.includes(s) || type.includes(s) || cowork.includes(s);
  });

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-sora text-2xl font-bold text-primary dark:text-white">Mes réservations</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Suivez vos réservations à venir, en cours, passées ou annulées.
            </p>
          </div>
          <Link
            to="/book/step1"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#f95d00] text-white rounded-xl text-sm font-semibold hover:opacity-95 transition shadow-sm shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
            <span>Nouvelle réservation</span>
          </Link>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>
        )}
        {success && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">{success}</div>
        )}

        {/* 4 KPI cibles RM-10 (suppression de "Montant total") */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'À venir',
              value: stats ? stats.upcomingCount : '—',
              icon: 'event',
              iconBg: 'bg-[#ffedd8] text-[#f95d00]',
            },
            {
              label: 'Heures ce mois',
              value: stats ? `${stats.hoursThisMonth} h` : '—',
              icon: 'schedule',
              iconBg: 'bg-amber-50 text-amber-700',
            },
            {
              label: 'Total payé',
              value: stats ? <Money amount={stats.totalPaid} zeroLabel="0,000 DT" /> : '—',
              icon: 'payments',
              iconBg: 'bg-emerald-50 text-emerald-700',
            },
            {
              label: 'Reste à payer',
              value: stats ? <Money amount={stats.totalRemaining} zeroLabel="0,000 DT" /> : '—',
              icon: 'pending_actions',
              iconBg: 'bg-rose-50 text-rose-700',
            },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white dark:bg-[#1a1917] rounded-2xl border border-outline-variant/15 p-4 sm:p-5 shadow-xs flex items-center gap-3.5">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${kpi.iconBg}`}>
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{kpi.icon}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-on-surface-variant uppercase tracking-wider font-bold">{kpi.label}</p>
                <p className="font-sora text-lg sm:text-xl font-extrabold text-primary dark:text-white mt-0.5 truncate">{kpi.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Onglets + Recherche */}
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {TABS.map((t) => {
              const cnt = stats?.tabCounts?.[t.key] ?? 0;
              const isActive = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition border cursor-pointer ${
                    isActive
                      ? 'bg-[#f95d00] text-white border-[#f95d00] shadow-xs'
                      : 'bg-white dark:bg-[#1a1917] text-primary dark:text-white border-outline-variant/20 hover:border-[#f95d00]'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
                  <span>{t.label}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isActive ? 'bg-white/20 text-white' : 'bg-surface-container text-primary dark:bg-white/10 dark:text-white'}`}>
                    {cnt}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 20 }}>
              search
            </span>
            <input
              type="text"
              placeholder="Rechercher par espace, type ou établissement..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-outline-variant/20 text-sm text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-[#f95d00]/30 focus:border-[#f95d00] transition bg-white dark:bg-[#1a1917]"
            />
          </div>
        </div>

        {/* Liste des réservations */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#f95d00] border-t-transparent" />
            <p className="text-xs text-on-surface-variant font-medium">Chargement de vos réservations…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-[#1a1917] rounded-2xl border border-outline-variant/15">
            <span className="material-symbols-outlined text-5xl text-outline-variant mb-2">event_busy</span>
            <p className="text-base font-bold text-primary dark:text-white">Aucune réservation dans cet onglet</p>
            <p className="text-xs text-on-surface-variant mt-1">Planifiez un créneau en quelques secondes depuis l&apos;outil de réservation.</p>
            <Link
              to="/book/step1"
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-[#f95d00] text-white rounded-xl text-xs font-bold"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
              Réserver un espace
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((b) => {
              const st = STATUS_CONFIG[b.statut] || STATUS_CONFIG.pending;
              const typeFormatted = formatSpaceType(b.espaces?.type);
              const isBeforeStart =
                !b.has_started &&
                ['pending', 'confirmed', 'en_attente_confirmation', 'waitlisted'].includes(b.statut);
              const showContactInsteadOfCancel =
                !isBeforeStart && b.statut !== 'cancelled' && b.statut !== 'refused';

              return (
                <div
                  key={b.id}
                  className="bg-white dark:bg-[#1a1917] rounded-2xl border border-outline-variant/15 p-5 shadow-xs space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-[#f95d00]/10 text-[#f95d00] flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                          {b.espaces?.type === 'bureau' || b.espaces?.type === 'private_office' ? 'door_front' : b.espaces?.type === 'salle_reunion' || b.espaces?.type === 'meeting_room' ? 'groups' : b.espaces?.type === 'training_room' ? 'school' : 'desk'}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-sora font-bold text-primary dark:text-white text-base">
                            {b.espaces?.nom || 'Espace de travail'}
                          </h3>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset ${st.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                            {st.label}
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-1">
                          <strong className="text-[#f95d00]">{typeFormatted}</strong>
                          {b.coworking_nom ? ` · ${b.coworking_nom}` : ''} · {formatDateDMY(b.date_debut)} · {formatTime24h(b.date_debut)} – {formatTime24h(b.date_fin)}
                        </p>

                        <div className="flex flex-wrap gap-4 mt-1.5 text-xs">
                          <span className="text-on-surface-variant">
                            Payé : <strong className="text-emerald-700 dark:text-emerald-400"><Money amount={b.montant_paye} zeroLabel="0,000 DT" /></strong>
                          </span>
                          <span className="text-on-surface-variant">
                            Reste à payer : <strong className={b.reste_a_payer > 0 ? 'text-[#f95d00]' : 'text-on-surface-variant'}><Money amount={b.reste_a_payer} zeroLabel="0,000 DT" /></strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 border-outline-variant/15 pt-3 sm:pt-0 shrink-0">
                      <div className="text-left sm:text-right">
                        <span className="text-xs text-on-surface-variant font-bold uppercase tracking-wider block">Montant</span>
                        <span className="font-sora font-extrabold text-primary dark:text-white text-base">
                          <Money amount={b.montant_total} zeroLabel="Gratuit" />
                        </span>
                      </div>

                      {isBeforeStart && (
                        <button
                          type="button"
                          onClick={() => openCancelModal(b)}
                          className="px-3.5 py-2 rounded-xl text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-bold transition border border-rose-200 dark:border-rose-900/40 cursor-pointer"
                        >
                          Annuler
                        </button>
                      )}

                      {showContactInsteadOfCancel && (
                        <Link
                          to={`/dashboard/messages?subject=${encodeURIComponent(`Réservation ${b.espaces?.nom || ''} du ${formatDateDMY(b.date_debut)}`)}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border border-outline-variant/30 text-primary dark:text-white hover:border-[#f95d00] hover:text-[#f95d00] transition"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chat</span>
                          Contacter l&apos;établissement
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Motif de refus explicite saisi par l'Admin */}
                  {b.statut === 'refused' && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                      <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18 }}>info</span>
                      <div>
                        <strong>Motif du refus :</strong>{' '}
                        {b.motif_refus || "Aucun motif détaillé n'a été précisé par l'établissement."}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-white dark:bg-[#1a1917] rounded-2xl border border-outline-variant/15 overflow-hidden">
          <Pagination
            currentPage={pagination.page}
            totalItems={pagination.total}
            itemsPerPage={ITEMS_PER_PAGE}
            onPageChange={loadData}
            label="réservations"
          />
        </div>
      </div>

      {/* Modale d'annulation avec affichage clair de la pénalité hors délai */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={() => setCancelModal(null)}>
          <div
            className="bg-white dark:bg-[#1a1917] rounded-3xl p-6 shadow-2xl border border-outline-variant/20 max-w-md w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-rose-600" style={{ fontSize: 22 }}>warning</span>
              </div>
              <div className="min-w-0">
                <h3 className="font-sora font-bold text-primary dark:text-white text-base">Annuler la réservation</h3>
                <p className="text-xs text-on-surface-variant truncate">{cancelModal.espaces?.nom || 'Espace'}</p>
              </div>
            </div>

            {cancelInfoLoading ? (
              <p className="text-xs text-on-surface-variant flex items-center gap-2 py-2">
                <span className="animate-spin inline-block h-3.5 w-3.5 border-2 border-[#f95d00] border-t-transparent rounded-full" />
                Calcul des conditions d&apos;annulation…
              </p>
            ) : cancelInfo?.info && (
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low/50 p-4 space-y-2 text-xs">
                {!cancelInfo.info.allowed ? (
                  <p className="font-bold text-rose-700">{cancelInfo.info.reason || 'Annulation non autorisée.'}</p>
                ) : (
                  <>
                    {cancelInfo.info.penalite_pct > 0 && cancelInfo.info.montantPenalite > 0 ? (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                        <p className="font-bold">Annulation hors délai gratuit ({cancelInfo.info.delai_heures} h)</p>
                        <p>
                          Une pénalité de <strong>{cancelInfo.info.penalite_pct}%</strong> soit{' '}
                          <strong><Money amount={cancelInfo.info.montantPenalite} /></strong>{' '}
                          {cancelInfo.info.montantPaye > 0
                            ? 'sera retenue sur le montant réglé.'
                            : 'sera enregistrée sur votre compte (payable sur place).'}
                        </p>
                      </div>
                    ) : (
                      <p className="font-semibold text-emerald-700">
                        Annulation gratuite dans les délais — aucun frais appliqué.
                      </p>
                    )}
                    {cancelInfo.info.montantPaye > 0 && (
                      <div className="flex justify-between pt-1">
                        <span className="text-on-surface-variant">
                          {cancelInfo.info.mode === 'credit' ? 'Crédit portefeuille' : 'Montant remboursé'}
                        </span>
                        <span className="font-bold text-emerald-700">
                          <Money amount={cancelInfo.info.mode === 'credit' ? cancelInfo.info.montantCredit : cancelInfo.info.montantRembourse} />
                        </span>
                      </div>
                    )}
                  </>
                )}
                {cancelInfo.policy?.message_membre && (
                  <p className="text-xs text-on-surface-variant italic border-t border-outline-variant/15 pt-2">
                    {cancelInfo.policy.message_membre}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setCancelModal(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/30 text-xs font-bold text-primary dark:text-white"
              >
                Conserver
              </button>
              <button
                type="button"
                onClick={() => handleCancel(cancelModal.id)}
                disabled={cancelling === cancelModal.id || (cancelInfo && !cancelInfo.info?.allowed)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {cancelling === cancelModal.id ? 'Annulation…' : "Confirmer l'annulation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
