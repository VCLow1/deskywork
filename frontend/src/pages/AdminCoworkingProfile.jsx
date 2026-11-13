import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { tenantAdminApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import { fileToCompressedBase64 } from '../utils/imageCompress';
import PortalLayout from '../components/layout/PortalLayout';

const BUCKET = 'coworking-images';

async function uploadImageToBackend(file, folder) {
  const { base64Data, fileName, fileType } = await fileToCompressedBase64(file, {
    maxWidth: folder === 'logos' ? 800 : 1600,
    maxHeight: folder === 'logos' ? 800 : 1200,
    quality: 0.84,
  });
  const res = await tenantAdminApi.uploadPhoto({
    base64Data,
    fileName,
    fileType,
    folder,
  });
  return res.publicUrl;
}

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 bg-white text-sm text-primary outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15 transition-all placeholder:text-on-surface-variant/50';

function ImageUploadZone({ label, hint, imageUrl, onUpload, uploading, onRemove, aspect = 'cover' }) {
  const fileRef = useRef(null);

  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">{label}</label>
      <div
        className={`relative rounded-2xl border-2 border-dashed transition-all cursor-pointer overflow-hidden ${uploading ? 'border-secondary/50 bg-secondary/3' : 'border-outline-variant/40 hover:border-secondary hover:bg-secondary/3'}`}
        style={{ height: aspect === 'cover' ? 200 : 140 }}
        onClick={() => !uploading && fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => onUpload(e.target.files?.[0])} />

        {imageUrl ? (
          <>
            <img src={imageUrl} alt={label}
              className={`w-full h-full ${aspect === 'cover' ? 'object-cover' : 'object-contain p-4'}`} />
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              <div className="flex flex-col items-center gap-2 text-white">
                <span className="material-symbols-outlined" style={{ fontSize: 28 }}>photo_camera</span>
                <span className="text-sm font-semibold">Changer l'image</span>
              </div>
            </div>
          </>
        ) : uploading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-secondary" />
            <p className="text-sm text-on-surface-variant font-medium">Upload en cours…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="material-symbols-outlined text-on-surface-variant/40" style={{ fontSize: 40 }}>add_photo_alternate</span>
            <p className="text-sm text-on-surface-variant font-medium">Cliquer pour uploader</p>
            <p className="text-xs text-on-surface-variant/60">{hint}</p>
          </div>
        )}
      </div>
      {imageUrl && (
        <button onClick={onRemove}
          className="mt-1.5 text-xs text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
          Supprimer l'image
        </button>
      )}
    </div>
  );
}

const MARKETPLACE_EQUIPEMENTS = [
  'Wi-Fi Fibre Haut Débit',
  'Climatisation / Chauffage',
  'Vidéoprojecteur',
  'Écran TV / Moniteur',
  'Tableau blanc',
  'Café & Thé inclus',
  'Imprimante & Scanner',
  'Parking',
  'Accès sécurisé 24/7',
  'Casiers sécurisés',
];

export default function AdminCoworkingProfile({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null
  );
  const [tenant, setTenant] = useState(null);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [galleryProgress, setGalleryProgress] = useState({ done: 0, total: 0 });
  const [galleryDragOver, setGalleryDragOver] = useState(false);
  const galleryRef = useRef(null);
  const [form, setForm] = useState({
    nom: '', description: '', adresse: '', ville: '', pays: 'Tunisie',
    telephone: '', email: '', site_web: '', logo_url: '', cover_url: '',
    latitude: '', longitude: '',
    activite: 'mixte', tarif_depassement_heure: '', auto_confirmation: false,
    gallery_photos: [], equipements: [],
    domiciliation_actif: false,
    domiciliation_tarif_mensuel: '',
    domiciliation_tarif_annuel: '',
    domiciliation_description: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [toast, setToast] = useState('');
  const [toastErr, setToastErr] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const showError = (msg) => { setToastErr(msg); setTimeout(() => setToastErr(''), 4000); };

  useEffect(() => { if (userId) loadData(); }, [userId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await tenantAdminApi.getTenant();
      const t = res.tenant;
      setTenant(t);
      setForm({
        nom: t.nom || '',
        description: t.description || '',
        adresse: t.adresse || '',
        ville: t.ville || '',
        pays: t.pays || 'Tunisie',
        telephone: t.telephone || '',
        email: t.email || '',
        site_web: t.site_web || '',
        logo_url: t.logo_url || '',
        cover_url: t.cover_url || '',
        latitude: t.latitude != null ? String(t.latitude) : '',
        longitude: t.longitude != null ? String(t.longitude) : '',
        activite: t.settings?.activite || 'mixte',
        tarif_depassement_heure: t.settings?.tarif_depassement_heure != null ? String(t.settings.tarif_depassement_heure) : '',
        auto_confirmation: t.settings?.auto_confirmation === true,
        gallery_photos: Array.isArray(t.settings?.gallery_photos) ? t.settings.gallery_photos : [],
        equipements: Array.isArray(t.settings?.equipements) ? t.settings.equipements : [],
        domiciliation_actif: t.settings?.domiciliation?.actif === true,
        domiciliation_tarif_mensuel: t.settings?.domiciliation?.tarif_mensuel != null ? String(t.settings.domiciliation.tarif_mensuel) : '',
        domiciliation_tarif_annuel: t.settings?.domiciliation?.tarif_annuel != null ? String(t.settings.domiciliation.tarif_annuel) : '',
        domiciliation_description: t.settings?.domiciliation?.description || '',
      });
    } catch (e) { showError(e.message); }
    finally { setLoading(false); }
  };

  const handleUploadGalleryFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return;

    const validFiles = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        showError(`"${file.name}" n'est pas une image valide.`);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        showError(`"${file.name}" dépasse 8 MB.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    setUploadingGallery(true);
    setGalleryProgress({ done: 0, total: validFiles.length });
    const uploadedUrls = [];
    try {
      for (let i = 0; i < validFiles.length; i += 1) {
        const url = await uploadImageToBackend(validFiles[i], 'gallery');
        uploadedUrls.push(url);
        setGalleryProgress({ done: i + 1, total: validFiles.length });
      }
      if (uploadedUrls.length > 0) {
        setForm((f) => ({
          ...f,
          gallery_photos: [...(f.gallery_photos || []), ...uploadedUrls],
        }));
        showToast(`${uploadedUrls.length} photo${uploadedUrls.length > 1 ? 's ajoutées' : ' ajoutée'} à la galerie (pensez à enregistrer).`);
      }
    } catch (e) {
      if (uploadedUrls.length > 0) {
        setForm((f) => ({
          ...f,
          gallery_photos: [...(f.gallery_photos || []), ...uploadedUrls],
        }));
      }
      showError(e.message || 'Erreur lors de l’upload de la galerie.');
    } finally {
      setUploadingGallery(false);
      setGalleryProgress({ done: 0, total: 0 });
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const moveGalleryPhoto = (idx, dir) => {
    setForm((f) => {
      const list = [...(f.gallery_photos || [])];
      const target = idx + dir;
      if (target < 0 || target >= list.length) return f;
      [list[idx], list[target]] = [list[target], list[idx]];
      return { ...f, gallery_photos: list };
    });
  };

  const handleUploadLogo = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showError('Fichier invalide.'); return; }
    if (file.size > 3 * 1024 * 1024) { showError('Logo trop grand. Maximum 3 MB.'); return; }
    setUploadingLogo(true);
    try {
      const url = await uploadImageToBackend(file, 'logos');
      setForm(f => ({ ...f, logo_url: url }));
    } catch (e) { showError(e.message); }
    finally { setUploadingLogo(false); }
  };

  const handleUploadCover = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showError('Fichier invalide.'); return; }
    if (file.size > 8 * 1024 * 1024) { showError('Image trop grande. Maximum 8 MB.'); return; }
    setUploadingCover(true);
    try {
      const url = await uploadImageToBackend(file, 'covers');
      setForm(f => ({ ...f, cover_url: url }));
    } catch (e) { showError(e.message); }
    finally { setUploadingCover(false); }
  };

  const handleSave = async () => {
    if (!form.nom.trim()) { showError('Le nom du coworking est requis.'); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.latitude === '') payload.latitude = null;
      if (payload.longitude === '') payload.longitude = null;
      if (payload.latitude != null && isNaN(parseFloat(payload.latitude))) { showError('Latitude invalide.'); setSaving(false); return; }
      if (payload.longitude != null && isNaN(parseFloat(payload.longitude))) { showError('Longitude invalide.'); setSaving(false); return; }
      if (payload.activite) localStorage.setItem('active_org_activite', payload.activite);
      payload.domiciliation = {
        actif: Boolean(form.domiciliation_actif),
        tarif_mensuel: parseFloat(form.domiciliation_tarif_mensuel) || 0,
        tarif_annuel: parseFloat(form.domiciliation_tarif_annuel) || 0,
        description: form.domiciliation_description.trim(),
      };
      const updated = await tenantAdminApi.updateTenant(payload);
      if (updated?.tenant) setTenant(updated.tenant);
      showToast('Profil du coworking mis à jour avec succès !');
    } catch (e) { showError(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse mb-6" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse mb-4 h-32" />
        ))}
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

      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-sora font-bold text-2xl sm:text-3xl" style={{ color: '#100f0d' }}>Profil du Coworking</h1>
            <p className="text-on-surface-variant text-sm mt-1">Personnalisez les informations et les visuels de votre espace</p>
          </div>
          {tenant?.id && (
            <Link
              to={`/coworking/${tenant.id}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-secondary/30 bg-secondary/10 text-secondary font-bold text-xs hover:bg-secondary/20 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>visibility</span>
              Consulter mon espace
            </Link>
          )}
        </div>

        {/* Preview card */}
        {(form.cover_url || form.logo_url) && (
          <div className="bg-white rounded-3xl border border-outline-variant/20 shadow-sm mb-8 overflow-hidden">
            <div className="relative h-48 bg-gradient-to-br from-secondary/20 to-secondary/5">
              {form.cover_url && (
                <img src={form.cover_url} alt="Couverture" className="w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              {form.logo_url && (
                <div className="absolute bottom-4 left-5">
                  <img src={form.logo_url} alt="Logo"
                    className="w-16 h-16 rounded-2xl object-contain bg-white shadow-lg border-2 border-white" />
                </div>
              )}
            </div>
            <div className="px-5 py-4">
              <h3 className="font-sora font-bold text-lg" style={{ color: '#100f0d' }}>{form.nom || 'Nom du coworking'}</h3>
              {form.ville && <p className="text-xs text-on-surface-variant mt-0.5">{form.ville}{form.pays ? `, ${form.pays}` : ''}</p>}
            </div>
          </div>
        )}

        <div className="space-y-6">

          {/* Section Visuels */}
          <div className="bg-white rounded-3xl border border-outline-variant/20 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>image</span>
              <h2 className="font-sora font-semibold text-primary">Visuels</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <ImageUploadZone
                label="Logo du coworking"
                hint="PNG transparent recommandé · max 3 MB"
                imageUrl={form.logo_url}
                onUpload={handleUploadLogo}
                uploading={uploadingLogo}
                onRemove={() => setForm(f => ({ ...f, logo_url: '' }))}
                aspect="logo"
              />
              <ImageUploadZone
                label="Photo de couverture"
                hint="Idéalement 1200×400 px · max 8 MB"
                imageUrl={form.cover_url}
                onUpload={handleUploadCover}
                uploading={uploadingCover}
                onRemove={() => setForm(f => ({ ...f, cover_url: '' }))}
                aspect="cover"
              />
            </div>
          </div>

          {/* Section Informations */}
          <div className="bg-white rounded-3xl border border-outline-variant/20 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>info</span>
              <h2 className="font-sora font-semibold text-primary">Informations générales</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Nom du coworking *</label>
                <input value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))}
                  placeholder="Ex : Encre Cobalt Coworking"
                  className={inputCls} />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Décrivez votre espace coworking en quelques phrases…"
                  rows={3}
                  className={`${inputCls} resize-none`} />
              </div>

              {[
                { key: 'adresse',   label: 'Adresse',     placeholder: 'Numéro, rue, quartier', col: 2 },
                { key: 'ville',     label: 'Ville',       placeholder: 'Ex : Tunis', col: 1 },
                { key: 'pays',      label: 'Pays',        placeholder: 'Ex : Tunisie', col: 1 },
                { key: 'telephone', label: 'Téléphone',   placeholder: '+216 XX XXX XXX', col: 1 },
                { key: 'email',     label: 'Email',       placeholder: 'contact@coworking.tn', col: 1 },
                { key: 'site_web',  label: 'Site web',    placeholder: 'https://votre-site.tn', col: 2 },
                { key: 'latitude',  label: 'Latitude (GPS)', placeholder: 'Ex : 36.806496', col: 1 },
                { key: 'longitude', label: 'Longitude (GPS)', placeholder: 'Ex : 10.181532', col: 1 },
              ].map(({ key, label, placeholder, col }) => (
                <div key={key} className={col === 2 ? 'sm:col-span-2' : ''}>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">{label}</label>
                  <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          {/* Section Activité & Règles CDC v3.0 (D4 & D5) */}
          <div className="bg-white rounded-3xl border border-outline-variant/20 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>tune</span>
              <h2 className="font-sora font-semibold text-primary">Activité de l'établissement &amp; Règles opérationnelles</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">
                  Type d'activité (débloque les menus Formations, Sessions, Apprenants, Formateurs)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'coworking', label: 'Coworking', desc: 'Espaces de travail, réservations & sessions' },
                    { id: 'centre_formation', label: 'Centre de formation', desc: 'Formations, sessions, apprenants & formateurs' },
                    { id: 'mixte', label: 'Mixte (Les deux)', desc: 'Coworking + Centre de formation unifiés' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, activite: opt.id }))}
                      className={`p-3.5 rounded-2xl border text-left transition ${
                        form.activite === opt.id
                          ? 'border-[#f95d00] bg-orange-50 ring-2 ring-[#f95d00]/15'
                          : 'border-outline-variant/30 hover:bg-surface-container-low'
                      }`}
                    >
                      <p className="font-bold text-sm text-primary">{opt.label}</p>
                      <p className="text-[11px] text-on-surface-variant mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
                    Barème de dépassement horaire (DT / h)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={form.tarif_depassement_heure}
                    onChange={(e) => setForm((f) => ({ ...f, tarif_depassement_heure: e.target.value }))}
                    placeholder="Laisser vide = tarif horaire de l'espace"
                    className={inputCls}
                  />
                </div>
                <div className="flex items-center gap-3 pt-5">
                  <input
                    id="cfg-auto-confirm"
                    type="checkbox"
                    checked={Boolean(form.auto_confirmation)}
                    onChange={(e) => setForm((f) => ({ ...f, auto_confirmation: e.target.checked }))}
                  />
                  <label htmlFor="cfg-auto-confirm" className="text-xs font-semibold text-primary cursor-pointer">
                    Confirmation automatique des réservations standards (hors Espace événementiel)
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Équipements & services inclus */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-outline-variant/20 space-y-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>checklist</span>
              <div>
                <h2 className="font-sora font-semibold text-primary">Équipements & services Marketplace</h2>
                <p className="text-xs text-on-surface-variant">
                  Sélectionnez les équipements affichés sur votre fiche publique DeskyWork.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {MARKETPLACE_EQUIPEMENTS.map((eq) => {
                const active = (form.equipements || []).includes(eq);
                return (
                  <button
                    key={eq}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        equipements: active
                          ? f.equipements.filter((x) => x !== eq)
                          : [...(f.equipements || []), eq],
                      }))
                    }
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                      active
                        ? 'bg-[#f95d00] text-white border-[#f95d00]'
                        : 'bg-surface-container-low/50 text-on-surface-variant border-outline-variant/25 hover:border-[#f95d00]'
                    }`}
                  >
                    {active ? `✓ ${eq}` : `+ ${eq}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section Service de Domiciliation d'entreprise (CDC v3.0) */}
          <div className="bg-white rounded-3xl border border-outline-variant/20 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 22 }}>business</span>
                <div>
                  <h2 className="font-sora font-semibold text-primary">Service de Domiciliation d'Entreprise</h2>
                  <p className="text-xs text-on-surface-variant">Proposez une adresse de siège social légale pour vos membres et entreprises.</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.domiciliation_actif}
                  onChange={(e) => setForm((f) => ({ ...f, domiciliation_actif: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#f95d00]"></div>
              </label>
            </div>

            {form.domiciliation_actif ? (
              <div className="space-y-4 pt-3 border-t border-outline-variant/15">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
                      Tarif mensuel (DT HT) *
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={form.domiciliation_tarif_mensuel}
                      onChange={(e) => setForm((f) => ({ ...f, domiciliation_tarif_mensuel: e.target.value }))}
                      placeholder="Ex : 80.000"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
                      Tarif annuel (DT HT)
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={form.domiciliation_tarif_annuel}
                      onChange={(e) => setForm((f) => ({ ...f, domiciliation_tarif_annuel: e.target.value }))}
                      placeholder="Ex : 800.000"
                      className={inputCls}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
                    Description, conditions &amp; Pièces requises
                  </label>
                  <textarea
                    rows={3}
                    value={form.domiciliation_description}
                    onChange={(e) => setForm((f) => ({ ...f, domiciliation_description: e.target.value }))}
                    placeholder="Ex : Domiciliation juridique avec contrat, réception et notification de courrier, réexpédition ou scan, attestation pour le RNE. Pièces requises : CIN du gérant, statuts de l'entreprise..."
                    className={inputCls}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant italic">
                Le service de domiciliation est actuellement désactivé. Activez le bouton ci-dessus pour le proposer sur votre fiche Marketplace.
              </p>
            )}
          </div>

          {/* Section Indépendante : Galerie photos multi-upload */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-outline-variant/20 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 22 }}>photo_library</span>
                <div>
                  <h2 className="font-sora font-semibold text-primary">
                    Galerie photos de l'établissement ({(form.gallery_photos || []).length})
                  </h2>
                  <p className="text-xs text-on-surface-variant">
                    Ajoutez plusieurs photos en une seule fois (glisser-déposer ou sélection multiple).
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUploadGalleryFiles(e.target.files)}
                />
                <button
                  type="button"
                  disabled={uploadingGallery}
                  onClick={() => galleryRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e55500] disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>add_photo_alternate</span>
                  {uploadingGallery
                    ? `Upload ${galleryProgress.done}/${galleryProgress.total}…`
                    : 'Ajouter plusieurs photos'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || uploadingGallery || uploadingLogo || uploadingCover}
                  className="px-3.5 py-2 rounded-xl border border-secondary/30 bg-secondary/10 text-secondary text-xs font-bold hover:bg-secondary/20 disabled:opacity-50 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>save</span>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>

            {/* Zone Glisser-Déposer multi-images */}
            <div
              onDragOver={(e) => { e.preventDefault(); setGalleryDragOver(true); }}
              onDragLeave={() => setGalleryDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setGalleryDragOver(false);
                if (!uploadingGallery) handleUploadGalleryFiles(e.dataTransfer.files);
              }}
              onClick={() => !uploadingGallery && galleryRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-5 text-center cursor-pointer transition-all ${
                galleryDragOver
                  ? 'border-[#f95d00] bg-orange-50/70'
                  : 'border-outline-variant/35 hover:border-[#f95d00] hover:bg-orange-50/30'
              }`}
            >
              {uploadingGallery ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <div className="animate-spin rounded-full h-7 w-7 border-t-2 border-b-2 border-[#f95d00]" />
                  <p className="text-xs font-semibold text-primary">
                    Envoi des images en cours ({galleryProgress.done} / {galleryProgress.total})…
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 py-1">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 32 }}>cloud_upload</span>
                  <p className="text-xs font-semibold text-primary">
                    Glissez-déposez plusieurs photos ici ou cliquez pour sélectionner
                  </p>
                  <p className="text-[11px] text-on-surface-variant">
                    Formats JPG, PNG, WebP · Sélection multiple supportée · max 8 MB par image
                  </p>
                </div>
              )}
            </div>

            {(form.gallery_photos || []).length === 0 ? (
              <p className="text-xs text-on-surface-variant italic text-center py-2">
                Aucune photo ajoutée à la galerie pour le moment.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {form.gallery_photos.map((url, idx) => (
                  <div key={`${url}-${idx}`} className="rounded-2xl overflow-hidden border border-outline-variant/20 bg-surface-container-low/30 flex flex-col">
                    <div className="relative h-36 bg-slate-100">
                      <img src={url} alt={`Galerie ${idx + 1}`} className="w-full h-full object-cover" />
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-bold">
                        #{idx + 1}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between gap-2 bg-white border-t border-outline-variant/15">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveGalleryPhoto(idx, -1)}
                          title="Déplacer avant"
                          className="p-1 rounded-lg hover:bg-surface-container-low text-on-surface-variant disabled:opacity-30"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
                        </button>
                        <button
                          type="button"
                          disabled={idx === form.gallery_photos.length - 1}
                          onClick={() => moveGalleryPhoto(idx, 1)}
                          title="Déplacer après"
                          className="p-1 rounded-lg hover:bg-surface-container-low text-on-surface-variant disabled:opacity-30"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, gallery_photos: f.gallery_photos.filter((_, i) => i !== idx) }))}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-600 hover:bg-red-50 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bouton sauvegarder */}
          <div className="flex justify-end gap-3">
            <button onClick={loadData}
              className="px-5 py-2.5 border border-outline-variant/30 text-on-surface-variant rounded-xl font-semibold text-sm hover:bg-surface-container transition-colors">
              Annuler
            </button>
            <button onClick={handleSave} disabled={saving || uploadingLogo || uploadingCover || uploadingGallery}
              className="px-7 py-2.5 bg-secondary text-white rounded-xl font-bold text-sm hover:bg-secondary/90 disabled:opacity-50 transition-colors shadow-sm flex items-center gap-2">
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
                  Enregistrement…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>save</span>
                  Enregistrer les modifications
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
