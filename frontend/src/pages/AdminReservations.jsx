import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { bookingApi, paymentApi, sessionApi, tenantAdminApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import AdminAgenda from './AdminAgenda';
import NewReservationModal from '../components/reservations/NewReservationModal';
import WalkInSessionModal from '../components/sessions/WalkInSessionModal';
import Money from '../components/common/Money';
import { formatDateDMY, formatTime24h, tunisLocalToISO } from '../utils/format';

const STATUT_CONFIG = {
  pending: {
    label: 'En attente',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700/50',
    icon: 'hourglass_empty',
  },
  en_attente_confirmation: {
    label: 'En attente de confirmation',
    badgeClass: 'bg-orange-100 text-[#c2410c] border-orange-300',
    icon: 'phone_callback',
  },
  confirmed: {
    label: 'Confirmée',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700/50',
    icon: 'check_circle',
  },
  refused: {
    label: 'Refusée',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-700/50',
    icon: 'block',
  },
  cancelled: {
    label: 'Annulée',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    icon: 'cancel',
  },
  completed: {
    label: 'Terminée',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-700/50',
    icon: 'task_alt',
  },
  no_show: {
    label: 'No-show (Absent)',
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-700/50',
    icon: 'person_off',
  },
  waitlisted: {
    label: "En liste d'attente",
    badgeClass: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-700/50',
    icon: 'queue',
  },
};

const ITEMS_PER_PAGE = 10;

export default function AdminReservations({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null
  );
  const [bookings, setBookings] = useState([]);
  const [espaces, setEspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Filtres
  const [searchParams, setSearchParams] = useSearchParams();
  const initialHubTab = ['list', 'calendar', 'plan'].includes(searchParams.get('view')) ? searchParams.get('view') : 'list';
  const [hubTab, setHubTab] = useState(initialHubTab);
  const [scannerTrigger, setScannerTrigger] = useState(0);
  const [filterStatut, setFilterStatut] = useState('all');
  const [filterEspace, setFilterEspace] = useState('all');
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showNewModal, setShowNewModal] = useState(() => searchParams.get('new') === '1');
  const [showWalkinModal, setShowWalkinModal] = useState(() => searchParams.get('walkin') === '1');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [unites, setUnites] = useState([]);
  const [cancelModalBooking, setCancelModalBooking] = useState(null);
  const [cancelMotif, setCancelMotif] = useState('');
  const [refuseModalBooking, setRefuseModalBooking] = useState(null);
  const [refuseMotif, setRefuseMotif] = useState('');
  const [moveModalBooking, setMoveModalBooking] = useState(null);
  const [moveForm, setMoveForm] = useState({ date: '', heure_debut: '09:00', heure_fin: '12:00', unite_id: '' });
  const [moveAlternatives, setMoveAlternatives] = useState(null);

  const initialPersonneId = searchParams.get('personne_id') || '';
  const isManager = ['admin', 'super_admin'].includes(String(profile?.role || '').toLowerCase());

  const navigate = useNavigate();

  useEffect(() => {
    const q = searchParams.get('search');
    if (q !== null) setSearchQuery(q);
    if (searchParams.get('new') === '1') {
      setShowNewModal(true);
    }
    if (searchParams.get('walkin') === '1') {
      setShowWalkinModal(true);
    }
    const v = searchParams.get('view');
    if (v && ['list', 'calendar', 'plan'].includes(v)) {
      setHubTab(v);
    }
  }, [searchParams]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => {
    loadData();
  }, [includeArchived]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const [bookingsData, espacesData, unitesData] = await Promise.all([
        bookingApi.getAll(includeArchived ? { include_archived: 'true' } : {}),
        bookingApi.getEspaces().catch(() => ({ espaces: [] })),
        tenantAdminApi.getUnites().catch(() => ({ unites: [] })),
      ]);

      setBookings(bookingsData.reservations || []);
      setEspaces(espacesData.espaces || []);
      setUnites(unitesData.unites || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const handleConfirmBooking = async (booking) => {
    const id = typeof booking === 'object' ? booking.id : booking;
    setActionId(id);
    try {
      await bookingApi.update(id, { statut: 'confirmed' });
      // Si la réservation est liée à une formation, publier la formation
      const { data: linkedForm } = await supabase.from('formations').select('id, titre').eq('reservation_id', id).maybeSingle();
      if (linkedForm) {
        await supabase.from('formations').update({ statut: 'publiee' }).eq('id', linkedForm.id);
      }
      showToast("Réservation approuvée et confirmée ! Règlement sur place lors de l'arrivée.");
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionId(null);
    }
  };

  const handleUpdateStatus = async (id, statut, confirmMsg, successMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setActionId(id);
    try {
      await bookingApi.update(id, { statut });
      if (statut === 'refused' || statut === 'cancelled') {
        const { data: linkedForm } = await supabase.from('formations').select('id').eq('reservation_id', id).maybeSingle();
        if (linkedForm) {
          await supabase.from('formations').update({ statut: 'annulee' }).eq('id', linkedForm.id);
        }
      }
      showToast(successMsg);
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionId(null);
    }
  };

  const handleCancelBooking = async (id) => {
    if (!window.confirm('Voulez-vous vraiment annuler cette réservation ?')) return;
    setActionId(id);
    try {
      await bookingApi.cancel(id);
      showToast('Réservation annulée avec succès.');
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionId(null);
    }
  };

  // Filtrage des réservations
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (filterStatut !== 'all' && b.statut !== filterStatut) return false;
      if (filterEspace !== 'all' && b.espace_id !== filterEspace) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const memberName = `${b.profiles?.prenom || ''} ${b.profiles?.nom || ''}`.toLowerCase();
        const memberEmail = (b.profiles?.email || '').toLowerCase();
        const espaceName = (b.espaces?.nom || '').toLowerCase();
        const roleLabel = (b.profiles?.role === 'formateur' ? 'formateur' : 'membre').toLowerCase();
        if (!memberName.includes(q) && !memberEmail.includes(q) && !espaceName.includes(q) && !roleLabel.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [bookings, filterStatut, filterEspace, searchQuery]);

  // Réinitialiser la page quand les filtres changent
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatut, filterEspace, searchQuery]);

  // Découpage paginé (10 par page)
  const paginatedBookings = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredBookings.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredBookings, currentPage]);

  // Statistiques rapides
  const stats = useMemo(() => {
    const total = bookings.length;
    const pending = bookings.filter((b) => b.statut === 'pending').length;
    const confirmed = bookings.filter((b) => b.statut === 'confirmed').length;
    const todayStr = new Date().toISOString().split('T')[0];
    const today = bookings.filter((b) => (b.date_debut || '').startsWith(todayStr)).length;
    return { total, pending, confirmed, today };
  }, [bookings]);

  const getReservationOwner = (booking) => {
    const profile = booking.profiles || {};
    const prenom = profile.prenom || '';
    const nom = profile.nom || '';
    const email = profile.email || '—';
    const role = profile.role === 'formateur' ? 'Formateur' : 'Membre';
    const fullName = [prenom, nom].filter(Boolean).join(' ') || 'Sans nom';
    return { fullName, email, role };
  };

  if (loading) {
    return (
      <PortalLayout profile={profile} onLogout={handleLogout}>
        {/* Header skeleton */}
        <div className="mb-6">
          <div className="h-3 w-24 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        </div>
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
              <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
              <div className="h-7 w-12 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        {/* Table skeleton */}
        <div className="bg-white rounded-2xl shadow-sm p-5 animate-pulse">
          <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-4 py-3 border-b border-gray-100 last:border-0">
              <div className="h-4 w-1/4 bg-gray-100 rounded" />
              <div className="h-4 w-1/4 bg-gray-100 rounded" />
              <div className="h-4 w-1/6 bg-gray-100 rounded" />
              <div className="h-4 w-1/6 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-20 right-6 z-[9999] flex items-center gap-2.5 px-5 py-3.5 bg-emerald-600 text-white rounded-2xl shadow-xl text-sm font-semibold animate-fade-down">
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>check_circle</span>
          <span>{toast}</span>
        </div>
      )}

      {/* En-tête */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div className="min-w-0 text-left">
          <h1 className="font-sora font-bold text-primary" style={{ fontSize: 'clamp(20px, 4vw, 28px)' }}>Réservations</h1>
          <p className="text-on-surface-variant text-sm mt-1">
            Liste, calendrier, plan interactif 2D en direct et contrôle d'accès par code QR.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto shrink-0">
          <button
            type="button"
            onClick={() => {
              setHubTab('calendar');
              setSearchParams({ view: 'calendar' });
              setScannerTrigger((c) => c + 1);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-outline-variant/30 text-primary rounded-xl font-bold text-xs sm:text-sm hover:bg-surface-container transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 18 }}>qr_code_scanner</span>
            <span>Scanner</span>
          </button>
          <button
            type="button"
            onClick={() => setShowWalkinModal(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-orange-300 text-[#f95d00] rounded-xl font-bold text-xs sm:text-sm hover:bg-orange-50 transition-all shadow-sm"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>directions_walk</span>
            <span>Client sur place</span>
          </button>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm hover:opacity-95 transition-all shadow-sm"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            <span>Nouvelle réservation</span>
          </button>
          <button
            onClick={loadData}
            title="Rafraîchir"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-outline-variant/30 text-on-surface-variant hover:text-[#f95d00] transition-all shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>sync</span>
          </button>
        </div>
      </div>

      {/* Onglets Hub Réservations : Liste | Calendrier | Plan en direct */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { id: 'list', label: 'Liste', icon: 'view_list' },
          { id: 'calendar', label: 'Calendrier', icon: 'calendar_month' },
          { id: 'plan', label: 'Plan en direct', icon: 'map' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setHubTab(t.id);
              setSearchParams(t.id === 'list' ? {} : { view: t.id });
            }}
            style={hubTab === t.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition ${hubTab === t.id
              ? 'shadow-xs'
              : 'bg-white border border-outline-variant/20 text-on-surface-variant hover:text-primary'
              }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {hubTab !== 'list' ? (
        <AdminAgenda
          session={session}
          embedded
          initialView={hubTab === 'plan' ? 'plan' : 'week'}
          openScannerTrigger={scannerTrigger}
        />
      ) : (
        <>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl flex items-center gap-2.5">
              <span className="material-symbols-outlined text-red-500">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* Cartes de statistiques */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-outline-variant/15 shadow-sm">
              <div className="flex items-center justify-between text-on-surface-variant mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Total</span>
                <span className="material-symbols-outlined text-primary/60" style={{ fontSize: 20 }}>receipt_long</span>
              </div>
              <p className="font-sora font-bold text-2xl text-primary">{stats.total}</p>
              <p className="text-xs text-on-surface-variant mt-1">Toutes réservations</p>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-outline-variant/15 shadow-sm">
              <div className="flex items-center justify-between text-amber-600 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">En attente</span>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>hourglass_top</span>
              </div>
              <p className="font-sora font-bold text-2xl text-amber-600">{stats.pending}</p>
              <p className="text-xs text-on-surface-variant mt-1">À confirmer</p>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-outline-variant/15 shadow-sm">
              <div className="flex items-center justify-between text-emerald-600 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Confirmées</span>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>check_circle</span>
              </div>
              <p className="font-sora font-bold text-2xl text-emerald-600">{stats.confirmed}</p>
              <p className="text-xs text-on-surface-variant mt-1">Validées sur l'agenda</p>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-outline-variant/15 shadow-sm">
              <div className="flex items-center justify-between text-secondary mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Aujourd'hui</span>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>today</span>
              </div>
              <p className="font-sora font-bold text-2xl text-secondary">{stats.today}</p>
              <p className="text-xs text-on-surface-variant mt-1">Séances prévues ce jour</p>
            </div>
          </div>

          {/* Barre de filtres et recherche */}
          <div className="bg-white rounded-2xl border border-outline-variant/15 shadow-sm p-4 sm:p-5 mb-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            {/* Recherche */}
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60" style={{ fontSize: 20 }}>
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher par membre, email, espace…"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-outline-variant/30 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15 transition-all"
              />
            </div>

            {/* Filtres statut & espace */}
            <div className="flex flex-col xs:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-on-surface-variant whitespace-nowrap hidden sm:inline">Statut :</span>
                <select
                  value={filterStatut}
                  onChange={(e) => setFilterStatut(e.target.value)}
                  className="flex-1 sm:flex-none px-3 py-2 rounded-xl border border-outline-variant/30 text-sm font-medium bg-white outline-none focus:border-secondary transition-all min-w-0"
                >
                  <option value="all">Tous les statuts</option>
                  <option value="pending">En attente</option>
                  <option value="en_attente_confirmation">En attente de confirmation</option>
                  <option value="confirmed">Confirmée</option>
                  <option value="refused">Refusée</option>
                  <option value="completed">Terminée</option>
                  <option value="no_show">No-show (Absent)</option>
                  <option value="waitlisted">En liste d'attente</option>
                  <option value="cancelled">Annulée</option>
                </select>
              </div>

              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant cursor-pointer px-2">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                  className="accent-[#f95d00]"
                />
                Afficher les archivés
              </label>

              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-on-surface-variant whitespace-nowrap hidden sm:inline">Espace :</span>
                <select
                  value={filterEspace}
                  onChange={(e) => setFilterEspace(e.target.value)}
                  className="flex-1 sm:flex-none px-3 py-2 rounded-xl border border-outline-variant/30 text-sm font-medium bg-white outline-none focus:border-secondary transition-all min-w-0"
                >
                  <option value="all">Tous les espaces</option>
                  {espaces.map((es) => (
                    <option key={es.id} value={es.id}>{es.nom}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Tableau des réservations */}
          <div className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm overflow-hidden">
            <div className="table-responsive-wrapper">
              <table className="w-full min-w-[700px] text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant/10 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    <th className="py-3 px-3.5">Membre / Invité</th>
                    <th className="py-3 px-3">Espace réservé</th>
                    <th className="py-3 px-3">Date & Créneau</th>
                    <th className="py-3 px-2.5 text-center">Paiement</th>
                    <th className="py-3 px-2.5 text-center">Statut</th>
                    <th className="py-3 px-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10 text-xs sm:text-sm">
                  {filteredBookings.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 px-4 text-center text-on-surface-variant">
                        <div className="flex flex-col items-center justify-center">
                          <span className="material-symbols-outlined text-on-surface-variant/30 mb-2" style={{ fontSize: 44 }}>
                            event_busy
                          </span>
                          <p className="font-semibold text-sm text-primary">Aucune réservation trouvée</p>
                          <p className="text-xs text-on-surface-variant mt-1">
                            Modifiez vos filtres ou attendez de nouvelles demandes de réservation.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedBookings.map((b) => {
                      const cfg = STATUT_CONFIG[b.statut] || {
                        label: b.statut,
                        badgeClass: 'bg-gray-100 text-gray-800 border-gray-300',
                        icon: 'info',
                      };

                      const isGuestBooking = Boolean(b.guests && !b.profiles);
                      const member = b.profiles || b.guests || {};
                      const memberName = [member.prenom || b.guests?.prenom, member.nom || b.guests?.nom].filter(Boolean).join(' ') || 'Invité';
                      const memberEmail = member.email || b.guests?.email || 'Sans email';
                      const memberPhone = member.telephone || b.guests?.telephone || '';
                      const memberRole = isGuestBooking ? 'Invité' : (member.role === 'formateur' ? 'Formateur' : 'Membre');
                      const isActing = actionId === b.id;
                      const paidPayment = (b.paiements || []).find((p) => p.statut === 'paid');
                      const pendingPayment = (b.paiements || []).find((p) => p.statut === 'pending');
                      const hasPaidOrPartial = (b.paiements || []).some((p) => p.statut === 'paid' || p.statut === 'partial');
                      const activeSess = Array.isArray(b.sessions) ? b.sessions.find((s) => !s.check_out && s.statut !== 'completed') : null;
                      const hasCheckedIn = Array.isArray(b.sessions) ? b.sessions.some((s) => Boolean(s.check_in)) : false;
                      const noShowBlocked = hasPaidOrPartial || hasCheckedIn || Boolean(b.checked_in_at || b.no_show_blocked);
                      const ownerId = b.user_id || b.guest_id || null;

                      return (
                        <tr key={b.id} className={`hover:bg-surface-container-low/40 transition-colors ${b.archived_at ? 'opacity-60 bg-slate-50/70' : ''}`}>
                          {/* Membre / Invité */}
                          <td className="py-2.5 px-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-orange-100 text-[#f95d00] font-bold flex items-center justify-center text-xs shrink-0">
                                {(member.prenom || b.guests?.prenom || 'I')?.[0] || 'I'}{(member.nom || b.guests?.nom || '')?.[0] || ''}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {ownerId ? (
                                    <Link
                                      to={`/admin/clients/${ownerId}`}
                                      className="font-semibold text-primary hover:text-[#f95d00] truncate max-w-[150px] text-xs sm:text-sm"
                                    >
                                      {memberName}
                                    </Link>
                                  ) : (
                                    <p className="font-semibold text-primary truncate max-w-[150px] text-xs sm:text-sm">
                                      {memberName}
                                    </p>
                                  )}
                                  <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 text-slate-700 px-1.5 py-0.5 text-xs font-semibold">
                                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{memberRole === 'Formateur' ? 'school' : 'person'}</span>
                                    {memberRole}
                                  </span>
                                </div>
                                <p className="text-xs text-on-surface-variant truncate max-w-[175px]">
                                  {memberEmail}
                                </p>
                                {memberPhone && (
                                  <p className="text-xs text-on-surface-variant/80 flex items-center gap-0.5 truncate">
                                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>call</span>
                                    <span>{memberPhone}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Espace & Unité */}
                          <td className="py-2.5 px-3 font-semibold text-primary">
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[#f95d00] shrink-0" style={{ fontSize: 16 }}>meeting_room</span>
                              <span className="truncate max-w-[140px] text-xs sm:text-sm" title={b.espaces?.nom}>{b.espaces?.nom || 'Espace inconnu'}</span>
                            </div>
                            {b.unite?.code && (
                              <p className="text-xs text-on-surface-variant pl-5">Unité : {b.unite.code}</p>
                            )}
                          </td>

                          {/* Date & Heures strictes Africa/Tunis jj/mm/aaaa 24h */}
                          <td className="py-2.5 px-3 text-on-surface-variant whitespace-nowrap">
                            <span className="font-medium text-primary text-xs sm:text-sm">
                              {formatDateDMY(b.date_debut)}
                            </span>
                            <div className="text-xs text-on-surface-variant/85 mt-0.5 flex items-center gap-1">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>schedule</span>
                              <span>
                                {formatTime24h(b.date_debut)}
                                {' → '}
                                {formatTime24h(b.date_fin)}
                              </span>
                            </div>
                          </td>

                          {/* Mode de Paiement */}
                          <td className="py-2.5 px-2.5 text-center whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200 shadow-xs">
                              <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 14 }}>storefront</span>
                              <span>
                                {b.mode === 'check' ? 'Chèque' : b.mode === 'bank_transfer' ? 'Virement bancaire' : 'Sur place'}
                              </span>
                            </span>
                          </td>

                          {/* Statut Badge */}
                          <td className="py-2.5 px-2.5 text-center whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${cfg.badgeClass}`}>
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{cfg.icon}</span>
                              <span>{cfg.label}</span>
                            </span>
                            {b.statut === 'en_attente_confirmation' && b.confirmation_expires_at && (
                              <p className="text-xs text-[#c2410c] font-semibold mt-0.5">
                                Expire à {formatTime24h(b.confirmation_expires_at)}
                              </p>
                            )}
                          </td>

                      {/* Statut Badge */}
                      <td className="py-2.5 px-2.5 text-center whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${cfg.badgeClass}`}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{cfg.icon}</span>
                          <span>{cfg.label}</span>
                        </span>
                        {b.statut === 'en_attente_confirmation' && b.confirmation_expires_at && (
                          <p className="text-xs text-[#c2410c] font-semibold mt-0.5">
                            Expire à {formatTime24h(b.confirmation_expires_at)}
                          </p>
                        )}
                        {b.statut === 'refused' && (b.motif_refus || b.motif_annulation) && (
                          <p className="text-xs text-rose-700 font-medium mt-0.5 max-w-[200px] truncate" title={b.motif_refus || b.motif_annulation}>
                            {b.motif_refus || b.motif_annulation}
                          </p>
                        )}
                      </td>

                              {b.statut === 'confirmed' && !activeSess && (
                                <button
                                  type="button"
                                  disabled={isActing}
                                  onClick={async () => {
                                    setActionId(b.id);
                                    try {
                                      await sessionApi.start({ reservation_id: b.id });
                                      showToast('Check-in effectué et chronomètre démarré.');
                                      await loadData();
                                    } catch (err) {
                                      setError(err.message);
                                    } finally {
                                      setActionId(null);
                                    }
                                  }}
                                  style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>login</span>
                                  <span>Check-in</span>
                                </button>
                              )}

                              {activeSess && (
                                <button
                                  type="button"
                                  disabled={isActing}
                                  onClick={async () => {
                                    setActionId(b.id);
                                    try {
                                      await sessionApi.stop(activeSess.id);
                                      showToast('Check-out effectué.');
                                      await loadData();
                                    } catch (err) {
                                      setError(err.message);
                                    } finally {
                                      setActionId(null);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>logout</span>
                                  <span>Check-out</span>
                                </button>
                              )}

                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setOpenMenuId((cur) => (cur === b.id ? null : b.id))}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-outline-variant/30 bg-white text-xs font-bold text-primary hover:bg-surface-container-low"
                                >
                                  <span>Actions</span>
                                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>expand_more</span>
                                </button>

                                {openMenuId === b.id && (
                                  <div className="absolute right-0 mt-1.5 w-56 rounded-2xl border border-outline-variant/25 bg-white shadow-xl z-40 py-1.5 text-left text-xs font-semibold">
                                    {(b.statut === 'pending' || b.statut === 'en_attente_confirmation') && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => { setOpenMenuId(null); handleConfirmBooking(b); }}
                                          className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-emerald-700"
                                        >
                                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                                          Confirmer
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => { setOpenMenuId(null); handleUpdateStatus(b.id, 'refused', 'Refuser cette réservation ?', 'Réservation refusée.'); }}
                                          className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-rose-700"
                                        >
                                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>block</span>
                                          Refuser
                                        </button>
                                      </>
                                    )}

                            {openMenuId === b.id && (
                              <div className="absolute right-0 mt-1.5 w-56 rounded-2xl border border-outline-variant/25 bg-white shadow-xl z-40 py-1.5 text-left text-xs font-semibold">
                                {(b.statut === 'pending' || b.statut === 'en_attente_confirmation') && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => { setOpenMenuId(null); handleConfirmBooking(b); }}
                                      className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-emerald-700"
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                                      Confirmer
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        setRefuseModalBooking(b);
                                        setRefuseMotif('');
                                      }}
                                      className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-rose-700"
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>block</span>
                                      Refuser (avec motif)
                                    </button>
                                  </>
                                )}

                                    {['pending', 'confirmed', 'en_attente_confirmation'].includes(b.statut) && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            setMoveModalBooking(b);
                                            setMoveAlternatives(null);
                                            setMoveForm({
                                              date: new Date(b.date_debut).toISOString().slice(0, 10),
                                              heure_debut: formatTime24h(b.date_debut) || '09:00',
                                              heure_fin: formatTime24h(b.date_fin) || '12:00',
                                              unite_id: b.unite_id || '',
                                            });
                                          }}
                                          className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-primary"
                                        >
                                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>drive_file_move</span>
                                          Déplacer
                                        </button>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            setOpenMenuId(null);
                                            setActionId(b.id);
                                            try {
                                              const r = await bookingApi.extend(b.id, { minutes: 60 });
                                              showToast(r.message || 'Prolongée de +1h (facturable).');
                                              await loadData();
                                            } catch (err) {
                                              setError(err.message);
                                            } finally {
                                              setActionId(null);
                                            }
                                          }}
                                          className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-[#f95d00]"
                                        >
                                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>more_time</span>
                                          Prolonger (+1h)
                                        </button>
                                      </>
                                    )}

                                    {b.statut === 'confirmed' && !activeSess && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setOpenMenuId(null);
                                          await sessionApi.start({ reservation_id: b.id });
                                          showToast('Check-in validé.');
                                          await loadData();
                                        }}
                                        className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-primary"
                                      >
                                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>login</span>
                                        Check-in
                                      </button>
                                    )}

                                    {activeSess && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setOpenMenuId(null);
                                          await sessionApi.stop(activeSess.id);
                                          showToast('Check-out validé.');
                                          await loadData();
                                        }}
                                        className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-emerald-700"
                                      >
                                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>logout</span>
                                        Check-out
                                      </button>
                                    )}

                                    {pendingPayment && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setOpenMenuId(null);
                                          await paymentApi.collect(pendingPayment.id, { mode_paiement: 'cash' });
                                          showToast('Paiement encaissé.');
                                          await loadData();
                                        }}
                                        className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-amber-800"
                                      >
                                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>payments</span>
                                        Encaisser
                                      </button>
                                    )}

                                    {paidPayment && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => { setOpenMenuId(null); paymentApi.downloadReceipt(paidPayment.id); }}
                                          className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-[#f95d00]"
                                        >
                                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>receipt_long</span>
                                          Télécharger le reçu
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            navigate(`/admin/payments?tab=remboursements&search=${encodeURIComponent(paidPayment.id)}`);
                                          }}
                                          className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-rose-700"
                                        >
                                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>currency_exchange</span>
                                          Rembourser
                                        </button>
                                      </>
                                    )}

                                    {b.statut === 'confirmed' && !noShowBlocked && (
                                      <button
                                        type="button"
                                        onClick={() => { setOpenMenuId(null); handleUpdateStatus(b.id, 'no_show', 'Marquer No-show (Absent) ?', 'No-show (Absent) enregistré.'); }}
                                        className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-amber-800"
                                      >
                                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person_off</span>
                                        No-show (Absent)
                                      </button>
                                    )}

                                    {isManager && !b.archived_at && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setOpenMenuId(null);
                                          if (!window.confirm('Archiver cette réservation ? Elle restera dans l\'historique.')) return;
                                          try {
                                            await bookingApi.archive(b.id);
                                            showToast('Réservation archivée.');
                                            await loadData();
                                          } catch (err) {
                                            setError(err.message);
                                          }
                                        }}
                                        className="w-full px-3.5 py-2 hover:bg-slate-50 flex items-center gap-2 text-on-surface-variant border-t border-outline-variant/10 mt-1"
                                      >
                                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>archive</span>
                                        Archiver
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination 10 par page */}
            <Pagination
              currentPage={currentPage}
              totalItems={filteredBookings.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setCurrentPage}
              label="réservations"
            />
          </div>

          <NewReservationModal
            isOpen={showNewModal}
            onClose={() => {
              setShowNewModal(false);
              if (searchParams.get('new') || searchParams.get('personne_id')) setSearchParams({});
            }}
            onCreated={() => {
              showToast('Réservation créée avec succès.');
              loadData();
            }}
            espaces={espaces}
            userRole={profile?.role}
            initialPersonneId={initialPersonneId}
          />

          <WalkInSessionModal
            isOpen={showWalkinModal}
            onClose={() => {
              setShowWalkinModal(false);
              if (searchParams.get('walkin')) setSearchParams({});
            }}
            onSuccess={() => loadData()}
            espaces={espaces}
          />

          {cancelModalBooking && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!cancelMotif.trim()) return;
                  try {
                    await bookingApi.update(cancelModalBooking.id, {
                      statut: 'cancelled',
                      motif_annulation: cancelMotif.trim(),
                    });
                    setCancelModalBooking(null);
                    showToast('Réservation annulée avec motif.');
                    await loadData();
                  } catch (err) {
                    setError(err.message);
                  }
                }}
                className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-3 text-left"
              >
                <h3 className="font-sora text-base font-bold text-primary">Annuler la réservation</h3>
                <p className="text-xs text-on-surface-variant">
                  Saisissez le motif d&apos;annulation (conservé dans le journal d&apos;activité) :
                </p>
                <textarea
                  required
                  rows={3}
                  value={cancelMotif}
                  onChange={(e) => setCancelMotif(e.target.value)}
                  placeholder="Ex : Annulation demandée par téléphone par le client…"
                  className="w-full rounded-xl border border-slate-300 p-3 text-xs"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setCancelModalBooking(null)} className="rounded-xl border px-4 py-2 text-xs font-semibold">
                    Fermer
                  </button>
                  <button type="submit" style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="rounded-xl px-4 py-2 text-xs font-bold">
                    Confirmer l&apos;annulation
                  </button>
                </div>
              </form>
            </div>
          )}

      {refuseModalBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (refuseMotif.trim().length < 3) {
                setError('Saisissez un motif de refus (minimum 3 caractères).');
                return;
              }
              try {
                await bookingApi.update(refuseModalBooking.id, {
                  statut: 'refused',
                  motif_refus: refuseMotif.trim(),
                });
                const { data: linkedForm } = await supabase
                  .from('formations')
                  .select('id')
                  .eq('reservation_id', refuseModalBooking.id)
                  .maybeSingle();
                if (linkedForm) {
                  await supabase.from('formations').update({ statut: 'annulee' }).eq('id', linkedForm.id);
                }
                setRefuseModalBooking(null);
                setRefuseMotif('');
                showToast('Réservation refusée avec motif transmis au membre.');
                await loadData();
              } catch (err) {
                setError(err.message);
              }
            }}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-3 text-left"
          >
            <h3 className="font-sora text-base font-bold text-primary">Refuser la réservation</h3>
            <p className="text-xs text-on-surface-variant">
              Ce motif sera visible directement par le membre sur sa page « Mes réservations » et dans son e-mail.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                'Salle indisponible pour maintenance',
                'Capacité / effectif non compatible',
                'Créneau réservé à un événement privé',
              ].map((tpl) => (
                <button
                  key={tpl}
                  type="button"
                  onClick={() => setRefuseMotif(tpl)}
                  className="px-2.5 py-1 rounded-lg border border-outline-variant/25 text-xs font-semibold text-primary hover:border-[#f95d00]"
                >
                  {tpl}
                </button>
              ))}
            </div>
            <textarea
              required
              minLength={3}
              rows={3}
              value={refuseMotif}
              onChange={(e) => setRefuseMotif(e.target.value)}
              placeholder="Saisissez le motif du refus (obligatoire)…"
              className="w-full rounded-xl border border-slate-300 p-3 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRefuseModalBooking(null)} className="rounded-xl border px-4 py-2 text-xs font-semibold">
                Fermer
              </button>
              <button type="submit" className="rounded-xl bg-rose-600 text-white px-4 py-2 text-xs font-bold">
                Confirmer le refus
              </button>
            </div>
          </form>
        </div>
      )}

          {moveModalBooking && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setMoveAlternatives(null);
                  try {
                    await bookingApi.move(moveModalBooking.id, {
                      date_debut: tunisLocalToISO(`${moveForm.date}T${moveForm.heure_debut}`),
                      date_fin: tunisLocalToISO(`${moveForm.date}T${moveForm.heure_fin}`),
                      unite_id: moveForm.unite_id || null,
                    });
                    setMoveModalBooking(null);
                    showToast('Réservation déplacée.');
                    await loadData();
                  } catch (err) {
                    if (err?.status === 409 && err?.data?.alternatives) {
                      setMoveAlternatives(err.data.alternatives);
                    }
                    setError(err.message);
                  }
                }}
                className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-3 text-left"
              >
                <h3 className="font-sora text-base font-bold text-primary">Déplacer la réservation</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-bold mb-1">Date</label>
                    <input type="date" required value={moveForm.date} onChange={(e) => setMoveForm((f) => ({ ...f, date: e.target.value }))} className="w-full rounded-xl border px-2.5 py-2 text-xs" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Début</label>
                    <input type="time" required value={moveForm.heure_debut} onChange={(e) => setMoveForm((f) => ({ ...f, heure_debut: e.target.value }))} className="w-full rounded-xl border px-2.5 py-2 text-xs" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Fin</label>
                    <input type="time" required value={moveForm.heure_fin} onChange={(e) => setMoveForm((f) => ({ ...f, heure_fin: e.target.value }))} className="w-full rounded-xl border px-2.5 py-2 text-xs" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Unité / Poste</label>
                  <select value={moveForm.unite_id} onChange={(e) => setMoveForm((f) => ({ ...f, unite_id: e.target.value }))} className="w-full rounded-xl border px-3 py-2 text-xs">
                    <option value="">— Conserver / Attribution libre —</option>
                    {unites
                      .filter((u) => u.espace_id === moveModalBooking.espace_id && !u.archived_at && u.statut === 'disponible')
                      .map((u) => (
                        <option key={u.id} value={u.id}>{u.code} · {u.nom}</option>
                      ))}
                  </select>
                </div>
                {moveAlternatives?.slots?.length > 0 && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-xs space-y-1">
                    <p className="font-bold text-amber-900">Créneaux alternatifs disponibles :</p>
                    <div className="flex flex-wrap gap-1.5">
                      {moveAlternatives.slots.map((sl) => (
                        <button
                          key={sl.label}
                          type="button"
                          onClick={() => setMoveForm((f) => ({ ...f, heure_debut: sl.heure_debut, heure_fin: sl.heure_fin }))}
                          className="rounded-lg border border-orange-300 bg-white px-2 py-1 font-bold text-[#f95d00]"
                        >
                          {sl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setMoveModalBooking(null)} className="rounded-xl border px-4 py-2 text-xs font-semibold">
                    Annuler
                  </button>
                  <button type="submit" style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="rounded-xl px-4 py-2 text-xs font-bold">
                    Valider le déplacement
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </PortalLayout>
  );
}
