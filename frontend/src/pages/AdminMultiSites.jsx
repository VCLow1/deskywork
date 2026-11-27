import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { sitesApi, memberApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import { normalizeTunisianPhone, validateTunisianPhone } from '../utils/tunisianPhone';
import TunisianPhoneInput from '../components/common/TunisianPhoneInput';

export default function AdminMultiSites({ session }) {
  const userId = session?.user?.id;
  const [profile,  setProfile]  = useState(null);
  const [sites,    setSites]    = useState([]);
  const [selected, setSelected] = useState(null); // site sélectionné pour détails
  const [members,  setMembers]  = useState([]);
  const [allMembers, setAllMembers] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [success,  setSuccess]  = useState('');
  const [error,    setError]    = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState({ nom: '', adresse: '', ville: '', telephone: '', email: '' });
  const [editId,   setEditId]   = useState(null);
  const [search,   setSearch]   = useState('');

  useEffect(() => { if (userId) loadData(); }, [userId]);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 3500); return () => clearTimeout(t); } }, [success]);
  useEffect(() => { if (error)   { const t = setTimeout(() => setError(''),   3500); return () => clearTimeout(t); } }, [error]);
  useEffect(() => { if (selected) loadSiteMembers(selected.id); }, [selected]);

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', userId).single();
      setProfile(prof);
      const { sites: s } = await sitesApi.getAll();
      setSites(s || []);
      const { members: m } = await memberApi.getAll();
      setAllMembers((m || []).filter(x => x.role === 'member'));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const loadSiteMembers = async (siteId) => {
    try {
      const { membres } = await sitesApi.getMembers(siteId);
      setMembers(membres || []);
    } catch { setMembers([]); }
  };

  const handleSave = async () => {
    if (!form.nom.trim()) { setError('Le nom est requis.'); return; }
    if (form.telephone && form.telephone.trim()) {
      const check = validateTunisianPhone(form.telephone);
      if (!check.valid) { setError(check.error); return; }
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        telephone: form.telephone?.trim() ? normalizeTunisianPhone(form.telephone) : '',
      };
      if (editId) {
        await sitesApi.update(editId, payload);
        setSuccess('Site mis à jour.');
      } else {
        await sitesApi.create(payload);
        setSuccess('Site créé.');
      }
      setForm({ nom: '', adresse: '', ville: '', telephone: '', email: '' });
      setShowForm(false); setEditId(null);
      await loadData();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (site) => {
    if (!window.confirm(`Supprimer le site "${site.nom}" ?`)) return;
    try {
      const res = await sitesApi.delete(site.id);
      if (res.error) { setError(res.error); return; }
      setSuccess('Site supprimé.'); if (selected?.id === site.id) setSelected(null);
      await loadData();
    } catch (e) { setError(e.message); }
  };

  const handleToggleActive = async (site) => {
    try {
      await sitesApi.update(site.id, { actif: !site.actif });
      await loadData();
    } catch (e) { setError(e.message); }
  };

  const handleAddMember = async (userId) => {
    try {
      await sitesApi.addMember(selected.id, userId);
      setSuccess('Membre ajouté à ce site.');
      await loadSiteMembers(selected.id);
    } catch (e) { setError(e.message); }
  };

  const handleRemoveMember = async (userId) => {
    try {
      await sitesApi.removeMember(selected.id, userId);
      setSuccess('Accès retiré.'); await loadSiteMembers(selected.id);
    } catch (e) { setError(e.message); }
  };

  const editSite = (site) => {
    setEditId(site.id);
    setForm({ nom: site.nom, adresse: site.adresse || '', ville: site.ville || '', telephone: site.telephone || '', email: site.email || '' });
    setShowForm(true);
  };

  const memberIds = members.map(m => m.user_id);
  const filteredAll = allMembers.filter(m =>
    !memberIds.includes(m.id) &&
    (`${m.prenom} ${m.nom} ${m.email}`).toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
    </div>
  );

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="mb-5 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center gap-3 text-sm">
          <span className="material-symbols-outlined text-amber-700">lock_clock</span>
          <div>
            <strong>Offre Pro :</strong> La gestion multi-sites est réservée aux établissements disposant de l&apos;abonnement Pro. Votre établissement fonctionne actuellement en mode mono-site.
          </div>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Gestion multi-sites</h1>
            <p className="text-on-surface-variant text-sm mt-1">Gérez vos différents sites et les accès des membres.</p>
          </div>
          <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ nom: '', adresse: '', ville: '', telephone: '', email: '' }); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-white rounded-2xl font-bold text-sm hover:bg-secondary/90 transition-all">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{showForm ? 'close' : 'add'}</span>
            {showForm ? 'Annuler' : 'Nouveau site'}
          </button>
        </div>

        {success && <div className="mb-4 p-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-sm flex items-center gap-2"><span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>{success}</div>}
        {error   && <div className="mb-4 p-3 rounded-xl bg-error-container text-on-error-container text-sm flex items-center gap-2"><span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>{error}</div>}

        {/* Formulaire création/édition */}
        {showForm && (
          <div className="bg-white rounded-3xl border border-outline-variant/20 p-6 mb-6 shadow-sm">
            <h2 className="font-sora font-bold text-primary text-base mb-4">
              {editId ? 'Modifier le site' : 'Nouveau site'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {[
                { key: 'nom',       label: 'Nom du site *',  placeholder: 'Ex : Siège Tunis Centre' },
                { key: 'adresse',   label: 'Adresse',        placeholder: 'Rue, numéro' },
                { key: 'ville',     label: 'Ville',          placeholder: 'Ex : Tunis' },
                { key: 'telephone', label: 'Téléphone',      placeholder: '+216 XX XXX XXX' },
                { key: 'email',     label: 'Email du site',  placeholder: 'site@coworking.tn' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">{label}</label>
                  {key === 'telephone' ? (
                    <TunisianPhoneInput
                      value={form.telephone}
                      onChange={(val) => setForm((f) => ({ ...f, telephone: val }))}
                      placeholder={placeholder}
                      className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-2.5 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15"
                    />
                  ) : (
                    <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-2.5 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15" />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowForm(false); setEditId(null); }}
                className="px-4 py-2.5 border border-outline-variant/30 text-on-surface-variant rounded-xl font-semibold text-sm hover:bg-surface-container">
                Annuler
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2.5 bg-secondary text-white rounded-xl font-bold text-sm hover:bg-secondary/90 disabled:opacity-50">
                {saving ? 'Sauvegarde…' : editId ? 'Mettre à jour' : 'Créer le site'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* ── Liste des sites ── */}
          <div className={selected ? 'lg:col-span-5' : 'lg:col-span-12'}>
            {sites.length === 0 ? (
              <div className="bg-white rounded-3xl border border-outline-variant/20 p-10 text-center shadow-sm">
                <span className="material-symbols-outlined text-on-surface-variant/30 block mb-3" style={{ fontSize: 48 }}>location_city</span>
                <p className="font-semibold text-primary mb-1">Aucun site configuré</p>
                <p className="text-sm text-on-surface-variant">Créez votre premier site en cliquant sur "Nouveau site".</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sites.map((site) => (
                  <div key={site.id}
                    className={`bg-white rounded-3xl border p-5 shadow-sm cursor-pointer transition-all hover:-translate-y-0.5 ${
                      selected?.id === site.id ? 'border-secondary ring-2 ring-secondary/20' : 'border-outline-variant/20'
                    }`}
                    onClick={() => setSelected(s => s?.id === site.id ? null : site)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${site.actif ? 'bg-emerald-100' : 'bg-surface-container-high'}`}>
                          <span className={`material-symbols-outlined ${site.actif ? 'text-emerald-600' : 'text-on-surface-variant'}`} style={{ fontSize: 18 }}>location_city</span>
                        </span>
                        <div className="min-w-0">
                          <p className="font-sora font-bold text-primary text-sm truncate">{site.nom}</p>
                          {site.ville && <p className="text-xs text-on-surface-variant">{site.ville}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${site.actif ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-container-high text-on-surface-variant'}`}>
                          {site.actif ? 'Actif' : 'Inactif'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-outline-variant/10 text-xs text-on-surface-variant">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>group</span>
                        {site.nb_membres || 0} membre(s)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>domain</span>
                        {(site.espaces || []).length} espace(s)
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
                      <button onClick={() => editSite(site)} className="text-on-surface-variant hover:text-primary transition-colors" title="Modifier">
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                      </button>
                      <button onClick={() => handleToggleActive(site)} className={`text-sm transition-colors ${site.actif ? 'text-amber-500 hover:text-amber-700' : 'text-emerald-500 hover:text-emerald-700'}`} title={site.actif ? 'Désactiver' : 'Activer'}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{site.actif ? 'pause_circle' : 'play_circle'}</span>
                      </button>
                      <button onClick={() => handleDelete(site)} className="text-red-400 hover:text-red-600 transition-colors ml-auto" title="Supprimer">
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Détails site sélectionné (membres) ── */}
          {selected && (
            <div className="lg:col-span-7">
              <div className="bg-white rounded-3xl border border-outline-variant/20 p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="font-sora font-bold text-primary text-base">{selected.nom}</h2>
                    <p className="text-xs text-on-surface-variant">Membres autorisés sur ce site</p>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-on-surface-variant hover:text-primary">
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
                  </button>
                </div>

                {/* Membres actuels */}
                <div className="space-y-2 mb-4">
                  {members.length === 0 ? (
                    <p className="text-sm text-on-surface-variant text-center py-4">Aucun membre autorisé sur ce site.</p>
                  ) : members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant/10 hover:bg-surface-container-low transition-colors">
                      <div className="w-7 h-7 rounded-full bg-secondary/10 flex items-center justify-center font-bold text-xs text-secondary shrink-0">
                        {(m.profiles?.prenom?.[0] || '') + (m.profiles?.nom?.[0] || '')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-primary text-sm truncate">{m.profiles?.prenom} {m.profiles?.nom}</p>
                        <p className="text-xs text-on-surface-variant truncate">{m.profiles?.email}</p>
                      </div>
                      <button onClick={() => handleRemoveMember(m.user_id)} title="Retirer l'accès"
                        className="text-red-400 hover:text-red-600 transition-colors shrink-0">
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_remove</span>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Ajouter un membre */}
                <div className="border-t border-outline-variant/10 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-2">Ajouter un membre</p>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Rechercher par nom ou email…"
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm outline-none focus:border-secondary mb-2" />
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {filteredAll.slice(0, 10).map((m) => (
                      <button key={m.id} onClick={() => handleAddMember(m.id)}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/5 transition-colors text-left">
                        <div className="w-6 h-6 rounded-full bg-secondary/10 flex items-center justify-center font-bold text-xs text-secondary shrink-0">
                          {(m.prenom?.[0] || '') + (m.nom?.[0] || '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-primary text-xs truncate">{m.prenom} {m.nom}</p>
                          <p className="text-xs text-on-surface-variant truncate">{m.email}</p>
                        </div>
                        <span className="material-symbols-outlined text-secondary shrink-0" style={{ fontSize: 16 }}>add_circle</span>
                      </button>
                    ))}
                    {filteredAll.length === 0 && search && (
                      <p className="text-xs text-on-surface-variant text-center py-2">Aucun résultat.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
