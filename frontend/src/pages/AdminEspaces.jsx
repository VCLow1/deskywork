import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { tenantAdminApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';

const ITEMS_PER_PAGE = 10;

const ESPACE_TYPES = [
  { value: 'open_space', label: 'Open Space', icon: 'desk', color: '#f95d00' },
  { value: 'private_office', label: 'Bureau privé (Private Office)', icon: 'meeting_room', color: '#6d28d9' },
  { value: 'meeting_room', label: 'Salle de réunion (Meeting Room)', icon: 'groups', color: '#1a7a5a' },
  { value: 'training_room', label: 'Salle de formation (Training Room)', icon: 'school', color: '#b45309' },
  { value: 'event_space', label: 'Espace événementiel (Event Space)', icon: 'celebration', color: '#b91c1c' },
  { value: 'hot_desk', label: 'Poste nomade (Hot Desk)', icon: 'laptop_mac', color: '#0e7490' },
  { value: 'dedicated_desk', label: 'Poste fixe (Dedicated Desk)', icon: 'push_pin', color: '#4338ca' },
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

export default function AdminEspaces({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null
  );
  const [espaces, setEspaces] = useState([]);
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
  }, [userId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await tenantAdminApi.getEspaces();
      setEspaces(res.espaces || []);
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
        tarif_horaire: parseFloat(form.tarif_horaire) || 0,
        tarif_journalier: parseFloat(form.tarif_journalier) || 0,
        tarif_mensuel: parseFloat(form.tarif_mensuel) || 0,
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
    if (!confirm(`Supprimer l'espace "${espace.nom}" ? Cette action supprimera aussi toutes les données associées.`)) return;
    try {
      await tenantAdminApi.deleteEspace(espace.id);
      setEspaces(prev => prev.filter(item => item.id !== espace.id));
      showToast(`Espace "${espace.nom}" supprimé.`);
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

      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Mes Espaces</h1>
            <p className="text-on-surface-variant text-sm mt-1">Gérez les espaces de votre coworking · {espaces.length} espace{espaces.length > 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => { setShowForm(v => !v); setEditId(null); setForm({ ...EMPTY_FORM }); }}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-secondary text-white rounded-2xl font-bold text-sm hover:bg-secondary/90 transition-all shadow-sm"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{showForm && !editId ? 'close' : 'add'}</span>
            {showForm && !editId ? 'Annuler' : 'Nouvel espace'}
          </button>
        </div>

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
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Nom de l'espace *</label>
                <input value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))}
                  placeholder="Ex : Open Space Principal, Salle Einstein…"
                  className={inputCls} />
              </div>

              {/* Statut */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Statut de l'espace *</label>
                <select value={form.statut} onChange={e => setForm(f => ({ ...f, statut: e.target.value }))}
                  className={inputCls}>
                  {STATUT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>

              {/* Type (7 typologies officielles CDC v3.0) */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Typologie (7 types officiels) *</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className={inputCls}>
                  {ESPACE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {/* Capacité */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Capacité maximale (personnes) *</label>
                <input type="number" min="1" max="500" value={form.capacite}
                  onChange={e => setForm(f => ({ ...f, capacite: e.target.value }))}
                  className={inputCls} />
              </div>

              {/* Horaires d'ouverture */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Horaires d'ouverture</label>
                <input type="text" value={form.horaires}
                  onChange={e => setForm(f => ({ ...f, horaires: e.target.value }))}
                  placeholder="Ex : 08:00 - 20:00"
                  className={inputCls} />
              </div>

              {/* Description complète */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Description complète de l'espace</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Description détaillée de l'ambiance, de la configuration du mobilier, du calme ou de la vue..."
                  className={inputCls}
                />
              </div>

              {/* Tarifs (DT à 3 décimales) */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Tarif horaire (DT HT)</label>
                <input type="number" min="0" step="0.001" value={form.tarif_horaire}
                  onChange={e => setForm(f => ({ ...f, tarif_horaire: e.target.value }))}
                  placeholder="Ex : 15.000"
                  className={inputCls} />
                <p className="text-[10px] text-on-surface-variant mt-1">
                  Format : {Number(form.tarif_horaire || 0).toFixed(3)} DT
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Tarif journalier (DT HT)</label>
                <input type="number" min="0" step="0.001" value={form.tarif_journalier}
                  onChange={e => setForm(f => ({ ...f, tarif_journalier: e.target.value }))}
                  placeholder="Ex : 75.000"
                  className={inputCls} />
                <p className="text-[10px] text-on-surface-variant mt-1">
                  Format : {Number(form.tarif_journalier || 0).toFixed(3)} DT
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Tarif mensuel (DT HT)</label>
                <input type="number" min="0" step="0.001" value={form.tarif_mensuel}
                  onChange={e => setForm(f => ({ ...f, tarif_mensuel: e.target.value }))}
                  placeholder="Ex : 450.000"
                  className={inputCls} />
                <p className="text-[10px] text-on-surface-variant mt-1">
                  Format : {Number(form.tarif_mensuel || 0).toFixed(3)} DT
                </p>
              </div>

              {/* Équipements (Amenities) */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">Équipements &amp; Commodités inclus</label>
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
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
                  Photo principale de l'espace
                  {!editId && <span className="ml-2 text-[10px] font-normal text-secondary normal-case tracking-normal">(facultatif — modifiable à tout moment)</span>}
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
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold text-white"
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
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0"
                              style={{ color: stInfo.color, background: stInfo.bg }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{stInfo.icon}</span>
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

                      {/* Tarifs CDC v3.0 (3 décimales en DT) */}
                      <div className="space-y-1 mb-3 pt-1 border-t border-outline-variant/10 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Tarif horaire :</span>
                          <span className="font-bold text-primary">
                            {espace.tarif_horaire > 0 ? `${Number(espace.tarif_horaire).toFixed(3)} DT/h` : 'Gratuit'}
                          </span>
                        </div>
                        {Number(espace.tarif_journalier) > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-on-surface-variant">Tarif journalier :</span>
                            <span className="font-semibold text-secondary">
                              {Number(espace.tarif_journalier).toFixed(3)} DT/j
                            </span>
                          </div>
                        )}
                        {Number(espace.tarif_mensuel) > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-on-surface-variant">Tarif mensuel :</span>
                            <span className="font-semibold text-primary">
                              {Number(espace.tarif_mensuel).toFixed(3)} DT/mois
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Équipements inclus */}
                      {Array.isArray(espace.equipements) && espace.equipements.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {espace.equipements.slice(0, 2).map((eq, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-secondary/8 text-secondary">
                              ✓ {eq}
                            </span>
                          ))}
                          {espace.equipements.length > 2 && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-on-surface-variant/70">
                              +{espace.equipements.length - 2}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-3 border-t border-outline-variant/10">
                        <button
                          onClick={() => handleEdit(espace)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-secondary hover:bg-secondary/8 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                          Modifier
                        </button>
                        <div className="w-px h-5 bg-outline-variant/20" />
                        <button
                          onClick={() => handleDelete(espace)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                          Supprimer
                        </button>
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
      </div>
    </PortalLayout>
  );
}
