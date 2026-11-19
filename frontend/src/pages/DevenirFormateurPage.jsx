// pages/DevenirFormateurPage.jsx — Candidature "Devenir Formateur" (CDC v3.0 — Chantier 1 & 2)
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/layout/Navbar';
import { guestApi } from '../services/api/guests';
import { API_URL } from '../services/api';
import { supabase } from '../supabaseClient';

export default function DevenirFormateurPage({ session }) {
  const [form, setForm] = useState({
    prenom: '',
    nom: '',
    email: '',
    telephone: '+216 ',
    password: '',
    specialite: '',
    biographie: '',
    documents: '',
    tenant_id: '',
  });
  const [establishments, setEstablishments] = useState([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    guestApi.getCoworkings()
      .then((res) => setEstablishments(res.coworkings || []))
      .catch(() => {});

    if (session?.user) {
      const m = session.user.user_metadata || {};
      setForm((f) => ({
        ...f,
        prenom: f.prenom || m.prenom || '',
        nom: f.nom || m.nom || '',
        email: f.email || session.user.email || '',
        telephone: f.telephone === '+216 ' && m.telephone ? m.telephone : f.telephone,
      }));
    }
  }, [session]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);
    setError('');
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result.split(',')[1];
          const { data: { session: s } } = await supabase.auth.getSession();
          if (s?.access_token) {
            const res = await fetch(`${API_URL}/api/upload`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${s.access_token}`,
              },
              body: JSON.stringify({ file: base64, filename: file.name, contentType: file.type }),
            });
            const data = await res.json();
            if (res.ok && data.url) {
              setForm((f) => ({ ...f, documents: data.url }));
              setUploadedFileName(file.name);
              setUploadingDoc(false);
              return;
            }
          }
          // Sans session connectée : on conserve le nom du justificatif + taille pour soumission
          setForm((f) => ({ ...f, documents: `${file.name} (${Math.round(file.size / 1024)} Ko)` }));
          setUploadedFileName(file.name);
        } catch (err) {
          setError(err.message);
        } finally {
          setUploadingDoc(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError(err.message);
      setUploadingDoc(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.prenom.trim() || !form.nom.trim() || !form.email.trim() || !form.specialite.trim() || !form.biographie.trim()) {
      setError('Veuillez remplir tous les champs obligatoires.');
      return;
    }
    setLoading(true);
    try {
      const res = await guestApi.submitTrainerApplication(form);
      setSuccess(res);
    } catch (err) {
      setError(err.message || 'Impossible de soumettre votre candidature.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] font-inter text-[#100f0d]">
      <Navbar session={session} activeLink="/devenir-formateur" />

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-28 sm:px-6">
        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-[#f95d00]">
            <span className="material-symbols-outlined text-[16px]">school</span>
            Espace Formateurs DeskyWork
          </span>
          <h1 className="mt-3 font-sora text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Devenir Formateur partenaire
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Animez vos ateliers et sessions de formation dans les meilleurs coworkings et centres partenaires en Tunisie.
            Votre profil reste en statut <strong>En attente (Pending)</strong> jusqu’à validation par un établissement partenaire.
          </p>
        </div>

        {success ? (
          <div className="rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <span className="material-symbols-outlined text-[34px]">hourglass_top</span>
            </div>
            <h2 className="font-sora text-2xl font-bold text-slate-900">Candidature envoyée — Statut : Pending</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-600">
              {success.message}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Retour à l'accueil
              </Link>
              <Link to="/login" className="rounded-xl bg-[#f95d00] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#e55500]">
                Se connecter à mon compte
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 space-y-5">
            {error && (
              <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span className="material-symbols-outlined text-[18px]">error</span>
                <span>{error}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Prénom *</label>
                <input
                  type="text"
                  required
                  value={form.prenom}
                  onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))}
                  placeholder="Ex: Amine"
                  className="form-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Nom *</label>
                <input
                  type="text"
                  required
                  value={form.nom}
                  onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
                  placeholder="Ex: Ben Salah"
                  className="form-input"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Adresse e-mail *</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="formateur@exemple.tn"
                  className="form-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Téléphone *</label>
                <input
                  type="tel"
                  required
                  value={form.telephone}
                  onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
                  placeholder="+216 98 123 456"
                  className="form-input"
                />
              </div>
            </div>

            {!session && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Mot de passe de votre compte formateur (min. 6 caractères)
                </label>
                <input
                  type="password"
                  minLength={6}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Choisissez un mot de passe pour accéder à votre espace"
                  className="form-input"
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Spécialité / Domaines *</label>
                <input
                  type="text"
                  required
                  value={form.specialite}
                  onChange={(e) => setForm((f) => ({ ...f, specialite: e.target.value }))}
                  placeholder="Ex: Développement Web, Marketing Digital, Management"
                  className="form-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Établissement privilégié (optionnel)</label>
                <select
                  value={form.tenant_id}
                  onChange={(e) => setForm((f) => ({ ...f, tenant_id: e.target.value }))}
                  className="form-input"
                >
                  <option value="">Tous les établissements partenaires</option>
                  {establishments.map((est) => (
                    <option key={est.id} value={est.id}>{est.nom} ({est.ville || 'Tunisie'})</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Biographie courte *</label>
              <textarea
                rows={4}
                required
                value={form.biographie}
                onChange={(e) => setForm((f) => ({ ...f, biographie: e.target.value }))}
                placeholder="Présentez votre parcours, votre expérience pédagogique et vos thématiques d'intervention..."
                className="form-input"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Documents / Certifications (CV, diplôme, références)</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={form.documents}
                  onChange={(e) => setForm((f) => ({ ...f, documents: e.target.value }))}
                  placeholder="Ex: Certification PMP, Lien CV / LinkedIn ou nom du document"
                  className="form-input flex-1"
                />
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                  <span className="material-symbols-outlined text-[18px]">upload_file</span>
                  {uploadingDoc ? 'Envoi…' : (uploadedFileName ? uploadedFileName : 'Joindre un fichier')}
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <strong>Validation :</strong> Conformément au processus DeskyWork, votre compte formateur démarre avec le statut <strong>En attente (Pending)</strong> jusqu’à approbation par un coworking / centre de formation partenaire.
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full rounded-xl py-3.5 text-sm font-bold shadow-md flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
              {loading ? 'Envoi en cours…' : 'Soumettre ma candidature formateur'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

