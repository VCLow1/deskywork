import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { tenantAdminApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import FloorPlanEditor from '../components/floorplan/FloorPlanEditor';
import AdminPricing from './AdminPricing';
import { formatDT, formatDateTimeDMY } from '../utils/format';
import Money from '../components/common/Money';
import { DEFAULT_TVA_PCT, computeTTC } from '../utils/pricingMath';
import UnitStatusModal from '../components/units/UnitStatusModal';

const ITEMS_PER_PAGE = 10;

const ESPACE_TYPES = [
  { value: 'open_space', label: 'Open space', icon: 'desk', color: '#f95d00' },
  { value: 'private_office', label: 'Bureau privé', icon: 'meeting_room', color: '#f95d00' },
  { value: 'meeting_room', label: 'Salle de réunion', icon: 'groups', color: '#1a7a5a' },
  { value: 'training_room', label: 'Salle de formation', icon: 'school', color: '#b45309' },
  { value: 'event_space', label: 'Espace événementiel', icon: 'celebration', color: '#b91c1c' },
  { value: 'hot_desk', label: 'Poste nomade', icon: 'laptop_mac', color: '#f95d00' },
  { value: 'dedicated_desk', label: 'Poste fixe', icon: 'push_pin', color: '#4338ca' },
];

const AMENITIES_OPTIONS = [
  'Wi-Fi Fibre Haut Débit',
  'Prises électriques individuelles',
  'Vidéoprojecteur HD',
  'Tableau blanc & Marqueurs',
  'Écran TV / Moniteur',
  'Système visioconférence',
  'Climatisation / Chauffage',
  'Isolation phonique',
  'Machine à café / Eau fraîche',
  'Accès sécurisé 24/7',
  'Lumière naturelle',
  'Imprimante & Scanner',
];

const STATUT_OPTIONS = [
  { value: 'actif', label: 'Actif', color: '#10b981', bg: '#ecfdf5', icon: 'check_circle' },
  { value: 'en_maintenance', label: 'En maintenance', color: '#f59e0b', bg: '#fffbeb', icon: 'construction' },
  { value: 'inactif', label: 'Inactif', color: '#64748b', bg: '#f1f5f9', icon: 'cancel' },
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
  });
}

async function uploadImageToBackend(file, folder = 'espaces') {
  const base64Data = await fileToBase64(file);
  const res = await tenantAdminApi.uploadPhoto({
    base64Data,
    fileName: file.name,
    fileType: file.type,
    folder,
  });
  return res.publicUrl;
}

const EMPTY_FORM = {
  nom: '',
  type: 'open_space',
  capacite: 10,
  description: '',
  statut: 'actif',
  horaires: '08:00 - 20:00',
  tarif_horaire: 15,
  tarif_journalier: 75,
  tarif_mensuel: 450,
  equipements: ['Wi-Fi Fibre Haut Débit', 'Prises électriques individuelles'],
  photo_url: '',
};

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 bg-white text-sm text-primary outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15 transition-all placeholder:text-on-surface-variant/50';

const HUB_TABS = [
  { id: 'espaces', label: 'Espaces', icon: 'meeting_room' },
  { id: 'unites', label: 'Unités & Postes', icon: 'grid_view' },
  { id: 'plan', label: 'Plan 2D', icon: 'map' },
  { id: 'ressources', label: 'Ressources', icon: 'inventory_2' },
  { id: 'services', label: 'Services', icon: 'room_service' },
  { id: 'domiciliation', label: 'Domiciliation', icon: 'corporate_fare' },
  { id: 'tarifs', label: 'Tarifs et formules', icon: 'sell' },
  { id: 'promos', label: 'Codes promo', icon: 'confirmation_number' },
  { id: 'incidents', label: 'Maintenance et incidents', icon: 'build' },
];

export default function AdminEspaces({ session }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'espaces';
  const activeTab = HUB_TABS.some((t) => t.id === rawTab) ? rawTab : (rawTab === 'list' ? 'espaces' : 'espaces');
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null
  );
  const [espaces, setEspaces] = useState([]);
  const [unites, setUnites] = useState([]);
  const [unitForm, setUnitForm] = useState({ espace_id: '', mode: 'single', code: '', nom: '', type_unite: 'bureau_prive', capacite: 1, batch_prefix: 'B', batch_count: 4 });
  const [statusModalUnit, setStatusModalUnit] = useState(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [ressources, setRessources] = useState([]);
  const [services, setServices] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [domForm, setDomForm] = useState({ actif: false, tarif_mensuel: 0, tarif_annuel: 0, description: '' });
  const [resForm, setResForm] = useState({ nom: '', categorie: 'equipement', quantite: 1 });
  const [svcForm, setSvcForm] = useState({ nom: '', prix_ht: '', tva_pct: DEFAULT_TVA_PCT, unite: 'unité' });
  const [incForm, setIncForm] = useState({ titre: '', espace_id: '', priorite: 'normale', description: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [toast, setToast] = useState('');
  const [toastErr, setToastErr] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const fileRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const showError = (msg) => { setToastErr(msg); setTimeout(() => setToastErr(''), 4000); };

  useEffect(() => {
    if (userId) loadData();
  }, [userId, includeArchived]);

  const loadData = async () => {
    try {
      setLoading(true);
      const archParam = includeArchived ? { include_archived: 'true' } : {};
      const [res, tRes, resList, svcList, incList, uniList] = await Promise.all([
        tenantAdminApi.getEspaces(archParam),
        tenantAdminApi.getTenant().catch(() => null),
        tenantAdminApi.getRessources(archParam).catch(() => ({ items: [] })),
        tenantAdminApi.getServices(archParam).catch(() => ({ items: [] })),
        tenantAdminApi.getIncidents(archParam).catch(() => ({ items: [] })),
        tenantAdminApi.getUnites(archParam).catch(() => ({ unites: [] })),
      ]);
      setEspaces(res.espaces || []);
      setRessources(resList.items || []);
      setServices(svcList.items || []);
      setIncidents(incList.items || []);
      setUnites(uniList.unites || []);
      if (tRes?.tenant?.settings?.domiciliation) {
        setDomForm({
          actif: Boolean(tRes.tenant.settings.domiciliation.actif),
          tarif_mensuel: Number(tRes.tenant.settings.domiciliation.tarif_mensuel || 0),
          tarif_annuel: Number(tRes.tenant.settings.domiciliation.tarif_annuel || 0),
          description: tRes.tenant.settings.domiciliation.description || '',
        });
      }
    } catch (e) { showError(e.message); }
    finally { setLoading(false); }
  };

  const handlePhotoUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showError('Fichier invalide. Veuillez sélectionner une image.'); return; }
    if (file.size > 5 * 1024 * 1024) { showError('Image trop grande. Maximum 5 MB.'); return; }
    setUploading(true);
    try {
      const url = await uploadImageToBackend(file, 'espaces');
      setForm(f => ({ ...f, photo_url: url }));
    } catch (e) { showError(e.message); }
    finally { setUploading(false); }
  };

  const handleSave = async () => {
    if (!form.nom.trim()) { showError('Le nom de l\'espace est requis.'); return; }
    if (!form.type) { showError('Le type est requis.'); return; }
    if (!form.capacite || parseInt(form.capacite) < 1) { showError('La capacité doit être ≥ 1.'); return; }
    setSaving(true);
    try {
      const payload = {
        nom: form.nom.trim(),
        type: form.type,
        capacite: parseInt(form.capacite, 10),
        description: form.description ? form.description.trim() : '',
        statut: form.statut || 'actif',
        horaires: form.horaires ? form.horaires.trim() : '08:00 - 20:00',
        equipements: Array.isArray(form.equipements) ? form.equipements : [],
        photo_url: form.photo_url || '',
      };
      if (editId) {
        await tenantAdminApi.updateEspace(editId, payload);
        showToast('Espace mis à jour avec succès.');
      } else {
        await tenantAdminApi.createEspace(payload);
        showToast('Espace créé avec succès.');
      }
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      setEditId(null);
      await loadData();
    } catch (e) { showError(e.message); }
    finally { setSaving(false); }
  };

  const handleEdit = (espace) => {
    setEditId(espace.id);
    setForm({
      nom: espace.nom || '',
      type: espace.type || 'open_space',
      capacite: espace.capacite || 10,
      description: espace.description || '',
      statut: espace.statut || (espace.actif === false ? 'inactif' : 'actif'),
      horaires: espace.horaires || '08:00 - 20:00',
      tarif_horaire: espace.tarif_horaire || 0,
      tarif_journalier: espace.tarif_journalier || 0,
      tarif_mensuel: espace.tarif_mensuel || 0,
      equipements: Array.isArray(espace.equipements) ? espace.equipements : [],
      photo_url: espace.photo_url || '',
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (espace) => {
    if (!window.confirm(`Archiver l'espace "${espace.nom}" ? Il restera conservé dans l'historique.`)) return;
    try {
      await tenantAdminApi.archiveEspace(espace.id);
      showToast(`Espace "${espace.nom}" archivé.`);
      await loadData();
    } catch (e) { showError(e.message); }
  };

  const handleRestoreEspace = async (espace) => {
    try {
      await tenantAdminApi.restoreEspace(espace.id);
      showToast(`Espace "${espace.nom}" restauré.`);
      await loadData();
    } catch (e) { showError(e.message); }
  };

  const getTypeInfo = (type) => ESPACE_TYPES.find(t => t.value === type) || ESPACE_TYPES[0];

  if (loading) return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="p-6">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse h-48" />
          ))}
        </div>
      </div>
    </PortalLayout>
  );

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>

      {/* Toasts */}
      {toast && (
        <div className="fixed top-20 right-4 z-[9998] flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-2xl shadow-xl text-sm font-semibold">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>{toast}
        </div>
      )}
      {toastErr && (
        <div className="fixed top-20 right-4 z-[9998] flex items-center gap-2 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-xl text-sm font-semibold">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>{toastErr}
        </div>
      )}

      <div className="max-w-7xl mx-auto">

        {/* Header Hub Espaces et offres */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div className="text-left">
            <h1 className="font-sora font-bold text-[#100f0d] text-2xl sm:text-3xl">Espaces et offres</h1>
            <p className="text-on-surface-variant text-sm mt-1">
              Espaces, plan 2D, ressources, services additionnels, domiciliation, tarifs HT/TTC, codes promo et maintenance.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-outline-variant/25 bg-white text-xs font-semibold cursor-pointer">
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="accent-[#f95d00]" />
              Afficher les archivés
            </label>
            {activeTab === 'espaces' && (
              <button
                onClick={() => { setShowForm(v => !v); setEditId(null); setForm({ ...EMPTY_FORM }); }}
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-sm hover:opacity-95 transition-all shadow-sm"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{showForm && !editId ? 'close' : 'add'}</span>
                {showForm && !editId ? 'Annuler' : 'Nouvel espace'}
              </button>
            )}
          </div>
        </div>

        {/* 7+ sous-onglets du Hub Espaces et offres */}
        <div className="flex flex-wrap gap-2 mb-6">
          {HUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSearchParams(t.id === 'espaces' ? {} : { tab: t.id })}
              style={activeTab === t.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition ${
                activeTab === t.id
                  ? 'shadow-xs'
                  : 'bg-white border border-outline-variant/20 text-on-surface-variant hover:text-[#100f0d]'
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {activeTab === 'plan' ? (
          <FloorPlanEditor espaces={espaces} showToast={showToast} showError={showError} />
        ) : activeTab === 'unites' ? (
          <div className="space-y-5 text-left">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!unitForm.espace_id) { showError('Sélectionnez un espace de rattachement.'); return; }
                try {
                  if (unitForm.mode === 'batch') {
                    await tenantAdminApi.createUnite({
                      espace_id: unitForm.espace_id,
                      type_unite: unitForm.type_unite,
                      capacite: Number(unitForm.capacite || 1),
                      batch_prefix: unitForm.batch_prefix || 'B',
                      batch_count: Number(unitForm.batch_count || 1),
                      nom: unitForm.nom || unitForm.batch_prefix,
                    });
                    showToast('Lot d\'unités créé avec succès.');
                  } else {
                    await tenantAdminApi.createUnite({
                      espace_id: unitForm.espace_id,
                      code: unitForm.code,
                      nom: unitForm.nom || unitForm.code,
                      type_unite: unitForm.type_unite,
                      capacite: Number(unitForm.capacite || 1),
                    });
                    showToast('Unité créée avec succès.');
                  }
                  setUnitForm((f) => ({ ...f, code: '', nom: '' }));
                  await loadData();
                } catch (err) {
                  showError(err.message);
                }
              }}
              className="bg-white rounded-3xl border border-outline-variant/20 p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-sora font-bold text-base text-primary">Ajouter des unités / postes</h2>
                  <p className="text-xs text-on-surface-variant">
                    Modélisez chaque bureau privé (ex : B-01, B-02) ou poste Open Space pour le contrôle de disponibilité atomique.
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {[
                    { id: 'single', label: 'Unitaire' },
                    { id: 'batch', label: 'Création en lot' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setUnitForm((f) => ({ ...f, mode: m.id }))}
                      style={unitForm.mode === m.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                        unitForm.mode === m.id ? '' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1">Espace rattaché *</label>
                  <select
                    required
                    value={unitForm.espace_id}
                    onChange={(e) => setUnitForm((f) => ({ ...f, espace_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">— Choisir un espace —</option>
                    {espaces.filter((es) => !es.archived_at).map((es) => (
                      <option key={es.id} value={es.id}>{es.nom}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-on-surface-variant mb-1">Type d&apos;unité</label>
                  <select
                    value={unitForm.type_unite}
                    onChange={(e) => setUnitForm((f) => ({ ...f, type_unite: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="bureau_prive">Bureau privé</option>
                    <option value="poste_open_space">Poste Open space</option>
                    <option value="poste_fixe">Poste fixe</option>
                    <option value="salle">Salle dédiée</option>
                  </select>
                </div>

                {unitForm.mode === 'batch' ? (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-on-surface-variant mb-1">Préfixe (ex : B, OS)</label>
                      <input
                        required
                        value={unitForm.batch_prefix}
                        onChange={(e) => setUnitForm((f) => ({ ...f, batch_prefix: e.target.value.toUpperCase() }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-on-surface-variant mb-1">Nombre à créer</label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        required
                        value={unitForm.batch_count}
                        onChange={(e) => setUnitForm((f) => ({ ...f, batch_count: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-on-surface-variant mb-1">Code * (ex : B-01)</label>
                      <input
                        required
                        value={unitForm.code}
                        onChange={(e) => setUnitForm((f) => ({ ...f, code: e.target.value }))}
                        placeholder="B-01"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-on-surface-variant mb-1">Libellé</label>
                      <input
                        value={unitForm.nom}
                        onChange={(e) => setUnitForm((f) => ({ ...f, nom: e.target.value }))}
                        placeholder="Bureau privé 01"
                        className={inputCls}
                      />
                    </div>
                  </>
                )}

                <div className="flex gap-2">
                  <div className="w-24">
                    <label className="block text-xs font-bold text-on-surface-variant mb-1">Capacité</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={unitForm.capacite}
                      onChange={(e) => setUnitForm((f) => ({ ...f, capacite: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <button
                    type="submit"
                    style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                    className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold shadow-xs hover:opacity-95"
                  >
                    Créer
                  </button>
                </div>
              </div>
            </form>

            <div className="bg-white rounded-3xl border border-outline-variant/15 overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="border-b text-xs uppercase text-on-surface-variant">
                    <th className="py-3.5 px-4">Code / Nom</th>
                    <th className="py-3.5 px-4">Espace</th>
                    <th className="py-3.5 px-4">Type &amp; Capacité</th>
                    <th className="py-3.5 px-4">Statut</th>
                    <th className="py-3.5 px-4">Motif interne / Retour</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {unites.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-on-surface-variant text-sm">
                        Aucune unité ou poste configuré pour cet établissement.
                      </td>
                    </tr>
                  ) : (
                    unites.map((u) => {
                      const espName = u.espaces?.nom || espaces.find((e) => e.id === u.espace_id)?.nom || '—';
                      const badge = u.statut === 'en_maintenance'
                        ? { cls: 'bg-slate-100 text-slate-800 border-slate-300', icon: 'construction', txt: 'En maintenance' }
                        : u.statut === 'non_disponible'
                          ? { cls: 'bg-amber-100 text-amber-900 border-amber-300', icon: 'block', txt: 'Non disponible' }
                          : { cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: 'check_circle', txt: 'Disponible' };
                      return (
                        <tr key={u.id} className={u.archived_at ? 'opacity-60 bg-slate-50/70' : 'hover:bg-surface-container-low/40'}>
                          <td className="py-3 px-4 font-bold text-primary">
                            {u.code} · <span className="font-semibold">{u.nom}</span>
                          </td>
                          <td className="py-3 px-4">{espName}</td>
                          <td className="py-3 px-4 text-xs text-on-surface-variant">
                            {u.type_unite.replace(/_/g, ' ')} · {u.capacite} place(s)
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.cls}`}>
                              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{badge.icon}</span>
                              {badge.txt}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs text-on-surface-variant">
                            {u.motif_interne ? <p className="font-medium text-primary">{u.motif_interne}</p> : '—'}
                            {u.date_retour_auto && <p>Retour auto : {formatDateTimeDMY(u.date_retour_auto)}</p>}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                            {u.archived_at ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await tenantAdminApi.restoreUnite(u.id);
                                  showToast('Unité restaurée.');
                                  await loadData();
                                }}
                                className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-bold text-emerald-700"
                              >
                                Restaurer
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setStatusModalUnit(u)}
                                  style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                                  className="rounded-lg px-3 py-1.5 text-xs font-bold"
                                >
                                  Changer statut
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!window.confirm(`Archiver l'unité ${u.code} ?`)) return;
                                    try {
                                      await tenantAdminApi.archiveUnite(u.id);
                                      showToast('Unité archivée.');
                                      await loadData();
                                    } catch (err) {
                                      showError(err.message);
                                    }
                                  }}
                                  className="rounded-lg border border-outline-variant/30 px-2.5 py-1.5 text-xs font-semibold text-on-surface-variant"
                                >
                                  Archiver
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'tarifs' ? (
          <AdminPricing session={session} embedded initialTab="espaces_tarifs" />
        ) : activeTab === 'promos' ? (
          <AdminPricing session={session} embedded initialTab="promo" />
        ) : activeTab === 'domiciliation' ? (
          <div className="bg-white rounded-3xl border border-outline-variant/20 p-6 max-w-2xl space-y-4">
            <h2 className="font-sora font-bold text-lg text-primary">Offre de domiciliation d'entreprise</h2>
            <label className="flex items-center gap-2.5 text-sm font-semibold cursor-pointer">
              <input type="checkbox" checked={domForm.actif} onChange={(e) => setDomForm((f) => ({ ...f, actif: e.target.checked }))} className="w-4 h-4 accent-[#f95d00]" />
              Proposer la domiciliation commerciale aux entreprises
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Tarif mensuel HT (DT)</label>
                <input type="number" min="0" step="0.001" value={domForm.tarif_mensuel} onChange={(e) => setDomForm((f) => ({ ...f, tarif_mensuel: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Tarif annuel HT (DT)</label>
                <input type="number" min="0" step="0.001" value={domForm.tarif_annuel} onChange={(e) => setDomForm((f) => ({ ...f, tarif_annuel: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Services inclus (réception courrier, justificatif…)</label>
              <textarea rows={3} value={domForm.description} onChange={(e) => setDomForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await tenantAdminApi.updateTenant({ domiciliation: domForm });
                    showToast('Offre de domiciliation enregistrée.');
                  } catch (err) { showError(err.message); }
                }}
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="px-5 py-2.5 rounded-xl text-sm font-bold"
              >
                Enregistrer la domiciliation
              </button>
            </div>
          </div>
        ) : activeTab === 'ressources' ? (
          <div className="space-y-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await tenantAdminApi.createRessource({ ...resForm, quantite: Number(resForm.quantite || 1) });
                  setResForm({ nom: '', categorie: 'equipement', quantite: 1 });
                  showToast('Ressource ajoutée.');
                  await loadData();
                } catch (err) { showError(err.message); }
              }}
              className="bg-white rounded-2xl p-4 border border-outline-variant/20 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            >
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">Nom de la ressource *</label>
                <input required value={resForm.nom} onChange={(e) => setResForm((f) => ({ ...f, nom: e.target.value }))} placeholder="Ex : Vidéoprojecteur Epson" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">Catégorie</label>
                <input value={resForm.categorie} onChange={(e) => setResForm((f) => ({ ...f, categorie: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">Quantité</label>
                <input type="number" min="1" value={resForm.quantite} onChange={(e) => setResForm((f) => ({ ...f, quantite: e.target.value }))} className={inputCls} />
              </div>
              <button type="submit" style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="py-2.5 px-4 rounded-xl text-sm font-bold">Ajouter</button>
            </form>
            <div className="bg-white rounded-2xl border border-outline-variant/15 overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead><tr className="border-b text-xs uppercase text-on-surface-variant"><th className="py-3 px-4">Nom</th><th className="py-3 px-4">Catégorie</th><th className="py-3 px-4">Qté</th><th className="py-3 px-4 text-right">Actions</th></tr></thead>
                <tbody className="divide-y">
                  {ressources.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-on-surface-variant">Aucune ressource enregistrée.</td></tr> : ressources.map((r) => (
                    <tr key={r.id} className={r.archived_at ? 'opacity-60' : ''}>
                      <td className="py-3 px-4 font-semibold">{r.nom}</td>
                      <td className="py-3 px-4">{r.categorie || '—'}</td>
                      <td className="py-3 px-4">{r.quantite || 1}</td>
                      <td className="py-3 px-4 text-right">
                        {r.archived_at ? (
                          <button type="button" onClick={async () => { await tenantAdminApi.restoreRessource(r.id); await loadData(); }} className="text-emerald-700 text-xs font-bold">Restaurer</button>
                        ) : (
                          <button type="button" onClick={async () => { if (window.confirm('Archiver cette ressource ?')) { await tenantAdminApi.archiveRessource(r.id); await loadData(); } }} className="text-on-surface-variant text-xs font-bold">Archiver</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'services' ? (
          <div className="space-y-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const ht = Number(svcForm.prix_ht || 0);
                  const tva = Number(svcForm.tva_pct ?? DEFAULT_TVA_PCT);
                  await tenantAdminApi.createService({
                    nom: svcForm.nom.trim(),
                    prix_ht: ht,
                    tva_pct: tva,
                    prix_ttc: computeTTC(ht, tva),
                    unite: svcForm.unite,
                  });
                  setSvcForm({ nom: '', prix_ht: '', tva_pct: DEFAULT_TVA_PCT, unite: 'unité' });
                  showToast('Service additionnel créé.');
                  await loadData();
                } catch (err) { showError(err.message); }
              }}
              className="bg-white rounded-2xl p-4 border border-outline-variant/20 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
            >
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-on-surface-variant mb-1">Nom du service *</label>
                <input required value={svcForm.nom} onChange={(e) => setSvcForm((f) => ({ ...f, nom: e.target.value }))} placeholder="Ex : Pause café / Imprimerie" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">Prix HT (DT) *</label>
                <input type="number" step="0.001" min="0" required value={svcForm.prix_ht} onChange={(e) => setSvcForm((f) => ({ ...f, prix_ht: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">TVA %</label>
                <input type="number" step="0.5" min="0" value={svcForm.tva_pct} onChange={(e) => setSvcForm((f) => ({ ...f, tva_pct: e.target.value }))} className={inputCls} />
              </div>
              <button type="submit" style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="py-2.5 px-4 rounded-xl text-sm font-bold">Ajouter</button>
            </form>
            <div className="bg-white rounded-2xl border border-outline-variant/15 overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead><tr className="border-b text-xs uppercase text-on-surface-variant"><th className="py-3 px-4">Service</th><th className="py-3 px-4">Prix HT</th><th className="py-3 px-4">Prix TTC</th><th className="py-3 px-4 text-right">Actions</th></tr></thead>
                <tbody className="divide-y">
                  {services.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-on-surface-variant">Aucun service enregistré.</td></tr> : services.map((s) => (
                    <tr key={s.id} className={s.archived_at ? 'opacity-60' : ''}>
                      <td className="py-3 px-4 font-semibold">{s.nom}</td>
                      <td className="py-3 px-4"><Money amount={s.prix_ht} showTaxType="HT" /></td>
                      <td className="py-3 px-4 font-bold text-[#f95d00]"><Money amount={s.prix_ttc ?? computeTTC(s.prix_ht, s.tva_pct)} showTaxType="TTC" /></td>
                      <td className="py-3 px-4 text-right">
                        {s.archived_at ? (
                          <button type="button" onClick={async () => { await tenantAdminApi.restoreService(s.id); await loadData(); }} className="text-emerald-700 text-xs font-bold">Restaurer</button>
                        ) : (
                          <button type="button" onClick={async () => { if (window.confirm('Archiver ce service ?')) { await tenantAdminApi.archiveService(s.id); await loadData(); } }} className="text-on-surface-variant text-xs font-bold">Archiver</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'incidents' ? (
          <div className="space-y-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await tenantAdminApi.createIncident({ ...incForm, statut: 'ouvert' });
                  setIncForm({ titre: '', espace_id: '', priorite: 'normale', description: '' });
                  showToast('Incident de maintenance enregistré.');
                  await loadData();
                } catch (err) { showError(err.message); }
              }}
              className="bg-white rounded-2xl p-4 border border-outline-variant/20 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            >
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">Titre incident *</label>
                <input required value={incForm.titre} onChange={(e) => setIncForm((f) => ({ ...f, titre: e.target.value }))} placeholder="Ex : Climatisation en panne" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">Espace concerné</label>
                <select value={incForm.espace_id} onChange={(e) => setIncForm((f) => ({ ...f, espace_id: e.target.value }))} className={inputCls}>
                  <option value="">Général</option>
                  {espaces.map((es) => <option key={es.id} value={es.id}>{es.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">Priorité</label>
                <select value={incForm.priorite} onChange={(e) => setIncForm((f) => ({ ...f, priorite: e.target.value }))} className={inputCls}>
                  <option value="basse">Basse</option>
                  <option value="normale">Normale</option>
                  <option value="haute">Haute</option>
                  <option value="critique">Critique</option>
                </select>
              </div>
              <button type="submit" style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="py-2.5 px-4 rounded-xl text-sm font-bold">Déclarer</button>
            </form>
            <div className="bg-white rounded-2xl border border-outline-variant/15 overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead><tr className="border-b text-xs uppercase text-on-surface-variant"><th className="py-3 px-4">Incident</th><th className="py-3 px-4">Priorité</th><th className="py-3 px-4">Statut</th><th className="py-3 px-4 text-right">Actions</th></tr></thead>
                <tbody className="divide-y">
                  {incidents.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-on-surface-variant">Aucun incident signalé.</td></tr> : incidents.map((inc) => (
                    <tr key={inc.id} className={inc.archived_at ? 'opacity-60' : ''}>
                      <td className="py-3 px-4"><p className="font-semibold">{inc.titre}</p><p className="text-xs text-on-surface-variant">{formatDateTimeDMY(inc.created_at)}</p></td>
                      <td className="py-3 px-4 capitalize font-semibold">{inc.priorite || 'normale'}</td>
                      <td className="py-3 px-4 capitalize font-bold">{inc.archived_at ? 'Archivé' : (inc.statut || 'ouvert')}</td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {inc.archived_at ? (
                          <button type="button" onClick={async () => { await tenantAdminApi.restoreIncident(inc.id); await loadData(); }} className="text-emerald-700 text-xs font-bold">Restaurer</button>
                        ) : (
                          <>
                            {inc.statut !== 'resolu' && (
                              <button type="button" onClick={async () => { await tenantAdminApi.updateIncident(inc.id, { statut: 'resolu' }); await loadData(); }} className="text-emerald-700 text-xs font-bold">Marquer résolu</button>
                            )}
                            <button type="button" onClick={async () => { if (window.confirm('Archiver cet incident ?')) { await tenantAdminApi.archiveIncident(inc.id); await loadData(); } }} className="text-on-surface-variant text-xs font-bold">Archiver</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
        <>

        {/* Formulaire Création / Édition */}
        {showForm && (
          <div className="bg-white rounded-3xl border border-outline-variant/20 shadow-sm p-4 sm:p-7 mb-8"
            style={{ animation: 'slideDown .25s ease-out' }}>
            <style>{`@keyframes slideDown { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }`}</style>

            <h2 className="font-sora font-bold text-primary text-lg mb-6">
              {editId ? '✏️ Modifier l\'espace' : '✨ Nouvel espace'}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
              {/* Nom */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Nom de l'espace *</label>
                <input value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))}
                  placeholder="Ex : Open space principal, Salle Einstein…"
                  className={inputCls} />
              </div>

              {/* Statut */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Statut de l'espace *</label>
                <select value={form.statut} onChange={e => setForm(f => ({ ...f, statut: e.target.value }))}
                  className={inputCls}>
                  {STATUT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>

              {/* Type */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Catégorie d'espace *</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className={inputCls}>
                  {ESPACE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {/* Capacité */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Capacité maximale (personnes) *</label>
                <input type="number" min="1" max="500" value={form.capacite}
                  onChange={e => setForm(f => ({ ...f, capacite: e.target.value }))}
                  className={inputCls} />
              </div>

              {/* Horaires d'ouverture */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Horaires d'ouverture</label>
                <input type="text" value={form.horaires}
                  onChange={e => setForm(f => ({ ...f, horaires: e.target.value }))}
                  placeholder="Ex : 08:00 - 20:00"
                  className={inputCls} />
              </div>

              {/* Description complète */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Description complète de l'espace</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Description détaillée de l'ambiance, de la configuration du mobilier, du calme ou de la vue..."
                  className={inputCls}
                />
              </div>

              {/* Tarification centralisée dans Tarifs et formules (LOT 2) */}
              <div className="sm:col-span-2 lg:col-span-3 p-4 rounded-2xl border border-[#f95d00]/25 bg-orange-50/40 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-[#c2410c]">Tarifs HT / TTC centralisés</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Les tarifs horaire, journalier et mensuel de cet espace se configurent exclusivement dans l'onglet « Tarifs et formules ».
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSearchParams({ tab: 'tarifs' })}
                  style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                  className="px-4 py-2 rounded-xl text-xs font-bold shadow-2xs"
                >
                  Configurer les tarifs
                </button>
              </div>

              {/* Équipements (Amenities) */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-2">Équipements &amp; Commodités inclus</label>
                <div className="flex flex-wrap gap-2">
                  {AMENITIES_OPTIONS.map(amenity => {
                    const selected = (form.equipements || []).includes(amenity);
                    return (
                      <button
                        key={amenity}
                        type="button"
                        onClick={() => {
                          setForm(f => ({
                            ...f,
                            equipements: selected
                              ? f.equipements.filter(item => item !== amenity)
                              : [...(f.equipements || []), amenity]
                          }));
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                          selected
                            ? 'bg-secondary text-white border-secondary'
                            : 'bg-surface-container-low text-on-surface-variant border-outline-variant/30 hover:border-secondary'
                        }`}
                      >
                        {selected ? `✓ ${amenity}` : `+ ${amenity}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Photo upload — pleine largeur */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
                  Photo principale de l'espace
                  {!editId && <span className="ml-2 text-xs font-normal text-secondary normal-case tracking-normal">(facultatif — modifiable à tout moment)</span>}
                </label>
                <div
                  className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all cursor-pointer overflow-hidden ${
                    uploading
                      ? 'border-secondary/50 bg-secondary/3'
                      : form.photo_url
                        ? 'border-secondary/40'
                        : 'border-outline-variant/40 hover:border-secondary hover:bg-secondary/3'
                  }`}
                  style={{ minHeight: 140 }}
                  onClick={() => !uploading && fileRef.current?.click()}
                >
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => handlePhotoUpload(e.target.files?.[0])} />

                  {form.photo_url ? (
                    <>
                      <img src={form.photo_url} alt="Aperçu" className="w-full h-48 object-cover rounded-2xl" />
                      <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                        <div className="flex flex-col items-center gap-2">
                          <span className="material-symbols-outlined text-white" style={{ fontSize: 28 }}>photo_camera</span>
                          <span className="text-white text-sm font-semibold">Changer la photo</span>
                        </div>
                      </div>
                    </>
                  ) : uploading ? (
                    <div className="flex flex-col items-center gap-2 py-6">
                      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-secondary" />
                      <p className="text-sm text-on-surface-variant font-medium">Upload en cours…</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-6">
                      <div className="w-14 h-14 rounded-2xl bg-secondary/8 flex items-center justify-center mb-1">
                        <span className="material-symbols-outlined text-secondary" style={{ fontSize: 32 }}>add_photo_alternate</span>
                      </div>
                      <p className="text-sm font-semibold text-on-surface-variant">
                        {editId ? 'Cliquer pour changer la photo' : 'Cliquer pour ajouter une photo'}
                      </p>
                      <p className="text-xs text-on-surface-variant/60">JPG, PNG, WebP — max 5 MB</p>
                    </div>
                  )}
                </div>
                {form.photo_url && (
                  <button onClick={(e) => { e.stopPropagation(); setForm(f => ({ ...f, photo_url: '' })); }}
                    className="mt-1.5 text-xs text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                    Supprimer la photo
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-outline-variant/10">
              <button onClick={() => { setShowForm(false); setEditId(null); setForm({ ...EMPTY_FORM }); }}
                className="px-5 py-2.5 border border-outline-variant/30 text-on-surface-variant rounded-xl font-semibold text-sm hover:bg-surface-container transition-colors">
                Annuler
              </button>
              <button onClick={handleSave} disabled={saving || uploading}
                className="px-6 py-2.5 bg-secondary text-white rounded-xl font-bold text-sm hover:bg-secondary/90 disabled:opacity-50 transition-colors shadow-sm">
                {saving ? 'Enregistrement…' : editId ? 'Mettre à jour' : 'Créer l\'espace'}
              </button>
            </div>
          </div>
        )}

        {/* Liste des espaces */}
        {espaces.length === 0 && !showForm ? (
          <div className="bg-white rounded-3xl border border-outline-variant/20 p-12 text-center shadow-sm">
            <span className="material-symbols-outlined text-on-surface-variant/30 block mb-4" style={{ fontSize: 56 }}>meeting_room</span>
            <p className="font-sora font-bold text-primary text-lg mb-2">Aucun espace configuré</p>
            <p className="text-sm text-on-surface-variant mb-6">Créez votre premier espace pour commencer à accepter des réservations.</p>
            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white rounded-2xl font-bold text-sm hover:bg-secondary/90 transition-colors">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
              Créer un espace
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {espaces.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((espace) => {
                const typeInfo = getTypeInfo(espace.type);
                return (
                  <div key={espace.id}
                    className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden">

                    {/* Photo ou placeholder */}
                    {espace.photo_url ? (
                      <div className="relative h-44 overflow-hidden">
                        <img src={espace.photo_url} alt={espace.nom}
                          className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                        <div className="absolute top-3 right-3">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold text-white"
                            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{typeInfo.icon}</span>
                            {typeInfo.label}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="h-44 flex items-center justify-center"
                        style={{ background: `${typeInfo.color}12` }}>
                        <div className="flex flex-col items-center gap-2">
                          <span className="material-symbols-outlined" style={{ fontSize: 48, color: `${typeInfo.color}80` }}>{typeInfo.icon}</span>
                          <span className="text-xs font-semibold" style={{ color: `${typeInfo.color}90` }}>{typeInfo.label}</span>
                        </div>
                      </div>
                    )}

                    <div className="p-5">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-sora font-bold text-primary text-base leading-snug">{espace.nom}</h3>
                        {(() => {
                          const currentStatut = espace.statut || (espace.actif === false ? 'inactif' : 'actif');
                          const stInfo = STATUT_OPTIONS.find(s => s.value === currentStatut) || STATUT_OPTIONS[0];
                          return (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold shrink-0"
                              style={{ color: stInfo.color, background: stInfo.bg }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{stInfo.icon}</span>
                              {stInfo.label}
                            </span>
                          );
                        })()}
                      </div>

                      {espace.description && (
                        <p className="text-xs text-on-surface-variant line-clamp-2 mb-3">
                          {espace.description}
                        </p>
                      )}

                      <div className="grid grid-cols-2 gap-2 text-xs text-on-surface-variant mb-3 bg-surface-container-low/40 p-2.5 rounded-2xl">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-secondary" style={{ fontSize: 15 }}>group</span>
                          <span>{espace.capacite} pers. max</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-secondary" style={{ fontSize: 15 }}>schedule</span>
                          <span>{espace.horaires || '08:00 - 20:00'}</span>
                        </div>
                      </div>

                      {/* Tarifs en DT (3 décimales) */}
                      <div className="space-y-1 mb-3 pt-1 border-t border-outline-variant/10 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Tarif horaire :</span>
                          <span className="font-bold text-[#100f0d]">
                            {espace.tarif_horaire > 0 ? `${formatDT(espace.tarif_horaire)}/h` : 'Gratuit'}
                          </span>
                        </div>
                        {Number(espace.tarif_journalier) > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-on-surface-variant">Tarif journalier :</span>
                            <span className="font-semibold text-[#f95d00]">
                              {formatDT(espace.tarif_journalier)}/j
                            </span>
                          </div>
                        )}
                        {Number(espace.tarif_mensuel) > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-on-surface-variant">Tarif mensuel :</span>
                            <span className="font-semibold text-[#100f0d]">
                              {formatDT(espace.tarif_mensuel)}/mois
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Équipements inclus */}
                      {Array.isArray(espace.equipements) && espace.equipements.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {espace.equipements.slice(0, 2).map((eq, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md text-xs font-medium bg-secondary/8 text-secondary">
                              ✓ {eq}
                            </span>
                          ))}
                          {espace.equipements.length > 2 && (
                            <span className="px-1.5 py-0.5 rounded-md text-xs font-semibold text-on-surface-variant/70">
                              +{espace.equipements.length - 2}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-3 border-t border-outline-variant/10">
                        {espace.archived_at ? (
                          <button
                            onClick={() => handleRestoreEspace(espace)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>restore_from_trash</span>
                            Restaurer
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEdit(espace)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-[#f95d00] hover:bg-orange-50 transition-colors"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                              Modifier
                            </button>
                            <div className="w-px h-5 bg-outline-variant/20" />
                            <button
                              onClick={() => handleDelete(espace)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-slate-100 transition-colors"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>archive</span>
                              Archiver
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-3xl overflow-hidden shadow-sm">
              <Pagination
                currentPage={currentPage}
                totalItems={espaces.length}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setCurrentPage}
                label="espaces"
              />
            </div>
          </div>
        )}
        </>
        )}
      </div>

      <UnitStatusModal
        unite={statusModalUnit}
        isOpen={Boolean(statusModalUnit)}
        onClose={() => setStatusModalUnit(null)}
        onSaved={(res) => {
          showToast(res?.message || 'Statut de l\'unité mis à jour.');
          loadData();
        }}
      />
    </PortalLayout>
  );
}
