import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { tenantAdminApi, bookingApi } from '../services/api';
import BrandLogo from '../components/layout/BrandLogo';

const ESPACE_TYPES = [
  { value: 'open_space', label: 'Open Space' },
  { value: 'private_office', label: 'Bureau privé' },
  { value: 'meeting_room', label: 'Salle de réunion' },
  { value: 'training_room', label: 'Salle de formation' },
  { value: 'event_space', label: 'Espace événementiel' },
  { value: 'hot_desk', label: 'Poste nomade (Hot Desk)' },
  { value: 'dedicated_desk', label: 'Poste fixe (Dedicated Desk)' },
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

const EMPTY_ESPACE = { nom: '', type: 'open_space', capacite: 10, tarif_horaire: 15, photo_url: '' };

export default function AdminOnboarding({ session }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [tenant, setTenant] = useState(null);
  const [tenantForm, setTenantForm] = useState({
    description: '', adresse: '', ville: '', pays: 'Tunisie', telephone: '', email: '',
  });
  const [espaces, setEspaces] = useState([]);
  const [newEspace, setNewEspace] = useState({ ...EMPTY_ESPACE });
  const fileRef = useRef(null);

  const handlePhotoUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Fichier invalide. Veuillez sélectionner une image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image trop grande. Maximum 5 MB.'); return; }
    setUploading(true);
    setError('');
    try {
      const url = await uploadImageToBackend(file, 'espaces');
      setNewEspace(f => ({ ...f, photo_url: url }));
    } catch (e) { setError(e.message); }
    finally { setUploading(false); }
  };

  const userId = session?.user?.id;
  useEffect(() => { if (userId) loadData(); }, [userId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', userId).single();
      if (prof?.role !== 'admin') {
        navigate('/admin/dashboard');
        return;
      }

      const res = await tenantAdminApi.getTenant();
      if (res.onboarding_completed) {
        navigate('/admin/dashboard');
        return;
      }

      setTenant(res.tenant);
      setTenantForm({
        description: res.tenant.description || '',
        adresse: res.tenant.adresse || '',
        ville: res.tenant.ville || '',
        pays: res.tenant.pays || 'Tunisie',
        telephone: res.tenant.telephone || '',
        email: res.tenant.email || '',
      });

      const espRes = await bookingApi.getEspaces();
      setEspaces(espRes.espaces || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTenant = async () => {
    setSaving(true);
    setError('');
    try {
      const { tenant: updated } = await tenantAdminApi.updateTenant(tenantForm);
      setTenant(updated);
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddEspace = async () => {
    if (!newEspace.nom.trim()) { setError('Le nom de l\'espace est requis.'); return; }
    setSaving(true);
    setError('');
    try {
      const { espace } = await tenantAdminApi.createEspace(newEspace);
      setEspaces((prev) => [...prev, espace]);
      setNewEspace({ ...EMPTY_ESPACE });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveEspace = async (id) => {
    try {
      await tenantAdminApi.deleteEspace(id);
      setEspaces((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleComplete = async () => {
    if (espaces.length < 1) {
      setError('Ajoutez au moins un espace avant de terminer.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await tenantAdminApi.completeOnboarding();
      navigate('/admin/dashboard');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#f4f6f9' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen page-gradient font-inter">
      <header className="px-6 py-5 border-b border-outline-variant/15 bg-surface-container-lowest/80 backdrop-blur-sm">
        <BrandLogo to="/" />
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-secondary/10 text-secondary mb-3">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>domain</span>
            Configuration du coworking
          </span>
          <h1 className="font-sora text-2xl font-bold text-primary">
            Bienvenue, {tenant?.nom}
          </h1>
          <p className="text-sm text-on-surface-variant mt-2">
            Votre compte a été validé. Complétez la configuration de votre espace pour commencer.
          </p>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {[
            { n: 1, label: 'Informations' },
            { n: 2, label: 'Espaces' },
          ].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step >= n ? 'bg-secondary text-white' : 'bg-surface-container-high text-on-surface-variant'
              }`}>
                {step > n ? <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span> : n}
              </div>
              <span className={`text-sm font-semibold ${step >= n ? 'text-primary' : 'text-on-surface-variant'}`}>{label}</span>
              {n < 2 && <div className={`w-12 h-0.5 ${step > 1 ? 'bg-secondary' : 'bg-outline-variant/30'}`} />}
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-5 p-4 rounded-2xl flex items-center gap-3 text-sm"
            style={{ background: '#ffdad6', color: '#93000a', border: '1px solid rgba(186,26,26,0.15)' }}>
            <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
            <span>{error}</span>
          </div>
        )}

        <div className="glass-card rounded-3xl shadow-elevated p-6 space-y-5">
          {step === 1 && (
            <>
              <h2 className="font-sora text-lg font-semibold text-primary">Informations de votre coworking</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-label-sm font-semibold text-on-surface-variant">Description</label>
                  <textarea
                    value={tenantForm.description}
                    onChange={(e) => setTenantForm({ ...tenantForm, description: e.target.value })}
                    className="form-input mt-1"
                    rows={3}
                    placeholder="Présentez votre espace de coworking..."
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Localisation</label>
                  <div className="mt-2 space-y-4">
                    <div>
                      <label className="text-label-sm font-semibold text-on-surface-variant">Adresse</label>
                      <input
                        value={tenantForm.adresse}
                        onChange={(e) => setTenantForm({ ...tenantForm, adresse: e.target.value })}
                        className="form-input mt-1"
                        placeholder="12 Rue de la Liberté"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-label-sm font-semibold text-on-surface-variant">Ville</label>
                        <input
                          value={tenantForm.ville}
                          onChange={(e) => setTenantForm({ ...tenantForm, ville: e.target.value })}
                          className="form-input mt-1"
                          placeholder="Tunis"
                        />
                      </div>
                      <div>
                        <label className="text-label-sm font-semibold text-on-surface-variant">Pays</label>
                        <input
                          value={tenantForm.pays}
                          onChange={(e) => setTenantForm({ ...tenantForm, pays: e.target.value })}
                          className="form-input mt-1"
                          placeholder="Tunisie"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-label-sm font-semibold text-on-surface-variant">Téléphone</label>
                    <input
                      value={tenantForm.telephone}
                      onChange={(e) => setTenantForm({ ...tenantForm, telephone: e.target.value })}
                      className="form-input mt-1"
                      placeholder="+216 99 999 999"
                    />
                  </div>
                  <div>
                    <label className="text-label-sm font-semibold text-on-surface-variant">Email de contact</label>
                    <input
                      type="email"
                      value={tenantForm.email}
                      onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })}
                      className="form-input mt-1"
                      placeholder="contact@moncoworking.tn"
                    />
                  </div>
                </div>
              </div>
              <button
                onClick={handleSaveTenant}
                disabled={saving}
                className="btn-primary w-full mt-2"
              >
                {saving ? 'Enregistrement…' : 'Continuer → Ajouter les espaces'}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="font-sora text-lg font-semibold text-primary">Vos espaces et places</h2>
              <p className="text-sm text-on-surface-variant">
                Ajoutez les espaces réservables de votre coworking avec leur capacité (nombre de places).
              </p>

              {espaces.length > 0 && (
                <div className="divide-y divide-outline-variant/15 rounded-xl border border-outline-variant/20 overflow-hidden">
                  {espaces.map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-4 py-3 bg-surface-container-low/50 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {e.photo_url ? (
                          <img src={e.photo_url} alt={e.nom} className="w-11 h-11 rounded-lg object-cover border border-outline-variant/20 shrink-0" />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>meeting_room</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-primary text-sm truncate">{e.nom}</p>
                          <p className="text-xs text-on-surface-variant truncate">
                            {ESPACE_TYPES.find((t) => t.value === e.type)?.label || e.type}
                            {' · '}{e.capacite} places · {e.tarif_horaire} DT/h
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveEspace(e.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 shrink-0"
                        title="Supprimer"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="p-4 rounded-xl bg-surface-container-low space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Nouvel espace</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={newEspace.nom}
                    onChange={(ev) => setNewEspace({ ...newEspace, nom: ev.target.value })}
                    className="form-input"
                    placeholder="Nom de l'espace"
                  />
                  <select
                    value={newEspace.type}
                    onChange={(ev) => setNewEspace({ ...newEspace, type: ev.target.value })}
                    className="form-input appearance-none"
                  >
                    {ESPACE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={newEspace.capacite}
                    onChange={(ev) => setNewEspace({ ...newEspace, capacite: parseInt(ev.target.value, 10) || 1 })}
                    className="form-input"
                    placeholder="Nombre de places"
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={newEspace.tarif_horaire}
                    onChange={(ev) => setNewEspace({ ...newEspace, tarif_horaire: parseFloat(ev.target.value) || 0 })}
                    className="form-input"
                    placeholder="Tarif horaire (DT)"
                  />
                </div>

                {/* Upload photo espace */}
                <div className="pt-1">
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                    Photo de l'espace (recommandé)
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handlePhotoUpload(e.target.files?.[0])}
                  />

                  {newEspace.photo_url ? (
                    <div className="relative rounded-xl overflow-hidden border border-outline-variant/30 h-32 group">
                      <img src={newEspace.photo_url} alt="Aperçu" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          className="px-3 py-1.5 bg-white/90 text-primary text-xs font-semibold rounded-lg hover:bg-white"
                        >
                          Changer
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewEspace(f => ({ ...f, photo_url: '' }))}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                      className="w-full py-3 px-4 border-2 border-dashed border-outline-variant/40 hover:border-secondary rounded-xl flex items-center justify-center gap-2 text-sm text-on-surface-variant hover:text-secondary transition-all bg-white"
                    >
                      {uploading ? (
                        <span className="animate-spin h-4 w-4 border-2 border-secondary border-t-transparent rounded-full" />
                      ) : (
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add_photo_alternate</span>
                      )}
                      <span>{uploading ? 'Téléversement de la photo…' : 'Ajouter une photo pour cet espace'}</span>
                    </button>
                  )}
                </div>

                <button
                  onClick={handleAddEspace}
                  disabled={saving || uploading}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary/10 text-secondary rounded-full text-sm font-semibold hover:bg-secondary/20 transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                  Ajouter cet espace
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/30 text-sm font-semibold hover:bg-surface-container-low transition-colors"
                >
                  ← Retour
                </button>
                <button
                  onClick={handleComplete}
                  disabled={saving || espaces.length < 1}
                  className="btn-primary flex-1"
                  style={{ opacity: espaces.length < 1 ? 0.5 : 1 }}
                >
                  {saving ? 'Finalisation…' : 'Terminer la configuration'}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
