import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { formationApi, bookingApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';

const ITEMS_PER_PAGE = 10;

/* ─── Shared helpers ─────────────────────────────────────────────────────── */
const inputCls =
  'w-full px-4 py-2.75 rounded-2xl border border-slate-200 text-sm text-slate-800 bg-slate-50 ' +
  'focus:outline-none focus:ring-4 focus:ring-orange-100 focus:border-orange-300 transition-all shadow-sm ' +
  'placeholder:text-slate-400';

function Field({ label, required, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
        {required && <span className="text-orange-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

/* ─── Centered Popup Modal ───────────────────────────────────────────────── */
function Modal({ open, onClose, title, subtitle, icon, children, footer, maxWidth = 'max-w-3xl' }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[2px]"
        onClick={onClose}
        style={{ animation: 'fadeIn 0.2s ease' }}
      />

      <div
        className={`relative w-full ${maxWidth} mx-auto bg-white rounded-3xl shadow-[0_24px_80px_rgba(15,23,42,0.18)] border border-slate-200/80 flex flex-col max-h-[90vh] overflow-hidden`}
        style={{ animation: 'popIn 0.25s cubic-bezier(.34,1.56,.64,1)' }}
      >
        <div className="flex items-start justify-between gap-3 sm:gap-4 p-4 sm:p-5 border-b border-slate-200 bg-gradient-to-r from-white via-orange-50/30 to-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center shrink-0 shadow-sm shadow-orange-200">
                <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>{icon}</span>
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-sora font-bold text-slate-900 text-xl sm:text-2xl leading-tight">{title}</h2>
              {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-xl">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors flex-shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">{children}</div>

        {footer && (
          <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 shrink-0">
            {footer}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn   {
          from { transform: scale(.95) translateY(10px); opacity: 0; }
          to   { transform: scale(1)   translateY(0);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE : ADMIN FORMATEURS
═══════════════════════════════════════════════════════════════════════════ */
export default function AdminFormateurs({ session }) {
  const [profile, setProfile] = useState(null);
  const [formateurs, setFormateurs] = useState([]);
  const [remunerations, setRemunerations] = useState([]);
  const [formations, setFormations] = useState([]); // needed for remuneration select
  const [trainerBookings, setTrainerBookings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [pageFormateurs, setPageFormateurs] = useState(1);
  const [pageRemus, setPageRemus] = useState(1);

  /* ─── Modals ─── */
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRemuModal, setShowRemuModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedFormateur, setSelectedFormateur] = useState(null);

  /* ─── Forms ─── */
  const emptyFormateur = { nom: '', prenom: '', email: '', telephone: '', specialite: '', biographie: '' };
  const [formateurForm, setFormateurForm] = useState(emptyFormateur);
  const [remuForm, setRemuForm] = useState({
    formateur_id: '', formation_id: '', montant: '', statut: 'en_attente', note: '',
  });

  /* ─── Load ─── */
  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4000);
    return () => clearTimeout(t);
  }, [success]);

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: prof, error: e } = await supabase
        .from('profiles').select('*').eq('id', session.user.id).single();
      if (e) throw e;
      if (!['super_admin', 'admin', 'staff'].includes(prof.role)) throw new Error('Accès non autorisé.');
      setProfile(prof);
      await refreshData();
    } catch (e) { setError(e.message); setLoading(false); }
  };

  const refreshData = async () => {
    try {
      const [tRes, rRes, fRes, bookingsRes] = await Promise.all([
        formationApi.getFormateurs(),
        supabase.from('remuneration_formateurs')
          .select('*, profiles!formateur_id(nom, prenom), formations(titre)')
          .order('created_at', { ascending: false }),
        formationApi.getAll(),
        bookingApi.getAll(),
      ]);

      const rawFormateurs = tRes.formateurs || [];
      const bookingsMap = {};
      for (const booking of bookingsRes.reservations || []) {
        const owner = booking.profiles || {};
        if (owner.role !== 'formateur' || !booking.user_id) continue;
        if (!bookingsMap[booking.user_id]) bookingsMap[booking.user_id] = [];
        bookingsMap[booking.user_id].push(booking);
      }

      const mergedFormateurs = [...rawFormateurs];
      for (const booking of bookingsRes.reservations || []) {
        const owner = booking.profiles || {};
        if (owner.role !== 'formateur' || !booking.user_id) continue;
        if (!mergedFormateurs.some((p) => p.id === booking.user_id)) {
          mergedFormateurs.push({
            id: booking.user_id,
            nom: owner.nom || '',
            prenom: owner.prenom || '',
            email: owner.email || '',
            telephone: owner.telephone || '',
            specialite: '',
            biographie: '',
            statut_compte: 'actif',
            created_at: booking.created_at || new Date().toISOString(),
          });
        }
      }

      setFormateurs(mergedFormateurs.sort((a, b) => (a.nom || '').localeCompare(b.nom || '')));
      setRemunerations(rRes.data || []);
      setFormations(fRes.formations || []);
      setTrainerBookings(bookingsMap);
    } catch (e) { setError('Erreur chargement : ' + e.message); }
    finally { setLoading(false); }
  };

  /* ─── Actions ─── */
  const handleCreateFormateur = async (e) => {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      await formationApi.createFormateur(formateurForm);
      setSuccess(`Formateur ${formateurForm.prenom} ${formateurForm.nom} créé avec succès.`);
      setFormateurForm(emptyFormateur);
      setShowCreateModal(false);
      await refreshData();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleToggleStatus = async (id, current) => {
    const next = current === 'actif' ? 'suspendu' : 'actif';
    if (!window.confirm(`Passer ce formateur en statut « ${next} » ?`)) return;
    try {
      await formationApi.updateFormateur(id, { statut_compte: next });
      setSuccess('Statut mis à jour.');
      await refreshData();
    } catch (err) { setError(err.message); }
  };

  const handleOpenRemu = (formateurId) => {
    setRemuForm({ formateur_id: formateurId, formation_id: '', montant: '', statut: 'en_attente', note: '' });
    setShowRemuModal(true);
  };

  const handleSaveRemu = async (e) => {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      await formationApi.addRemuneration(remuForm.formateur_id, {
        formation_id: remuForm.formation_id || null,
        montant: parseFloat(remuForm.montant),
        statut: remuForm.statut,
        note: remuForm.note || null,
        date_versement: remuForm.statut === 'paye' ? new Date().toISOString() : null,
      });
      setSuccess('Rémunération enregistrée.');
      setShowRemuModal(false);
      await refreshData();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleMarkPaid = async (id) => {
    if (!window.confirm('Confirmer le versement et marquer comme payé ?')) return;
    try {
      const { error: e } = await supabase
        .from('remuneration_formateurs')
        .update({ statut: 'paye', date_versement: new Date().toISOString() })
        .eq('id', id);
      if (e) throw e;
      setSuccess('Rémunération réglée.');
      await refreshData();
    } catch (err) { setError(err.message); }
  };

  /* ─── KPIs ─── */
  const actifs = formateurs.filter(f => f.statut_compte === 'actif').length;
  const pending = remunerations.filter(r => r.statut === 'en_attente').reduce((s, r) => s + parseFloat(r.montant || 0), 0);
  const paid = remunerations.filter(r => r.statut === 'paye').reduce((s, r) => s + parseFloat(r.montant || 0), 0);

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
    </div>
  );

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
                <span className="material-symbols-outlined text-violet-600" style={{ fontSize: 16 }}>school</span>
              </span>
              <span className="text-xs font-bold uppercase tracking-widest text-slate-800">Gestion Formateurs</span>
            </div>
            <h1 className="font-sora font-bold text-slate-900 text-2xl sm:text-3xl">Formateurs</h1>
            <p className="text-sm text-on-surface-variant mt-0.5">Gérer vos intervenants et leurs honoraires.</p>
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {[
            { label: 'Total formateurs', value: formateurs.length, icon: 'group', color: 'text-slate-800 bg-slate-100' },
            { label: 'Comptes actifs', value: actifs, icon: 'check_circle', color: 'text-emerald-700 bg-emerald-50' },
            { label: 'Payouts en attente', value: `${pending.toFixed(3)} DT`, icon: 'pending_actions', color: 'text-amber-700 bg-amber-50' },
            { label: 'Payouts payés', value: `${paid.toFixed(3)} DT`, icon: 'payments', color: 'text-slate-800 bg-slate-100' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-outline-variant/20 shadow-sm flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${color}`}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{icon}</span>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant leading-tight">{label}</p>
                <p className="font-sora font-bold text-slate-900 text-xl leading-tight mt-0.5">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Alertes ── */}
        {error && (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-2xl bg-red-50 text-red-800 border border-red-200 text-sm">
            <span className="material-symbols-outlined text-red-500 shrink-0" style={{ fontSize: 18 }}>error</span>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        )}
        {success && (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-sm">
            <span className="material-symbols-outlined text-emerald-500 shrink-0" style={{ fontSize: 18 }}>check_circle</span>
            <span>{success}</span>
          </div>
        )}

        {/* ════════════════════ LISTE FORMATEURS ════════════════════ */}
        {formateurs.length === 0 ? (
          <div className="bg-white rounded-3xl border border-outline-variant/20 p-12 text-center shadow-sm">
            <div className="w-16 h-16 rounded-3xl bg-surface-container-low flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 32 }}>person_off</span>
            </div>
            <h3 className="font-sora font-bold text-slate-900 text-base mb-2">Aucun formateur enregistré</h3>
            <p className="text-sm text-on-surface-variant mb-6">Aucun formateur n'a encore été ajouté à cet espace.</p>
          </div>
        ) : (
          <>
            <div className="mb-8 overflow-hidden rounded-3xl border border-outline-variant/20 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-[11px] font-bold uppercase tracking-wider text-on-surface-variant border-b border-outline-variant/20">
                      <th className="p-4">Formateur</th>
                      <th className="p-4">Contact</th>
                      <th className="p-4">Spécialité</th>
                      <th className="p-4">Réservations</th>
                      <th className="p-4">Statut</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10 text-sm">
                    {formateurs.slice((pageFormateurs - 1) * ITEMS_PER_PAGE, pageFormateurs * ITEMS_PER_PAGE).map((t) => {
                      const initials = (t.prenom?.[0] || '') + (t.nom?.[0] || '');
                      const remu = remunerations.filter(r => r.profiles && r.profiles.nom === t.nom && r.profiles.prenom === t.prenom);
                      const pending = remu.filter(r => r.statut === 'en_attente').reduce((s, r) => s + parseFloat(r.montant || 0), 0);
                      const reservations = trainerBookings[t.id] || [];
                      const reservationLabel = reservations.length > 0
                        ? `${reservations.length} ${reservations.length > 1 ? 'réservations' : 'réservation'}`
                        : 'Aucune réservation';

                      return (
                        <tr key={t.id} className="hover:bg-surface-container-low/40 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 flex items-center justify-center font-sora font-bold text-slate-800 text-sm shrink-0">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <p className="font-sora font-bold text-slate-900 truncate">{t.prenom} {t.nom}</p>
                                <p className="text-xs text-on-surface-variant truncate">{t.email || '—'}</p>
                              </div>
                            </div>
                          </td>

                          <td className="p-4 text-xs text-on-surface-variant">
                            <div className="flex flex-col gap-1">
                              <span>{t.telephone || '—'}</span>
                              <span>{t.email || '—'}</span>
                            </div>
                          </td>

                          <td className="p-4">
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-800 px-2.5 py-1 text-[10px] font-semibold">
                              <span className="material-symbols-outlined" style={{ fontSize: 11 }}>star</span>
                              {t.specialite || '—'}
                            </span>
                          </td>

                          <td className="p-4">
                            <div className="inline-flex items-center gap-2 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2 text-orange-800 shadow-sm">
                              <span className="material-symbols-outlined text-base" style={{ fontSize: 16 }}>event</span>
                              <div>
                                <div className="text-[9px] font-bold uppercase tracking-[0.12em] opacity-75">Réservations</div>
                                <div className="text-sm font-bold leading-tight">{reservations.length}</div>
                              </div>
                            </div>
                          </td>

                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                              t.statut_compte === 'actif' ? 'bg-emerald-100 text-emerald-800'
                                : t.statut_compte === 'en_attente' ? 'bg-amber-100 text-amber-800'
                                  : 'bg-red-100 text-red-800'
                            }`}>
                              <span className="material-symbols-outlined" style={{ fontSize: 11 }}>
                                {t.statut_compte === 'actif' ? 'check_circle' : t.statut_compte === 'en_attente' ? 'hourglass_top' : 'block'}
                              </span>
                              {t.statut_compte === 'actif' ? 'Validé' : t.statut_compte === 'en_attente' ? 'En attente (Pending)' : 'Suspendu'}
                            </span>
                          </td>

                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleOpenRemu(t.id)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>payments</span>
                                Rémunérer
                              </button>
                              <button
                                onClick={() => { setSelectedFormateur(t); setShowDetailModal(true); }}
                                className="inline-flex items-center justify-center rounded-xl border border-outline-variant/30 p-2 text-on-surface-variant hover:bg-surface-container"
                                title="Voir les honoraires"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>receipt_long</span>
                              </button>
                              <button
                                onClick={() => handleToggleStatus(t.id, t.statut_compte)}
                                className={`inline-flex items-center justify-center rounded-xl border p-2 ${t.statut_compte === 'actif' ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                                title={t.statut_compte === 'actif' ? 'Suspendre' : 'Activer'}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.statut_compte === 'actif' ? 'block' : 'check_circle'}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={pageFormateurs}
                totalItems={formateurs.length}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setPageFormateurs}
                label="formateurs"
              />
            </div>

            {/* ════════════════════ TABLEAU HONORAIRES ════════════════════ */}
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-sora font-semibold text-slate-900 text-base flex items-center gap-2">
                <span className="material-symbols-outlined text-slate-700" style={{ fontSize: 18 }}>payments</span>
                Historique des rémunérations
              </h2>
              <button
                onClick={() => { setRemuForm({ formateur_id: '', formation_id: '', montant: '', statut: 'en_attente', note: '' }); setShowRemuModal(true); }}
                className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 font-semibold rounded-xl text-xs hover:bg-emerald-50"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add</span>
                Nouvelle rémunération
              </button>
            </div>

            {remunerations.length === 0 ? (
              <div className="bg-white rounded-3xl border border-outline-variant/20 p-8 text-center shadow-sm text-on-surface-variant text-sm">
                Aucune rémunération enregistrée.
              </div>
            ) : (
              <>
                {/* Mobile */}
                <div className="sm:hidden space-y-3">
                  {remunerations.slice((pageRemus - 1) * ITEMS_PER_PAGE, pageRemus * ITEMS_PER_PAGE).map((r) => (
                    <div key={r.id} className="bg-white rounded-3xl border border-outline-variant/20 p-4 shadow-sm">
                      <div className="flex justify-between items-start mb-1.5">
                        <p className="font-semibold text-slate-900 text-sm">{r.profiles?.prenom} {r.profiles?.nom}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${r.statut === 'paye' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                          {r.statut === 'paye' ? 'Payé' : 'En attente'}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mb-1">{r.formations?.titre || 'Honoraires'}</p>
                      <p className="font-bold text-emerald-700 text-lg mb-2">{parseFloat(r.montant || 0).toFixed(3)} DT</p>
                      {r.statut === 'en_attente' && (
                        <button onClick={() => handleMarkPaid(r.id)} className="w-full py-2 text-xs font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700">
                          Marquer comme payé
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop */}
                <div className="hidden sm:block bg-white rounded-3xl border border-outline-variant/20 overflow-hidden shadow-sm">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider border-b border-outline-variant/20">
                        <th className="p-4">Formateur</th>
                        <th className="p-4">Formation / Motif</th>
                        <th className="p-4">Montant</th>
                        <th className="p-4">Statut</th>
                        <th className="p-4">Versement</th>
                        <th className="p-4">Note</th>
                        <th className="p-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {remunerations.slice((pageRemus - 1) * ITEMS_PER_PAGE, pageRemus * ITEMS_PER_PAGE).map((r) => (
                        <tr key={r.id} className="hover:bg-surface-container-lowest transition-colors group">
                          <td className="p-4 font-semibold text-slate-900">{r.profiles?.prenom} {r.profiles?.nom}</td>
                          <td className="p-4 text-xs text-on-surface-variant">{r.formations?.titre || '—'}</td>
                          <td className="p-4 font-bold text-emerald-700">{parseFloat(r.montant || 0).toFixed(3)} DT</td>
                          <td className="p-4">
                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border ${r.statut === 'paye'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}>
                              {r.statut === 'paye' ? '✓ Payé' : '⏳ En attente'}
                            </span>
                          </td>
                          <td className="p-4 text-xs text-on-surface-variant">
                            {r.date_versement ? new Date(r.date_versement).toLocaleDateString('fr-FR') : '—'}
                          </td>
                          <td className="p-4 text-xs italic text-on-surface-variant max-w-[140px]">
                            <div className="truncate">{r.note || '—'}</div>
                          </td>
                          <td className="p-4 text-right">
                            {r.statut === 'en_attente' && (
                              <button
                                onClick={() => handleMarkPaid(r.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 ml-auto px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>check</span>
                                Marquer payé
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination
                    currentPage={pageRemus}
                    totalItems={remunerations.length}
                    itemsPerPage={ITEMS_PER_PAGE}
                    onPageChange={setPageRemus}
                    label="rémunérations"
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          POPUP : CRÉER UN FORMATEUR
      ══════════════════════════════════════════════════════════════ */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Créer un formateur"
        subtitle="Un compte sera créé avec le rôle formateur dans Supabase Auth"
        icon="person_add"
        maxWidth="max-w-lg"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="flex-1 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-sm hover:bg-surface-container transition-colors"
            >
              Annuler
            </button>
            <button
              form="createFormateurForm"
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 bg-secondary text-white font-semibold rounded-xl text-sm hover:bg-secondary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {saving && <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
              Créer le formateur
            </button>
          </div>
        }
      >
        <form id="createFormateurForm" onSubmit={handleCreateFormateur} className="space-y-4">
          <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 text-sky-800 text-xs flex items-start gap-2">
            <span className="material-symbols-outlined text-sky-500 shrink-0" style={{ fontSize: 16 }}>info</span>
            Un email d'invitation sera envoyé au formateur avec ses informations de connexion.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Prénom" required>
              <input className={inputCls} placeholder="Alice" required value={formateurForm.prenom}
                onChange={e => setFormateurForm(p => ({ ...p, prenom: e.target.value }))} />
            </Field>
            <Field label="Nom" required>
              <input className={inputCls} placeholder="Martin" required value={formateurForm.nom}
                onChange={e => setFormateurForm(p => ({ ...p, nom: e.target.value }))} />
            </Field>
          </div>

          <Field label="Email professionnel" required>
            <input type="email" className={inputCls} placeholder="formateur@email.com" required value={formateurForm.email}
              onChange={e => setFormateurForm(p => ({ ...p, email: e.target.value }))} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Téléphone">
              <input className={inputCls} placeholder="+216 XX XXX XXX" value={formateurForm.telephone}
                onChange={e => setFormateurForm(p => ({ ...p, telephone: e.target.value }))} />
            </Field>
            <Field label="Spécialité / Domaine">
              <input className={inputCls} placeholder="UX Design, React..." value={formateurForm.specialite}
                onChange={e => setFormateurForm(p => ({ ...p, specialite: e.target.value }))} />
            </Field>
          </div>

          <Field label="Biographie courte">
            <textarea className={inputCls} rows={3}
              placeholder="Parcours, compétences clés du formateur..."
              value={formateurForm.biographie}
              onChange={e => setFormateurForm(p => ({ ...p, biographie: e.target.value }))} />
          </Field>

          {error && showCreateModal && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
          )}
        </form>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════
          POPUP : NOUVELLE RÉMUNÉRATION
      ══════════════════════════════════════════════════════════════ */}
      <Modal
        open={showRemuModal}
        onClose={() => setShowRemuModal(false)}
        title="Enregistrer une rémunération"
        subtitle="Saisir les honoraires d'un formateur pour une session"
        icon="payments"
        maxWidth="max-w-md"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setShowRemuModal(false)}
              className="flex-1 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-sm">
              Annuler
            </button>
            <button form="remuForm" type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl text-sm hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
              Enregistrer
            </button>
          </div>
        }
      >
        <form id="remuForm" onSubmit={handleSaveRemu} className="space-y-5">
          <div className="rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 p-3.5">
            <div className="flex items-center gap-2 text-emerald-800">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>info</span>
              <span className="text-xs font-semibold uppercase tracking-[0.08em]">Rémunération</span>
            </div>
            <p className="mt-1 text-sm text-slate-700">Enregistrez le montant dû pour cette session ou pour un forfait global.</p>
          </div>

          <div className="grid gap-4">
            <Field label="Formateur" required>
              <select className={inputCls} required value={remuForm.formateur_id}
                onChange={e => setRemuForm(p => ({ ...p, formateur_id: e.target.value }))}>
                <option value="">— Choisir un formateur —</option>
                {formateurs.map(t => <option key={t.id} value={t.id}>{t.prenom} {t.nom}</option>)}
              </select>
            </Field>

            <Field label="Formation concernée">
              <select className={inputCls} value={remuForm.formation_id}
                onChange={e => setRemuForm(p => ({ ...p, formation_id: e.target.value }))}>
                <option value="">— Honoraires généraux —</option>
                {formations.map(f => <option key={f.id} value={f.id}>{f.titre}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Montant (DT)" required>
                <input type="number" min={0} step="0.5" className={inputCls} placeholder="150.00" required
                  value={remuForm.montant} onChange={e => setRemuForm(p => ({ ...p, montant: e.target.value }))} />
              </Field>

              <Field label="Statut du versement">
                <select className={inputCls} value={remuForm.statut}
                  onChange={e => setRemuForm(p => ({ ...p, statut: e.target.value }))}>
                  <option value="en_attente">En attente</option>
                  <option value="paye">Versé</option>
                </select>
              </Field>
            </div>

            <Field label="Note / Référence">
              <input className={inputCls} placeholder="Ex: Virement N° 00123"
                value={remuForm.note} onChange={e => setRemuForm(p => ({ ...p, note: e.target.value }))} />
            </Field>
          </div>

          {error && showRemuModal && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
          )}
        </form>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════
          POPUP : DÉTAIL FORMATEUR (honoraires)
      ══════════════════════════════════════════════════════════════ */}
      <Modal
        open={showDetailModal && !!selectedFormateur}
        onClose={() => setShowDetailModal(false)}
        title={selectedFormateur ? `${selectedFormateur.prenom} ${selectedFormateur.nom}` : ''}
        subtitle="Historique des rémunérations"
        icon="receipt_long"
        maxWidth="max-w-lg"
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => { setShowDetailModal(false); handleOpenRemu(selectedFormateur?.id); }}
              className="flex-1 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl text-sm hover:bg-emerald-700"
            >
              + Nouvelle rémunération
            </button>
            <button onClick={() => setShowDetailModal(false)}
              className="flex-1 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-sm">
              Fermer
            </button>
          </div>
        }
      >
        {selectedFormateur && (() => {
          const myRemu = remunerations.filter(r =>
            r.profiles?.nom === selectedFormateur.nom && r.profiles?.prenom === selectedFormateur.prenom
          );
          const total = myRemu.reduce((s, r) => s + parseFloat(r.montant || 0), 0);
          return myRemu.length === 0 ? (
            <p className="text-sm text-center text-on-surface-variant py-4 italic">Aucune rémunération pour ce formateur.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-surface-container-low rounded-2xl text-sm">
                <span className="text-on-surface-variant font-medium">Total cumulé</span>
                <span className="font-sora font-bold text-primary">{total.toFixed(3)} DT</span>
              </div>
              {myRemu.map(r => (
                <div key={r.id} className="flex items-center justify-between p-3.5 border border-outline-variant/20 rounded-2xl">
                  <div>
                    <p className="text-sm font-semibold text-primary">{r.formations?.titre || 'Honoraires'}</p>
                    <p className="text-xs text-on-surface-variant">
                      {r.date_versement
                        ? `Versé le ${new Date(r.date_versement).toLocaleDateString('fr-FR')}`
                        : `Le ${new Date(r.created_at).toLocaleDateString('fr-FR')}`}
                    </p>
                    {r.note && <p className="text-xs italic text-on-surface-variant mt-0.5">{r.note}</p>}
                  </div>
                  <div className="text-right ml-4">
                    <p className="font-bold text-emerald-700">{parseFloat(r.montant || 0).toFixed(3)} DT</p>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${r.statut === 'paye' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                      {r.statut === 'paye' ? 'Payé' : 'En attente'}
                    </span>
                    {r.statut === 'en_attente' && (
                      <button onClick={() => handleMarkPaid(r.id)}
                        className="block mt-1 text-[10px] font-semibold text-emerald-700 hover:underline">
                        Marquer payé
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </Modal>
    </PortalLayout>
  );
}
