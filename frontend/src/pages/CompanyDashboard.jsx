import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { bookingApi, paymentApi } from '../services/api';
import { supabase } from '../supabaseClient';
import { formatDT } from '../utils/currency';

export default function CompanyDashboard({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const profile = userId
    ? { id: userId, email, role: 'company', type_membre: 'entreprise', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata }
    : null;

  const [loading, setLoading] = useState(true);
  const [companyOrg, setCompanyOrg] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    async function loadCompanyData() {
      if (!userId) return;
      setLoading(true);
      try {
        // Charger l'organisation liée au profil
        const { data: mems } = await supabase
          .from('memberships')
          .select('*, organizations(*)')
          .eq('user_id', userId);

        const org = mems?.[0]?.organizations || null;
        setCompanyOrg(org);

        // Charger les réservations du compte
        const resList = await bookingApi.list({ client_type: 'entreprise' }).catch(() => []);
        setBookings(Array.isArray(resList) ? resList : resList?.reservations || []);

        // Charger les paiements
        const payList = await paymentApi.listSelf().catch(() => []);
        setPayments(Array.isArray(payList) ? payList : payList?.paiements || []);
      } catch (err) {
        console.error('Erreur chargement données entreprise:', err);
      } finally {
        setLoading(false);
      }
    }
    loadCompanyData();
  }, [userId]);

  const activeBookings = bookings.filter((b) => b.statut === 'confirmed' || b.statut === 'pending');
  const totalSpent = payments.filter((p) => p.statut === 'paid').reduce((acc, p) => acc + (parseFloat(p.montant) || 0), 0);

  const raisonSociale = companyOrg?.nom || metadata?.raison_sociale || 'Société Test SARL';
  const matricule = companyOrg?.matricule_fiscal || '1234567/A/M/000';

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="space-y-6">
        {/* En-tête Espace Entreprise */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 sm:p-8 rounded-3xl shadow-xl">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs font-bold uppercase tracking-wider">
                Compte Entreprise B2B
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-white/90 text-xs font-medium">
                Rôle Fixe
              </span>
            </div>
            <h1 className="font-sora text-2xl sm:text-3xl font-bold">
              {raisonSociale}
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm flex flex-wrap items-center gap-3">
              <span>MF : <strong className="text-white font-mono">{matricule}</strong></span>
              <span>·</span>
              <span>Contact : <strong>{profile?.prenom} {profile?.nom}</strong></span>
              <span>·</span>
              <span>{profile?.email}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/book/step1"
              className="px-5 py-3 rounded-xl bg-[#f95d00] hover:bg-[#e05300] text-white font-bold text-sm shadow-lg shadow-orange-500/20 flex items-center gap-2 transition-all active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              Réserver un espace B2B
            </Link>
            <Link
              to="/company/domiciliation"
              className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm border border-white/15 flex items-center gap-2 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">corporate_fare</span>
              Offres Domiciliation
            </Link>
          </div>
        </div>

        {/* 4 Cartes Métriques */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Réservations actives</span>
              <span className="p-2 bg-orange-50 text-orange-600 rounded-xl material-symbols-outlined text-[20px]">calendar_today</span>
            </div>
            <div className="font-sora text-2xl font-bold text-slate-900">{activeBookings.length}</div>
            <p className="text-xs text-slate-500 mt-1">Espaces de travail & réunions</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Collaborateurs</span>
              <span className="p-2 bg-blue-50 text-blue-600 rounded-xl material-symbols-outlined text-[20px]">group</span>
            </div>
            <div className="font-sora text-2xl font-bold text-slate-900">5</div>
            <p className="text-xs text-slate-500 mt-1">Accès et badges actifs</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Domiciliation</span>
              <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl material-symbols-outlined text-[20px]">corporate_fare</span>
            </div>
            <div className="font-sora text-xl font-bold text-emerald-600">Partenaires dispo</div>
            <p className="text-xs text-slate-500 mt-1">Nero Ennasr & Thirty Three Lac 2</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Factures & Reçus</span>
              <span className="p-2 bg-purple-50 text-purple-600 rounded-xl material-symbols-outlined text-[20px]">receipt_long</span>
            </div>
            <div className="font-sora text-2xl font-bold text-slate-900">{formatDT(totalSpent)}</div>
            <p className="text-xs text-slate-500 mt-1">Règlement 100% sur place</p>
          </div>
        </div>

        {/* Section réservations récentes */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-sora text-lg font-bold text-slate-900">Dernières réservations B2B</h2>
              <p className="text-xs text-slate-500">Suivi des demandes et confirmations pour vos équipes</p>
            </div>
            <Link to="/company/bookings" className="text-xs font-bold text-[#f95d00] hover:underline flex items-center gap-1">
              Voir tout <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Chargement des données...</div>
          ) : bookings.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <span className="material-symbols-outlined text-4xl text-slate-300">event_busy</span>
              <p className="text-sm text-slate-600 font-medium">Aucune réservation pour le moment.</p>
              <Link
                to="/book/step1"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#f95d00] text-white rounded-xl text-xs font-bold hover:bg-[#e05300]"
              >
                Réserver mon premier espace
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/70 text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                    <th className="px-5 py-3">Espace & Lieu</th>
                    <th className="px-5 py-3">Date & Créneau</th>
                    <th className="px-5 py-3">Montant</th>
                    <th className="px-5 py-3">Règlement</th>
                    <th className="px-5 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {bookings.slice(0, 5).map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 font-semibold text-slate-900">
                        {b.espaces?.nom || b.espace_nom || 'Espace de réunion'}
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        {new Date(b.date_debut).toLocaleDateString('fr-FR')} (
                        {new Date(b.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} -{' '}
                        {new Date(b.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})
                      </td>
                      <td className="px-5 py-3 font-bold text-slate-900">
                        {formatDT(b.montant_total || 0)}
                      </td>
                      <td className="px-5 py-3">
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold">
                          Sur place à l'arrivée
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          b.statut === 'confirmed' ? 'bg-emerald-100 text-emerald-800' :
                          b.statut === 'pending' ? 'bg-amber-100 text-amber-800' :
                          b.statut === 'cancelled' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {b.statut === 'confirmed' ? 'Confirmée' : b.statut === 'pending' ? 'En attente' : b.statut}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bannière Domiciliation Partenaires */}
        <div className="bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-transparent p-6 rounded-3xl border border-orange-500/20 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#f95d00] text-white flex items-center justify-center shrink-0 shadow-md shadow-orange-500/20">
              <span className="material-symbols-outlined text-2xl">verified</span>
            </div>
            <div>
              <h3 className="font-sora font-bold text-slate-900 text-base">
                Domiciliez votre société chez nos partenaires de confiance
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Nero Coworking (Ennasr 2) dès 75 DT/mois et Thirty Three Space (Lac 2) dès 85 DT/mois.
              </p>
            </div>
          </div>
          <Link
            to="/company/domiciliation"
            className="px-5 py-2.5 rounded-xl bg-[#f95d00] hover:bg-[#e05300] text-white font-bold text-xs shrink-0 transition-all shadow-sm"
          >
            Découvrir les offres
          </Link>
        </div>
      </div>
    </PortalLayout>
  );
}
