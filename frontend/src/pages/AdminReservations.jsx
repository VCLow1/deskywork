import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { bookingApi, memberApi, paymentApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import { formatDateDMY, formatTime24h, tunisLocalToISO } from '../utils/format';

const STATUT_CONFIG = {
  pending: {
    label: 'En attente',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700/50',
    icon: 'hourglass_empty',
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
  const [filterStatut, setFilterStatut] = useState('all');
  const [filterEspace, setFilterEspace] = useState('all');
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [showNewModal, setShowNewModal] = useState(() => searchParams.get('new') === '1');
  const [membersList, setMembersList] = useState([]);
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [newBookingForm, setNewBookingForm] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      user_id: '',
      espace_id: '',
      date: today,
      heure_debut: '09:00',
      heure_fin: '12:00',
      nb_participants: 1,
      notes: '',
    };
  });

  const navigate = useNavigate();

  useEffect(() => {
    const q = searchParams.get('search');
    if (q !== null) setSearchQuery(q);
    if (searchParams.get('new') === '1') setShowNewModal(true);
  }, [searchParams]);

  useEffect(() => {
    if (showNewModal && membersList.length === 0) {
      memberApi.getAll().then((r) => setMembersList(r.members || [])).catch(() => {});
    }
  }, [showNewModal]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const [bookingsData, espacesData] = await Promise.all([
        bookingApi.getAll(),
        bookingApi.getEspaces().catch(() => ({ espaces: [] })),
      ]);

      setBookings(bookingsData.reservations || []);
      setEspaces(espacesData.espaces || []);
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h1 className="font-sora font-bold text-primary" style={{ fontSize: 'clamp(20px, 4vw, 28px)' }}>Gestion des Réservations</h1>
          <p className="text-on-surface-variant text-sm mt-1">
            Visualisez, confirmez et gérez toutes les réservations des espaces de coworking.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-[#f95d00] text-white rounded-xl font-semibold text-xs sm:text-sm hover:bg-[#e55500] transition-all shadow-sm"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_circle</span>
            <span>Nouvelle réservation</span>
          </button>
          <Link
            to="/admin/agenda"
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-outline-variant/30 text-primary rounded-xl font-semibold text-xs sm:text-sm hover:bg-surface-container transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>calendar_month</span>
            <span>Voir l'Agenda</span>
          </Link>
          <button
            onClick={loadData}
            title="Rafraîchir"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-outline-variant/30 text-on-surface-variant hover:text-secondary hover:border-secondary transition-all shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>sync</span>
          </button>
        </div>
      </div>

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
              <option value="confirmed">Confirmée</option>
              <option value="refused">Refusée</option>
              <option value="completed">Terminée</option>
              <option value="no_show">No-show (Absent)</option>
              <option value="waitlisted">En liste d'attente</option>
              <option value="cancelled">Annulée</option>
            </select>
          </div>

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
                  const hasPaidOrPartial = (b.paiements || []).some((p) => p.statut === 'paid' || p.statut === 'partial');
                  const noShowBlocked = hasPaidOrPartial || Boolean(b.checked_in_at || b.no_show_blocked);

                  return (
                    <tr key={b.id} className="hover:bg-surface-container-low/40 transition-colors">
                      {/* Membre / Invité */}
                      <td className="py-2.5 px-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-secondary/10 text-secondary font-bold flex items-center justify-center text-xs shrink-0">
                            {(member.prenom || b.guests?.prenom || 'I')?.[0] || 'I'}{(member.nom || b.guests?.nom || '')?.[0] || ''}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-semibold text-primary truncate max-w-[150px] text-xs sm:text-sm">
                                {memberName}
                              </p>
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

                      {/* Espace */}
                      <td className="py-2.5 px-3 font-semibold text-primary">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-secondary shrink-0" style={{ fontSize: 16 }}>meeting_room</span>
                          <span className="truncate max-w-[140px] text-xs sm:text-sm" title={b.espaces?.nom}>{b.espaces?.nom || 'Espace inconnu'}</span>
                        </div>
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
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {b.statut === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleConfirmBooking(b)}
                                disabled={isActing}
                                title="Accepter (règlement sur place à l'accueil)"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>check</span>
                                <span className="hidden xs:inline">Accepter</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateStatus(b.id, 'refused', 'Refuser cette demande de réservation ?', 'Réservation refusée.')}
                                disabled={isActing}
                                title="Refuser la demande"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>block</span>
                                <span className="hidden xs:inline">Refuser</span>
                              </button>
                            </>
                          )}

                          {b.statut === 'confirmed' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleUpdateStatus(b.id, 'completed', null, 'Réservation marquée terminée.')}
                                disabled={isActing}
                                title="Marquer comme terminée"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-emerald-700 hover:bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>task_alt</span>
                                <span className="hidden sm:inline">Terminée</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => !noShowBlocked && handleUpdateStatus(b.id, 'no_show', 'Marquer ce client en No-show (Absent) ?', 'Statut No-show (Absent) enregistré.')}
                                disabled={isActing || noShowBlocked}
                                title={
                                  noShowBlocked
                                    ? 'Impossible : un paiement ou un check-in validé existe déjà pour cette réservation.'
                                    : 'Marquer No-show (Absent)'
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-orange-700 hover:bg-orange-50 border border-orange-200 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>person_off</span>
                                <span className="hidden sm:inline">No-show (Absent)</span>
                              </button>
                            </>
                          )}

                          {paidPayment && (
                            <button
                              type="button"
                              onClick={() => paymentApi.downloadReceipt(paidPayment.id)}
                              title="Télécharger le reçu PDF"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[#f95d00] hover:bg-orange-50 border border-orange-200 rounded-xl text-xs font-semibold transition-all"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>receipt_long</span>
                              <span className="hidden md:inline">Télécharger le reçu</span>
                            </button>
                          )}

                          {['pending', 'confirmed', 'waitlisted'].includes(b.statut) && (
                            <button
                              type="button"
                              onClick={() => handleCancelBooking(b.id)}
                              disabled={isActing}
                              title="Annuler la réservation"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                              <span className="hidden xs:inline">Annuler</span>
                            </button>
                          )}

                          <Link
                            to="/admin/agenda"
                            title="Voir dans le calendrier"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-xl border border-outline-variant/30 text-on-surface-variant hover:text-secondary hover:border-secondary transition-all"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>calendar_month</span>
                          </Link>
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

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              const chosenEsp = espaces.find((sp) => sp.id === newBookingForm.espace_id);
              const maxCap = Math.max(1, parseInt(chosenEsp?.capacite, 10) || 1);
              const nbPart = parseInt(newBookingForm.nb_participants, 10);
              if (chosenEsp?.type === 'meeting_room' && (!Number.isInteger(nbPart) || nbPart < 1 || nbPart > maxCap)) {
                setError(`Pour une salle de réunion, le nombre de participants doit être compris entre 1 et ${maxCap}.`);
                return;
              }
              setCreatingBooking(true);
              try {
                const date_debut = tunisLocalToISO(`${newBookingForm.date}T${newBookingForm.heure_debut}`);
                const date_fin = tunisLocalToISO(`${newBookingForm.date}T${newBookingForm.heure_fin}`);
                await bookingApi.create({
                  user_id: newBookingForm.user_id,
                  espace_id: newBookingForm.espace_id,
                  date_debut,
                  date_fin,
                  ...(chosenEsp?.type === 'meeting_room' ? { nb_participants: nbPart } : {}),
                  notes: newBookingForm.notes,
                });
                showToast('Réservation créée avec succès.');
                setShowNewModal(false);
                if (searchParams.get('new')) setSearchParams({});
                await loadData();
              } catch (err) {
                setError(err.message);
              } finally {
                setCreatingBooking(false);
              }
            }}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-sora text-lg font-bold text-slate-900">Nouvelle réservation</h3>
              <button
                type="button"
                onClick={() => {
                  setShowNewModal(false);
                  if (searchParams.get('new')) setSearchParams({});
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Membre *</label>
              <select
                required
                value={newBookingForm.user_id}
                onChange={(e) => setNewBookingForm((p) => ({ ...p, user_id: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">— Sélectionner un membre —</option>
                {membersList.map((m) => (
                  <option key={m.id} value={m.id}>{m.prenom} {m.nom} ({m.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Espace *</label>
              <select
                required
                value={newBookingForm.espace_id}
                onChange={(e) => setNewBookingForm((p) => ({ ...p, espace_id: e.target.value, nb_participants: 1 }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">— Sélectionner un espace —</option>
                {espaces.map((esp) => (
                  <option key={esp.id} value={esp.id}>{esp.nom} ({esp.tarif_horaire} DT/h)</option>
                ))}
              </select>
            </div>
            {(() => {
              const sel = espaces.find((sp) => sp.id === newBookingForm.espace_id);
              if (sel?.type !== 'meeting_room') return null;
              const maxCap = Math.max(1, parseInt(sel.capacite, 10) || 1);
              return (
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Nombre de participants * (1 à {maxCap} max)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={maxCap}
                    value={newBookingForm.nb_participants}
                    onChange={(e) => setNewBookingForm((p) => ({ ...p, nb_participants: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  />
                </div>
              );
            })()}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-semibold mb-1">Date *</label>
                <input
                  type="date"
                  required
                  value={newBookingForm.date}
                  onChange={(e) => setNewBookingForm((p) => ({ ...p, date: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Début *</label>
                <input
                  type="time"
                  required
                  value={newBookingForm.heure_debut}
                  onChange={(e) => setNewBookingForm((p) => ({ ...p, heure_debut: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Fin *</label>
                <input
                  type="time"
                  required
                  value={newBookingForm.heure_fin}
                  onChange={(e) => setNewBookingForm((p) => ({ ...p, heure_fin: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Notes</label>
              <input
                type="text"
                value={newBookingForm.notes}
                onChange={(e) => setNewBookingForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Besoin particulier..."
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowNewModal(false);
                  if (searchParams.get('new')) setSearchParams({});
                }}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={creatingBooking}
                className="flex-1 rounded-xl bg-[#f95d00] py-2.5 text-xs font-bold text-white hover:bg-[#e55500] disabled:opacity-50"
              >
                {creatingBooking ? 'Création…' : 'Confirmer la réservation'}
              </button>
            </div>
          </form>
        </div>
      )}
    </PortalLayout>
  );
}
