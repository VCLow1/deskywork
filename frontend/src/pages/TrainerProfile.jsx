import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import PortalLayout from '../components/layout/PortalLayout';

/* ─── Champ de formulaire réutilisable ─────────────────────────────────── */
function Field({ label, value, onChange, type = 'text', readOnly = false, placeholder = '' }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
        {label}
      </label>
      {type === 'textarea' ? (
        <textarea
          value={value || ''}
          onChange={onChange}
          readOnly={readOnly}
          placeholder={placeholder}
          rows={4}
          className={`w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-2.5 text-sm text-on-surface outline-none resize-none transition-all duration-200
            ${readOnly ? 'opacity-60 cursor-not-allowed' : 'focus:border-secondary focus:ring-2 focus:ring-secondary/15'}`}
        />
      ) : (
        <input
          type={type}
          value={value || ''}
          onChange={onChange}
          readOnly={readOnly}
          placeholder={placeholder}
          className={`w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-2.5 text-sm text-on-surface outline-none transition-all duration-200
            ${readOnly ? 'opacity-60 cursor-not-allowed' : 'focus:border-secondary focus:ring-2 focus:ring-secondary/15'}`}
        />
      )}
    </div>
  );
}

export default function TrainerProfile({ session }) {
  const [profile,  setProfile]  = useState(null);
  const [form,     setForm]     = useState({ prenom: '', nom: '', telephone: '', specialite: '', biographie: '', canal_notification: 'email' });
  const [email,    setEmail]    = useState('');
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [testingNotification, setTestingNotification] = useState(false);
  const [photoUpl, setPhotoUpl] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [success,  setSuccess]  = useState('');
  const [error,    setError]    = useState('');
  const photoRef = useRef(null);

  /* ── auto-dismiss messages ─────────────────────────────────────────── */
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3500); return () => clearTimeout(t); } }, [success]);
  useEffect(() => { if (error)   { const t = setTimeout(() => setError(''),   3500); return () => clearTimeout(t); } }, [error]);

  /* ── Chargement initial ────────────────────────────────────────────── */
  useEffect(() => { loadProfile(); }, [session]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      setEmail(session?.user?.email || '');
      const { data: prof, error: e } = await supabase
        .from('profiles').select('*').eq('id', session.user.id).single();
      if (e) throw e;
      setProfile(prof);
      setForm({
        prenom:             prof.prenom             || '',
        nom:                prof.nom                || '',
        telephone:          prof.telephone          || '',
        specialite:         prof.specialite         || '',
        biographie:         prof.biographie         || '',
        canal_notification: prof.canal_notification || 'email',
      });
    } catch (e) { setError(e.message); }
    finally     { setLoading(false); }
  };

  /* ── Sauvegarder le profil ─────────────────────────────────────────── */
  const handleSave = async () => {
    if (!form.prenom.trim() || !form.nom.trim()) {
      setError('Prénom et nom sont obligatoires.'); return;
    }
    setSaving(true);
    setError('');
    try {
      const { error: e } = await supabase
        .from('profiles')
        .update({ ...form, updated_at: new Date().toISOString() })
        .eq('id', session.user.id);
      if (e) throw e;
      setProfile((p) => ({ ...p, ...form }));
      setSuccess('Profil mis à jour avec succès.');
    } catch (e) { setError(e.message); }
    finally     { setSaving(false); }
  };

  /* ── Upload photo de profil (CDC v3.0) ───────────────────────────────── */
  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Format invalide. Veuillez sélectionner une image (JPEG, PNG, WebP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('L\'image dépasse 5 MB. Veuillez choisir un fichier plus léger.');
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPhotoPreview(localPreview);
    setPhotoUpl(true);
    setError('');

    try {
      let publicUrl = null;
      // 1. Essayer l'upload sécurisé via le Backend (service role, contourne RLS)
      try {
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
        });
        reader.readAsDataURL(file);
        const base64Data = await base64Promise;

        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

        const res = await fetch(`${API_URL}/api/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            base64Data,
            fileName: file.name,
            fileType: file.type,
            folder: 'avatars',
          }),
        });

        const data = await res.json();
        if (res.ok && data.publicUrl) {
          publicUrl = data.publicUrl;
        }
      } catch (_) { }

      // 2. Fallback vers le client Supabase direct si l'API backend n'est pas dispo
      if (!publicUrl) {
        const ext = file.name.split('.').pop();
        const path = `${session.user.id}_${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        publicUrl = urlData.publicUrl;
      }

      const { error: updErr } = await supabase.from('profiles')
        .update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', session.user.id);
      if (updErr) throw updErr;

      setProfile((p) => ({ ...p, photo_url: publicUrl }));
      setPhotoPreview(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('profile-updated', { detail: { photo_url: publicUrl } }));
      }
      setSuccess('Photo mise à jour.');
    } catch (e) {
      setPhotoPreview(null);
      setError("Erreur upload : " + e.message);
    } finally {
      setPhotoUpl(false);
    }
  };

  /* ── Test de notification ────────────────────────────────────────── */
  const handleTestNotification = async (canal) => {
    try {
      setTestingNotification(true);
      setError('');
      const targetCanal = canal || form.canal_notification || 'email';

      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      
      const res = await fetch(`${API_URL}/api/members/me/test-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ canal: targetCanal })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur lors du test de notification');
      setSuccess('Notification de test envoyée avec succès par E-mail & In-App !');
    } catch (err) {
      setError(err.message || 'Impossible d\'envoyer le test de notification.');
    } finally {
      setTestingNotification(false);
    }
  };

  /* ── Changer le mot de passe ──────────────────────────────────────── */
  const handleResetPassword = async () => {
    try {
      const { error: e } = await supabase.auth.resetPasswordForEmail(email);
      if (e) throw e;
      setSuccess('Email de réinitialisation envoyé à ' + email);
    } catch (e) { setError(e.message); }
  };

  /* ── Loading ───────────────────────────────────────────────────────── */
  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
    </div>
  );

  const initials = `${form.prenom?.[0] || ''}${form.nom?.[0] || ''}`.toUpperCase() || 'F';

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">

        {/* ── Header ── */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-7 h-7 rounded-lg bg-secondary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 16 }}>person</span>
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-secondary">Espace Formateur</span>
          </div>
          <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Mon Profil</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Gérez vos informations personnelles et professionnelles.
          </p>
        </div>

        {/* ── Alertes ── */}
        {error && (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-2xl bg-error-container text-on-error-container border border-error/20 text-sm">
            <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18 }}>error</span>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="shrink-0 opacity-60 hover:opacity-100">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        )}
        {success && (
          <div className="mb-4 flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-sm">
            <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18 }}>check_circle</span>
            <span>{success}</span>
          </div>
        )}

        {/* ── Card photo + identité ── */}
        <div className="bg-surface-container-low rounded-3xl border border-outline-variant/20 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-5">
            {/* Avatar */}
            <div className="relative shrink-0">
              {(photoPreview || profile?.photo_url) ? (
                <img
                  src={photoPreview || profile.photo_url}
                  alt="Photo de profil"
                  className="w-20 h-20 rounded-2xl object-cover border-2 border-outline-variant/20 shadow"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center font-sora font-bold text-2xl shadow"
                  style={{ background: 'linear-gradient(135deg, #100f0d, #f95d00)', color: '#fbffff' }}>
                  {initials}
                </div>
              )}
              {/* Bouton upload superposé */}
              <button
                onClick={() => photoRef.current?.click()}
                disabled={photoUpl}
                title="Changer la photo"
                className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-secondary text-white shadow flex items-center justify-center hover:bg-secondary/90 transition-all disabled:opacity-50"
              >
                {photoUpl
                  ? <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full inline-block" />
                  : <span className="material-symbols-outlined" style={{ fontSize: 14 }}>photo_camera</span>
                }
              </button>
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </div>

            {/* Nom + rôle + email */}
            <div className="min-w-0">
              <p className="font-sora font-bold text-primary text-lg leading-tight">
                {form.prenom} {form.nom}
              </p>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-secondary/10 text-secondary mt-1">
                <span className="material-symbols-outlined text-[13px]">lock</span>
                Rôle &amp; Profil (figé) : Formateur
              </div>
              <p className="text-xs text-on-surface-variant mt-1.5 truncate">{email}</p>
              {form.specialite && (
                <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary/10 text-secondary">
                  <span className="material-symbols-outlined" style={{ fontSize: 11 }}>school</span>
                  {form.specialite}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Informations personnelles ── */}
        <div className="bg-surface-container-low rounded-3xl border border-outline-variant/20 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-secondary/10">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 17 }}>badge</span>
            </span>
            <h2 className="font-sora font-bold text-primary text-base">Informations personnelles</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Prénom *" value={form.prenom}
              onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))} />
            <Field label="Nom *" value={form.nom}
              onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} />
            <Field label="Email" value={email} readOnly />
            <Field label="Téléphone" value={form.telephone} placeholder="+216 XX XXX XXX"
              onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))} />
          </div>
        </div>

        {/* ── Informations professionnelles ── */}
        <div className="bg-surface-container-low rounded-3xl border border-outline-variant/20 p-6 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-secondary/10">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 17 }}>school</span>
            </span>
            <h2 className="font-sora font-bold text-primary text-base">Informations professionnelles</h2>
          </div>

          <div className="flex flex-col gap-4">
            <Field label="Spécialité" value={form.specialite} placeholder="Ex : Développement web, Design UX..."
              onChange={(e) => setForm((f) => ({ ...f, specialite: e.target.value }))} />
            <Field label="Biographie" value={form.biographie} type="textarea"
              placeholder="Décrivez votre parcours, vos compétences et votre expérience..."
              onChange={(e) => setForm((f) => ({ ...f, biographie: e.target.value }))} />
          </div>
        </div>

        {/* ── Préférences de Notifications (CDC v3.0 — D2 : E-mail & In-App uniquement) ── */}
        <div className="bg-surface-container-low rounded-3xl border border-outline-variant/20 p-6 mb-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-5">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-secondary/10">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 17 }}>notifications_active</span>
              </span>
              <div>
                <h2 className="font-sora font-bold text-primary text-base">Canaux de Notifications</h2>
                <p className="text-xs text-on-surface-variant">Vos alertes de sessions de formation et paiements sont envoyées par e-mail et dans l'application</p>
              </div>
            </div>
            <button
              onClick={() => handleTestNotification('email')}
              disabled={testingNotification}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-outline-variant/30 text-xs font-semibold text-primary hover:bg-surface-container transition-all disabled:opacity-50"
            >
              <span className={`material-symbols-outlined ${testingNotification ? 'animate-spin' : ''}`} style={{ fontSize: 15 }}>
                {testingNotification ? 'sync' : 'send'}
              </span>
              <span>Tester</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl border-2 border-secondary bg-secondary/5 flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 24 }}>mail</span>
              <div>
                <p className="font-sora font-bold text-sm text-primary">E-mail</p>
                <p className="text-[11px] text-on-surface-variant">Boîte de réception configurée sur votre profil</p>
              </div>
            </div>
            <div className="p-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 flex items-center gap-3">
              <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: 24 }}>notifications</span>
              <div>
                <p className="font-sora font-bold text-sm text-primary">In-App</p>
                <p className="text-[11px] text-on-surface-variant">Alertes en direct dans votre espace formateur</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Sécurité ── */}
        <div className="bg-surface-container-low rounded-3xl border border-outline-variant/20 p-6 mb-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-amber-50">
              <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 17 }}>lock</span>
            </span>
            <h2 className="font-sora font-bold text-primary text-base">Sécurité</h2>
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-on-surface">Mot de passe</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Un email de réinitialisation sera envoyé à <strong>{email}</strong>
              </p>
            </div>
            <button
              onClick={handleResetPassword}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/30 text-sm font-semibold text-on-surface hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>lock_reset</span>
              Réinitialiser
            </button>
          </div>
        </div>

        {/* ── Bouton Sauvegarder ── */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-secondary text-white rounded-2xl font-bold text-sm hover:bg-secondary/90 active:scale-95 transition-all disabled:opacity-60 shadow-sm"
          >
            {saving ? (
              <>
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" />
                Sauvegarde…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                Sauvegarder
              </>
            )}
          </button>
        </div>

      </div>
    </PortalLayout>
  );
}
