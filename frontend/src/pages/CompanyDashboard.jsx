import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { bookingApi, paymentApi, sessionApi, memberPortalApi } from '../services/api';
import {
  connectSocket,
  joinUser,
  onSessionStarted,
  onSessionEnded,
  disconnectSocket,
} from '../services/socket';
import { supabase } from '../supabaseClient';
import { formatDT } from '../utils/currency';

function formatTimer(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);

  /* ── Session de travail en direct ── */
  const [activeSession, setActiveSession] = useState(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [checkingOut, setCheckingOut] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  // Charger l'ensemble des données entreprise
  const loadCompanyData = async () => {
    if (!userId) return;
    try {
      // 1. Organisation B2B liée
      const { data: mems } = await supabase
        .from('memberships')
        .select('*, organizations(*)')
        .eq('user_id', userId);

      const org = mems?.[0]?.organizations || null;
      setCompanyOrg(org);

      // 2. Réservations
      const resList = await bookingApi.list({ client_type: 'entreprise' }).catch(() => []);
      const allRes = Array.isArray(resList) ? resList : resList?.reservations || [];
      setBookings(allRes);

      // 3. Factures / Paiements
      const payList = await paymentApi.listSelf().catch(() => []);
      const allPay = Array.isArray(payList) ? payList : payList?.paiements || [];
      setPayments(allPay);

      // 4. Notifications non lues
      try {
        const notifsRes = await memberPortalApi.getNotifications();
        const unread = (notifsRes?.notifications || []).filter((n) => !n.lu).length;
        setUnreadNotifsCount(unread);
      } catch (_) {
        const { count } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('lu', false);
        setUnreadNotifsCount(count || 0);
      }

      // 5. Session de travail active
      try {
        const activeRes = await sessionApi.getActive();
        const sess = activeRes?.session || null;
        setActiveSession(sess);
        if (sess?.debut) {
          const startMs = new Date(sess.debut).getTime();
          const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
          setTimerSeconds(elapsed);
        }
      } catch (_) {
        setActiveSession(null);
      }
    } catch (err) {
      console.error('Erreur chargement données dashboard entreprise:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompanyData();
  }, [userId]);

  // Minuteur temps réel pour session de travail active
  useEffect(() => {
    if (!activeSession) {
      setTimerSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  // Écoute temps réel Socket
  useEffect(() => {
    if (!userId) return;
    try {
      connectSocket();
      joinUser(userId);
      onSessionStarted((data) => {
        if (data?.session) {
          setActiveSession(data.session);
          setTimerSeconds(0);
        }
      });
      onSessionEnded(() => {
        setActiveSession(null);
        setTimerSeconds(0);
      });
    } catch (_) {}

    return () => {
      try {
        disconnectSocket();
      } catch (_) {}
    };
  }, [userId]);

  // Terminer la session de travail
  const handleCheckOut = async () => {
    if (!activeSession) return;
    setCheckingOut(true);
    try {
      await sessionApi.checkOut({ session_id: activeSession.id });
      setActiveSession(null);
      setTimerSeconds(0);
      await loadCompanyData();
    } catch (err) {
      alert('Erreur libération de session : ' + err.message);
    } finally {
      setCheckingOut(false);
    }
  };

  // Télécharger reçu PDF
  const handleDownloadPdf = async (paymentId) => {
    setDownloadingId(paymentId);
    try {
      await paymentApi.downloadReceipt(paymentId);
    } catch (err) {
      alert('Erreur lors du téléchargement du reçu PDF : ' + err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  /* ── 4 KPIs ── */
  const activeBookings = useMemo(() => {
    return bookings.filter((b) => b.statut === 'confirmed' || b.statut === 'pending');
  }, [bookings]);

  const upcomingBookings = useMemo(() => {
    const now = new Date();
    return bookings
      .filter((b) => new Date(b.date_fin) > now && b.statut !== 'cancelled')
      .sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut))
      .slice(0, 5);
  }, [bookings]);

  const totalHistoryCount = bookings.length;
  const totalSpent = payments.filter((p) => p.statut === 'paid').reduce((acc, p) => acc + (parseFloat(p.montant) || 0), 0);

  const raisonSociale = companyOrg?.nom || metadata?.raison_sociale || `${profile?.prenom || ''} ${profile?.nom || ''}`.trim() || 'Mon Entreprise';
  const matricule = companyOrg?.matricule_fiscal || metadata?.matricule_fiscal || 'Non renseigné';

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="space-y-6">

        {/* ═══════════════════════════════════════════════════════════════════
            EN-TÊTE ESPACE ENTREPRISE (B2B)
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-6 sm:p-8 rounded-3xl shadow-xl border border-slate-700/50">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="px-3 py-1 rounded-full bg-orange-500/20 text-[#f95d00] border border-orange-500/35 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#f95d00] animate-pulse" />
                Espace Entreprise Dédié
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-white/90 text-xs font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">lock</span>
                Rôle FIXE
              </span>
            </div>
            <h1 className="font-sora text-2xl sm:text-3xl font-bold tracking-tight">
              {raisonSociale}
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm flex flex-wrap items-center gap-2 sm:gap-3">
              <span>MF : <strong className="text-white font-mono">{matricule}</strong></span>
              <span>·</span>
              <span>Interlocuteur : <strong>{profile?.prenom} {profile?.nom}</strong></span>
              <span>·</span>
              <span className="text-slate-400">{profile?.email}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/book/step1"
              className="px-5 py-3 rounded-xl bg-[#f95d00] hover:bg-[#e05300] text-white font-bold text-sm shadow-lg shadow-orange-500/25 flex items-center gap-2 transition-all active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">calendar_today</span>
              Réserver un espace B2B
            </Link>
            <Link
              to="/company/domiciliation"
              className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm border border-white/20 flex items-center gap-2 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">corporate_fare</span>
              Offres Domiciliation
            </Link>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            LES 4 KPIS OBLIGATOIRES (CDC DESKYWORK)
            1. Réservations actives
            2. Session de travail en cours (minuteur temps réel)
            3. Historique total
            4. Notifications non lues
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* KPI 1 : Réservations actives */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs hover:border-orange-300 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Réservations actives</span>
                <span className="w-9 h-9 rounded-xl bg-orange-50 text-[#f95d00] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">calendar_month</span>
                </span>
              </div>
              <div className="font-sora text-3xl font-bold text-slate-900 mt-1">
                {activeBookings.length}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
              <span>Confirmées & en attente</span>
              <Link to="/company/bookings" className="text-[#f95d00] font-bold hover:underline">Gérer →</Link>
            </p>
          </div>

          {/* KPI 2 : Session de travail en cours (minuteur temps réel) */}
          <div className={`rounded-3xl p-5 border shadow-xs transition-all flex flex-col justify-between ${
            activeSession
              ? 'bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border-emerald-300'
              : 'bg-white border-slate-200/80'
          }`}>
            <div>
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Session en cours</span>
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  activeSession ? 'bg-emerald-100 text-emerald-700 animate-pulse' : 'bg-slate-100 text-slate-500'
                }`}>
                  <span className="material-symbols-outlined text-[20px]">timer</span>
                </span>
              </div>
              {activeSession ? (
                <div>
                  <div className="font-mono text-2xl font-extrabold text-emerald-700 tracking-wider">
                    {formatTimer(timerSeconds)}
                  </div>
                  <p className="text-xs font-semibold text-slate-700 truncate mt-1">
                    {activeSession.espaces?.nom || activeSession.espace_nom || 'Poste de travail actif'}
                  </p>
                </div>
              ) : (
                <div>
                  <div className="font-sora text-xl font-bold text-slate-400">Aucune session</div>
                  <p className="text-xs text-slate-500 mt-1">Check-in disponible à l'accueil</p>
                </div>
              )}
            </div>
            <div className="text-xs mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
              {activeSession ? (
                <button
                  type="button"
                  onClick={handleCheckOut}
                  disabled={checkingOut}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[13px]">logout</span>
                  {checkingOut ? 'Libération…' : 'Terminer'}
                </button>
              ) : (
                <span className="text-slate-400">Minuteur automatique</span>
              )}
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                activeSession ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}>
                {activeSession ? 'Actif' : 'Inactif'}
              </span>
            </div>
          </div>

          {/* KPI 3 : Historique total */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs hover:border-indigo-300 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Historique total</span>
                <span className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">history</span>
                </span>
              </div>
              <div className="font-sora text-3xl font-bold text-slate-900 mt-1">
                {totalHistoryCount}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
              <span>{formatDT(totalSpent)} réglés</span>
              <Link to="/company/invoices" className="text-indigo-600 font-bold hover:underline">Reçus →</Link>
            </p>
          </div>

          {/* KPI 4 : Notifications non lues */}
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs hover:border-purple-300 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Notifications</span>
                <span className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center relative">
                  <span className="material-symbols-outlined text-[20px]">notifications</span>
                  {unreadNotifsCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#f95d00] text-white text-[9px] font-bold flex items-center justify-center">
                      {unreadNotifsCount}
                    </span>
                  )}
                </span>
              </div>
              <div className="font-sora text-3xl font-bold text-slate-900 mt-1">
                {unreadNotifsCount}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
              <span>{unreadNotifsCount > 0 ? 'Messages & alertes en attente' : 'Toutes les alertes lues'}</span>
              <Link to="/company/messages" className="text-purple-600 font-bold hover:underline">Voir →</Link>
            </p>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 1 : PROCHAINES RÉSERVATIONS (AVEC OBJET DU BESOIN & PARTENAIRE)
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-orange-50 text-[#f95d00] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">event_available</span>
                </span>
                <h2 className="font-sora text-lg font-bold text-slate-900">Prochaines réservations B2B</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Détail des créneaux réservés, établissement partenaire, capacité et objet du besoin.
              </p>
            </div>
            <Link
              to="/company/bookings"
              className="text-xs font-bold text-[#f95d00] hover:underline flex items-center gap-1.5"
            >
              <span>Voir tout l'historique</span>
              <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
            </Link>
          </div>

          {loading ? (
            <div className="p-10 text-center text-slate-400 text-sm">Chargement des réservations…</div>
          ) : upcomingBookings.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <span className="material-symbols-outlined text-4xl text-slate-300">event_busy</span>
              <p className="text-sm font-semibold text-slate-700">Aucune réservation à venir pour le moment.</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Réservez un bureau privatif ou une salle de réunion auprès de nos établissements partenaires sans frais supplémentaires.
              </p>
              <Link
                to="/book/step1"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#f95d00] text-white rounded-xl text-xs font-bold hover:bg-[#e05300] shadow-sm transition-all"
              >
                <span className="material-symbols-outlined text-[16px]">add_circle</span>
                Réserver un espace pour mon équipe
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/70 text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                    <th className="px-6 py-3.5">Établissement &amp; Espace</th>
                    <th className="px-6 py-3.5">Date &amp; Créneau</th>
                    <th className="px-6 py-3.5">Personnes &amp; Objet du besoin</th>
                    <th className="px-6 py-3.5">Montant HT</th>
                    <th className="px-6 py-3.5">Règlement</th>
                    <th className="px-6 py-3.5">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {upcomingBookings.map((b) => {
                    const tenantNom = b.tenants?.nom || b.espaces?.tenants?.nom || 'Établissement Partenaire';
                    const espaceNom = b.espaces?.nom || b.espace_nom || 'Espace de travail';
                    const objetBesoin = b.notes || b.objet_besoin || b.description || 'Séance de travail en équipe';

                    return (
                      <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-900">{espaceNom}</div>
                          <div className="text-[11px] text-[#f95d00] font-semibold flex items-center gap-1 mt-0.5">
                            <span className="material-symbols-outlined text-[13px]">apartment</span>
                            {tenantNom}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900">
                            {new Date(b.date_debut).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {new Date(b.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} -{' '}
                            {new Date(b.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="px-6 py-4 max-w-xs">
                          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[14px] text-slate-500">group</span>
                            {b.nb_personnes ? `${b.nb_personnes} personne${b.nb_personnes > 1 ? 's' : ''}` : 'Équipe'}
                          </div>
                          <div className="text-[11px] text-slate-500 italic truncate mt-0.5" title={objetBesoin}>
                            « {objetBesoin} »
                          </div>
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-900">
                          {formatDT(b.montant_total || 0)}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold">
                            <span className="material-symbols-outlined text-[12px]">payments</span>
                            Sur place
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            b.statut === 'confirmed' ? 'bg-emerald-100 text-emerald-800' :
                            b.statut === 'pending' ? 'bg-amber-100 text-amber-800' :
                            b.statut === 'cancelled' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-800'
                          }`}>
                            {b.statut === 'confirmed' ? 'Confirmée' : b.statut === 'pending' ? 'En attente' : b.statut}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 2 : ESPACES PROS CHEZ NOS PARTENAIRES
            (Bureaux privés, Salles de réunion, Domiciliation)
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-sora text-lg font-bold text-slate-900">Espaces pros chez nos partenaires</h2>
              <p className="text-xs text-slate-500">Des infrastructures certifiées pour vos collaborateurs et rendez-vous clients</p>
            </div>
            <Link to="/book/step1" className="text-xs font-bold text-[#f95d00] hover:underline">
              Explorer le catalogue →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Carte 1 : Bureaux privés & Flex Office */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-orange-100 text-[#f95d00] flex items-center justify-center group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-2xl">door_sliding</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#f95d00]">Postes &amp; Équipes</span>
                  <h3 className="font-sora font-bold text-base text-slate-900 mt-0.5">Bureaux privés &amp; Flex Office</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Espaces privatifs fermés et sécurisés pour vos équipes de 2 à 20 personnes. Fibre haut débit dédiée et accès 24/7.
                  </p>
                </div>
                <div className="text-xs text-slate-600 space-y-1 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-emerald-600">check_circle</span>
                    <span>Néro Coworking (Ennasr 2)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-emerald-600">check_circle</span>
                    <span>Thirty Three Space (Lac 2)</span>
                  </div>
                </div>
              </div>
              <div className="pt-4 mt-3 border-t border-slate-100">
                <Link
                  to="/book/step1?type=private_office"
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-[#f95d00] text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                  Réserver un bureau
                </Link>
              </div>
            </div>

            {/* Carte 2 : Salles de réunion & Boardrooms */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-2xl">co_present</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Comités &amp; Clients</span>
                  <h3 className="font-sora font-bold text-base text-slate-900 mt-0.5">Salles de réunion &amp; Boardrooms</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Écrans 4K interactifs, systèmes de visioconférence et insonorisation phonique pour vos présentations et séminaires.
                  </p>
                </div>
                <div className="text-xs text-slate-600 space-y-1 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-emerald-600">check_circle</span>
                    <span>De 4 à 25 personnes</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-emerald-600">check_circle</span>
                    <span>Café &amp; eau minérale inclus</span>
                  </div>
                </div>
              </div>
              <div className="pt-4 mt-3 border-t border-slate-100">
                <Link
                  to="/book/step1?type=meeting_room"
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-indigo-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">groups</span>
                  Réserver une salle
                </Link>
              </div>
            </div>

            {/* Carte 3 : Domiciliation (Siège Social) */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group">
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-2xl">apartment</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Siège Social B2B</span>
                  <h3 className="font-sora font-bold text-base text-slate-900 mt-0.5">Offres de domiciliation</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Établissez votre adresse légale et fiscale dans des quartiers d'affaires prestigieux avec gestion et numérisation du courrier.
                  </p>
                </div>
                <div className="text-xs text-slate-600 space-y-1 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-emerald-600">check_circle</span>
                    <span>Néro Ennasr 2 — dès 75 DT/mois</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-emerald-600">check_circle</span>
                    <span>Thirty Three Lac 2 — dès 85 DT/mois</span>
                  </div>
                </div>
              </div>
              <div className="pt-4 mt-3 border-t border-slate-100">
                <Link
                  to="/company/domiciliation"
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">corporate_fare</span>
                  Voir les formules
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 3 : DERNIÈRES FACTURES ÉMISES PAR LES ÉTABLISSEMENTS
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                </span>
                <h2 className="font-sora text-lg font-bold text-slate-900">Dernières factures émises par les établissements</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Factures et reçus comptables officiels au nom de votre société, payables sur place et téléchargeables en PDF.
              </p>
            </div>
            <Link
              to="/company/invoices"
              className="text-xs font-bold text-purple-600 hover:underline flex items-center gap-1.5"
            >
              <span>Consulter toutes les pièces</span>
              <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
            </Link>
          </div>

          {loading ? (
            <div className="p-10 text-center text-slate-400 text-sm">Chargement des pièces comptables…</div>
          ) : payments.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <span className="material-symbols-outlined text-3xl text-slate-300">receipt_long</span>
              <p className="text-sm font-semibold text-slate-700">Aucune facture enregistrée pour le moment.</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Vos reçus apparaîtront ici dès l'encaissement à l'accueil de l'établissement partenaire.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/70 text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                    <th className="px-6 py-3.5">Réf. Reçu</th>
                    <th className="px-6 py-3.5">Date</th>
                    <th className="px-6 py-3.5">Établissement Partenaire</th>
                    <th className="px-6 py-3.5">Montant HT / TTC</th>
                    <th className="px-6 py-3.5">Statut</th>
                    <th className="px-6 py-3.5 text-right">Télécharger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {payments.slice(0, 5).map((p) => {
                    const isPaid = p.statut === 'paid';
                    const ref = p.reference_recu || `REC-${p.id.slice(0, 8).toUpperCase()}`;
                    const tenantNom = p.reservations?.tenants?.nom || p.reservations?.espaces?.tenants?.nom || 'Établissement Partenaire';

                    return (
                      <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-mono font-bold text-slate-900">
                          {ref}
                        </td>
                        <td className="px-6 py-4 text-slate-600">
                          {new Date(p.created_at).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-6 py-4 font-semibold text-slate-900">
                          {tenantNom}
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-900">
                          {formatDT(p.montant || 0)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {isPaid ? 'Encaissée sur place' : 'En attente'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(p.id)}
                            disabled={downloadingId === p.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-[#f95d00] hover:text-white text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
                            title="Télécharger le reçu / facture PDF"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {downloadingId === p.id ? 'sync' : 'picture_as_pdf'}
                            </span>
                            {downloadingId === p.id ? 'PDF…' : 'PDF'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </PortalLayout>
  );
}
