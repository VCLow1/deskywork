import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { formationApi, bookingApi, tenantAdminApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import { formatDateDMY, formatTime24h } from '../utils/format';
import { validateTunisianPhone, normalizeTunisianPhone } from '../utils/tunisianPhone';
import TunisianPhoneInput from '../components/common/TunisianPhoneInput';
import Money from '../components/common/Money';

const ITEMS_PER_PAGE = 10;

/* ─── Constants ─────────────────────────────────────────────────────────── */
const STATUT_STYLES = {
  planifiee: 'bg-amber-50 text-amber-800 border border-amber-200',
  publiee: 'bg-[#fff4ed] text-[#c2410c] border border-[#f95d00]/30',
  complete: 'bg-purple-50 text-purple-800 border border-purple-200',
  en_cours: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  terminee: 'bg-slate-100 text-slate-700 border border-slate-200',
  annulee: 'bg-red-50 text-red-800 border border-red-200',
};
const STATUT_LABELS = {
  planifiee: 'Planifiée',
  publiee: 'Publiée',
  complete: 'Complète',
  en_cours: 'En cours',
  terminee: 'Terminée',
  annulee: 'Annulée',
};

/* ─── Reusable Input ─────────────────────────────────────────────────────── */
const Field = ({ label, required, children }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
      {label}{required && <span className="text-error ml-0.5">*</span>}
    </label>
    {children}
  </div>
);
const inputCls = "w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/40 text-sm text-primary bg-white focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition-all placeholder:text-on-surface-variant/50";

/* ─── Centered Popup Modal ─────────────────────────────────────────────── */
function Modal({ open, onClose, title, subtitle, icon, children, footer, maxWidth = 'max-w-3xl' }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full ${maxWidth} mx-auto bg-white rounded-3xl sm:rounded-4xl shadow-[0_40px_120px_rgba(15,23,42,0.18)] flex flex-col max-h-[92vh] overflow-hidden`}
        style={{ animation: 'popIn 0.22s cubic-bezier(.34,1.56,.64,1)' }}
      >
        <div className="flex flex-col gap-3 sm:gap-4 p-4 sm:p-7 border-b border-outline-variant/15 bg-slate-50 shrink-0">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-3 sm:gap-4">
              {icon && (
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl sm:rounded-3xl bg-secondary/10 flex items-center justify-center shrink-0 shadow-sm">
                  <span className="material-symbols-outlined text-secondary" style={{ fontSize: 22 }}>{icon}</span>
                </div>
              )}
              <div className="min-w-0">
                <h2 className="font-sora font-bold text-primary text-xl sm:text-3xl leading-tight">{title}</h2>
                {subtitle && <p className="text-xs sm:text-sm text-on-surface-variant mt-1 sm:mt-2 max-w-2xl">{subtitle}</p>}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl sm:rounded-3xl hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors shrink-0"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-7 space-y-4 sm:space-y-7">{children}</div>

        {footer && (
          <div className="p-4 sm:p-6 border-t border-outline-variant/15 bg-surface-container-low rounded-b-[24px] sm:rounded-b-[32px] shrink-0">{footer}</div>
        )}
      </div>

      <style>{`
        @keyframes popIn {
          from { transform: scale(.95) translateY(10px); opacity: 0; }
          to   { transform: scale(1)   translateY(0);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ─── Small Dialog Modal ─────────────────────────────────────────────────── */
function Dialog({ open, onClose, title, children, footer, maxWidth = 'max-w-xl' }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`relative w-full ${maxWidth} mx-auto bg-surface-container-lowest rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden min-h-0`}
        style={{ animation: 'scaleIn 0.2s cubic-bezier(.4,0,.2,1)' }}
      >
        <div className="flex items-center justify-between gap-4 p-5 border-b border-outline-variant/20">
          <h2 className="font-sora font-bold text-primary text-base">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-surface-container flex items-center justify-center text-on-surface-variant">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">{children}</div>
        {footer && <div className="p-4 border-t border-outline-variant/20">{footer}</div>}
      </div>
      <style>{`
        @keyframes scaleIn {
          from { transform: scale(.95); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function AdminFormations({ session }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialUrlTab = (() => {
    const t = searchParams.get('tab');
    if (t === 'inscrits') return 'inscrits';
    if (t === 'formateurs') return 'formateurs';
    if (t === 'versements') return 'remunerations';
    return 'formations';
  })();
  /* ─── State ─── */
  const [profile, setProfile] = useState(null);
  const [moduleActif, setModuleActif] = useState(true);
  const [formations, setFormations] = useState([]);
  const [formateurs, setFormateurs] = useState([]);
  const [salles, setSalles] = useState([]);
  const [remunerations, setRemunerations] = useState([]);
  const [inscritsAll, setInscritsAll] = useState([]);
  const [activeTab, setActiveTab] = useState(initialUrlTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pageFormations, setPageFormations] = useState(1);
  const [pageFormateurs, setPageFormateurs] = useState(1);

  /* ─── Filters for Formations ─── */
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');
  const [filterFormateur, setFilterFormateur] = useState('all');
  const [filterDate, setFilterDate] = useState('');
  const [filterDispo, setFilterDispo] = useState('all');

  /* ─── Modals ─── */
  const [showFormationDrawer, setShowFormationDrawer] = useState(false);
  const [showFormateurDrawer, setShowFormateurDrawer] = useState(false);
  const [showRemunerationDialog, setShowRemunerationDialog] = useState(false);
  const [showParticipantsDialog, setShowParticipantsDialog] = useState(false);

  /* ─── Selected items ─── */
  const [selectedFormation, setSelectedFormation] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [waitingList, setWaitingList] = useState([]);

  /* ─── Forms ─── */
  const emptyFormation = {
    id: '', titre: '', description: '', formateur_id: '', espace_id: '',
    date_debut: '', date_fin: '', capacite_max: 15, prix_inscription: 0,
    programme: '', prerequis: '', materiel: '', statut: 'planifiee',
  };
  const [formationForm, setFormationForm] = useState(emptyFormation);
  const [formateurForm, setFormateurForm] = useState({ nom: '', prenom: '', email: '', telephone: '', specialite: '', biographie: '' });
  const [remunerationForm, setRemunerationForm] = useState({ formateur_id: '', formation_id: '', montant: '', statut: 'en_attente', note: '' });
  const [formSaving, setFormSaving] = useState(false);

  /* ─── Load ─── */
  useEffect(() => { loadUserData(); }, []);

  const loadUserData = async () => {
    try {
      setLoading(true);
      const { data: prof, error: e } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (e) throw e;
      if (!['super_admin', 'admin', 'staff'].includes(prof.role)) throw new Error('Accès non autorisé.');
      setProfile(prof);
      await refreshData();
    } catch (e) { setError(e.message); setLoading(false); }
  };

  const refreshData = async () => {
    try {
      setError('');
      const [fList, tList, sList, rList, tRes, insRes] = await Promise.all([
        formationApi.getAll(),
        formationApi.getFormateurs(),
        bookingApi.getEspaces(),
        supabase.from('remuneration_formateurs')
          .select('*, profiles!formateur_id(nom, prenom), formations(titre)')
          .order('created_at', { ascending: false }),
        tenantAdminApi.getTenant().catch(() => null),
        supabase.from('inscriptions_formations')
          .select('id, formation_id, statut, statut_paiement, created_at, profiles:user_id(nom, prenom, email, telephone), formations(titre, date_debut)')
          .order('created_at', { ascending: false }),
      ]);
      if (tRes?.tenant?.settings?.module_formations_actif === false) {
        setModuleActif(false);
      } else {
        setModuleActif(true);
      }
      setFormations(fList.formations || []);
      setFormateurs(tList.formateurs || []);
      setSalles((sList.espaces || []).filter(e =>
        ['training_room', 'meeting_room', 'event_space', 'salle', 'open_space'].includes(e.type)
      ));
      setRemunerations(rList.data || []);
      setInscritsAll(insRes?.data || []);
    } catch (e) { setError('Erreur chargement : ' + e.message); }
    finally { setLoading(false); }
  };

  /* ─── Auto-dismiss success ─── */
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4000);
    return () => clearTimeout(t);
  }, [success]);

  /* ─── Formation Actions ─── */
  const openCreateFormation = () => {
    // La création de formation est réservée aux formateurs depuis leur espace
    // Cette fonction est conservée uniquement pour l'ouverture du drawer de modification
    setFormationForm({ ...emptyFormation });
    setSelectedFormation(null);
    setShowFormationDrawer(true);
  };
  const openEditFormation = (f) => {
    setSelectedFormation(f);
    setFormationForm({
      id: f.id, titre: f.titre || '', description: f.description || '',
      formateur_id: f.formateur_id || '', espace_id: f.espace_id || '',
      date_debut: f.date_debut ? new Date(f.date_debut).toISOString().slice(0, 16) : '',
      date_fin: f.date_fin ? new Date(f.date_fin).toISOString().slice(0, 16) : '',
      capacite_max: f.capacite_max || 15, prix_inscription: f.prix_inscription || 0,
      programme: f.programme || '', prerequis: f.prerequis || '',
      materiel: f.materiel || '', statut: f.statut || 'planifiee',
    });
    setShowFormationDrawer(true);
  };
  const saveFormation = async (e) => {
    e.preventDefault(); setError(''); setFormSaving(true);
    try {
      if (!formationForm.id) {
        setError('La création de formation est réservée aux formateurs depuis leur espace.');
        setFormSaving(false);
        return;
      }
      const payload = {
        ...formationForm,
        capacite_max: parseInt(formationForm.capacite_max),
        prix_inscription: parseFloat(formationForm.prix_inscription),
        date_debut: new Date(formationForm.date_debut).toISOString(),
        date_fin: new Date(formationForm.date_fin).toISOString(),
      };
      await formationApi.update(formationForm.id, payload);
      setSuccess('Formation modifiée avec succès.');
      setShowFormationDrawer(false);
      await refreshData();
    } catch (err) { setError(err.message); }
    finally { setFormSaving(false); }
  };
  const cancelFormation = async (id) => {
    if (!window.confirm('Annuler / supprimer cette formation ?')) return;
    try {
      const res = await formationApi.delete(id);
      setSuccess(res.message || 'Formation annulée.');
      await refreshData();
    } catch (err) { setError(err.message); }
  };

  const approveFormation = async (f) => {
    try {
      await formationApi.update(f.id, { statut: 'publiee' });
      setSuccess(`Formation « ${f.titre} » et sa réservation de salle approuvées avec succès !`);
      await refreshData();
    } catch (err) {
      setError(err.message || "Erreur lors de l'approbation.");
    }
  };

  const refuseFormation = async (f) => {
    if (!window.confirm(`Refuser la demande de formation « ${f.titre} » et libérer la salle ?`)) return;
    try {
      await formationApi.update(f.id, { statut: 'annulee' });
      setSuccess(`Formation « ${f.titre} » refusée.`);
      await refreshData();
    } catch (err) {
      setError(err.message || 'Erreur lors du refus.');
    }
  };

  /* ─── Formateur Actions ─── */
  const saveFormateur = async (e) => {
    e.preventDefault(); setError('');
    if (formateurForm.telephone && formateurForm.telephone.trim()) {
      const check = validateTunisianPhone(formateurForm.telephone);
      if (!check.valid) {
        setError(check.error);
        return;
      }
    }
    setFormSaving(true);
    try {
      const payload = {
        ...formateurForm,
        telephone: formateurForm.telephone?.trim() ? normalizeTunisianPhone(formateurForm.telephone) : '',
      };
      await formationApi.createFormateur(payload);
      setSuccess(`Formateur ${formateurForm.prenom} ${formateurForm.nom} créé.`);
      setFormateurForm({ nom: '', prenom: '', email: '', telephone: '', specialite: '', biographie: '' });
      setShowFormateurDrawer(false);
      await refreshData();
    } catch (err) { setError(err.message); }
    finally { setFormSaving(false); }
  };
  const toggleFormateurStatus = async (id, current) => {
    const next = current === 'actif' ? 'suspendu' : 'actif';
    if (!window.confirm(`Passer ce formateur en statut « ${next} » ?`)) return;
    try {
      await formationApi.updateFormateur(id, { statut_compte: next });
      setSuccess('Statut mis à jour.');
      await refreshData();
    } catch (err) { setError(err.message); }
  };

  /* ─── Rémunération Actions ─── */
  const openRemuneration = (formateurId = '') => {
    setRemunerationForm({ formateur_id: formateurId, formation_id: '', montant: '', statut: 'en_attente', note: '' });
    setShowRemunerationDialog(true);
  };
  const saveRemuneration = async (e) => {
    e.preventDefault(); setError(''); setFormSaving(true);
    try {
      await formationApi.addRemuneration(remunerationForm.formateur_id, {
        formation_id: remunerationForm.formation_id,
        montant: parseFloat(remunerationForm.montant),
        statut: remunerationForm.statut,
        note: remunerationForm.note || null,
        date_versement: remunerationForm.statut === 'paye' ? new Date().toISOString() : null,
      });
      setSuccess('Rémunération enregistrée.');
      setShowRemunerationDialog(false);
      await refreshData();
    } catch (err) { setError(err.message); }
    finally { setFormSaving(false); }
  };
  const markRemunerationPaid = async (id) => {
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

  /* ─── Participants ─── */
  const openParticipants = async (formation) => {
    setSelectedFormation(formation);
    try {
      const res = await formationApi.getParticipants(formation.id);
      setParticipants(res.participants || []);
      setWaitingList(res.liste_attente || []);
      setShowParticipantsDialog(true);
    } catch (err) { setError('Impossible de charger les participants : ' + err.message); }
  };
  const togglePresence = async (userId, current) => {
    try {
      await formationApi.marquerPresence(selectedFormation.id, userId, !current);
      const res = await formationApi.getParticipants(selectedFormation.id);
      setParticipants(res.participants || []);
    } catch (err) { setError('Échec présence : ' + err.message); }
  };
  const removeParticipant = async (userId) => {
    if (!window.confirm('Retirer ce participant ?')) return;
    try {
      await formationApi.desinscrire(selectedFormation.id, userId);
      const res = await formationApi.getParticipants(selectedFormation.id);
      setParticipants(res.participants || []);
      await refreshData();
    } catch (err) { setError(err.message); }
  };
  const exportEmargement = async (formation) => {
    try {
      await formationApi.downloadEmargementPdf(formation.id, formation.titre);
    } catch (err) { alert("Erreur export feuille d'émargement PDF : " + err.message); }
  };

  /* ─── Salles fallback: if type filter returns empty, show all ─── */
  const sallesOptions = salles.length > 0 ? salles : [];

  /* ─── Filtered Formations ─── */
  const filteredFormations = useMemo(() => {
    return formations.filter((f) => {
      if (filterSearch) {
        const q = filterSearch.toLowerCase().trim();
        const titreMatch = f.titre?.toLowerCase().includes(q);
        const descMatch = f.description?.toLowerCase().includes(q);
        const formateurMatch = f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}`.toLowerCase().includes(q) : false;
        const espaceMatch = f.espaces?.nom?.toLowerCase().includes(q);
        if (!titreMatch && !descMatch && !formateurMatch && !espaceMatch) return false;
      }
      if (filterStatut !== 'all' && f.statut !== filterStatut) return false;
      if (filterFormateur !== 'all' && f.formateur_id !== filterFormateur) return false;
      if (filterDate) {
        const d = new Date(f.date_debut).toISOString().slice(0, 10);
        if (d !== filterDate) return false;
      }
      if (filterDispo === 'dispo') {
        const cap = f.capacite_max || f.places_max || 0;
        if (cap > 0 && (f.nb_inscrits || 0) >= cap) return false;
      } else if (filterDispo === 'complet') {
        const cap = f.capacite_max || f.places_max || 0;
        if (cap > 0 && (f.nb_inscrits || 0) < cap) return false;
      }
      return true;
    });
  }, [formations, filterSearch, filterStatut, filterFormateur, filterDate, filterDispo]);

  const totalPagesFormations = Math.max(1, Math.ceil(filteredFormations.length / ITEMS_PER_PAGE));
  const safePageFormations = Math.min(pageFormations, totalPagesFormations);
  const paginatedFormations = filteredFormations.slice((safePageFormations - 1) * ITEMS_PER_PAGE, safePageFormations * ITEMS_PER_PAGE);

  /* ─── KPIs ─── */
  const totalInscrits = formations.reduce((s, f) => s + (f.nb_inscrits || 0), 0);
  const pendingPay = remunerations.filter(r => r.statut === 'en_attente').reduce((s, r) => s + parseFloat(r.montant || 0), 0);

  /* ─── Loading ─── */
  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
    </div>
  );

  if (!moduleActif) {
    return (
      <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
        <div className="bg-surface-container-lowest rounded-3xl p-8 border border-outline-variant/20 max-w-2xl mx-auto text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-orange-50 text-[#f95d00] flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined" style={{ fontSize: 30 }}>school</span>
          </div>
          <h1 className="font-sora font-bold text-2xl text-primary">Module Formations désactivé</h1>
          <p className="text-sm text-on-surface-variant">
            Ce module est actuellement désactivé pour votre établissement. Réactivez-le à tout moment dans les paramètres de l'établissement.
          </p>
          <Link
            to="/admin/settings?tab=etablissement"
            style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-xs"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>settings</span>
            Activer dans Paramètres
          </Link>
        </div>
      </PortalLayout>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════════════ */
  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div>

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-7 h-7 rounded-lg bg-secondary/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 16 }}>school</span>
              </span>
              <span className="text-xs font-bold uppercase tracking-widest text-secondary">Formations</span>
            </div>
            <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Formations & Formateurs</h1>
            <p className="text-sm text-on-surface-variant mt-0.5">Gérer les sessions, les intervenants et les rémunérations.</p>
          </div>

          {/* CTA selon l'onglet actif */}
          <div className="shrink-0 flex flex-wrap items-center gap-3">
            {activeTab === 'remunerations' && profile?.role !== 'super_admin' && (
              <button
                onClick={() => openRemuneration()}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-2xl text-sm hover:bg-emerald-700 shadow-sm transition-all active:scale-95"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>payments</span>
                Nouvelle rémunération
              </button>
            )}
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {[
            { label: 'Formations', value: formations.length, icon: 'event_note', color: 'text-[#f95d00] bg-[#fff4ed]' },
            { label: 'Formateurs', value: formateurs.length, icon: 'person', color: 'text-slate-700 bg-slate-100' },
            { label: 'Participants', value: totalInscrits, icon: 'group', color: 'text-[#f95d00] bg-[#fff4ed]' },
            { label: 'Honoraires dus', value: <Money amount={pendingPay} />, icon: 'account_balance_wallet', color: 'text-amber-700 bg-amber-50' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="bg-surface-container-lowest rounded-3xl sm:rounded-3xl p-4 sm:p-5 border border-outline-variant/20 shadow-sm flex items-center gap-3 sm:gap-4">
              <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center shrink-0 ${color}`}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{icon}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant truncate">{label}</p>
                <p className="font-sora font-bold text-[#100f0d] text-xl sm:text-2xl leading-tight">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs Hub Formations : Sessions | Inscrits | Formateurs | Versements ── */}
        <div className="flex flex-wrap gap-1 mb-6 bg-surface-container-low rounded-2xl p-1.5 w-full sm:w-fit">
          {[
            { key: 'formations', urlKey: 'sessions', label: 'Sessions', count: formations.length, icon: 'event_note' },
            { key: 'inscrits', urlKey: 'inscrits', label: 'Inscrits', count: inscritsAll.length || totalInscrits, icon: 'how_to_reg' },
            { key: 'formateurs', urlKey: 'formateurs', label: 'Formateurs', count: formateurs.length, icon: 'person' },
            { key: 'remunerations', urlKey: 'versements', label: 'Versements', count: remunerations.length, icon: 'payments' },
          ].map(({ key, urlKey, label, count, icon }) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key);
                setSearchParams(key === 'formations' ? {} : { tab: urlKey });
              }}
              style={activeTab === key ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl font-semibold text-xs sm:text-sm transition-all ${activeTab === key
                ? 'shadow-sm'
                : 'text-on-surface-variant hover:text-[#100f0d]'
                }`}
            >
              <span className="material-symbols-outlined hidden sm:block" style={{ fontSize: 16 }}>{icon}</span>
              <span className="truncate">{label}</span>
              <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${activeTab === key ? 'bg-white/20 text-white' : 'bg-outline-variant/20 text-on-surface-variant'
                }`}>{count}</span>
            </button>
          ))}
        </div>

        {/* ── Alertes ── */}
        {error && (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-2xl bg-red-50 text-red-800 border border-red-200 text-sm">
            <span className="material-symbols-outlined text-red-500 shrink-0" style={{ fontSize: 18 }}>error</span>
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">
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

        {/* ════════════════════════════ TAB: FORMATIONS ════════════════════════════ */}
        {activeTab === 'formations' && (
          <div>
            {/* Filter Dock */}
            <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-4 mb-6 shadow-sm space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Search */}
                <div className="relative lg:col-span-2">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">search</span>
                  <input
                    type="text"
                    value={filterSearch}
                    onChange={(e) => { setFilterSearch(e.target.value); setPageFormations(1); }}
                    placeholder="Titre, formateur, salle..."
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low rounded-2xl border border-outline-variant/30 text-xs sm:text-sm text-primary placeholder-on-surface-variant/60 focus:outline-none focus:border-secondary"
                  />
                  {filterSearch && (
                    <button
                      onClick={() => { setFilterSearch(''); setPageFormations(1); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </div>

                {/* Statut */}
                <div>
                  <select
                    value={filterStatut}
                    onChange={(e) => { setFilterStatut(e.target.value); setPageFormations(1); }}
                    className="w-full px-3 py-2.5 bg-surface-container-low rounded-2xl border border-outline-variant/30 text-xs sm:text-sm text-primary focus:outline-none focus:border-secondary"
                  >
                    <option value="all">Tous les statuts</option>
                    <option value="publiee">Publiée</option>
                    <option value="planifiee">Planifiée</option>
                    <option value="complete">Complète</option>
                    <option value="en_cours">En cours</option>
                    <option value="terminee">Terminée</option>
                    <option value="annulee">Annulée</option>
                  </select>
                </div>

                {/* Formateur */}
                <div>
                  <select
                    value={filterFormateur}
                    onChange={(e) => { setFilterFormateur(e.target.value); setPageFormations(1); }}
                    className="w-full px-3 py-2.5 bg-surface-container-low rounded-2xl border border-outline-variant/30 text-xs sm:text-sm text-primary focus:outline-none focus:border-secondary"
                  >
                    <option value="all">Tous les formateurs</option>
                    {formateurs.map((frm) => (
                      <option key={frm.id} value={frm.id}>{frm.prenom} {frm.nom}</option>
                    ))}
                  </select>
                </div>

                {/* Disponibilité */}
                <div>
                  <select
                    value={filterDispo}
                    onChange={(e) => { setFilterDispo(e.target.value); setPageFormations(1); }}
                    className="w-full px-3 py-2.5 bg-surface-container-low rounded-2xl border border-outline-variant/30 text-xs sm:text-sm text-primary focus:outline-none focus:border-secondary"
                  >
                    <option value="all">Toutes disponibilités</option>
                    <option value="dispo">Places restantes</option>
                    <option value="complet">Complète (0 place)</option>
                  </select>
                </div>
              </div>

              {/* Second row: Date filter & Reset */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-outline-variant/10 text-xs text-on-surface-variant">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">calendar_today</span>
                  <span>Date session :</span>
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => { setFilterDate(e.target.value); setPageFormations(1); }}
                    className="px-2.5 py-1 bg-surface-container-low rounded-xl border border-outline-variant/30 text-xs text-primary focus:outline-none focus:border-secondary"
                  />
                  {filterDate && (
                    <button onClick={() => { setFilterDate(''); setPageFormations(1); }} className="hover:text-primary">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-medium text-primary">
                    {filteredFormations.length} résultat{filteredFormations.length > 1 ? 's' : ''}
                  </span>
                  {(filterSearch || filterStatut !== 'all' || filterFormateur !== 'all' || filterDate || filterDispo !== 'all') && (
                    <button
                      onClick={() => {
                        setFilterSearch('');
                        setFilterStatut('all');
                        setFilterFormateur('all');
                        setFilterDate('');
                        setFilterDispo('all');
                        setPageFormations(1);
                      }}
                      className="text-secondary font-semibold hover:underline flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">refresh</span>
                      Réinitialiser filtres
                    </button>
                  )}
                </div>
              </div>
            </div>

            {filteredFormations.length === 0 ? (
              <EmptyState
                icon="event_note"
                title={formations.length === 0 ? "Aucune formation planifiée" : "Aucun résultat trouvé"}
                text={formations.length === 0 ? "Les formations créées par les formateurs depuis leur espace apparaissent ici." : "Aucune formation ne correspond à vos filtres actuels."}
              />
            ) : (
              <>
                {/* Mobile Cards */}
                <div className="sm:hidden space-y-3">
                  {paginatedFormations.map((f) => (
                    <div key={f.id} className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-4 shadow-sm">
                      <div className="flex justify-between items-start gap-2 mb-3">
                        <h3 className="font-sora font-bold text-[#100f0d] text-sm leading-snug">{f.titre}</h3>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUT_STYLES[f.statut]}`}>
                          {STATUT_LABELS[f.statut]}
                        </span>
                      </div>
                      <div className="space-y-1.5 text-xs text-on-surface-variant mb-3">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>person</span>
                          {f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : '—'}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>calendar_today</span>
                          {formatDateDMY(f.date_debut)} {formatTime24h(f.date_debut)}
                          <span>→</span>
                          {formatDateDMY(f.date_fin)} {formatTime24h(f.date_fin)}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>group</span>
                          {f.nb_inscrits || 0} / {f.capacite_max} inscrits
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>payments</span>
                          {f.prix_inscription > 0
                            ? <Money amount={f.prix_inscription} />
                            : (f.est_gratuit || f.programme?.includes('[SESSION_GRATUITE]'))
                            ? <span className="text-emerald-600 font-semibold">Gratuit</span>
                            : <span className="text-slate-400 font-medium italic">Non défini</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2 border-t border-outline-variant/10 flex-wrap">
                        {f.statut === 'planifiee' && profile?.role !== 'super_admin' && (
                          <>
                            <button onClick={() => approveFormation(f)} className="flex-1 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 shadow-xs">Approuver</button>
                            <button onClick={() => refuseFormation(f)} className="py-1.5 px-3 text-xs font-semibold border border-rose-300 text-rose-700 rounded-xl hover:bg-rose-50">Refuser</button>
                          </>
                        )}
                        <button onClick={() => openParticipants(f)} className="flex-1 py-1.5 text-xs font-semibold border border-secondary/30 text-secondary rounded-xl hover:bg-secondary/5">Inscrits</button>
                        {profile?.role !== 'super_admin' && (
                          <>
                            <button onClick={() => openEditFormation(f)} className="py-1.5 px-2 text-xs font-semibold border border-outline-variant/30 text-on-surface-variant rounded-xl hover:bg-surface-container">Modifier</button>
                            {f.statut !== 'annulee' && (
                              <button onClick={() => cancelFormation(f.id)} className="px-3 py-1.5 text-xs font-semibold border border-error/30 text-error rounded-xl hover:bg-error/5">✕</button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table */}
                <div className="hidden sm:block bg-surface-container-lowest rounded-3xl border border-outline-variant/20 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1020px] text-left text-sm border-collapse">
                      <thead>
                        <tr className="bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider border-b border-outline-variant/20">
                          <th className="p-4 w-[340px]">Titre</th>
                          <th className="p-4 w-[180px]">Formateur</th>
                          <th className="p-4 w-[150px]">Salle</th>
                          <th className="p-4 w-[240px]">Date & Heure</th>
                          <th className="p-4 w-[120px]">Inscrits</th>
                          <th className="p-4 w-[110px]">Tarif</th>
                          <th className="p-4 w-[100px]">Statut</th>
                          <th className="p-4 text-right w-[170px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {paginatedFormations.map((f) => (
                          <tr key={f.id} className="hover:bg-surface-container-lowest transition-colors group">
                            <td className="p-4 font-semibold text-primary max-w-[360px] whitespace-normal break-words">
                              <div className="whitespace-normal break-words text-sm leading-snug line-clamp-2">{f.titre}</div>
                            </td>
                            <td className="p-4 text-on-surface-variant text-xs whitespace-normal break-words">
                              {f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : <span className="italic text-outline">Non assigné</span>}
                            </td>
                            <td className="p-4 text-on-surface-variant text-xs whitespace-normal break-words">{f.espaces?.nom || '—'}</td>
                            <td className="p-4 text-xs text-on-surface-variant whitespace-normal break-words min-w-[240px]">
                              <div>{formatDateDMY(f.date_debut)} {formatTime24h(f.date_debut)}</div>
                              <div className="font-medium text-[#100f0d] break-words">{formatDateDMY(f.date_fin)} {formatTime24h(f.date_fin)}</div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-1">
                                <span className="font-bold text-[#100f0d]">{f.nb_inscrits || 0}</span>
                                <span className="text-on-surface-variant text-xs">/ {f.capacite_max}</span>
                              </div>
                              <div className="h-1 w-16 rounded-full bg-outline-variant/20 mt-1">
                                <div
                                  className="h-1 rounded-full bg-[#f95d00] transition-all"
                                  style={{ width: `${Math.min(100, ((f.nb_inscrits || 0) / f.capacite_max) * 100)}%` }}
                                />
                              </div>
                            </td>
                            <td className="p-4 font-semibold text-[#100f0d] text-xs">
                              {f.prix_inscription > 0 ? (
                                <Money amount={f.prix_inscription} />
                              ) : (f.est_gratuit || f.programme?.includes('[SESSION_GRATUITE]')) ? (
                                <span className="text-emerald-600 font-semibold">Gratuit</span>
                              ) : (
                                <span className="text-slate-400 font-medium italic">Non défini</span>
                              )}
                            </td>
                            <td className="p-4">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUT_STYLES[f.statut] || ''}`}>
                                {STATUT_LABELS[f.statut] || f.statut}
                              </span>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {f.statut === 'planifiee' && profile?.role !== 'super_admin' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => approveFormation(f)}
                                      title="Approuver la formation et sa réservation"
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>
                                      <span>Approuver</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => refuseFormation(f)}
                                      title="Refuser la formation"
                                      className="inline-flex items-center gap-1 px-2 py-1.5 text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold transition-all"
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>block</span>
                                      <span>Refuser</span>
                                    </button>
                                  </>
                                )}
                                <ActionBtn icon="group" title="Participants" onClick={() => openParticipants(f)} color="text-secondary" />
                                <ActionBtn icon="download" title="Export émargement" onClick={() => exportEmargement(f)} color="text-on-surface-variant" />
                                {profile?.role !== 'super_admin' && (
                                  <>
                                    <ActionBtn icon="edit" title="Modifier" onClick={() => openEditFormation(f)} color="text-on-surface-variant" />
                                    {f.statut !== 'annulee' && (
                                      <ActionBtn icon="cancel" title="Annuler" onClick={() => cancelFormation(f.id)} color="text-error" />
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <Pagination
                  currentPage={pageFormations}
                  totalItems={filteredFormations.length}
                  itemsPerPage={ITEMS_PER_PAGE}
                  onPageChange={setPageFormations}
                  label="formations"
                />
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════ TAB: INSCRITS ════════════════════════════ */}
        {activeTab === 'inscrits' && (
          <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 overflow-x-auto shadow-sm">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant bg-surface-container-low/50">
                  <th className="py-3 px-4">Apprenant</th>
                  <th className="py-3 px-4">Formation</th>
                  <th className="py-3 px-4">Date session</th>
                  <th className="py-3 px-4">Statut inscription</th>
                  <th className="py-3 px-4">Paiement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {inscritsAll.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-on-surface-variant">Aucun apprenant inscrit pour le moment.</td></tr>
                ) : inscritsAll.map((ins) => (
                  <tr key={ins.id}>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-primary">
                        {ins.profiles ? `${ins.profiles.prenom || ''} ${ins.profiles.nom || ''}`.trim() : 'Apprenant'}
                      </p>
                      <p className="text-xs text-on-surface-variant">{ins.profiles?.email || '—'}</p>
                    </td>
                    <td className="py-3 px-4 font-semibold">{ins.formations?.titre || '—'}</td>
                    <td className="py-3 px-4 text-xs text-on-surface-variant">
                      {ins.formations?.date_debut ? formatDateDMY(ins.formations.date_debut) : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 capitalize">
                        {ins.statut || 'confirmee'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${
                        ins.statut_paiement === 'paye' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {ins.statut_paiement === 'paye' ? 'Payé' : 'En attente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ════════════════════════════ TAB: FORMATEURS ════════════════════════════ */}
        {activeTab === 'formateurs' && (
          <div>
            {formateurs.length === 0 ? (
              <EmptyState icon="person" title="Aucun formateur enregistré" text="Aucun formateur n'a encore été ajouté à cet espace." />
            ) : (
              <>
                {/* Mobile Cards */}
                <div className="sm:hidden space-y-3">
                  {formateurs.slice((pageFormateurs - 1) * ITEMS_PER_PAGE, pageFormateurs * ITEMS_PER_PAGE).map((t) => (
                    <div key={t.id} className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-4 shadow-sm">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center font-bold text-secondary text-sm shrink-0">
                          {(t.prenom?.[0] || '') + (t.nom?.[0] || '')}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-primary text-sm truncate">{t.prenom} {t.nom}</p>
                          <p className="text-xs text-on-surface-variant truncate">{t.email}</p>
                        </div>
                        <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${t.statut_compte === 'actif' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {t.statut_compte || 'actif'}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mb-3">🎯 {t.specialite || 'Généraliste'} {t.telephone && `· ${t.telephone}`}</p>
                      <div className="flex gap-2 pt-2 border-t border-outline-variant/10">
                        <button onClick={() => openRemuneration(t.id)} className="flex-1 py-1.5 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl hover:bg-emerald-100">Rémunérer</button>
                        <button onClick={() => toggleFormateurStatus(t.id, t.statut_compte)} className={`flex-1 py-1.5 text-xs font-semibold border rounded-xl ${t.statut_compte === 'actif' ? 'border-red-200 text-error bg-red-50 hover:bg-red-100' : 'border-emerald-200 text-emerald-700 bg-emerald-50'}`}>
                          {t.statut_compte === 'actif' ? 'Suspendre' : 'Activer'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Grid Cards (Mobile & Desktop) */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {formateurs.slice((pageFormateurs - 1) * ITEMS_PER_PAGE, pageFormateurs * ITEMS_PER_PAGE).map((t) => (
                    <div key={t.id} className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all group">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-secondary/20 to-secondary/5 flex items-center justify-center font-sora font-bold text-secondary text-base shrink-0">
                          {(t.prenom?.[0] || '') + (t.nom?.[0] || '')}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-sora font-bold text-primary truncate">{t.prenom} {t.nom}</p>
                          <p className="text-xs text-on-surface-variant truncate">{t.email}</p>
                        </div>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${t.statut_compte === 'actif' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {t.statut_compte || 'actif'}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs text-on-surface-variant mb-4 px-1">
                        {t.specialite && (
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>star</span>
                            {t.specialite}
                          </div>
                        )}
                        {t.telephone && (
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>phone</span>
                            {t.telephone}
                          </div>
                        )}
                        {t.biographie && (
                          <p className="italic text-on-surface-variant/70 line-clamp-2 mt-2">{t.biographie}</p>
                        )}
                      </div>

                      <div className="flex gap-2 pt-3 border-t border-outline-variant/10">
                        {profile?.role !== 'super_admin' && (
                          <button
                            onClick={() => openRemuneration(t.id)}
                            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl hover:bg-emerald-100 transition-colors"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>payments</span>
                            Rémunérer
                          </button>
                        )}
                        {profile?.role !== 'super_admin' && (
                          <button
                            onClick={() => toggleFormateurStatus(t.id, t.statut_compte)}
                            className={`flex items-center justify-center p-2 rounded-xl border transition-colors ${t.statut_compte === 'actif'
                              ? 'border-red-200 text-error bg-red-50 hover:bg-red-100'
                              : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                              }`}
                            title={t.statut_compte === 'actif' ? 'Suspendre' : 'Activer'}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              {t.statut_compte === 'actif' ? 'block' : 'check_circle'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <Pagination
                  currentPage={pageFormateurs}
                  totalItems={formateurs.length}
                  itemsPerPage={ITEMS_PER_PAGE}
                  onPageChange={setPageFormateurs}
                  label="formateurs"
                />
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════ TAB: REMUNERATIONS ════════════════════════════ */}
        {activeTab === 'remunerations' && (
          <div>
            {remunerations.length === 0 ? (
              <EmptyState icon="payments" title="Aucune rémunération enregistrée" text="Commencez par enregistrer les honoraires de vos formateurs après leurs sessions." action={() => openRemuneration()} actionLabel="Nouvelle rémunération" />
            ) : (
              <>
                {/* Mobile */}
                <div className="sm:hidden space-y-3">
                  {remunerations.map((r) => (
                    <div key={r.id} className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-4 shadow-sm">
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-semibold text-[#100f0d] text-sm">{r.profiles?.prenom} {r.profiles?.nom}</p>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.statut === 'paye' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                          {r.statut === 'paye' ? 'Payé' : 'En attente'}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mb-1">{r.formations?.titre || 'Honoraires'}</p>
                      <p className="font-bold text-emerald-700 text-base mb-3"><Money amount={r.montant} /></p>
                      {r.statut === 'en_attente' && (
                        <button onClick={() => markRemunerationPaid(r.id)} className="w-full py-2 text-xs font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700">
                          Marquer comme payé
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop Table */}
                <div className="hidden sm:block bg-surface-container-lowest rounded-3xl border border-outline-variant/20 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-left text-sm border-collapse">
                      <thead>
                        <tr className="bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider border-b border-outline-variant/20">
                          <th className="p-4">Formateur</th>
                          <th className="p-4">Formation / Motif</th>
                          <th className="p-4">Montant</th>
                          <th className="p-4">Statut</th>
                          <th className="p-4">Date versement</th>
                          <th className="p-4">Note</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {remunerations.map((r) => (
                          <tr key={r.id} className="hover:bg-surface-container-lowest transition-colors group">
                            <td className="p-4 font-semibold text-primary">{r.profiles?.prenom} {r.profiles?.nom}</td>
                            <td className="p-4 text-on-surface-variant text-xs">{r.formations?.titre || '—'}</td>
                            <td className="p-4 font-bold text-emerald-700"><Money amount={r.montant} /></td>
                            <td className="p-4">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${r.statut === 'paye' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                                {r.statut === 'paye' ? 'Payé' : 'En attente'}
                              </span>
                            </td>
                            <td className="p-4 text-xs text-on-surface-variant">
                              {r.date_versement ? formatDateDMY(r.date_versement) : '—'}
                            </td>
                            <td className="p-4 text-xs text-on-surface-variant italic max-w-[160px]">
                              <div className="truncate">{r.note || '—'}</div>
                            </td>
                            <td className="p-4 text-right">
                              {r.statut === 'en_attente' ? (
                                profile?.role !== 'super_admin' ? (
                                  <button
                                    onClick={() => markRemunerationPaid(r.id)}
                                    className="inline-flex items-center gap-2 ml-auto px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>
                                    Marquer payé
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-2 px-3 py-2 bg-amber-100 text-amber-800 text-xs font-semibold rounded-xl">
                                    En attente
                                  </span>
                                )
                              ) : (
                                <span className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-600 text-xs font-semibold rounded-xl">
                                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>done</span>
                                  Payé
                                </span>
                              )}
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
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          MODAL — PLANIFIER / MODIFIER FORMATION
      ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showFormationDrawer}
        onClose={() => setShowFormationDrawer(false)}
        title="Modifier la formation"
        subtitle="Remplissez les informations de la session"
        icon="event_note"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowFormationDrawer(false)}
              className="flex-1 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-sm hover:bg-surface-container"
            >
              Annuler
            </button>
            <button
              form="formationForm"
              type="submit"
              disabled={formSaving}
              className="flex-1 py-2.5 bg-secondary text-white font-semibold rounded-xl text-sm hover:bg-secondary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {formSaving ? <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : null}
              Enregistrer
            </button>
          </div>
        }
      >
        <form id="formationForm" onSubmit={saveFormation} className="space-y-4">
          <Field label="Titre de la formation" required>
            <input className={inputCls} placeholder="Ex: Atelier Design Sprint" required value={formationForm.titre}
              onChange={e => setFormationForm(p => ({ ...p, titre: e.target.value }))} />
          </Field>

          <Field label="Description">
            <textarea className={inputCls} rows={3} placeholder="Présentez la formation en quelques lignes..." value={formationForm.description}
              onChange={e => setFormationForm(p => ({ ...p, description: e.target.value }))} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Formateur" required>
              <select className={inputCls} required value={formationForm.formateur_id}
                onChange={e => setFormationForm(p => ({ ...p, formateur_id: e.target.value }))}>
                <option value="">— Choisir —</option>
                {formateurs.map(t => (
                  <option key={t.id} value={t.id}>{t.prenom} {t.nom}</option>
                ))}
              </select>
              {formateurs.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠️ Aucun formateur disponible.
                </p>
              )}
            </Field>

            <Field label="Salle / Espace" required>
              <select className={inputCls} required value={formationForm.espace_id}
                onChange={e => setFormationForm(p => ({ ...p, espace_id: e.target.value }))}>
                <option value="">— Choisir —</option>
                {sallesOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.nom}</option>
                ))}
              </select>
              {sallesOptions.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">⚠️ Aucun espace trouvé.</p>
              )}
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date & Heure de début" required>
              <input type="datetime-local" className={inputCls} required value={formationForm.date_debut}
                onChange={e => setFormationForm(p => ({ ...p, date_debut: e.target.value }))} />
            </Field>
            <Field label="Date & Heure de fin" required>
              <input type="datetime-local" className={inputCls} required value={formationForm.date_fin}
                onChange={e => setFormationForm(p => ({ ...p, date_fin: e.target.value }))} />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Capacité max (places)" required>
              <input type="number" min={1} className={inputCls} required value={formationForm.capacite_max}
                onChange={e => setFormationForm(p => ({ ...p, capacite_max: e.target.value }))} />
            </Field>
            <Field label="Prix d'inscription (DT)">
              <input type="number" min={0} step="0.5" className={inputCls} value={formationForm.prix_inscription}
                onChange={e => setFormationForm(p => ({ ...p, prix_inscription: e.target.value }))} />
            </Field>
          </div>

          <Field label="Programme / Déroulement">
            <textarea className={inputCls} rows={3} placeholder="9h-10h : Introduction&#10;10h-12h : Atelier pratique..." value={formationForm.programme}
              onChange={e => setFormationForm(p => ({ ...p, programme: e.target.value }))} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Prérequis">
              <input className={inputCls} placeholder="Ex: Notions de base en design" value={formationForm.prerequis}
                onChange={e => setFormationForm(p => ({ ...p, prerequis: e.target.value }))} />
            </Field>
            <Field label="Matériel à apporter">
              <input className={inputCls} placeholder="Ex: Ordinateur portable" value={formationForm.materiel}
                onChange={e => setFormationForm(p => ({ ...p, materiel: e.target.value }))} />
            </Field>
          </div>

          {formationForm.id && (
            <Field label="Statut">
              <select className={inputCls} value={formationForm.statut}
                onChange={e => setFormationForm(p => ({ ...p, statut: e.target.value }))}>
                <option value="planifiee">Planifiée</option>
                <option value="en_cours">En cours</option>
                <option value="terminee">Terminée</option>
                <option value="annulee">Annulée</option>
              </select>
            </Field>
          )}

          {/* Inline error inside the form */}
          {error && showFormationDrawer && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
          )}
        </form>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════
          MODAL — CRÉER FORMATEUR
      ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showFormateurDrawer}
        onClose={() => setShowFormateurDrawer(false)}
        title="Créer un formateur"
        subtitle="Un compte sera créé dans Supabase Auth avec le rôle formateur"
        icon="person_add"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setShowFormateurDrawer(false)} className="flex-1 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-sm hover:bg-surface-container">
              Annuler
            </button>
            <button form="formateurForm" type="submit" disabled={formSaving} className="flex-1 py-2.5 bg-secondary text-white font-semibold rounded-xl text-sm hover:bg-secondary/90 disabled:opacity-50 flex items-center justify-center gap-2">
              {formSaving && <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
              Créer le formateur
            </button>
          </div>
        }
      >
        <form id="formateurForm" onSubmit={saveFormateur} className="space-y-4">
          <div className="p-3 rounded-xl bg-[#fff4ed] border border-[#f95d00]/25 text-[#9a3412] text-xs flex items-start gap-2">
            <span className="material-symbols-outlined text-[#f95d00] shrink-0" style={{ fontSize: 16 }}>info</span>
            Un email d'invitation sera envoyé au formateur avec ses informations de connexion.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Prénom" required>
              <input className={inputCls} placeholder="Ex: Alice" required value={formateurForm.prenom}
                onChange={e => setFormateurForm(p => ({ ...p, prenom: e.target.value }))} />
            </Field>
            <Field label="Nom" required>
              <input className={inputCls} placeholder="Ex: Martin" required value={formateurForm.nom}
                onChange={e => setFormateurForm(p => ({ ...p, nom: e.target.value }))} />
            </Field>
          </div>

          <Field label="Email professionnel" required>
            <input type="email" className={inputCls} placeholder="formateur@email.com" required value={formateurForm.email}
              onChange={e => setFormateurForm(p => ({ ...p, email: e.target.value }))} />
          </Field>

          <Field label="Téléphone">
            <TunisianPhoneInput
              className={inputCls}
              value={formateurForm.telephone}
              onChange={(val) => setFormateurForm(p => ({ ...p, telephone: val }))}
            />
          </Field>

          <Field label="Domaine d'expertise / Spécialité">
            <input className={inputCls} placeholder="Ex: UX Design, Marketing Digital, React..." value={formateurForm.specialite}
              onChange={e => setFormateurForm(p => ({ ...p, specialite: e.target.value }))} />
          </Field>

          <Field label="Biographie courte">
            <textarea className={inputCls} rows={3} placeholder="Quelques mots sur le formateur, son parcours, ses compétences..." value={formateurForm.biographie}
              onChange={e => setFormateurForm(p => ({ ...p, biographie: e.target.value }))} />
          </Field>

          {error && showFormateurDrawer && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
          )}
        </form>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════
          DIALOG — RÉMUNÉRATION
      ══════════════════════════════════════════════════════════════════════════ */}
      <Dialog
        open={showRemunerationDialog}
        onClose={() => setShowRemunerationDialog(false)}
        title="Enregistrer une rémunération"
        maxWidth="max-w-2xl"
        footer={
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => setShowRemunerationDialog(false)} className="flex-1 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-sm">
              Annuler
            </button>
            <button form="remunerationForm" type="submit" disabled={formSaving} className="flex-1 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl text-sm hover:bg-emerald-700 disabled:opacity-50">
              Enregistrer
            </button>
          </div>
        }
      >
        <form id="remunerationForm" onSubmit={saveRemuneration} className="grid gap-4 sm:grid-cols-2">
          <Field label="Formateur" required>
            <select className={inputCls} required value={remunerationForm.formateur_id}
              onChange={e => setRemunerationForm(p => ({ ...p, formateur_id: e.target.value }))}>
              <option value="">— Choisir —</option>
              {formateurs.map(t => <option key={t.id} value={t.id}>{t.prenom} {t.nom}</option>)}
            </select>
          </Field>
          <Field label="Formation concernée">
            <select className={inputCls} value={remunerationForm.formation_id}
              onChange={e => setRemunerationForm(p => ({ ...p, formation_id: e.target.value }))}>
              <option value="">— Honoraires généraux —</option>
              {formations.map(f => <option key={f.id} value={f.id}>{f.titre}</option>)}
            </select>
          </Field>
          <Field label="Montant (DT)" required>
            <input type="number" min={0} step="0.5" className={inputCls} placeholder="150.00" required value={remunerationForm.montant}
              onChange={e => setRemunerationForm(p => ({ ...p, montant: e.target.value }))} />
          </Field>
          <Field label="Statut">
            <select className={inputCls} value={remunerationForm.statut}
              onChange={e => setRemunerationForm(p => ({ ...p, statut: e.target.value }))}>
              <option value="en_attente">En attente de versement</option>
              <option value="paye">Versé immédiatement</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note / Référence">
              <input className={inputCls} placeholder="Ex: Virement N° 00123" value={remunerationForm.note}
                onChange={e => setRemunerationForm(p => ({ ...p, note: e.target.value }))} />
            </Field>
          </div>
        </form>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════════
          DIALOG — PARTICIPANTS & ÉMARGEMENT
      ══════════════════════════════════════════════════════════════════════════ */}
      <Dialog
        open={showParticipantsDialog}
        onClose={() => setShowParticipantsDialog(false)}
        title={`Participants — ${selectedFormation?.titre || ''}`}
        maxWidth="max-w-4xl"
        footer={
          <div className="flex gap-3">
            {selectedFormation && (
              <button onClick={() => exportEmargement(selectedFormation)} className="flex items-center gap-1.5 px-4 py-2 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-xs hover:bg-surface-container">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
                Export JSON
              </button>
            )}
            <button onClick={() => setShowParticipantsDialog(false)} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="flex-1 py-2 font-semibold rounded-xl text-sm hover:opacity-90">
              Fermer
            </button>
          </div>
        }
      >
        {/* Inscrits confirmés */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
            Inscrits confirmés ({participants.length})
          </h3>
          {participants.length === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-4 italic">Aucun inscrit pour le moment.</p>
          ) : (
            <div className="border border-outline-variant/20 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[620px] text-xs">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant font-semibold">
                    <th className="p-3 text-left">Participant</th>
                    <th className="p-3 text-center">Présent</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {participants.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-container-lowest">
                      <td className="p-3">
                        <p className="font-semibold text-[#100f0d]">{p.profiles?.prenom} {p.profiles?.nom}</p>
                        <p className="text-on-surface-variant text-xs">{p.profiles?.email}</p>
                      </td>
                      <td className="p-3 text-center">
                        <input type="checkbox" checked={p.present || false} onChange={() => togglePresence(p.user_id, p.present)}
                          className="w-4 h-4 rounded accent-secondary cursor-pointer" />
                      </td>
                      <td className="p-3 text-right">
                        <button onClick={() => removeParticipant(p.user_id)} className="text-error hover:bg-error/5 rounded-lg p-1">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>person_remove</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Liste d'attente */}
        {waitingList.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-2">
              Liste d'attente ({waitingList.length})
            </h3>
            <div className="space-y-2">
              {waitingList.map((w) => (
                <div key={w.id} className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-xs font-medium text-amber-900">{w.profiles?.prenom} {w.profiles?.nom}</p>
                  <p className="text-xs text-amber-700">{w.profiles?.email}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Dialog>
    </PortalLayout>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function ActionBtn({ icon, title, onClick, color = 'text-on-surface-variant' }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-container-high transition-colors ${color}`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
    </button>
  );
}

function EmptyState({ icon, title, text, action, actionLabel }) {
  return (
    <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-12 text-center shadow-sm">
      <div className="w-16 h-16 rounded-3xl bg-surface-container-low flex items-center justify-center mx-auto mb-4">
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 32 }}>{icon}</span>
      </div>
      <h3 className="font-sora font-bold text-primary text-xl sm:text-2xl mb-3">{title}</h3>
      <p className="text-base leading-7 text-on-surface-variant mb-6 max-w-none mx-auto">{text}</p>
      {action && (
        <button onClick={action} className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white font-semibold rounded-2xl text-sm hover:bg-secondary/90 shadow-sm transition-all active:scale-95">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
