import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { bookingApi } from '../services/api';
import { supabase } from '../supabaseClient';
import { formatDT } from '../utils/currency';

export default function CompanyCalendar({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = userId
    ? { id: userId, email, role: 'company', type_membre: 'entreprise', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata }
    : null;

  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date());

  useEffect(() => {
    async function loadData() {
      if (!userId) return;
      setLoading(true);
      try {
        const res = await bookingApi.list({ client_type: 'entreprise' }).catch(() => []);
        setBookings(Array.isArray(res) ? res : res?.reservations || []);
      } catch (err) {
        console.error('Erreur chargement réservations calendrier:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [userId]);

  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();

  const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Adjust so Monday is 0
  const startOffset = (firstDay + 6) % 7;

  const monthLabel = selectedMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const prevMonth = () => setSelectedMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(year, month + 1, 1));

  const days = [];
  for (let i = 0; i < startOffset; i++) {
    days.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(d);
  }

  const getBookingsForDay = (d) => {
    if (!d) return [];
    return bookings.filter((b) => {
      const dt = new Date(b.date_debut);
      return dt.getFullYear() === year && dt.getMonth() === month && dt.getDate() === d;
    });
  };

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-sora font-bold text-2xl text-slate-900">Calendrier des Réservations B2B</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Visualisez le planning d'occupation de vos équipes sur l'ensemble des établissements partenaires.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/book/step1"
              className="px-4 py-2.5 rounded-xl bg-[#f95d00] hover:bg-[#e05300] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Nouvelle réservation
            </Link>
          </div>
        </div>

        {/* Navigation mois */}
        <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
            <h2 className="font-sora font-bold text-lg text-slate-900 capitalize">
              {monthLabel}
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={prevMonth}
                className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                title="Mois précédent"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedMonth(new Date())}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Aujourd'hui
              </button>
              <button
                type="button"
                onClick={nextMonth}
                className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                title="Mois suivant"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>

          {/* Grille des jours de la semaine */}
          <div className="grid grid-cols-7 gap-2 mb-2 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
            <div>Lun</div>
            <div>Mar</div>
            <div>Mer</div>
            <div>Jeu</div>
            <div>Ven</div>
            <div>Sam</div>
            <div>Dim</div>
          </div>

          {/* Cases du calendrier */}
          <div className="grid grid-cols-7 gap-2">
            {days.map((d, idx) => {
              if (d === null) {
                return <div key={`empty-${idx}`} className="h-28 rounded-2xl bg-slate-50/40 border border-transparent" />;
              }

              const dayBookings = getBookingsForDay(d);
              const isToday =
                new Date().getDate() === d &&
                new Date().getMonth() === month &&
                new Date().getFullYear() === year;

              return (
                <div
                  key={`day-${d}`}
                  className={`h-28 p-2 rounded-2xl border transition-all flex flex-col justify-between ${
                    isToday
                      ? 'border-[#f95d00] bg-orange-50/20'
                      : dayBookings.length > 0
                        ? 'border-slate-300 bg-white'
                        : 'border-slate-100 bg-white hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                        isToday ? 'bg-[#f95d00] text-white shadow-xs' : 'text-slate-700'
                      }`}
                    >
                      {d}
                    </span>
                    {dayBookings.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600">
                        {dayBookings.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 overflow-y-auto max-h-16 text-[10px]">
                    {dayBookings.map((b) => (
                      <div
                        key={b.id}
                        className={`px-1.5 py-0.5 rounded-md truncate font-semibold ${
                          b.statut === 'confirmed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                        title={`${b.espaces?.nom || 'Espace'} (${new Date(b.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`}
                      >
                        {new Date(b.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} {b.espaces?.nom || 'Espace'}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

