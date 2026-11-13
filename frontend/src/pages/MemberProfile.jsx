import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { memberApi, memberPortalApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import { QRCodeSVG } from 'qrcode.react';

const MEMBER_TYPE_LABELS = {
  individuel: 'Individuel',
  entreprise: 'Entreprise',
  etudiant: 'Etudiant',
};

const DOC_TYPE_ICONS = {
  cin: 'badge',
  certificat: 'verified_user',
  contrat: 'description',
  facture: 'receipt_long',
  autre: 'attach_file',
};

const SUBSCRIPTION_LABELS = {
  day_pass: 'Day Pass',
  week_pass: 'Week Pass',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  annuel: 'Annuel',
  bureau_prive: 'Bureau privé',
};

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <span
        className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
        style={{ background: 'rgba(249,93,0,0.09)', color: '#f95d00' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{icon}</span>
      </span>
      <div>
        <h2 className="font-sora font-bold text-primary" style={{ fontSize: 17 }}>{title}</h2>
        {subtitle && <p className="text-xs text-on-surface-variant mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange, readOnly, type = 'text' }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value || ''}
        onChange={onChange}
        readOnly={readOnly}
        className={`w-full rounded-xl border border-outline-variant/20 bg-white px-4 py-2.5 text-sm font-medium text-on-surface outline-none transition-all duration-200
          ${readOnly ? 'opacity-60 cursor-not-allowed' : 'focus:border-secondary focus:ring-2 focus:ring-secondary/15'}
          placeholder:text-on-surface-variant/50`}
      />
    </div>
  );
}

export default function MemberProfile({ session }) {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [qrData, setQrData] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    prenom: '',
    nom: '',
    telephone: '',
    cin: '',
    type_membre: 'individuel',
  });
  const [userEmail, setUserEmail] = useState('');
  const [memberSince, setMemberSince] = useState('');

  const [qrLoading, setQrLoading] = useState(false);
  const [docForm, setDocForm] = useState({ nom: '', url: '', type: 'autre' });
  const [docUploading, setDocUploading] = useState(false);
  const [deletingDocIdx, setDeletingDocIdx] = useState(null);

  const [notifications, setNotifications] = useState({
    email_reservations: true,
    email_abonnements: true,
    email_formations: true,
  });
  const [canalNotification, setCanalNotification] = useState('email');
  const [notifSaving, setNotifSaving] = useState(false);


  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [exporting, setExporting] = useState(false);

  const photoInputRef = useRef(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const docFileRef = useRef(null);
  const [uploadingDocFile, setUploadingDocFile] = useState(false);

  useEffect(() => {
    loadData();
  }, [session]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      setUserEmail(session?.user?.email || '');

      const [{ profile: prof }, qr, sub] = await Promise.all([
        memberApi.getMe(),
        memberApi.getQr().catch(() => null),
        import('../services/api').then((m) =>
          m.subscriptionApi.getActive().catch(() => ({ subscription: null }))
        ),
      ]);

      setProfile(prof);
      setForm({
        prenom: prof.prenom || '',
        nom: prof.nom || '',
        telephone: prof.telephone || '',
        cin: prof.cin || '',
        type_membre: prof.type_membre || 'individuel',
      });
      setDocuments(prof.documents || []);
      setMemberSince(prof.created_at || prof.date_creation || '');

      if (qr) setQrData(qr);
      if (sub?.subscription) setSubscription(sub.subscription);

      setCanalNotification(prof.canal_notification || prof.notifications?.canal || 'email');

      if (prof.notifications) {
        setNotifications({
          email_reservations: prof.notifications.email_reservations ?? true,
          email_abonnements: prof.notifications.email_abonnements ?? true,
          email_formations: prof.notifications.email_formations ?? true,
        });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const updated = await memberApi.updateMe(form);
      setProfile(updated.profile || updated);
      setSuccess('Profil mis a jour avec succes.');
      setTimeout(() => setSuccess(''), 3500);
    } catch (e) {
      setError(e.message);
      setTimeout(() => setError(''), 3500);
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validation format & taille
    const validMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validMimes.includes(file.type.toLowerCase())) {
      setError('Format d\'image non valide (JPEG, PNG, WEBP ou GIF uniquement).');
      setTimeout(() => setError(''), 4000);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('La photo ne doit pas dépasser 5 Mo.');
      setTimeout(() => setError(''), 4000);
      return;
    }

    // Aperçu immédiat
    const previewUrl = URL.createObjectURL(file);
    setPhotoPreview(previewUrl);
    setPhotoUploading(true);
    setError('');

    try {
      let publicUrl = null;

      // 1. Essayer l'upload sécurisé via le Backend
      try {
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
        });
        reader.readAsDataURL(file);
        const base64Data = await base64Promise;

        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch('/api/upload', {
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

      // 2. Fallback vers le client Supabase direct si l'API n'a pas répondu
      if (!publicUrl) {
        const ext = file.name.split('.').pop() || 'jpg';
        const filePath = `${profile?.id || 'current'}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, file, { upsert: true });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
          publicUrl = urlData.publicUrl;
        }
      }

      if (!publicUrl) {
        throw new Error('Échec du téléversement de la photo.');
      }

      await memberApi.updateMe({ photo_url: publicUrl });
      try {
        await supabase.auth.updateUser({ data: { photo_url: publicUrl, avatar_url: publicUrl } });
      } catch (_) {}

      // Mettre à jour l'état local et notifier le layout / header en temps réel
      setProfile((p) => ({ ...p, photo_url: publicUrl }));
      setPhotoPreview(publicUrl);
      window.dispatchEvent(new CustomEvent('profile-updated', { detail: { photo_url: publicUrl } }));

      setSuccess('Photo de profil mise à jour avec succès.');
      setTimeout(() => setSuccess(''), 3500);
    } catch (e) {
      setError('Erreur lors de l\'enregistrement : ' + e.message);
      setPhotoPreview(profile?.photo_url || null);
      setTimeout(() => setError(''), 3500);
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleDocFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDocFile(true);
    setError('');
    try {
      let publicUrl = null;

      // 1. Essayer upload via Backend
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
            folder: 'documents',
          }),
        });

        const data = await res.json();
        if (res.ok && data.publicUrl) {
          publicUrl = data.publicUrl;
        }
      } catch (_) {}

      // 2. Fallback direct client Supabase
      if (!publicUrl) {
        const ext = file.name.split('.').pop();
        const filePath = `doc_${profile.id || 'usr'}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, file, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
        publicUrl = urlData.publicUrl;
      }

      const defaultName = file.name.replace(/\.[^/.]+$/, '');
      setDocForm((d) => ({
        ...d,
        nom: d.nom || defaultName,
        url: publicUrl,
      }));
      setSuccess('Fichier téléversé ! Cliquez sur "Ajouter" pour enregistrer.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError('Erreur lors du téléversement : ' + err.message);
      setTimeout(() => setError(''), 3500);
    } finally {
      setUploadingDocFile(false);
      if (docFileRef.current) docFileRef.current.value = '';
    }
  };

  const handleAddDocument = async () => {
    if (!docForm.nom.trim() || !docForm.url.trim()) return;
    setDocUploading(true);
    setError('');
    try {
      await memberApi.addDocument(docForm);
      const { profile: prof } = await memberApi.getMe();
      setDocuments(prof.documents || []);
      setDocForm({ nom: '', url: '', type: 'autre' });
      setSuccess('Document ajoute.');
      setTimeout(() => setSuccess(''), 3500);
    } catch (e) {
      setError(e.message);
      setTimeout(() => setError(''), 3500);
    } finally {
      setDocUploading(false);
    }
  };

  const handleRemoveDocument = async (index) => {
    setDeletingDocIdx(index);
    setError('');
    try {
      await memberApi.removeDocument(index);
      const { profile: prof } = await memberApi.getMe();
      setDocuments(prof.documents || []);
      setSuccess('Document supprime.');
      setTimeout(() => setSuccess(''), 3500);
    } catch (e) {
      setError(e.message);
      setTimeout(() => setError(''), 3500);
    } finally {
      setDeletingDocIdx(null);
    }
  };

  const handleCanalChange = async () => {
    setCanalNotification('email');
    try {
      await memberApi.updateMe({
        canal_notification: 'email',
        notifications: { ...notifications, canal: 'email' },
      });
      setSuccess('Canal de notification mis à jour : Email + In-App');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError(e.message);
      setTimeout(() => setError(''), 3500);
    }
  };



  const handleNotificationChange = async (key) => {
    const updated = { ...notifications, [key]: !notifications[key] };
    setNotifications(updated);
    setNotifSaving(true);
    try {
      await memberPortalApi.updateSettings({ notifications: updated });
    } catch (e) {
      setNotifications(notifications);
      setError(e.message);
      setTimeout(() => setError(''), 3500);
    } finally {
      setNotifSaving(false);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const { profile: prof } = await memberApi.getMe();
      const blob = new Blob([JSON.stringify(prof, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mes-données-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      setSuccess('Donnees exportees avec succes.');
      setTimeout(() => setSuccess(''), 3500);
    } catch (e) {
      setError(e.message);
      setTimeout(() => setError(''), 3500);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError('');
    try {
      await memberPortalApi.updateSettings({ delete_request: true });
      await supabase.auth.signOut();
      navigate('/');
    } catch (e) {
      setError(e.message);
      setTimeout(() => setError(''), 3500);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDownloadQr = () => {
    if (!qrData?.token) return;
    const svg = document.getElementById('member-qr-code');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement('a');
      a.download = `qr-access-${profile?.prenom || 'membre'}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const handleShareQr = async () => {
    if (!qrData?.token) return;
    const shareData = {
      title: 'Mon QR d\'acces',
      text: `QR d'acces coworking — Token: ${qrData.token}`,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      await navigator.clipboard.writeText(shareData.text);
      setSuccess('Token copie dans le presse-papier.');
      setTimeout(() => setSuccess(''), 3500);
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return d; }
  };

  const initials = `${profile?.prenom?.[0] || ''}${profile?.nom?.[0] || ''}`.toUpperCase() || 'U';

  if (loading) {
    return (
      <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
        <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
          <div className="flex flex-col items-center gap-3">
            <span className="material-symbols-outlined animate-spin" style={{ fontSize: 32, color: '#f95d00' }}>
              progress_activity
            </span>
            <p className="text-sm text-on-surface-variant font-medium">Chargement du profil...</p>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="mb-6">
        <h1 className="font-sora font-bold text-primary" style={{ fontSize: 24 }}>Mon Profil</h1>
        <p className="text-sm text-on-surface-variant mt-1">Gerez vos informations, documents et securite.</p>
      </div>

      {success && (
        <div
          className="flex items-center gap-2.5 rounded-2xl border px-4 py-3 mb-5 text-sm font-semibold transition-all duration-300"
          style={{ background: 'rgba(47,190,143,0.08)', borderColor: 'rgba(47,190,143,0.25)', color: '#1a8a63' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>
          {success}
        </div>
      )}
      {error && (
        <div
          className="flex items-center gap-2.5 rounded-2xl border px-4 py-3 mb-5 text-sm font-semibold transition-all duration-300"
          style={{ background: 'rgba(255,111,89,0.08)', borderColor: 'rgba(255,111,89,0.25)', color: '#c93a24' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
          {error}
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          BENTO GRID
          ═══════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

        {/* ────────────────────────────────────────────
            SECTION 1 — Informations Personnelles
            ──────────────────────────────────────────── */}
        <div
          className="md:col-span-8 bg-white rounded-3xl border border-outline-variant/10 p-6"
          style={{ boxShadow: '0 4px 24px rgba(16,35,63,0.05)' }}
        >
          <SectionHeader icon="person" title="Informations Personnelles" subtitle="Mettez a jour vos donnees" />

          <div className="flex flex-col sm:flex-row gap-6">
            {/* Avatar */}
            <div className="flex flex-col items-center shrink-0">
              <div className="relative group">
                <div
                  className="flex items-center justify-center rounded-3xl overflow-hidden border-2 border-outline-variant/15"
                  style={{ width: 110, height: 110 }}
                >
                  {photoPreview || profile?.photo_url ? (
                    <img src={photoPreview || profile.photo_url} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center font-sora font-bold text-2xl"
                      style={{ background: 'linear-gradient(135deg, #100f0d, #f95d00)', color: '#dae2ff' }}
                    >
                      {initials}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                  className="absolute bottom-1 right-1 w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg transition-all duration-200 hover:scale-110"
                  style={{ background: '#f95d00' }}
                  title="Changer la photo"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    {photoUploading ? 'progress_activity' : 'photo_camera'}
                  </span>
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </div>
              <p className="text-[11px] text-on-surface-variant mt-2 text-center">
                Membre depuis<br />
                <span className="font-semibold text-on-surface">{formatDate(memberSince)}</span>
              </p>
            </div>

            {/* Fields */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldInput
                label="Prenom"
                value={form.prenom}
                onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))}
              />
              <FieldInput
                label="Nom"
                value={form.nom}
                onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
              />
              <FieldInput
                label="Email"
                value={userEmail}
                readOnly
              />
              <FieldInput
                label="Telephone"
                value={form.telephone}
                onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
              />
              <FieldInput
                label="CIN"
                value={form.cin}
                onChange={(e) => setForm((f) => ({ ...f, cin: e.target.value }))}
              />
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">
                  Rôle & Profil (figé)
                </label>
                <div className="w-full rounded-xl border border-outline-variant/20 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-slate-500">lock</span>
                    Membre ({MEMBER_TYPE_LABELS[profile?.type_membre] || 'Individuel'})
                  </span>
                  <span className="text-[10px] uppercase font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                    Fixe
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-5">
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #f95d00, #100f0d)', boxShadow: '0 4px 14px rgba(249,93,0,0.25)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {saving ? 'progress_activity' : 'save'}
              </span>
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────
            SECTION 2 — QR Code Acces
            ──────────────────────────────────────────── */}
        <div
          className="md:col-span-4 rounded-3xl p-6 flex flex-col items-center text-white relative overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, #0d1f3c 0%, #10233f 50%, #0a1628 100%)',
            boxShadow: '0 8px 32px rgba(10,22,40,0.35)',
          }}
        >
          <div
            className="absolute top-0 right-0 w-32 h-32 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(0,84,203,0.2), transparent)', transform: 'translate(30%, -30%)' }}
          />
          <div
            className="absolute bottom-0 left-0 w-24 h-24 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(45,109,235,0.15), transparent)', transform: 'translate(-20%, 20%)' }}
          />

          <SectionHeader
            icon="qr_code_2"
            title={<span className="text-white">QR Code Acces</span>}
            subtitle={<span className="text-white/60">Presentez ce code a l'entree</span>}
          />

          <div className="relative mt-2 mb-4">
            {/* Pulse ring for active access */}
            {qrData?.token && (
              <div
                className="absolute inset-0 rounded-2xl"
                style={{
                  background: 'rgba(0,84,203,0.15)',
                  animation: 'pulse-ring 2.5s ease-out infinite',
                }}
              />
            )}
            <div
              className="relative bg-white rounded-2xl p-3 flex items-center justify-center"
              style={{ width: 160, height: 160 }}
            >
              {qrData?.token ? (
                <QRCodeSVG
                  id="member-qr-code"
                  value={qrData.token}
                  size={136}
                  bgColor="#ffffff"
                  fgColor="#0d1f3c"
                  level="M"
                  includeMargin={false}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-on-surface-variant/50">
                  <span className="material-symbols-outlined" style={{ fontSize: 40 }}>qr_code_2</span>
                  <span className="text-xs font-medium">Aucun QR</span>
                </div>
              )}
            </div>
          </div>

          {subscription && (
            <div className="text-center mb-4 w-full">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold mb-2"
                style={{ background: 'rgba(47,190,143,0.15)', color: '#2fbe8f' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
                Acces actif
              </div>
              <p className="text-sm font-semibold text-white/90">
                {SUBSCRIPTION_LABELS[subscription.type] || subscription.type}
              </p>
              <p className="text-xs text-white/50 mt-0.5">
                Expire le {formatDate(subscription.date_fin)}
              </p>
            </div>
          )}

          <div className="flex gap-2.5 w-full mt-auto">
            <button
              onClick={handleDownloadQr}
              disabled={!qrData?.token}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.12)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
              Telecharger
            </button>
            <button
              onClick={handleShareQr}
              disabled={!qrData?.token}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-40"
              style={{ background: '#f95d00', color: 'white' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>share</span>
              Partager
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────
            SECTION 3 — Documents
            ──────────────────────────────────────────── */}
        <div
          className="md:col-span-7 bg-white rounded-3xl border border-outline-variant/10 p-6"
          style={{ boxShadow: '0 4px 24px rgba(16,35,63,0.05)' }}
        >
          <SectionHeader icon="folder_open" title="Documents" subtitle="Gardez vos justificatifs en securite" />

          {documents.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div
                className="flex items-center justify-center w-14 h-14 rounded-2xl mb-3"
                style={{ background: 'rgba(0,84,203,0.06)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#b0c4de' }}>drive_file_move</span>
              </div>
              <p className="text-sm font-semibold text-on-surface-variant">Aucun document</p>
              <p className="text-xs text-on-surface-variant/70 mt-1">Ajoutez vos pieces justificatives ici.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 mb-4">
              {documents.map((doc, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant/10 transition-all duration-200 hover:bg-secondary/3"
                >
                  <span
                    className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
                    style={{ background: 'rgba(249,93,0,0.07)', color: '#f95d00' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      {DOC_TYPE_ICONS[doc.type] || 'attach_file'}
                    </span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">{doc.nom || 'Document'}</p>
                    <p className="text-[11px] text-on-surface-variant capitalize">{doc.type || 'autre'}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveDocument(idx)}
                    disabled={deletingDocIdx === idx}
                    className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant/50 hover:text-danger hover:bg-danger/8 transition-all duration-200 disabled:opacity-40"
                    title="Supprimer"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                      {deletingDocIdx === idx ? 'progress_activity' : 'delete'}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add document form */}
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 p-4 sm:p-5 mt-3 shadow-xs">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>note_add</span>
                </span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary">Ajouter un document</h4>
                  <p className="text-[11px] text-on-surface-variant">Téléversez un fichier ou renseignez un lien sécurisé</p>
                </div>
              </div>

              {/* Bouton parcourir direct */}
              <button
                type="button"
                onClick={() => docFileRef.current?.click()}
                disabled={uploadingDocFile || docUploading}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-secondary/30 bg-secondary/5 hover:bg-secondary/10 text-secondary text-xs font-bold transition-all hover:scale-102 active:scale-98 disabled:opacity-50"
              >
                <span className={`material-symbols-outlined ${uploadingDocFile ? 'animate-spin' : ''}`} style={{ fontSize: 16 }}>
                  {uploadingDocFile ? 'sync' : 'upload_file'}
                </span>
                <span>{uploadingDocFile ? 'Téléversement…' : 'Parcourir un fichier'}</span>
              </button>
              <input
                ref={docFileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                className="hidden"
                onChange={handleDocFileUpload}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              {/* Nom du document */}
              <div className="sm:col-span-5 relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 pointer-events-none">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>description</span>
                </span>
                <input
                  type="text"
                  placeholder="Nom du document *"
                  value={docForm.nom}
                  onChange={(e) => setDocForm((d) => ({ ...d, nom: e.target.value }))}
                  className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-outline-variant/30 bg-white text-sm text-on-surface outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15 transition-all"
                />
              </div>

              {/* Type de document */}
              <div className="sm:col-span-3 relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 pointer-events-none">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>category</span>
                </span>
                <select
                  value={docForm.type}
                  onChange={(e) => setDocForm((d) => ({ ...d, type: e.target.value }))}
                  className="w-full h-11 pl-10 pr-8 rounded-xl border border-outline-variant/30 bg-white text-sm text-on-surface outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15 transition-all appearance-none cursor-pointer font-medium"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23667085' viewBox='0 0 16 16'%3E%3Cpath d='M4.5 6l3.5 3.5L11.5 6'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                  }}
                >
                  <option value="cin">CIN</option>
                  <option value="certificat">Certificat</option>
                  <option value="contrat">Contrat</option>
                  <option value="facture">Facture</option>
                  <option value="autre">Autre</option>
                </select>
              </div>

              {/* URL ou chemin */}
              <div className="sm:col-span-4 relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 pointer-events-none">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link</span>
                </span>
                <input
                  type="url"
                  placeholder="URL du fichier (ou parcourir) *"
                  value={docForm.url}
                  onChange={(e) => setDocForm((d) => ({ ...d, url: e.target.value }))}
                  className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-outline-variant/30 bg-white text-sm text-on-surface outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15 transition-all"
                />
              </div>

              {/* Bouton d'action sur toute la largeur ou aligné */}
              <div className="sm:col-span-12 flex justify-end mt-1">
                <button
                  type="button"
                  onClick={handleAddDocument}
                  disabled={docUploading || !docForm.nom.trim() || !docForm.url.trim()}
                  className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl text-xs font-bold text-white transition-all duration-200 hover:opacity-95 active:scale-98 disabled:opacity-40 shadow-sm"
                  style={{ background: '#f95d00' }}
                >
                  <span className={`material-symbols-outlined ${docUploading ? 'animate-spin' : ''}`} style={{ fontSize: 18 }}>
                    {docUploading ? 'sync' : 'add_circle'}
                  </span>
                  <span>{docUploading ? 'Enregistrement…' : 'Ajouter le document'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ────────────────────────────────────────────
            SECTION 4 — Securite & RGPD
            ──────────────────────────────────────────── */}
        <div
          className="md:col-span-5 bg-white rounded-3xl border border-outline-variant/10 p-6"
          style={{ boxShadow: '0 4px 24px rgba(16,35,63,0.05)' }}
        >
          <SectionHeader icon="shield" title="Securite & RGPD" subtitle="Protection de vos donnees" />

          {/* Export */}
          <button
            onClick={handleExportData}
            disabled={exporting}
            className="w-full inline-flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50 mb-3"
            style={{ background: 'rgba(249,93,0,0.06)', color: '#f95d00', border: '1px solid rgba(249,93,0,0.12)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 19 }}>
              {exporting ? 'progress_activity' : 'download'}
            </span>
            <div className="text-left">
              <p>Exporter mes donnees</p>
              <p className="text-[11px] font-normal opacity-70">Telecharger une copie de vos informations</p>
            </div>
          </button>

          {/* Danger zone */}
          <div
            className="rounded-xl border p-4 mb-5"
            style={{ background: 'rgba(255,111,89,0.04)', borderColor: 'rgba(255,111,89,0.15)' }}
          >
            {showDeleteConfirm ? (
              <div className="text-center">
                <p className="text-sm font-semibold text-danger mb-3">
                  Etes-vous sur ? Cette action est irreversible.
                </p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-on-surface-variant bg-outline-variant/10 hover:bg-outline-variant/20 transition-all"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: '#ff6f59' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      {deleting ? 'progress_activity' : 'delete_forever'}
                    </span>
                    Confirmer
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full inline-flex items-center gap-3 text-sm font-semibold transition-all duration-200 hover:opacity-80"
                style={{ color: '#ff6f59' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 19 }}>delete_forever</span>
                <div className="text-left">
                  <p>Supprimer mon compte</p>
                  <p className="text-[11px] font-normal opacity-70">Suppression permanente de toutes vos donnees</p>
                </div>
              </button>
            )}
          </div>

          {/* Notification preferences & Channels (CDC v3.0 — D2 : In-App & E-mail uniquement) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant">
                Canaux de notification actifs
              </p>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary">
                In-App &amp; E-mail
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
              <div className="flex items-center gap-3 p-3 rounded-2xl border-2 border-[#f95d00]/50 bg-[#f95d00]/5">
                <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 22 }}>mail</span>
                <div>
                  <p className="text-xs font-bold text-primary">E-mail</p>
                  <p className="text-[10px] text-on-surface-variant">Confirmations, reçus PDF et rappels</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/60">
                <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: 22 }}>notifications</span>
                <div>
                  <p className="text-xs font-bold text-primary">Notifications In-App</p>
                  <p className="text-[10px] text-on-surface-variant">Alertes en temps réel dans votre portail</p>
                </div>
              </div>
            </div>

            {/* Catégories de notifications */}
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">
              Types de notifications actives
            </p>
            <div className="flex flex-col gap-2">
              {[
                { key: 'email_reservations', label: 'Réservations & rappels J-1', icon: 'event_seat' },
                { key: 'email_abonnements', label: 'Abonnements & échéances', icon: 'card_membership' },
                { key: 'email_formations', label: 'Formations & inscriptions', icon: 'school' },
              ].map(({ key, label, icon }) => (
                <label
                  key={key}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-outline-variant/10 cursor-pointer transition-all duration-200 hover:bg-secondary/3"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex items-center justify-center w-7 h-7 rounded-lg"
                      style={{ background: 'rgba(249,93,0,0.06)', color: '#f95d00' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{icon}</span>
                    </span>
                    <span className="text-xs font-medium text-on-surface">{label}</span>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={notifications[key]}
                      onChange={() => handleNotificationChange(key)}
                      disabled={notifSaving}
                      className="sr-only peer"
                    />
                    <div
                      className="w-9 h-[20px] rounded-full peer-checked:bg-secondary bg-outline-variant/30 transition-all duration-200 cursor-pointer after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:w-[16px] after:h-[16px] after:rounded-full after:shadow-sm after:transition-all after:duration-200 peer-checked:after:translate-x-[16px]"
                    />
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Privacy text */}
          <div className="mt-5 p-3 rounded-xl" style={{ background: 'rgba(0,84,203,0.03)' }}>
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined mt-0.5" style={{ fontSize: 15, color: '#94a3b8' }}>info</span>
              <p className="text-[11px] text-on-surface-variant/70 leading-relaxed">
                Conformement au RGPD, vous pouvez exporter ou supprimer vos donnees a tout moment.
                Vos donnees ne sont jamais partagees avec des tiers sans votre consentement explicite.
                Pour toute question, contactez-nous a <span className="font-semibold">privacy@coworking.ma</span>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════
          KEYFRAMES
          ═══════════════════════════════════════════════ */}
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.08); opacity: 0.1; }
          100% { transform: scale(1); opacity: 0.4; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </PortalLayout>
  );
}
