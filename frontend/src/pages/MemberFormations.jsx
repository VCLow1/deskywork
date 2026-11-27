import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { formationApi, paymentApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';

const ITEMS_PER_PAGE = 10;

const STATUT_INSCRIPTION_LABELS = {
  confirmee: 'Confirmée',
  en_attente: 'En attente',
  annulee: 'Annulée',
};

export default function MemberFormations({ session }) {
  const [profile, setProfile] = useState(null);
  const [formations, setFormations] = useState([]);
  const [myInscriptions, setMyInscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedFormation, setSelectedFormation] = useState(null);
  const [paymentModalFormation, setPaymentModalFormation] = useState(null);
  const [selectedPaymentMode, setSelectedPaymentMode] = useState('sur_place'); // 'sur_place' | 'online'
  const [saving, setSaving] = useState(null); // formation id being acted on
  const [pageCatalogue, setPageCatalogue] = useState(1);
  const [pageInscriptions, setPageInscriptions] = useState(1);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterCity, setFilterCity] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDate, setFilterDate] = useState('');
  const [filterDispo, setFilterDispo] = useState('all');
  const navigate = useNavigate();

  useEffect(() => { loadUserData(); }, []);

  /* ─── Auto-dismiss success ─── */
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 6000);
    return () => clearTimeout(t);
  }, [success]);

  const loadUserData = async () => {
    try {
      setLoading(true);
      const { data: prof, error: e } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (e) throw e;
      setProfile(prof);
      await refreshData();
    } catch (e) { setError(e.message); setLoading(false); }
  };

  const refreshData = async () => {
    try {
      const [fList, myList] = await Promise.all([
        formationApi.getAll({}),
        formationApi.getMesFormations(),
      ]);
      setFormations(fList.formations || []);
      setMyInscriptions(myList.inscriptions || []);
    } catch (e) { setError('Erreur chargement : ' + e.message); }
    finally { setLoading(false); }
  };

  const handleOpenRegister = (formation) => {
    if (formation.prix_inscription > 0) {
      setSelectedPaymentMode('sur_place');
      setPaymentModalFormation(formation);
    } else {
      executeRegister(formation.id, 'sur_place');
    }
  };

  const executeRegister = async (formationId, mode = 'sur_place') => {
    setError(''); setSaving(formationId);
    try {
      const res = await formationApi.inscrire(formationId, { mode });
      const f = formations.find(x => x.id === formationId) || paymentModalFormation;
      setPaymentModalFormation(null);

      if (res.liste_attente) {
        setSuccess("Session de formation complète — vous avez été ajouté en liste d'attente !");
      } else if (f?.prix_inscription > 0) {
        setSuccess("Inscription confirmée ! Règlement à effectuer sur place (espèces, chèque ou virement) lors de votre arrivée.");
      } else {
        setSuccess('Inscription confirmée avec succès !');
      }
      await refreshData();
    } catch (err) {
      setError(err.message || 'Une erreur est survenue lors de l\'inscription.');
    } finally {
      setSaving(null);
    }
  };

  const handleUnregister = async (formationId) => {
    if (!window.confirm('Annuler votre inscription à cette formation ?')) return;
    setError(''); setSaving(formationId);
    try {
      await formationApi.desinscrire(formationId);
      setSuccess('Inscription annulée.');
      await refreshData();
    } catch (err) { setError(err.message); }
    finally { setSaving(null); }
  };

  const isInscribed = (formationId) =>
    myInscriptions.some(m => m.formation_id === formationId && m.statut !== 'annulee');

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
    </div>
  );

  const activeInscriptions = myInscriptions.filter(m => m.statut !== 'annulee');

  const availableCities = Array.from(new Set(formations.map(f => f.ville || f.espaces?.ville || f.etablissement).filter(Boolean)));
  const availableCategories = Array.from(new Set(formations.map(f => f.categorie || f.thematique || f.specialite || (f.espaces ? f.espaces.type : '')).filter(Boolean)));

  const filteredFormations = formations.filter((f) => {
    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase();
      const matchTitle = (f.titre || '').toLowerCase().includes(q);
      const matchDesc = (f.description || '').toLowerCase().includes(q);
      const matchTrainer = (f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : '').toLowerCase().includes(q);
      const matchEspace = (f.espaces?.nom || '').toLowerCase().includes(q);
      if (!matchTitle && !matchDesc && !matchTrainer && !matchEspace) return false;
    }
    if (filterCity !== 'all') {
      const city = (f.ville || f.espaces?.ville || f.etablissement || '').toLowerCase();
      if (!city.includes(filterCity.toLowerCase())) return false;
    }
    if (filterCategory !== 'all') {
      const cat = (f.categorie || f.thematique || f.specialite || (f.espaces ? f.espaces.type : '')).toLowerCase();
      if (!cat.includes(filterCategory.toLowerCase())) return false;
    }
    if (filterStatus !== 'all') {
      if (f.statut !== filterStatus) return false;
    }
    if (filterDate) {
      const fDate = new Date(f.date_debut).toISOString().slice(0, 10);
      if (fDate !== filterDate) return false;
    }
    if (filterDispo === 'available_only') {
      const rem = f.places_restantes ?? (f.capacite_max - (f.nb_inscrits || 0));
      if (rem <= 0) return false;
    }
    return true;
  });

  const pagedFormations = filteredFormations.slice((pageCatalogue - 1) * ITEMS_PER_PAGE, pageCatalogue * ITEMS_PER_PAGE);
  const pagedInscriptions = activeInscriptions.slice((pageInscriptions - 1) * ITEMS_PER_PAGE, pageInscriptions * ITEMS_PER_PAGE);

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">

        {/* ── Header ── */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-7 h-7 rounded-lg bg-secondary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 16 }}>school</span>
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-secondary">Espace Formation</span>
          </div>
          <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Formations &amp; Ateliers</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Inscrivez-vous à nos ateliers et sessions de formation professionnelle.
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
            <div className="flex-1">
              <span>{success}</span>
              {success.includes('paiement') && (
                <button onClick={() => navigate('/member/payments')} className="ml-3 underline font-semibold text-emerald-900 text-xs">
                  Voir mes reçus →
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ══ CATALOGUE ══ */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-sora font-semibold text-primary text-base flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>explore</span>
                Ateliers &amp; Formations
                <span className="text-xs font-bold text-secondary bg-secondary/10 px-2 py-0.5 rounded-full ml-1">
                  {filteredFormations.length} / {formations.length}
                </span>
              </h2>
            </div>

            {/* Barre de filtres complète CDC v3.0 */}
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-3.5 shadow-xs space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {/* Recherche mot-clé */}
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant/50 text-[18px]">search</span>
                  <input
                    type="text"
                    value={filterSearch}
                    onChange={(e) => { setFilterSearch(e.target.value); setPageCatalogue(1); }}
                    placeholder="Mot-clé, titre, formateur…"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-outline-variant/30 bg-surface-container-low text-primary focus:outline-none focus:border-secondary"
                  />
                </div>

                {/* Ville / Lieu */}
                <div>
                  <select
                    value={filterCity}
                    onChange={(e) => { setFilterCity(e.target.value); setPageCatalogue(1); }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-outline-variant/30 bg-surface-container-low text-primary focus:outline-none focus:border-secondary"
                  >
                    <option value="all">Toutes les villes / Établissements</option>
                    {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* Catégorie / Thématique */}
                <div>
                  <select
                    value={filterCategory}
                    onChange={(e) => { setFilterCategory(e.target.value); setPageCatalogue(1); }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-outline-variant/30 bg-surface-container-low text-primary focus:outline-none focus:border-secondary"
                  >
                    <option value="all">Toutes catégories / Thématiques</option>
                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* Statut */}
                <div>
                  <select
                    value={filterStatus}
                    onChange={(e) => { setFilterStatus(e.target.value); setPageCatalogue(1); }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-outline-variant/30 bg-surface-container-low text-primary focus:outline-none focus:border-secondary"
                  >
                    <option value="all">Tous les statuts</option>
                    <option value="planifiee">Planifiée / Publiée</option>
                    <option value="en_cours">En cours</option>
                    <option value="terminee">Terminée</option>
                    <option value="annulee">Annulée</option>
                  </select>
                </div>

                {/* Date */}
                <div>
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => { setFilterDate(e.target.value); setPageCatalogue(1); }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-outline-variant/30 bg-surface-container-low text-primary focus:outline-none focus:border-secondary"
                  />
                </div>

                {/* Disponibilité */}
                <div>
                  <select
                    value={filterDispo}
                    onChange={(e) => { setFilterDispo(e.target.value); setPageCatalogue(1); }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-outline-variant/30 bg-surface-container-low text-primary focus:outline-none focus:border-secondary font-medium"
                  >
                    <option value="all">Toutes disponibilités</option>
                    <option value="available_only">Places disponibles uniquement</option>
                  </select>
                </div>
              </div>

              {(filterSearch || filterCity !== 'all' || filterCategory !== 'all' || filterStatus !== 'all' || filterDate || filterDispo !== 'all') && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => {
                      setFilterSearch('');
                      setFilterCity('all');
                      setFilterCategory('all');
                      setFilterStatus('all');
                      setFilterDate('');
                      setFilterDispo('all');
                      setPageCatalogue(1);
                    }}
                    className="text-xs text-secondary font-bold hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">refresh</span>
                    Réinitialiser les filtres
                  </button>
                </div>
              )}
            </div>

            {filteredFormations.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-10 text-center shadow-sm">
                <span className="material-symbols-outlined text-on-surface-variant/30 block mb-3" style={{ fontSize: 48 }}>search_off</span>
                <p className="font-semibold text-primary mb-1">Aucune formation ne correspond à vos filtres</p>
                <p className="text-sm text-on-surface-variant">Modifiez vos critères ou réinitialisez les filtres.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {pagedFormations.map((f) => {
                    const enrolled = isInscribed(f.id);
                    const isSaving = saving === f.id;
                    const isFull = (f.places_restantes ?? (f.capacite_max - (f.nb_inscrits || 0))) <= 0;

                    return (
                      <div
                        key={f.id}
                        className={`bg-surface-container-lowest rounded-3xl border flex flex-col transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${enrolled ? 'border-secondary/30 bg-secondary/[0.01]' : 'border-outline-variant/20'
                          }`}
                      >
                        {/* Top color bar */}
                        <div className={`h-1 rounded-t-3xl ${enrolled ? 'bg-secondary' : isFull ? 'bg-amber-400' : 'bg-outline-variant/20'}`} />

                        <div className="p-5 flex flex-col flex-1">
                          {/* Badges */}
                          <div className="flex justify-between items-center gap-2 mb-3">
                            <span className="text-xs font-bold uppercase tracking-widest text-secondary bg-secondary/8 px-2 py-0.5 rounded-full truncate max-w-[140px]">
                              {f.espaces?.nom || 'Atelier'}
                            </span>
                            <span className={`text-xs font-bold shrink-0 ${f.prix_inscription > 0 ? 'text-primary' : (f.est_gratuit || f.programme?.includes('[SESSION_GRATUITE]')) ? 'text-emerald-600' : 'text-slate-400 italic'}`}>
                              {f.prix_inscription > 0
                                ? `${Number(f.prix_inscription).toFixed(3)} DT`
                                : (f.est_gratuit || f.programme?.includes('[SESSION_GRATUITE]'))
                                ? 'Gratuit'
                                : 'Non défini'}
                            </span>
                          </div>

                          <h3 className="font-sora font-bold text-primary text-base leading-snug mb-1.5">{f.titre}</h3>
                          <p className="text-xs text-on-surface-variant line-clamp-2 mb-4">{f.description || 'Aucune description.'}</p>

                          {/* Info lines */}
                          <div className="space-y-1.5 text-xs text-on-surface-variant mb-4 mt-auto">
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>person</span>
                              <span>{f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : 'Formateur'}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>calendar_today</span>
                              <span>
                                {new Date(f.date_debut).toLocaleDateString('fr-FR')} · {new Date(f.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — {new Date(f.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>group</span>
                              <span>
                                <strong className={isFull ? 'text-amber-600' : 'text-primary'}>
                                  {f.places_restantes ?? (f.capacite_max - (f.nb_inscrits || 0))}
                                </strong>
                                &nbsp;place{(f.places_restantes ?? 0) > 1 ? 's' : ''} disponible{(f.places_restantes ?? 0) > 1 ? 's' : ''}
                                <span className="text-on-surface-variant"> / {f.capacite_max}</span>
                              </span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex gap-2 pt-3 border-t border-outline-variant/10">
                            <button
                              onClick={() => setSelectedFormation(f)}
                              className="flex-1 py-2 border border-outline-variant/30 text-on-surface-variant font-semibold rounded-xl text-xs hover:bg-surface-container transition-colors"
                            >
                              Programme
                            </button>
                            {enrolled ? (
                              <button
                                disabled
                                className="flex-1 py-2 bg-emerald-50 text-emerald-700 font-semibold rounded-xl text-xs border border-emerald-200 flex items-center justify-center gap-1"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>check_circle</span>
                                Inscrit
                              </button>
                            ) : (
                              <button
                                onClick={() => handleOpenRegister(f)}
                                disabled={isSaving}
                                className="flex-1 py-2 bg-secondary text-white font-semibold rounded-xl text-xs hover:bg-secondary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1"
                              >
                                {isSaving
                                  ? <span className="animate-spin h-3 w-3 border border-white border-t-transparent rounded-full" />
                                  : isFull ? "Liste d'attente" : "S'inscrire"
                                }
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Pagination
                  currentPage={pageCatalogue}
                  totalItems={formations.length}
                  itemsPerPage={ITEMS_PER_PAGE}
                  onPageChange={setPageCatalogue}
                  label="formations"
                />
              </>
            )}
          </div>

          {/* ══ MES INSCRIPTIONS ══ */}
          <div>
            <h2 className="font-sora font-semibold text-primary text-base mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>assignment_turned_in</span>
              Mes inscriptions
              {activeInscriptions.length > 0 && (
                <span className="text-xs font-bold text-secondary bg-secondary/10 px-2 py-0.5 rounded-full ml-1">
                  {activeInscriptions.length}
                </span>
              )}
            </h2>

            <div className="space-y-3">
              {activeInscriptions.length === 0 ? (
                <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-6 text-center shadow-sm">
                  <span className="material-symbols-outlined text-on-surface-variant/30 block mb-2" style={{ fontSize: 36 }}>event_busy</span>
                  <p className="text-sm text-on-surface-variant">Aucune inscription.</p>
                  <p className="text-xs text-on-surface-variant/60 mt-1">Choisissez un atelier dans le catalogue.</p>
                </div>
              ) : (
                pagedInscriptions.map((my) => {
                  const item = my.formations;
                  if (!item) return null;
                  const isSaving = saving === item.id;
                  const paymentMode = my.paiements?.mode || 'cash';
                  const isOnSite = paymentMode === 'cash' || paymentMode === 'sur_place';

                  return (
                    <div key={my.id} className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-4 shadow-sm hover:border-secondary/20 transition-colors">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <h4 className="font-semibold text-primary text-sm leading-snug line-clamp-2 flex-1">{item.titre}</h4>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${my.statut === 'confirmee' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                          {STATUT_INSCRIPTION_LABELS[my.statut] || my.statut}
                        </span>
                      </div>

                      <div className="space-y-1 text-xs text-on-surface-variant mb-3">
                        <div className="flex items-center gap-1">
                          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>person</span>
                          {item.profiles ? `${item.profiles.prenom} ${item.profiles.nom}` : 'Formateur'}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>calendar_today</span>
                          {new Date(item.date_debut).toLocaleDateString('fr-FR')} à {new Date(item.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>

                      {/* Mode & Paiement badges */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-3 pt-2 border-t border-outline-variant/10">
                        {item.prix_inscription > 0 ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-semibold text-on-surface-variant">Mode :</span>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200">
                              Sur place
                            </span>
                          </div>
                        ) : (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${(my.formations?.est_gratuit || my.formations?.programme?.includes('[SESSION_GRATUITE]')) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                            {(my.formations?.est_gratuit || my.formations?.programme?.includes('[SESSION_GRATUITE]')) ? 'Gratuit' : 'Tarif non défini'}
                          </span>
                        )}

                        <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${my.statut_paiement === 'paye' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                            my.statut_paiement === 'gratuit' ? 'bg-gray-100 text-gray-600' :
                              'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                          {my.statut_paiement === 'paye' ? 'Payé' : my.statut_paiement === 'gratuit' ? 'Gratuit' : 'À régler sur place'}
                        </span>
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-outline-variant/10">
                        <button
                          onClick={() => handleUnregister(item.id)}
                          disabled={isSaving}
                          className="flex-1 py-1.5 border border-error/30 text-error font-semibold rounded-lg text-xs hover:bg-error/5 disabled:opacity-50"
                        >
                          {isSaving ? '...' : 'Annuler'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
              <Pagination
                currentPage={pageInscriptions}
                totalItems={activeInscriptions.length}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setPageInscriptions}
                label="inscriptions"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal Inscription & Choix Mode de Paiement (Sur place / En ligne) ── */}
      {paymentModalFormation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setPaymentModalFormation(null)} />
          <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-outline-variant/10 animate-fade-in">
            {/* Header Modal */}
            <div className="p-6 bg-surface-container-low border-b border-outline-variant/20 flex justify-between items-start">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-secondary bg-secondary/10 px-2.5 py-1 rounded-full">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>payments</span>
                  Modalités de paiement
                </span>
                <h3 className="font-sora font-bold text-xl text-primary mt-2">
                  Inscription à la formation
                </h3>
                <p className="text-xs text-on-surface-variant mt-0.5">{paymentModalFormation.titre}</p>
              </div>
              <button
                onClick={() => setPaymentModalFormation(null)}
                className="w-8 h-8 rounded-full border border-outline-variant/30 flex items-center justify-center text-on-surface-variant hover:bg-surface-hover transition"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>

            {/* Corps Modal */}
            <div className="p-6 space-y-5">
              {/* Récapitulatif Tarif */}
              <div className="p-4 rounded-2xl bg-secondary/5 border border-secondary/20 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-on-surface-variant">Frais d'inscription</p>
                  <p className="text-sm text-primary font-medium mt-0.5">
                    {paymentModalFormation.profiles ? `${paymentModalFormation.profiles.prenom} ${paymentModalFormation.profiles.nom}` : 'Formateur'} · {paymentModalFormation.espaces?.nom || 'Salle de formation'}
                  </p>
                </div>
                <span className="text-2xl font-sora font-bold text-secondary">
                  {parseFloat(paymentModalFormation.prix_inscription || 0).toFixed(3)} DT
                </span>
              </div>

              {/* Mode de règlement CDC v3.0 D1 : 100 % sur place */}
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                <strong>Règlement à effectuer sur place</strong> (espèces, chèque ou virement) lors de votre arrivée à l'établissement. Un reçu PDF numéroté vous sera remis après encaissement.
              </div>
            </div>

            {/* Footer Modal */}
            <div className="p-5 bg-surface-container border-t border-outline-variant/20 flex gap-3">
              <button
                onClick={() => setPaymentModalFormation(null)}
                className="flex-1 py-3 border border-outline-variant/30 text-on-surface-variant font-semibold rounded-2xl text-xs hover:bg-surface-hover transition"
              >
                Annuler
              </button>
              <button
                onClick={() => executeRegister(paymentModalFormation.id, 'sur_place')}
                disabled={saving === paymentModalFormation.id}
                className="flex-1 py-3 bg-secondary text-white font-semibold rounded-2xl text-xs hover:bg-secondary/90 transition shadow-md flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                {saving === paymentModalFormation.id ? (
                  <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
                    Confirmer l'inscription
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Programme ── */}
      {selectedFormation && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setSelectedFormation(null)} />
          <div className="relative w-full max-w-3xl bg-surface-container-lowest rounded-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-outline-variant/10">
            <div className="p-5 sm:p-6 border-b border-outline-variant/20 flex justify-between items-start gap-4">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-secondary bg-secondary/10 px-3 py-1 rounded-full">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>view_carousel</span>
                  Programme
                </span>
                <h2 className="font-sora font-bold text-xl sm:text-2xl text-primary mt-4 leading-tight line-clamp-2">
                  {selectedFormation.titre}
                </h2>
              </div>
              <button
                onClick={() => setSelectedFormation(null)}
                className="h-10 w-10 rounded-3xl border border-outline-variant/20 bg-surface-container flex items-center justify-center text-on-surface-variant hover:bg-surface-hover transition"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6 space-y-6">
              <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-2">Description</p>
                    <p className="text-sm leading-6 text-primary">{selectedFormation.description || 'Aucune description fournie pour ce workshop.'}</p>
                  </div>

                  {selectedFormation.programme && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-2">Déroulement</p>
                      <div className="space-y-3 text-sm leading-6 text-primary">
                        {selectedFormation.programme.split('\n').map((line, index) => (
                          <p key={index} className="break-words">{line || '\u00A0'}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4 rounded-3xl bg-surface-container-lowest border border-outline-variant/10 p-4 sm:p-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-2">Détails</p>
                    <ul className="space-y-3 text-sm text-primary">
                      <li className="flex items-start gap-3">
                        <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>person</span>
                        <span>{selectedFormation.profiles ? `${selectedFormation.profiles.prenom} ${selectedFormation.profiles.nom}` : 'Formateur'}</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>calendar_today</span>
                        <span>{new Date(selectedFormation.date_debut).toLocaleDateString('fr-FR')} · {new Date(selectedFormation.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — {new Date(selectedFormation.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>people</span>
                        <span>{selectedFormation.places_restantes ?? (selectedFormation.capacite_max - (selectedFormation.nb_inscrits || 0))} / {selectedFormation.capacite_max} places disponibles</span>
                      </li>
                      {selectedFormation.prerequis && (
                        <li className="flex items-start gap-3">
                          <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>checklist_rtl</span>
                          <span>{selectedFormation.prerequis}</span>
                        </li>
                      )}
                      {selectedFormation.materiel && (
                        <li className="flex items-start gap-3">
                          <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>inventory_2</span>
                          <span>{selectedFormation.materiel}</span>
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 sm:p-5 border-t border-outline-variant/20 bg-surface-container">
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => setSelectedFormation(null)}
                  className="flex-1 py-3 border border-outline-variant/30 text-on-surface-variant font-semibold rounded-2xl text-sm hover:bg-surface-hover transition"
                >
                  Fermer
                </button>
                {!isInscribed(selectedFormation.id) && (
                  <button
                    onClick={() => {
                      const f = selectedFormation;
                      setSelectedFormation(null);
                      handleOpenRegister(f);
                    }}
                    className="flex-1 py-3 bg-secondary text-white font-semibold rounded-2xl text-sm hover:bg-secondary/90 transition"
                  >
                    S'inscrire
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
