import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { bookingApi, paymentApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';

const ITEMS_PER_PAGE = 10;

const STATUS_CONFIG = {
  confirmed:  { label: 'Confirmée',          color: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  pending:    { label: 'En attente',         color: 'bg-amber-50   text-amber-700   ring-amber-600/20',   dot: 'bg-amber-500'   },
  refused:    { label: 'Refusée',            color: 'bg-rose-50    text-rose-700    ring-rose-600/20',    dot: 'bg-rose-500'    },
  completed:  { label: 'Terminée',           color: 'bg-slate-100  text-slate-600   ring-slate-500/20',   dot: 'bg-slate-400'   },
  no_show:    { label: 'Absent (no-show)',   color: 'bg-orange-50  text-orange-700  ring-orange-600/20',  dot: 'bg-orange-500'  },
  waitlisted: { label: "En liste d'attente", color: 'bg-violet-50  text-violet-700  ring-violet-600/20',  dot: 'bg-violet-500'  },
  cancelled:  { label: 'Annulée',            color: 'bg-red-50     text-red-700     ring-red-600/20',     dot: 'bg-red-500'     },
};

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function formatTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function formatCurrency(v) {
  return `${parseFloat(v || 0).toFixed(3)} DT`;
}

export default function TrainerBookings({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const navigate = useNavigate();
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'formateur', ...metadata } : null
  );
  const [bookings,   setBookings]   = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [payingId,   setPayingId]   = useState(null);
  const [cancelId,   setCancelId]   = useState(null);
  const [cancelModal,setCancelModal]= useState(null);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');

  // profile déjà initialisé depuis le JWT — aucun appel DB nécessaire

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bookingApi.getAll();
      setBookings(res.reservations || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (profile) loadBookings(); }, [profile, loadBookings]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3500); return () => clearTimeout(t); }
  }, [success]);

  const handleCancel = async (id) => {
    setCancelId(id);
    try {
      await bookingApi.cancel(id);
      setSuccess('Réservation annulée.');
      setCancelModal(null);
      await loadBookings();
    } catch (e) { setError(e.message); }
    finally { setCancelId(null); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  if (loading && !profile) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
    </div>
  );

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="space-y-6">

        {/* En-tête */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-sora text-2xl font-bold text-primary">Mes Réservations</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Vos réservations d'espaces de coworking
            </p>
          </div>
          <Link to="/book/step1"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white rounded-xl text-sm font-semibold hover:bg-secondary/90 transition shadow-sm shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            Nouvelle Réservation
          </Link>
        </div>

        {/* Alertes */}
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
            {error}
            <button onClick={() => setError('')} className="ml-auto"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span></button>
          </div>
        )}
        {success && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
            {success}
          </div>
        )}

        {/* Liste des réservations */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-secondary border-t-transparent" />
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-outline-variant/15 shadow-sm">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant/30 block mb-2">event_busy</span>
            <p className="font-bold text-primary">Aucune réservation</p>
            <p className="text-xs text-on-surface-variant mt-1">Vous n'avez pas encore réservé d'espace.</p>
            <Link to="/book/step1"
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-secondary text-white rounded-xl text-xs font-bold hover:bg-secondary/90 transition">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add</span>
              Réserver un espace
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((b) => {
              const st = STATUS_CONFIG[b.statut] || STATUS_CONFIG.pending;
              const canCancel = ['confirmed', 'pending'].includes(b.statut);
              const isPaid = b.paiements?.[0]?.statut === 'paid';

              return (
                <div key={b.id} className="bg-white rounded-2xl border border-outline-variant/15 p-5 shadow-sm hover:shadow-md transition">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Info espace */}
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined" style={{ fontSize: 22 }}>meeting_room</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-sora font-bold text-primary text-base">
                            {b.espaces?.nom || 'Espace'}
                          </h3>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset ${st.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                            {st.label}
                          </span>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                            Sur place
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          {formatDate(b.date_debut)} · {formatTime(b.date_debut)} – {formatTime(b.date_fin)}
                        </p>
                        {/* Indicateurs statut paiement */}
                        {b.statut === 'pending' && (
                          <p className="text-[11px] text-amber-600 font-medium mt-0.5">⏳ En attente de validation par l'admin</p>
                        )}
                        {b.statut === 'confirmed' && (
                          <p className="text-[11px] text-emerald-600 font-medium mt-0.5">
                            {isPaid ? 'Confirmée · Encaissement validé' : 'Confirmée · Règlement sur place à votre arrivée'}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Montant + Actions */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 border-outline-variant/10 pt-3 sm:pt-0">
                      <div className="text-right mr-2">
                        <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider block">Montant</span>
                        <span className="font-sora font-extrabold text-primary text-lg">
                          {formatCurrency(b.montant_total || (parseFloat(b.espaces?.tarif_horaire || 0) * Math.max(1, (new Date(b.date_fin) - new Date(b.date_debut)) / 3600000)))}
                        </span>
                      </div>

                      {canCancel && (
                        <button onClick={() => setCancelModal(b)}
                          className="px-3 py-1.5 rounded-lg text-xs text-rose-600 hover:bg-rose-50 font-bold border border-rose-200 transition">
                          Annuler
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="bg-white rounded-2xl border border-outline-variant/15 overflow-hidden">
              <Pagination
                currentPage={currentPage}
                totalItems={bookings.length}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setCurrentPage}
                label="réservations"
              />
            </div>
          </div>
        )}
      </div>

      {/* Modal annulation */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCancelModal(null)}>
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-rose-600" style={{ fontSize: 20 }}>warning</span>
              </div>
              <div>
                <h3 className="font-sora font-bold text-primary">Annuler la réservation</h3>
                <p className="text-xs text-on-surface-variant">{cancelModal.espaces?.nom}</p>
              </div>
            </div>
            <p className="text-xs text-on-surface-variant mb-5 leading-relaxed">
              Êtes-vous sûr de vouloir annuler cette réservation ? Cette action est irréversible.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setCancelModal(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/30 text-xs font-bold text-on-surface-variant hover:bg-surface-container transition">
                Conserver
              </button>
              <button onClick={() => handleCancel(cancelModal.id)} disabled={cancelId === cancelModal.id}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50 transition">
                {cancelId === cancelModal.id ? 'Annulation...' : 'Annuler'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
