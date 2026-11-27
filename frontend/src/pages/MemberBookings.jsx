import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { memberPortalApi, bookingApi, paymentApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import Money from '../components/common/Money';
import { formatDateDMY, formatTime24h } from '../utils/format';

const ITEMS_PER_PAGE = 10;

const STATUS_CONFIG = {
  confirmed: { label: 'Confirmée', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ring-emerald-600/20', dot: 'bg-emerald-500' },
  pending: { label: 'En attente', color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-amber-600/20', dot: 'bg-amber-500' },
  en_attente_confirmation: { label: 'En attente de confirmation', color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-amber-600/20', dot: 'bg-amber-500' },
  refused: { label: 'Refusée', color: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 ring-rose-600/20', dot: 'bg-rose-500' },
  cancelled: { label: 'Annulée', color: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 ring-red-600/20', dot: 'bg-red-500' },
  completed: { label: 'Terminée', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 ring-slate-500/20', dot: 'bg-slate-400' },
  no_show: { label: 'Absent', color: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 ring-orange-600/20', dot: 'bg-orange-500' },
  waitlisted: { label: "En liste d'attente", color: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 ring-violet-600/20', dot: 'bg-violet-500' },
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

const FILTERS = [
  { key: '', label: 'Toutes' },
  { key: 'confirmed', label: 'Confirmées' },
  { key: 'pending', label: 'En attente' },
  { key: 'waitlisted', label: "Liste d'attente" },
  { key: 'completed', label: 'Terminées' },
  { key: 'refused', label: 'Refusées' },
  { key: 'no_show', label: 'Absent' },
  { key: 'cancelled', label: 'Annulées' },
];

function formatDate(d) {
  return formatDateDMY(d);
}

function formatTime(d) {
  return formatTime24h(d);
}

function formatCurrency(v) {
  return <Money amount={v} zeroLabel="Gratuit" />;
}

function formatSpaceType(type) {
  if (!type) return 'Espace';
  return SPACE_TYPES_FR[type] || type.replace('_', ' ');
}

export default function MemberBookings({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const navigate = useNavigate();
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'member', ...metadata } : null
  );
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelInfo, setCancelInfo] = useState(null);
  const [cancelInfoLoading, setCancelInfoLoading] = useState(false);
  const [payingId, setPayingId] = useState(null);

  // profile déjà initialisé depuis le JWT — aucun appel DB nécessaire

  const loadData = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: ITEMS_PER_PAGE };
      if (filter) params.statut = filter;
      const res = await memberPortalApi.getBookingsHistory(params);
      setBookings(res.bookings || []);
      setStats(res.stats || null);
      setPagination(res.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      // silencieux
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { loadData(1); }, [loadData]);

  const openCancelModal = async (b) => {
    setCancelModal(b);
    setCancelInfo(null);
    setCancelInfoLoading(true);
    try {
      const res = await bookingApi.getCancelInfo(b.id);
      setCancelInfo(res);
    } catch (err) {
      setCancelInfo(null);
    }
    setCancelInfoLoading(false);
  };

  const handleCancel = async (id) => {
    setCancelling(id);
    try {
      await bookingApi.cancel(id);
      setCancelModal(null);
      loadData(pagination.page);
    } catch (err) {
      // silencieux
    }
    setCancelling(null);
  };

  const filtered = bookings.filter(b => {
    if (!search) return true;
    const s = search.toLowerCase();
    const name = (b.espaces?.nom || '').toLowerCase();
    const type = formatSpaceType(b.espaces?.type).toLowerCase();
    return name.includes(s) || type.includes(s);
  });

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="space-y-6">
        
        {/* En-tête de la page */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-sora text-2xl font-bold text-primary dark:text-white">Mes Réservations</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Historique complet de vos réservations d'espaces</p>
          </div>
          <Link
            to="/book/step1"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white rounded-xl text-sm font-semibold hover:bg-secondary-container transition shadow-md hover:shadow-lg active:scale-95 cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
            <span>Nouvelle Réservation</span>
          </Link>
        </div>

        {/* Statistiques KPI */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total réservations', value: stats.total, icon: 'calendar_month', iconBg: 'bg-[rgba(249,93,0,0.1)] text-secondary dark:bg-[rgba(249,93,0,0.2)] dark:text-[#f95d00]' },
              { label: 'Réservations confirmées', value: stats.confirmed, icon: 'check_circle', iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400' },
              { label: 'Heures totales', value: `${stats.totalHours || 0} h`, icon: 'schedule', iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400' },
              { label: 'Montant total', value: formatCurrency(stats.totalSpent), icon: 'payments', iconBg: 'bg-slate-100 text-primary dark:bg-slate-800 dark:text-white' },
            ].map((s) => (
              <div key={s.label} className="bg-white dark:bg-[#141824] rounded-2xl border border-slate-200/80 dark:border-slate-800/80 p-4 sm:p-5 shadow-xs flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${s.iconBg}`}>
                  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>{s.icon}</span>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">{s.label}</p>
                  <p className="font-sora text-xl font-extrabold text-primary dark:text-white mt-0.5">{s.value}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Barre de Recherche & Filtres en Français */}
        <div className="space-y-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: 20 }}>
              search
            </span>
            <input
              type="text"
              placeholder="Rechercher par nom d'espace ou type..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-sm text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition bg-white dark:bg-[#141824]"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition border cursor-pointer ${
                  filter === f.key
                    ? 'bg-secondary text-white border-secondary shadow-xs'
                    : 'bg-white dark:bg-[#141824] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-secondary hover:text-secondary'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Liste des cartes de réservations */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-secondary border-t-transparent" />
            <p className="text-xs text-slate-400 font-medium">Chargement de vos réservations...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-[#141824] rounded-2xl border border-slate-200/80 dark:border-slate-800/80">
            <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600 mb-2">event_busy</span>
            <p className="text-base font-bold text-primary dark:text-white">Aucune réservation trouvée</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Vous n'avez pas encore réservé d'espace dans cette catégorie.</p>
            <Link 
              to="/book/step1" 
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-secondary text-white rounded-xl text-xs font-bold shadow-xs hover:bg-secondary-container transition"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
              Réserver un espace
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((b) => {
              const st = STATUS_CONFIG[b.statut] || STATUS_CONFIG.pending;
              const canCancel = b.statut === 'confirmed' || b.statut === 'pending';
              const typeFormatted = formatSpaceType(b.espaces?.type);

              return (
                <div 
                  key={b.id} 
                  className="bg-white dark:bg-[#141824] rounded-2xl border border-slate-200/80 dark:border-slate-800/80 p-5 shadow-xs hover:shadow-md transition group"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {/* Icône type espace */}
                      <div className="w-12 h-12 rounded-xl bg-[#f95d00]/10 text-secondary flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                          {b.espaces?.type === 'bureau' || b.espaces?.type === 'private_office' ? 'door_front' : b.espaces?.type === 'salle_reunion' || b.espaces?.type === 'meeting_room' ? 'groups' : b.espaces?.type === 'training_room' ? 'school' : 'desk'}
                        </span>
                      </div>
                      
                      {/* Info Réservation */}
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-sora font-bold text-primary dark:text-white text-base">
                            {b.espaces?.nom || 'Espace de travail'}
                          </h3>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset ${st.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                            {st.label}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            Sur place
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          <strong className="text-secondary">{typeFormatted}</strong> &middot; {formatDate(b.date_debut)} &middot; {formatTime(b.date_debut)} – {formatTime(b.date_fin)}
                        </p>

                        {/* Indication statut / paiement */}
                        {b.statut === 'pending' && (
                          <p className="text-xs text-amber-600 font-medium mt-1">
                            ⏳ Demande en attente d'approbation par l'établissement.
                          </p>
                        )}
                        {b.statut === 'confirmed' && (
                          <p className="text-xs text-emerald-600 font-medium mt-1">
                            Confirmée · Règlement à effectuer sur place (espèces, chèque ou virement).
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Montant + Action Payer / Annuler */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 border-slate-100 dark:border-slate-800 pt-3 sm:pt-0 flex-wrap">
                      <div className="text-left sm:text-right mr-2">
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Montant</span>
                        <span className="font-sora font-extrabold text-primary dark:text-white text-base sm:text-lg">
                          {formatCurrency(b.montant_total)}
                        </span>
                      </div>

                      {canCancel && (
                        <button
                          onClick={() => openCancelModal(b)}
                          className="px-3 py-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-bold transition border border-rose-200 dark:border-rose-900/40 cursor-pointer"
                        >
                          Annuler
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        <div className="bg-white dark:bg-[#141824] rounded-2xl border border-outline-variant/15 overflow-hidden">
          <Pagination
            currentPage={pagination.page}
            totalItems={pagination.total}
            itemsPerPage={ITEMS_PER_PAGE}
            onPageChange={loadData}
            label="réservations"
          />
        </div>
      </div>

      {/* Modal d'annulation */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={() => setCancelModal(null)}>
          <div 
            className="bg-white dark:bg-[#141824] rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-fade-up" 
            style={{ maxWidth: '420px', width: '100%', minWidth: '280px', boxSizing: 'border-box' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-rose-600 dark:text-rose-400" style={{ fontSize: 22 }}>warning</span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-sora font-bold text-primary dark:text-white text-base">Annuler la réservation</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{cancelModal.espaces?.nom || 'Espace'}</p>
              </div>
            </div>
            
            <p className="text-xs text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
              Êtes-vous sûr de vouloir annuler cette réservation ? Cette action est irréversible.
            </p>

            {cancelInfoLoading && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 flex items-center gap-2">
                <span className="animate-spin inline-block h-3 w-3 border-2 border-secondary border-t-transparent rounded-full" />
                Chargement des conditions d'annulation...
              </p>
            )}

            {cancelInfo && !cancelInfoLoading && (
              <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-2">
                {!cancelInfo.info.allowed ? (
                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
                    {cancelInfo.info.reason || 'Annulation non autorisée.'}
                  </p>
                ) : (
                  <>
                    {cancelInfo.info.montantPaye > 0 && (
                      <>
                        <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                          <span>Pénalité appliquée</span>
                          <span className="font-bold">{cancelInfo.info.penalite_pct}%</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                          <span>Montant retenu</span>
                          <span className="font-bold">{formatCurrency(cancelInfo.info.montantRetenu)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                          <span>{cancelInfo.info.mode === 'credit' ? 'Crédit portefeuille' : 'Remboursement'}</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(cancelInfo.info.mode === 'credit' ? cancelInfo.info.montantCredit : cancelInfo.info.montantRembourse)}
                          </span>
                        </div>
                      </>
                    )}
                    {cancelInfo.info.montantPaye <= 0 && (
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Aucun montant réglé pour cette réservation : annulation sans frais.
                      </p>
                    )}
                  </>
                )}
                {cancelInfo.policy?.message_membre && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 italic border-t border-slate-200 dark:border-slate-800 pt-2">
                    {cancelInfo.policy.message_membre}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setCancelModal(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Conserver
              </button>
              <button
                onClick={() => handleCancel(cancelModal.id)}
                disabled={cancelling === cancelModal.id || (cancelInfo && !cancelInfo.info.allowed)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer shadow-md"
              >
                {cancelling === cancelModal.id ? 'Annulation...' : 'Annuler'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
