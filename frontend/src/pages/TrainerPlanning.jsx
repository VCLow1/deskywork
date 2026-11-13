import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { formationApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import { exportEmargementToExcel } from '../utils/exportEmargementExcel';

const STATUT_STYLES = {
  planifiee: 'bg-amber-50 text-amber-800 border border-amber-200',
  en_cours: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  terminee: 'bg-sky-50 text-sky-800 border border-sky-200',
  annulee: 'bg-red-50 text-red-800 border border-red-200',
};
const STATUT_LABELS = {
  planifiee: 'Planifiée', en_cours: 'En cours', terminee: 'Terminée', annulee: 'Annulée',
};

export default function TrainerPlanning({ session }) {
  const [profile, setProfile] = useState(null);
  const [formations, setFormations] = useState([]);
  const [remunerations, setRemunerations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /* Emargement Modal */
  const [showEmargement, setShowEmargement] = useState(false);
  const [selectedFormation, setSelectedFormation] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [presenceSaving, setPresenceSaving] = useState(null); // userId being toggled

  useEffect(() => { loadUserData(); }, []);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4000);
    return () => clearTimeout(t);
  }, [success]);

  const loadUserData = async () => {
    try {
      setLoading(true);
      const { data: prof, error: e } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (e) throw e;
      if (prof.role !== 'formateur') throw new Error('Accès réservé aux formateurs.');
      setProfile(prof);
      await refreshData(prof.id);
    } catch (e) { setError(e.message); setLoading(false); }
  };

  const refreshData = async (trainerId) => {
    try {
      const id = trainerId || profile?.id;
      const [fList, remRes] = await Promise.all([
        formationApi.getAll({ formateur_id: id }),
        supabase.from('remuneration_formateurs')
          .select('*, formations(titre)')
          .eq('formateur_id', id)
          .order('created_at', { ascending: false }),
      ]);
      setFormations(fList.formations || []);
      setRemunerations(remRes.data || []);
    } catch (e) { setError('Erreur chargement : ' + e.message); }
    finally { setLoading(false); }
  };

  const openEmargement = async (formation) => {
    setSelectedFormation(formation);
    setError('');
    try {
      const res = await formationApi.getParticipants(formation.id);
      setParticipants(res.participants || []);
      setShowEmargement(true);
    } catch (err) { setError('Chargement inscrits : ' + err.message); }
  };

  const togglePresence = async (userId, current) => {
    setPresenceSaving(userId);
    try {
      await formationApi.marquerPresence(selectedFormation.id, userId, !current);
      const res = await formationApi.getParticipants(selectedFormation.id);
      setParticipants(res.participants || []);
    } catch (err) { setError(err.message); }
    finally { setPresenceSaving(null); }
  };

  const updateStatut = async (formationId, newStatut) => {
    if (!window.confirm(`Passer la formation en statut « ${STATUT_LABELS[newStatut]} » ?`)) return;
    try {
      await formationApi.update(formationId, { statut: newStatut });
      setSuccess('Statut mis à jour.');
      await refreshData();
    } catch (err) { setError(err.message); }
  };

  const downloadEmargement = async (formation) => {
    try {
      await formationApi.downloadEmargementPdf(formation.id, formation.titre);
    } catch (err) { alert("Erreur export feuille d'émargement PDF : " + err.message); }
  };

  const handleCancel = async (formation) => {
    if (!window.confirm(`Annuler la formation "${formation.titre}" ?`)) return;
    try {
      await formationApi.update(formation.id, { statut: 'annulee' });
      setSuccess('Formation annulée.');
      await refreshData();
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (formation) => {
    const label = formation.nb_inscrits > 0
      ? `Cette formation a ${formation.nb_inscrits} inscrit(s). Elle sera marquée "Annulée" plutôt que supprimée.\n\nContinuer ?`
      : `Supprimer définitivement "${formation.titre}" ?`;
    if (!window.confirm(label)) return;
    try {
      await formationApi.delete(formation.id);
      setSuccess(formation.nb_inscrits > 0 ? 'Formation marquée comme annulée.' : 'Formation supprimée.');
      await refreshData();
    } catch (err) { setError(err.message); }
  };

  const totalCourses = formations.length;
  const doneCourses = formations.filter(f => f.statut === 'terminee').length;
  const pendingRemu = remunerations.filter(r => r.statut === 'en_attente').reduce((s, r) => s + parseFloat(r.montant || 0), 0);
  const paidRemu = remunerations.filter(r => r.statut === 'paye').reduce((s, r) => s + parseFloat(r.montant || 0), 0);

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
    </div>
  );

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">

        {/* ── Header ── */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-7 h-7 rounded-lg bg-secondary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 16 }}>school</span>
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-secondary">Espace Formateur</span>
          </div>
          <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Mon Planning</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Bonjour {profile?.prenom} — Gérez vos sessions et l'émargement de vos participants.
          </p>
        </div>

        {/* ── Alertes ── */}
        {error && (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-2xl bg-red-50 text-red-800 border border-red-200 text-sm">
            <span className="material-symbols-outlined text-red-500 shrink-0" style={{ fontSize: 18 }}>error</span>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">
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

        {/* ── KPIs ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {[
            { label: 'Sessions de formation assignées', value: totalCourses, icon: 'event_note', color: 'text-secondary bg-secondary/10' },
            { label: 'Sessions de formation terminées', value: doneCourses, icon: 'task_alt', color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Honoraires attendus', value: `${pendingRemu.toFixed(3)} DT`, icon: 'pending_actions', color: 'text-amber-600 bg-amber-50' },
            { label: 'Honoraires reçus', value: `${paidRemu.toFixed(3)} DT`, icon: 'payments', color: 'text-sky-600 bg-sky-50' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="bg-surface-container-lowest rounded-3xl sm:rounded-3xl p-4 sm:p-5 border border-outline-variant/20 shadow-sm flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${color}`}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{icon}</span>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant leading-tight">{label}</p>
                <p className="font-sora font-bold text-primary text-xl leading-tight mt-0.5">{value}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ══ PLANNING ══ */}
          <div className="lg:col-span-2">
            <h2 className="font-sora font-semibold text-primary text-base mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>date_range</span>
              Mes formations
            </h2>

            {formations.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-10 text-center shadow-sm">
                <span className="material-symbols-outlined text-on-surface-variant/30 block mb-3" style={{ fontSize: 48 }}>event_busy</span>
                <p className="font-semibold text-primary mb-1">Aucune session assignée</p>
                <p className="text-sm text-on-surface-variant">L'administrateur vous assignera vos prochaines formations.</p>
              </div>
            ) : (
              <>
                {/* Mobile Cards */}
                <div className="sm:hidden space-y-3">
                  {formations.map((f) => (
                    <div key={f.id} className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-4 shadow-sm">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <h3 className="font-sora font-bold text-primary text-sm leading-snug flex-1">{f.titre}</h3>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUT_STYLES[f.statut]}`}>
                          {STATUT_LABELS[f.statut]}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-on-surface-variant mb-3">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>location_on</span>
                          {f.espaces?.nom || '—'}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>calendar_today</span>
                          {new Date(f.date_debut).toLocaleDateString('fr-FR')} · {new Date(f.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>group</span>
                          {f.nb_inscrits || 0} inscrits / {f.capacite_max}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 pt-2 border-t border-outline-variant/10">
                        {f.statut === 'planifiee' && (
                          <button onClick={() => updateStatut(f.id, 'en_cours')} title="Démarrer"
                            className="text-emerald-600 hover:text-emerald-700 active:scale-90 transition-all">
                            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>play_circle</span>
                          </button>
                        )}
                        {f.statut === 'en_cours' && (
                          <button onClick={() => updateStatut(f.id, 'terminee')} title="Clôturer"
                            className="text-secondary hover:text-secondary/70 active:scale-90 transition-all">
                            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>stop_circle</span>
                          </button>
                        )}
                        <button onClick={() => openEmargement(f)} title="Émargement"
                          className="text-secondary hover:text-secondary/70 active:scale-90 transition-all">
                          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>assignment</span>
                        </button>
                        <button onClick={() => downloadEmargement(f)} title="Exporter"
                          className="text-slate-400 hover:text-slate-600 active:scale-90 transition-all">
                          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>download</span>
                        </button>
                        <button onClick={() => handleCancel(f)} title="Annuler la formation"
                          className="text-amber-500 hover:text-amber-700 active:scale-90 transition-all">
                          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>cancel</span>
                        </button>
                        <button onClick={() => handleDelete(f)} title="Supprimer"
                          className="text-red-400 hover:text-red-600 active:scale-90 transition-all ml-auto">
                          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table */}
                <div className="hidden sm:block bg-surface-container-lowest rounded-3xl border border-outline-variant/20 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider border-b border-outline-variant/20">
                          <th className="p-4">Formation</th>
                          <th className="p-4">Salle</th>
                          <th className="p-4">Date & Horaire</th>
                          <th className="p-4">Inscrits</th>
                          <th className="p-4">Statut</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {formations.map((f) => (
                          <tr key={f.id} className="hover:bg-surface-container-lowest transition-colors">
                            <td className="p-4 font-semibold text-primary">
                              <div className="break-words leading-snug">{f.titre}</div>
                            </td>
                            <td className="p-4 text-xs text-on-surface-variant">{f.espaces?.nom || '—'}</td>
                            <td className="p-4 text-xs">
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1 text-on-surface-variant">
                                  <span>{new Date(f.date_debut).toLocaleDateString('fr-FR')}</span>
                                  <span className="font-medium text-primary">{new Date(f.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="flex items-center gap-1 text-on-surface-variant">
                                  <span>{new Date(f.date_fin).toLocaleDateString('fr-FR')}</span>
                                  <span className="font-medium text-primary">{new Date(f.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-1">
                                <span className="font-bold text-primary">{f.nb_inscrits || 0}</span>
                                <span className="text-on-surface-variant text-xs">/ {f.capacite_max}</span>
                              </div>
                              <div className="h-1 w-14 rounded-full bg-outline-variant/20 mt-1">
                                <div className="h-1 rounded-full bg-secondary" style={{ width: `${Math.min(100, ((f.nb_inscrits || 0) / f.capacite_max) * 100)}%` }} />
                              </div>
                            </td>
                            <td className="p-4">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUT_STYLES[f.statut]}`}>
                                {STATUT_LABELS[f.statut]}
                              </span>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center justify-end gap-3">
                                {/* Démarrer */}
                                {f.statut === 'planifiee' && (
                                  <button
                                    onClick={() => updateStatut(f.id, 'en_cours')}
                                    title="Démarrer la formation"
                                    className="text-emerald-600 hover:text-emerald-700 active:scale-90 transition-all"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>play_circle</span>
                                  </button>
                                )}
                                {/* Clôturer */}
                                {f.statut === 'en_cours' && (
                                  <button
                                    onClick={() => updateStatut(f.id, 'terminee')}
                                    title="Clôturer la formation"
                                    className="text-secondary hover:text-secondary/70 active:scale-90 transition-all"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>stop_circle</span>
                                  </button>
                                )}
                                {/* Émargement */}
                                <button
                                  onClick={() => openEmargement(f)}
                                  title="Feuille d'émargement"
                                  className="text-secondary hover:text-secondary/70 active:scale-90 transition-all"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>assignment</span>
                                </button>
                                {/* Télécharger */}
                                <button
                                  onClick={() => downloadEmargement(f)}
                                  title="Exporter la liste"
                                  className="text-slate-400 hover:text-slate-600 active:scale-90 transition-all"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>download</span>
                                </button>
                                {/* Annuler */}
                                <button
                                  onClick={() => handleCancel(f)}
                                  title="Annuler la formation"
                                  className="text-amber-500 hover:text-amber-700 active:scale-90 transition-all"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>cancel</span>
                                </button>
                                {/* Supprimer */}
                                <button
                                  onClick={() => handleDelete(f)}
                                  title="Supprimer / Annuler la formation"
                                  className="text-red-400 hover:text-red-600 active:scale-90 transition-all"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ══ HONORAIRES ══ */}
          <div>
            <h2 className="font-sora font-semibold text-primary text-base mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>payments</span>
              Mes honoraires
            </h2>

            <div className="space-y-3">
              {remunerations.length === 0 ? (
                <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-6 text-center shadow-sm">
                  <span className="material-symbols-outlined text-on-surface-variant/30 block mb-2" style={{ fontSize: 36 }}>account_balance_wallet</span>
                  <p className="text-sm text-on-surface-variant">Aucun honoraire enregistré.</p>
                  <p className="text-xs text-on-surface-variant/60 mt-1">L'admin les ajoutera après vos sessions.</p>
                </div>
              ) : (
                remunerations.map((r) => (
                  <div key={r.id} className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-4 shadow-sm">
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <h4 className="font-semibold text-primary text-xs leading-snug line-clamp-1 flex-1">
                        {r.formations?.titre || 'Honoraires'}
                      </h4>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${r.statut === 'paye' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                        {r.statut === 'paye' ? 'Payé' : 'En attente'}
                      </span>
                    </div>
                    <p className="font-sora font-bold text-emerald-700 text-lg mb-1">{parseFloat(r.montant || 0).toFixed(3)} DT</p>
                    <p className="text-[10px] text-on-surface-variant">
                      {r.date_versement
                        ? `Versé le ${new Date(r.date_versement).toLocaleDateString('fr-FR')}`
                        : `Enregistré le ${new Date(r.created_at).toLocaleDateString('fr-FR')}`}
                    </p>
                    {r.note && <p className="text-[10px] italic text-on-surface-variant mt-0.5 truncate">Note : {r.note}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══ MODAL ÉMARGEMENT ══ */}
      {showEmargement && selectedFormation && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowEmargement(false)} />
          <div className="relative w-full sm:max-w-xl bg-surface-container-lowest rounded-4xl shadow-2xl flex flex-col max-h-[90vh]"
            style={{ animation: 'slideUp 0.25s cubic-bezier(.4,0,.2,1)' }}>
            <div className="p-5 border-b border-outline-variant/20 flex justify-between items-start bg-gradient-to-br from-surface-container-low to-white">
              <div>
                <span className="text-[9px] font-bold tracking-widest uppercase text-secondary bg-secondary/8 px-2 py-0.5 rounded-full">
                  Feuille d'émargement
                </span>
                <h2 className="font-sora font-bold text-lg text-primary mt-1 leading-snug">{selectedFormation.titre}</h2>
                <p className="text-xs text-on-surface-variant">
                  {new Date(selectedFormation.date_debut).toLocaleDateString('fr-FR')} · Cochez les présences
                </p>
              </div>
              <button onClick={() => setShowEmargement(false)} className="w-8 h-8 rounded-xl hover:bg-surface-container flex items-center justify-center text-on-surface-variant">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {participants.length === 0 ? (
                <div className="text-center py-8">
                  <span className="material-symbols-outlined text-on-surface-variant/30 block mb-2" style={{ fontSize: 36 }}>person_off</span>
                  <p className="text-sm text-on-surface-variant">Aucun inscrit pour cet atelier.</p>
                </div>
              ) : (
                <div className="border border-outline-variant/20 rounded-3xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-container-low text-on-surface-variant font-semibold">
                        <th className="p-3 text-left">Participant</th>
                        <th className="p-3 text-left hidden sm:table-cell">Email</th>
                        <th className="p-3 text-center">Présent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {participants.map((p) => (
                        <tr key={p.id} className="hover:bg-surface-container-lowest transition-colors">
                          <td className="p-3">
                            <p className="font-semibold text-primary">{p.profiles?.prenom} {p.profiles?.nom}</p>
                            <p className="text-on-surface-variant text-[10px] sm:hidden">{p.profiles?.email}</p>
                          </td>
                          <td className="p-3 text-on-surface-variant hidden sm:table-cell">{p.profiles?.email}</td>
                          <td className="p-3 text-center">
                            {presenceSaving === p.user_id ? (
                              <span className="animate-spin inline-block h-4 w-4 border-2 border-secondary border-t-transparent rounded-full" />
                            ) : (
                              <input
                                type="checkbox"
                                checked={p.present || false}
                                onChange={() => togglePresence(p.user_id, p.present)}
                                className="w-5 h-5 rounded cursor-pointer accent-secondary"
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-outline-variant/20 flex gap-3">
              <button onClick={() => downloadEmargement(selectedFormation)} className="flex items-center gap-1.5 px-4 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-xs hover:bg-surface-container">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
                Export JSON
              </button>
              <button onClick={() => setShowEmargement(false)} className="flex-1 py-2.5 bg-primary text-white font-semibold rounded-xl text-sm hover:bg-primary/90">
                Fermer
              </button>
            </div>
          </div>
          <style>{`
            @keyframes slideUp {
              from { transform: translateY(100%); opacity: 0; }
              to   { transform: translateY(0);    opacity: 1; }
            }
            @media (min-width: 640px) {
              @keyframes slideUp {
                from { transform: scale(.95); opacity: 0; }
                to   { transform: scale(1);   opacity: 1; }
              }
            }
          `}</style>
        </div>
      )}
    </PortalLayout>
  );
}
