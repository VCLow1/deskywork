import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { formationApi, bookingApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';

const ITEMS_PER_PAGE = 10;

/* ─── Constants ─────────────────────────────────────────────────────────── */
const STATUT_STYLES = {
  planifiee: 'bg-amber-50 text-amber-800 border border-amber-200',
  en_cours: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  terminee: 'bg-sky-50 text-sky-800 border border-sky-200',
  annulee: 'bg-red-50 text-red-800 border border-red-200',
};
const STATUT_LABELS = {
  planifiee: 'Planifiée',
  en_cours: 'En cours',
  terminee: 'Terminée',
  annulee: 'Annulée',
};

const PAIEMENT_STYLES = {
  gratuit: 'bg-slate-100 text-slate-700',
  paye: 'bg-emerald-100 text-emerald-800',
  en_attente: 'bg-amber-100 text-amber-800',
  rembourse: 'bg-sky-100 text-sky-800',
};
const PAIEMENT_LABELS = {
  gratuit: 'Gratuit',
  paye: 'Payé',
  en_attente: 'En attente',
  rembourse: 'Remboursé',
};

/* ─── Field helper ─────────────────────────────────────────────────────── */
const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/40 text-sm text-primary bg-white focus:outline-none focus:ring-2 focus:ring-secondary/30 focus:border-secondary transition-all placeholder:text-on-surface-variant/50';
const Field = ({ label, required, children }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
      {label}{required && <span className="text-error ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

/* ─── Modal ─────────────────────────────────────────────────────────────── */
function Modal({ open, onClose, title, subtitle, icon, children, footer }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-[0_40px_120px_rgba(15,23,42,0.18)] flex flex-col max-h-[92vh] overflow-hidden"
        style={{ animation: 'popIn 0.22s cubic-bezier(.34,1.56,.64,1)' }}
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-outline-variant/15 bg-slate-50 shrink-0">
          <div className="flex items-center gap-4">
            {icon && (
              <div className="w-11 h-11 rounded-2xl bg-secondary/10 flex items-center justify-center shrink-0 shadow-sm">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 22 }}>{icon}</span>
              </div>
            )}
            <div>
              <h2 className="font-sora font-bold text-primary text-xl leading-tight">{title}</h2>
              {subtitle && <p className="text-sm text-on-surface-variant mt-1">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-2xl hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">{children}</div>

        {footer && (
          <div className="p-5 border-t border-outline-variant/15 bg-surface-container-low rounded-b-3xl shrink-0">{footer}</div>
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

/* ─── Participants Modal ─────────────────────────────────────────────────── */
function ParticipantsModal({ open, onClose, formation, inscriptions }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open || !formation) return null;

  const activeInscrits = (inscriptions[formation.id] || []).filter(i => i.statut !== 'annulee');
  const nbInscrits = activeInscrits.length;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-[0_40px_120px_rgba(15,23,42,0.18)] flex flex-col max-h-[85vh] overflow-hidden"
        style={{ animation: 'popIn 0.22s cubic-bezier(.34,1.56,.64,1)' }}
      >
        <div className="p-5 border-b border-outline-variant/20 flex justify-between items-start" style={{ background: 'linear-gradient(135deg, #ffedd8, #fff7ed)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#f95d00]/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>group</span>
            </div>
            <div>
              <h2 className="font-sora font-bold text-lg text-primary leading-snug">{formation.titre}</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {nbInscrits} inscrits actifs · capacité {formation.capacite_max}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl hover:bg-violet-100 flex items-center justify-center text-on-surface-variant transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {(inscriptions[formation.id] || []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="material-symbols-outlined text-on-surface-variant/30 block mb-3" style={{ fontSize: 48 }}>group_off</span>
              <p className="text-sm font-semibold text-on-surface-variant">Aucun participant inscrit</p>
              <p className="text-xs text-on-surface-variant/60 mt-1">Les inscriptions apparaîtront ici.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 px-3 pb-2 border-b border-outline-variant/20">
                <span className="col-span-5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Participant</span>
                <span className="col-span-3 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Inscription</span>
                <span className="col-span-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Paiement</span>
                <span className="col-span-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant text-center">Présence</span>
              </div>

              {(inscriptions[formation.id] || []).map((insc) => (
                <div
                  key={insc.id}
                  className={`grid grid-cols-12 gap-2 items-center px-3 py-3 rounded-2xl border transition-colors ${insc.statut === 'annulee'
                    ? 'border-red-100 bg-red-50/40 opacity-60'
                    : 'border-outline-variant/15 hover:bg-surface-container-low'
                    }`}
                >
                  <div className="col-span-5 flex items-center gap-2 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-xs text-white"
                      style={{ background: 'linear-gradient(135deg, #100f0d, #f95d00)' }}
                    >
                      {(insc.profiles?.prenom?.[0] || '').toUpperCase()}{(insc.profiles?.nom?.[0] || '').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">
                        {insc.profiles?.prenom} {insc.profiles?.nom}
                      </p>
                      <p className="text-[10px] text-on-surface-variant truncate">{insc.profiles?.email}</p>
                    </div>
                  </div>

                  <div className="col-span-3">
                    <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${insc.statut === 'confirmee' ? 'bg-emerald-100 text-emerald-800' :
                      insc.statut === 'en_attente' ? 'bg-amber-100 text-amber-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                      {insc.statut === 'confirmee' ? 'Confirmée' : insc.statut === 'en_attente' ? 'En attente' : 'Annulée'}
                    </span>
                  </div>

                  <div className="col-span-2">
                    <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${PAIEMENT_STYLES[insc.statut_paiement] || 'bg-slate-100 text-slate-700'}`}>
                      {PAIEMENT_LABELS[insc.statut_paiement] || insc.statut_paiement}
                    </span>
                  </div>

                  <div className="col-span-2 flex justify-center">
                    {insc.present ? (
                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                        <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: 15, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center">
                        <span className="material-symbols-outlined text-slate-400" style={{ fontSize: 15 }}>radio_button_unchecked</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-outline-variant/20 flex justify-between items-center">
          <p className="text-xs text-on-surface-variant">
            {(inscriptions[formation.id] || []).filter(i => i.present).length} présences confirmées
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-violet-600 text-white font-semibold rounded-xl text-sm hover:bg-violet-700 transition-colors"
          >
            Fermer
          </button>
        </div>
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

/* ─── Delete Confirm Dialog ─────────────────────────────────────────────── */
function DeleteDialog({ open, onClose, onConfirm, formation, loading }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open || !formation) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-auto bg-white rounded-3xl shadow-2xl p-6"
        style={{ animation: 'popIn 0.22s cubic-bezier(.34,1.56,.64,1)' }}
      >
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-3xl bg-red-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-red-600" style={{ fontSize: 28 }}>warning</span>
          </div>
          <div>
            <h2 className="font-sora font-bold text-primary text-xl mb-2">Supprimer cette formation ?</h2>
            <p className="text-sm text-on-surface-variant">
              <strong className="text-primary">"{formation.titre}"</strong>
              <br />
              {formation.nb_inscrits > 0
                ? `Cette formation a ${formation.nb_inscrits} inscrit(s). Elle sera marquée comme annulée.`
                : 'Cette action est irréversible.'}
            </p>
          </div>
          <div className="flex gap-3 w-full">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-sm hover:bg-surface-container transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 py-2.5 bg-red-600 text-white font-semibold rounded-xl text-sm hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : null}
              {formation.nb_inscrits > 0 ? 'Annuler la formation' : 'Supprimer'}
            </button>
          </div>
        </div>
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

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function TrainerFormations({ session }) {
  const [profile, setProfile] = useState(null);
  const [formations, setFormations] = useState([]);
  const [espaces, setEspaces] = useState([]);
  const [inscriptions, setInscriptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [formSaving, setFormSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filterStatut, setFilterStatut] = useState('');

  /* Modals */
  const [showFormModal, setShowFormModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [selectedFormation, setSelectedFormation] = useState(null);

  /* Form */
  const emptyForm = {
    id: '', titre: '', description: '', espace_id: '',
    capacite_max: 10, prix_inscription: 0,
    date_debut: '', date_fin: '',
    programme: '', prerequis: '', materiel: '',
    statut: 'planifiee',
    reservation_id: '',
    mode: 'sur_place',
  };
  const [form, setForm] = useState(emptyForm);
  const [spaceCheck, setSpaceCheck] = useState({ status: 'idle', message: '' });

  /* ─── Dates fixes & Horaires de la formation ─── */
  const [datesFixes, setDatesFixes] = useState([]);
  const [heureDebut, setHeureDebut] = useState('09:00');
  const [heureFin, setHeureFin] = useState('17:00');
  const [newDateInput, setNewDateInput] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  });

  const addDateFixe = (dStr) => {
    if (!dStr) return;
    if (datesFixes.includes(dStr)) return;
    const next = [...datesFixes, dStr].sort();
    setDatesFixes(next);
  };

  const removeDateFixe = (dStr) => {
    setDatesFixes(prev => prev.filter(d => d !== dStr));
  };

  const addNextDay = () => {
    let base = new Date();
    if (datesFixes.length > 0) {
      base = new Date(datesFixes[datesFixes.length - 1] + 'T00:00:00');
    }
    base.setDate(base.getDate() + 1);
    addDateFixe(base.toISOString().slice(0, 10));
  };

  const addNextSaturday = () => {
    let base = new Date();
    const day = base.getDay();
    const diff = (6 - day + 7) % 7 || 7;
    base.setDate(base.getDate() + diff);
    addDateFixe(base.toISOString().slice(0, 10));
  };

  /* ─── Coworking & Espaces formation ─── */
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [espacesFormation, setEspacesFormation] = useState([]);
  const [loadingEspaces, setLoadingEspaces] = useState(false);

  /* Calcul du coût et espace sélectionné */
  const getSelectedSpace = () => {
    if (!form.espace_id) return null;
    return espacesFormation.find(e => e.id === form.espace_id) || espaces.find(e => e.id === form.espace_id);
  };

  const calculateDailyHours = () => {
    if (!heureDebut || !heureFin) return 0;
    const [h1, m1] = heureDebut.split(':').map(Number);
    const [h2, m2] = heureFin.split(':').map(Number);
    const diffMin = (h2 * 60 + m2) - (h1 * 60 + m1);
    return Math.max(0.5, diffMin / 60);
  };

  const calculateTotalHours = () => {
    const daily = calculateDailyHours();
    return Math.max(1, (datesFixes.length || 1) * daily);
  };

  const calculateSpacePrice = () => {
    const esp = getSelectedSpace();
    if (!esp || !esp.tarif_horaire) return 0;
    const hours = calculateTotalHours();
    return parseFloat((hours * parseFloat(esp.tarif_horaire)).toFixed(3));
  };

  useEffect(() => { loadUserData(); }, []);
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4000);
    return () => clearTimeout(t);
  }, [success]);

  /* ─── Chargement des espaces dès que le Coworking (Tenant) est sélectionné ─── */
  useEffect(() => {
    if (!showFormModal || !selectedTenantId) {
      setEspacesFormation([]);
      setSpaceCheck({ status: 'idle', message: '' });
      return;
    }
    let cancelled = false;
    setLoadingEspaces(true);
    bookingApi.getEspacesFormation({ tenant_id: selectedTenantId })
      .then(res => {
        if (!cancelled) {
          setEspacesFormation(res.espaces || []);
          const ids = (res.espaces || []).map(e => e.id);
          if (form.espace_id && !ids.includes(form.espace_id)) {
            setForm(p => ({ ...p, espace_id: '' }));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setEspacesFormation([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEspaces(false);
      });
    return () => { cancelled = true; };
  }, [showFormModal, selectedTenantId]);

  /* ─── Mise à jour du spaceCheck selon l'espace sélectionné ─── */
  useEffect(() => {
    if (!form.espace_id || espacesFormation.length === 0) {
      setSpaceCheck({ status: 'idle', message: '' });
      return;
    }
    const espace = espacesFormation.find(e => e.id === form.espace_id);
    if (!espace) { setSpaceCheck({ status: 'idle', message: '' }); return; }
    if (espace.disponible === false) {
      setSpaceCheck({ status: 'conflict', message: espace.raison_indisponibilite || "Cet espace n'est pas disponible." });
    } else if (espace.disponible === true) {
      setSpaceCheck({
        status: 'ok',
        message: espace.type === 'open_space'
          ? 'Open space disponible dans ce coworking. Une réservation sera créée et soumise à approbation.'
          : 'Salle de formation disponible dans ce coworking. Une réservation sera créée et soumise à approbation.',
      });
    } else {
      setSpaceCheck({ status: 'idle', message: '' });
    }
  }, [form.espace_id, espacesFormation]);

  /* ─── Data Loading ─── */
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
      const [fList, eList, tList] = await Promise.all([
        formationApi.getAll({ formateur_id: id }),
        bookingApi.getEspaces(),
        bookingApi.getTenants(),
      ]);
      const fData = fList.formations || [];
      setFormations(fData);
      setEspaces(eList.espaces || []);
      setTenants(tList.tenants || []);

      // Charger les inscriptions
      if (fData.length > 0) {
        const formationIds = fData.map(f => f.id);
        const { data: inscrData } = await supabase
          .from('inscriptions_formations')
          .select('*, profiles!user_id(id, nom, prenom, email, telephone)')
          .in('formation_id', formationIds)
          .order('created_at', { ascending: true });
        const grouped = {};
        (inscrData || []).forEach(i => {
          if (!grouped[i.formation_id]) grouped[i.formation_id] = [];
          grouped[i.formation_id].push(i);
        });
        setInscriptions(grouped);
      } else {
        setInscriptions({});
      }
    } catch (e) { setError('Erreur chargement : ' + e.message); }
    finally { setLoading(false); }
  };

  /* ─── Open Create Modal ─── */
  const openCreate = () => {
    setForm({ ...emptyForm });
    setSelectedFormation(null);
    setSelectedTenantId('');
    setEspacesFormation([]);
    setSpaceCheck({ status: 'idle', message: '' });
    // Date par défaut : dans 2 jours
    const defDate = new Date();
    defDate.setDate(defDate.getDate() + 2);
    const defDateStr = defDate.toISOString().slice(0, 10);
    setDatesFixes([defDateStr]);
    setHeureDebut('09:00');
    setHeureFin('17:00');
    setError('');
    setShowFormModal(true);
  };

  /* ─── Open Edit Modal ─── */
  const openEdit = (f) => {
    setSelectedFormation(f);
    // Retrouver le tenant de l'espace existant
    const espaceExistant = espaces.find(e => e.id === f.espace_id);
    setSelectedTenantId(espaceExistant?.tenant_id || '');
    
    // Extraire les dates fixes et les heures
    let existingDates = [];
    let hDeb = '09:00';
    let hFin = '17:00';
    if (f.date_debut) {
      const d1 = new Date(f.date_debut);
      const d2 = f.date_fin ? new Date(f.date_fin) : d1;
      const pad = (n) => String(n).padStart(2, '0');
      hDeb = `${pad(d1.getHours())}:${pad(d1.getMinutes())}`;
      hFin = `${pad(d2.getHours())}:${pad(d2.getMinutes())}`;
      existingDates = [d1.toISOString().slice(0, 10)];
      if (f.date_fin && d2.toISOString().slice(0, 10) !== d1.toISOString().slice(0, 10)) {
        existingDates.push(d2.toISOString().slice(0, 10));
      }
    }
    setDatesFixes(f.dates_fixes || existingDates);
    setHeureDebut(hDeb);
    setHeureFin(hFin);

    setForm({
      id: f.id,
      titre: f.titre || '',
      description: f.description || '',
      espace_id: f.espace_id || '',
      capacite_max: f.capacite_max || 10,
      prix_inscription: f.prix_inscription || 0,
      date_debut: f.date_debut ? new Date(f.date_debut).toISOString().slice(0, 16) : '',
      date_fin: f.date_fin ? new Date(f.date_fin).toISOString().slice(0, 16) : '',
      programme: f.programme || '',
      prerequis: f.prerequis || '',
      materiel: f.materiel || '',
      statut: f.statut || 'planifiee',
      reservation_id: f.reservation_id || '',
      mode: 'sur_place',
    });
    setError('');
    setShowFormModal(true);
  };

  /* ─── Open Delete ─── */
  const openDelete = (f) => {
    setSelectedFormation(f);
    setShowDeleteDialog(true);
  };

  /* ─── Save (Create or Update) ─── */
  const handleSave = async (e) => {
    e.preventDefault();
    if (spaceCheck.status === 'conflict') return;
    if (datesFixes.length === 0) {
      setError('Veuillez ajouter au moins une date de formation (dates fixes).');
      return;
    }
    if (!selectedTenantId) {
      setError('Veuillez sélectionner un établissement partenaire (coworking).');
      return;
    }
    setError(''); setFormSaving(true);
    try {
      const sortedDates = [...datesFixes].sort();
      const debutISO = new Date(`${sortedDates[0]}T${heureDebut}:00`).toISOString();
      const finISO = new Date(`${sortedDates[sortedDates.length - 1]}T${heureFin}:00`).toISOString();
      const totalH = calculateTotalHours();
      
      const datesSummary = sortedDates.map((d, i) =>
        `• Session ${i + 1} : ${new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} (${heureDebut} → ${heureFin})`
      ).join('\n');

      let cleanProg = form.programme || '';
      cleanProg = cleanProg.replace(/^📅 Sessions fixes.*?\n\n/s, '');
      const finalProgramme = `📅 Sessions fixes (${sortedDates.length} jour${sortedDates.length > 1 ? 's' : ''}) :\n${datesSummary}\n\n${cleanProg}`.trim();

      const payload = {
        ...form,
        formateur_id: profile.id,
        capacite_max: parseInt(form.capacite_max),
        prix_inscription: parseFloat(form.prix_inscription) || 0,
        date_debut: debutISO,
        date_fin: finISO,
        espace_id: form.espace_id || null,
        mode: form.mode || 'sur_place',
        tenant_id: selectedTenantId || undefined,
        total_heures: totalH,
        dates_fixes: sortedDates,
        programme: finalProgramme,
      };

      if (form.id) {
        await formationApi.update(form.id, payload);
        setSuccess('Formation modifiée avec succès !');
      } else {
        const created = await formationApi.create(payload);
        setSuccess(created.message || 'Formation créée avec succès ! La réservation sera validée par le coworking.');
      }

      setShowFormModal(false);
      setForm(emptyForm);
      setSelectedTenantId('');
      setDatesFixes([]);
      setEspacesFormation([]);
      await refreshData();
    } catch (err) { setError(err.message); }
    finally { setFormSaving(false); }
  };

  /* ─── Delete ─── */
  const handleDelete = async () => {
    if (!selectedFormation) return;
    setDeleting(true);
    try {
      const res = await formationApi.delete(selectedFormation.id);
      setSuccess(res.message || 'Formation supprimée.');
      setShowDeleteDialog(false);
      setSelectedFormation(null);
      await refreshData();
    } catch (err) { setError(err.message); }
    finally { setDeleting(false); }
  };

  /* ─── KPIs ─── */
  const totalFormations = formations.length;
  const planifiees = formations.filter(f => f.statut === 'planifiee').length;
  const totalInscrits = Object.values(inscriptions).reduce((s, arr) => s + arr.filter(i => i.statut !== 'annulee').length, 0);
  const totalRevenu = formations.reduce((s, f) => {
    const inscrits = (inscriptions[f.id] || []).filter(i => i.statut !== 'annulee' && i.statut_paiement === 'paye').length;
    return s + (inscrits * parseFloat(f.prix_inscription || 0));
  }, 0);

  /* ─── Filtered List ─── */
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatut]);

  const filteredFormations = filterStatut
    ? formations.filter(f => f.statut === filterStatut)
    : formations;

  const pagedFormations = filteredFormations.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

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
              <span className="w-7 h-7 rounded-lg bg-secondary/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 16 }}>school</span>
              </span>
              <span className="text-xs font-bold uppercase tracking-widest text-secondary">Espace Formateur</span>
            </div>
            <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Mes Formations</h1>
            <p className="text-sm text-on-surface-variant mt-0.5">
              Créez, modifiez et gérez toutes vos formations.
            </p>
          </div>
          <button
            id="btn-create-formation"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-5 py-3 bg-secondary text-white font-semibold rounded-2xl text-sm hover:bg-secondary/90 shadow-sm transition-all active:scale-95 shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add_circle</span>
            Nouvelle formation
          </button>
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
            { label: 'Total formations', value: totalFormations, icon: 'event_note', color: 'text-secondary bg-secondary/10' },
            { label: 'Planifiées', value: planifiees, icon: 'upcoming', color: 'text-amber-600 bg-amber-50' },
            { label: 'Total inscrits', value: totalInscrits, icon: 'group', color: 'text-violet-600 bg-violet-50' },
            { label: 'Revenus confirmés', value: `${totalRevenu.toFixed(0)} DT`, icon: 'payments', color: 'text-emerald-600 bg-emerald-50' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="bg-surface-container-lowest rounded-3xl p-4 sm:p-5 border border-outline-variant/20 shadow-sm flex items-center gap-3">
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

        {/* ── Filtres ── */}
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            { key: '', label: 'Toutes', count: formations.length },
            { key: 'planifiee', label: 'Planifiées', count: formations.filter(f => f.statut === 'planifiee').length },
            { key: 'en_cours', label: 'En cours', count: formations.filter(f => f.statut === 'en_cours').length },
            { key: 'terminee', label: 'Terminées', count: formations.filter(f => f.statut === 'terminee').length },
            { key: 'annulee', label: 'Annulées', count: formations.filter(f => f.statut === 'annulee').length },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilterStatut(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-semibold text-xs transition-all ${filterStatut === key
                ? 'bg-secondary text-white shadow-sm'
                : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                }`}
            >
              {label}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${filterStatut === key ? 'bg-white/20' : 'bg-outline-variant/20'}`}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* ── Liste des formations ── */}
        {filteredFormations.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-12 text-center shadow-sm">
            <div className="w-16 h-16 rounded-3xl bg-surface-container-low flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 32 }}>school</span>
            </div>
            <h3 className="font-sora font-bold text-primary text-xl mb-3">
              {filterStatut ? `Aucune formation "${STATUT_LABELS[filterStatut]}"` : 'Aucune formation créée'}
            </h3>
            <p className="text-sm text-on-surface-variant mb-6">
              {filterStatut ? "Modifiez le filtre pour voir d'autres formations." : 'Commencez par créer votre première formation !'}
            </p>
            {!filterStatut && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white font-semibold rounded-2xl text-sm hover:bg-secondary/90 shadow-sm transition-all active:scale-95"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                Créer ma première formation
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile Cards */}
            <div className="sm:hidden space-y-3">
              {pagedFormations.map((f) => {
                const formInscrits = (inscriptions[f.id] || []).filter(i => i.statut !== 'annulee');
                const nbInscrits = formInscrits.length;
                const fillPct = f.capacite_max > 0 ? Math.min(100, Math.round((nbInscrits / f.capacite_max) * 100)) : 0;
                const fillColor = fillPct >= 90 ? 'bg-red-500' : fillPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500';
                return (
                  <div key={f.id} className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 p-4 shadow-sm">
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <h3 className="font-sora font-bold text-primary text-sm leading-snug flex-1">{f.titre}</h3>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUT_STYLES[f.statut]}`}>
                        {STATUT_LABELS[f.statut]}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-xs text-on-surface-variant mb-3">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>location_on</span>
                        {f.espaces?.nom || '—'}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>calendar_today</span>
                        {new Date(f.date_debut).toLocaleDateString('fr-FR')} → {new Date(f.date_fin).toLocaleDateString('fr-FR')}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>payments</span>
                        {f.prix_inscription > 0 ? `${parseFloat(f.prix_inscription).toFixed(3)} DT` : 'Gratuit'}
                      </div>
                    </div>
                    {/* Fill bar */}
                    <div className="mb-3">
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-on-surface-variant">{nbInscrits} / {f.capacite_max} inscrits</span>
                        <span className="text-[10px] font-bold" style={{ color: fillPct >= 90 ? '#ef4444' : fillPct >= 60 ? '#f59e0b' : '#10b981' }}>{fillPct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-outline-variant/20 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${fillColor}`} style={{ width: `${fillPct}%` }} />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-outline-variant/10">
                      <button onClick={() => { setSelectedFormation(f); setShowParticipants(true); }} className="flex-1 py-1.5 text-xs font-semibold border border-secondary/30 text-secondary rounded-xl hover:bg-secondary/5">
                        Inscrits ({nbInscrits})
                      </button>
                      <button onClick={() => openEdit(f)} className="flex-1 py-1.5 text-xs font-semibold border border-outline-variant/30 text-on-surface-variant rounded-xl hover:bg-surface-container">
                        Modifier
                      </button>
                      <button onClick={() => openDelete({ ...f, nb_inscrits: nbInscrits })} className="px-3 py-1.5 text-xs font-semibold border border-error/30 text-error rounded-xl hover:bg-error/5">
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden sm:block bg-surface-container-lowest rounded-3xl border border-outline-variant/20 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider border-b border-outline-variant/20">
                      <th className="p-4">Titre</th>
                      <th className="p-4">Salle</th>
                      <th className="p-4">Dates</th>
                      <th className="p-4">Inscrits</th>
                      <th className="p-4">Tarif</th>
                      <th className="p-4">Statut</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {pagedFormations.map((f) => {
                      const nbInscrits = (inscriptions[f.id] || []).filter(i => i.statut !== 'annulee').length;
                      const fillPct = f.capacite_max > 0 ? Math.min(100, Math.round((nbInscrits / f.capacite_max) * 100)) : 0;
                      return (
                        <tr key={f.id} className="hover:bg-surface-container-lowest transition-colors group">
                          <td className="p-4">
                            <p className="font-semibold text-primary text-sm leading-snug line-clamp-2 max-w-[280px]">{f.titre}</p>
                            {f.description && (
                              <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-1 max-w-[280px]">{f.description}</p>
                            )}
                          </td>
                          <td className="p-4 text-xs text-on-surface-variant">{f.espaces?.nom || '—'}</td>
                          <td className="p-4 text-xs text-on-surface-variant">
                            <div>{new Date(f.date_debut).toLocaleDateString('fr-FR')} {new Date(f.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                            <div className="font-medium text-primary">{new Date(f.date_fin).toLocaleDateString('fr-FR')} {new Date(f.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-1 mb-1">
                              <span className="font-bold text-primary">{nbInscrits}</span>
                              <span className="text-on-surface-variant text-xs">/ {f.capacite_max}</span>
                            </div>
                            <div className="h-1.5 w-20 rounded-full bg-outline-variant/20 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${fillPct >= 90 ? 'bg-red-500' : fillPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${fillPct}%` }}
                              />
                            </div>
                          </td>
                          <td className="p-4 font-semibold text-primary text-sm">
                            {f.prix_inscription > 0
                              ? `${parseFloat(f.prix_inscription).toFixed(3)} DT`
                              : <span className="text-emerald-600 text-xs font-semibold">Gratuit</span>}
                          </td>
                          <td className="p-4">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUT_STYLES[f.statut] || ''}`}>
                              {STATUT_LABELS[f.statut] || f.statut}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Inscrits */}
                              <button
                                onClick={() => { setSelectedFormation(f); setShowParticipants(true); }}
                                title={`${nbInscrits} inscrits`}
                                className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-violet-50 text-violet-600 transition-colors"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>group</span>
                              </button>
                              {/* Edit */}
                              <button
                                onClick={() => openEdit(f)}
                                title="Modifier"
                                className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-container-high text-on-surface-variant transition-colors"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>edit</span>
                              </button>
                              {/* Delete */}
                              {f.statut !== 'terminee' && (
                                <button
                                  onClick={() => openDelete({ ...f, nb_inscrits: nbInscrits })}
                                  title="Supprimer"
                                  className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-50 text-error transition-colors"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>delete</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={currentPage}
                totalItems={filteredFormations.length}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setCurrentPage}
                label="formations"
              />
            </div>
            {/* Mobile Pagination */}
            <div className="sm:hidden">
              <Pagination
                currentPage={currentPage}
                totalItems={filteredFormations.length}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setCurrentPage}
                label="formations"
              />
            </div>
          </>
        )}
      </div>

      {/* ══ MODAL CRÉER / MODIFIER FORMATION ══════════════════════════════════ */}
      <Modal
        open={showFormModal}
        onClose={() => { setShowFormModal(false); setError(''); }}
        title={form.id ? 'Modifier la formation' : 'Nouvelle formation'}
        subtitle={form.id ? 'Modifiez les informations de votre formation' : 'Créez une nouvelle session de formation'}
        icon="school"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setShowFormModal(false); setError(''); }}
              className="flex-1 py-2.5 border border-outline-variant/40 text-on-surface-variant font-semibold rounded-xl text-sm hover:bg-surface-container transition-colors"
            >
              Annuler
            </button>
            <button
              form="trainerFormationForm"
              type="submit"
              disabled={formSaving || spaceCheck.status === 'conflict'}
              className="flex-1 py-2.5 bg-secondary text-white font-semibold rounded-xl text-sm hover:bg-secondary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {formSaving && <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />}
              {form.id ? 'Enregistrer' : 'Créer la formation'}
            </button>
          </div>
        }
      >
        <form id="trainerFormationForm" onSubmit={handleSave} className="space-y-4">
          <Field label="Titre de la formation" required>
            <input
              className={inputCls}
              placeholder="Ex: Atelier Design Sprint"
              required
              value={form.titre}
              onChange={e => setForm(p => ({ ...p, titre: e.target.value }))}
            />
          </Field>

          <Field label="Description">
            <textarea
              className={inputCls}
              rows={3}
              placeholder="Présentez la formation en quelques lignes..."
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            />
          </Field>

          {/* ══ ÉTAPE 1 : Établissement partenaire (Coworking en premier) ══ */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-amber-700" style={{ fontSize: 15 }}>apartment</span>
              </span>
              <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                Étape 1 — Établissement partenaire (Coworking)
              </span>
            </div>
            <Field label="Choisir un espace de coworking" required>
              <select
                className={inputCls}
                required
                value={selectedTenantId}
                onChange={e => {
                  setSelectedTenantId(e.target.value);
                  setForm(p => ({ ...p, espace_id: '' }));
                }}
              >
                <option value="">— Sélectionner un coworking partenaire —</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nom}{t.ville ? ` (${t.ville})` : ''} — Partenaire Officiel
                  </option>
                ))}
              </select>
              {selectedTenantId && (
                <div className="flex items-center gap-2 text-xs text-amber-800 font-medium mt-1">
                  <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: 16 }}>verified</span>
                  <span>Établissement sélectionné. Choisissez maintenant une salle de formation ci-dessous.</span>
                </div>
              )}
            </Field>
          </div>

          {/* ══ ÉTAPE 2 : Espace & Salle de ce coworking ══ */}
          <div className={`rounded-2xl border p-4 space-y-3 transition-all duration-200 ${!selectedTenantId
            ? 'border-slate-200 bg-slate-50 opacity-50 pointer-events-none select-none'
            : 'border-emerald-200 bg-emerald-50/70'
            }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-emerald-700" style={{ fontSize: 15 }}>meeting_room</span>
                </span>
                <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                  Étape 2 — Salle ou Espace du coworking
                </span>
              </div>
              {loadingEspaces && (
                <span className="animate-spin h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full shrink-0" />
              )}
            </div>

            {selectedTenantId && !loadingEspaces && espacesFormation.length === 0 && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                <span className="material-symbols-outlined shrink-0" style={{ fontSize: 15 }}>warning</span>
                Aucune salle de formation disponible pour cet établissement.
              </div>
            )}

            {selectedTenantId && !loadingEspaces && espacesFormation.length > 0 && (
              <Field label="Salle de formation ou Open space" required>
                <select
                  className={inputCls}
                  required
                  value={form.espace_id}
                  onChange={e => setForm(p => ({ ...p, espace_id: e.target.value }))}
                >
                  <option value="">— Sélectionner une salle / espace —</option>
                  {espacesFormation.filter(e => e.type === 'training_room').length > 0 && (
                    <optgroup label="🎓 Salles de formation (Recommandé)">
                      {espacesFormation
                        .filter(e => e.type === 'training_room')
                        .map(e => (
                          <option key={e.id} value={e.id}>
                            {e.nom} — {e.capacite} places ({e.tarif_horaire || 0} DT/h)
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {espacesFormation.filter(e => e.type === 'open_space').length > 0 && (
                    <optgroup label="🪑 Open spaces">
                      {espacesFormation
                        .filter(e => e.type === 'open_space')
                        .map(e => (
                          <option key={e.id} value={e.id}>
                            {e.nom} — {e.capacite} places ({e.tarif_horaire || 0} DT/h)
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>

                {spaceCheck.status !== 'idle' && (
                  <div className={`mt-2 p-3 rounded-xl text-xs font-semibold flex items-start gap-2 ${spaceCheck.status === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : spaceCheck.status === 'conflict'
                      ? 'bg-red-50 text-red-800 border border-red-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}>
                    <span className="material-symbols-outlined shrink-0" style={{ fontSize: 16 }}>
                      {spaceCheck.status === 'ok' ? 'check_circle' : spaceCheck.status === 'conflict' ? 'event_busy' : 'hourglass_top'}
                    </span>
                    <span>{spaceCheck.message}</span>
                  </div>
                )}
              </Field>
            )}
          </div>

          {/* ══ ÉTAPE 3 : Dates fixes & Horaires de la formation (Plusieurs jours) ══ */}
          <div className={`rounded-2xl border p-4 space-y-4 transition-all duration-200 ${!selectedTenantId || !form.espace_id
            ? 'border-slate-200 bg-slate-50 opacity-50 pointer-events-none select-none'
            : 'border-indigo-200 bg-indigo-50/70'
            }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-indigo-700" style={{ fontSize: 15 }}>event_repeat</span>
                </span>
                <span className="text-xs font-bold text-indigo-800 uppercase tracking-wider">
                  Étape 3 — Dates fixes &amp; Horaires (Plusieurs jours)
                </span>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                {datesFixes.length} jour{datesFixes.length > 1 ? 's' : ''} sélectionné{datesFixes.length > 1 ? 's' : ''}
              </span>
            </div>

            {/* Horaires quotidiens */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/80 p-3 rounded-xl border border-indigo-100">
              <Field label="Heure de début quotidienne" required>
                <input
                  type="time"
                  className={inputCls}
                  required
                  value={heureDebut}
                  onChange={e => setHeureDebut(e.target.value)}
                />
              </Field>
              <Field label="Heure de fin quotidienne" required>
                <input
                  type="time"
                  className={inputCls}
                  required
                  value={heureFin}
                  onChange={e => setHeureFin(e.target.value)}
                />
              </Field>
              <div className="sm:col-span-2 text-right">
                <span className="text-xs font-semibold text-indigo-700">
                  Durée par session : {calculateDailyHours()}h
                </span>
              </div>
            </div>

            {/* Ajouter une date fixe */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Ajouter des dates fixes pour la formation</span>
                <span className="text-[11px] font-normal text-slate-500">Sélectionnez chaque jour de session</span>
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className={inputCls}
                  min={new Date().toISOString().slice(0, 10)}
                  value={newDateInput}
                  onChange={e => setNewDateInput(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newDateInput) {
                      addDateFixe(newDateInput);
                    }
                  }}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs sm:text-sm whitespace-nowrap flex items-center gap-1.5 transition-all shadow-xs"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                  <span>Ajouter</span>
                </button>
              </div>

              {/* Raccourcis rapides */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-semibold text-slate-500 mr-1">Raccourcis :</span>
                <button
                  type="button"
                  onClick={addNextDay}
                  className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-bold rounded-lg transition-colors"
                >
                  + Jour suivant
                </button>
                <button
                  type="button"
                  onClick={addNextSaturday}
                  className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-bold rounded-lg transition-colors"
                >
                  + Samedi prochain
                </button>
              </div>
            </div>

            {/* Liste des dates fixes sélectionnées */}
            {datesFixes.length === 0 ? (
              <div className="p-3.5 bg-white/70 border border-dashed border-indigo-200 rounded-xl text-center text-xs text-indigo-600 font-medium">
                Aucune date fixée. Ajoutez au moins une date ci-dessus pour planifier la formation.
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Planning des séances ({datesFixes.length} jour{datesFixes.length > 1 ? 's' : ''}) :
                </p>
                <div className="grid gap-2 max-h-48 overflow-y-auto pr-1">
                  {datesFixes.map((dStr, idx) => {
                    const dateObj = new Date(dStr + 'T00:00:00');
                    const formatted = dateObj.toLocaleDateString('fr-FR', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    });
                    return (
                      <div
                        key={dStr}
                        className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-indigo-100 shadow-2xs hover:border-indigo-300 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-800 text-[11px] font-bold flex items-center justify-center shrink-0">
                            J{idx + 1}
                          </span>
                          <div>
                            <p className="text-xs font-bold text-slate-800 capitalize">{formatted}</p>
                            <p className="text-[10px] text-slate-500 font-medium">
                              {heureDebut} → {heureFin} · {calculateDailyHours()}h
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeDateFixe(dStr)}
                          title="Supprimer cette séance"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Estimation du coût de location & Résumé */}
            {form.espace_id && getSelectedSpace() && datesFixes.length > 0 && (
              <div className="pt-3 border-t border-indigo-200/80 space-y-3">
                <div className="p-3.5 rounded-2xl bg-white border border-indigo-200 flex items-center justify-between shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-indigo-700" style={{ fontSize: 20 }}>payments</span>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">Coût estimé location de salle</p>
                      <p className="text-[11px] text-slate-500">
                        {getSelectedSpace()?.tarif_horaire || 0} DT/h × {calculateTotalHours()} h ({datesFixes.length} séance{datesFixes.length > 1 ? 's' : ''} de {calculateDailyHours()}h)
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-sora font-extrabold text-xl text-indigo-700">{calculateSpacePrice()}</span>
                    <span className="text-xs font-bold text-indigo-600 ml-1">DT</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
                  <strong>Validation obligatoire par le coworking :</strong> La réservation sera envoyée au responsable du coworking pour approbation. Le règlement sera effectué sur place lors de votre arrivée.
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Capacité max (places)" required>
              <input
                type="number"
                min={1}
                className={inputCls}
                required
                value={form.capacite_max}
                onChange={e => setForm(p => ({ ...p, capacite_max: e.target.value }))}
              />
            </Field>
            <Field label="Prix d'inscription (DT)">
              <input
                type="number"
                min={0}
                step="0.5"
                className={inputCls}
                placeholder="0 = Gratuit"
                value={form.prix_inscription}
                onChange={e => setForm(p => ({ ...p, prix_inscription: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Programme / Déroulement">
            <textarea
              className={inputCls}
              rows={3}
              placeholder={"9h-10h : Introduction\n10h-12h : Atelier pratique..."}
              value={form.programme}
              onChange={e => setForm(p => ({ ...p, programme: e.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Prérequis">
              <input
                className={inputCls}
                placeholder="Ex: Notions de base en design"
                value={form.prerequis}
                onChange={e => setForm(p => ({ ...p, prerequis: e.target.value }))}
              />
            </Field>
            <Field label="Matériel à apporter">
              <input
                className={inputCls}
                placeholder="Ex: Ordinateur portable"
                value={form.materiel}
                onChange={e => setForm(p => ({ ...p, materiel: e.target.value }))}
              />
            </Field>
          </div>

          {form.id && (
            <Field label="Statut">
              <select
                className={inputCls}
                value={form.statut}
                onChange={e => setForm(p => ({ ...p, statut: e.target.value }))}
              >
                <option value="planifiee">Planifiée</option>
                <option value="en_cours">En cours</option>
                <option value="terminee">Terminée</option>
                <option value="annulee">Annulée</option>
              </select>
            </Field>
          )}

          {error && showFormModal && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
              <span className="material-symbols-outlined shrink-0" style={{ fontSize: 14 }}>error</span>
              {error}
            </div>
          )}
        </form>
      </Modal>

      {/* ══ MODAL PARTICIPANTS ══════════════════════════════════════════════ */}
      <ParticipantsModal
        open={showParticipants}
        onClose={() => setShowParticipants(false)}
        formation={selectedFormation}
        inscriptions={inscriptions}
      />

      {/* ══ DIALOG SUPPRESSION ══════════════════════════════════════════════ */}
      <DeleteDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        formation={selectedFormation}
        loading={deleting}
      />
    </PortalLayout>
  );
}
