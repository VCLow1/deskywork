import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { settingsApi, cancellationAdvancedApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';

const SPACE_TYPES = [
  { key: 'open_space',          label: 'Open Space' },
  { key: 'private_office',      label: 'Bureau privé' },
  { key: 'meeting_room',        label: 'Salle de réunion' },
  { key: 'training_room',       label: 'Salle de formation' },
  { key: 'event_space',         label: 'Espace événementiel' },
  { key: 'hot_desk',            label: 'Poste nomade (Hot Desk)' },
  { key: 'dedicated_desk',      label: 'Poste fixe (Dedicated Desk)' },
];

function Toggle({ checked, onChange, label, sub }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-secondary' : 'bg-surface-container-highest'}`}
        onClick={onChange}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      <div>
        <p className="text-sm font-semibold text-primary">{label}</p>
        {sub && <p className="text-xs text-on-surface-variant mt-0.5">{sub}</p>}
      </div>
    </label>
  );
}

function NumInput({ label, value, onChange, min = 0, max = 100, step = 1, suffix = '' }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(Number(e.target.value))}
          className="w-24 rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm font-bold text-primary focus:border-secondary focus:ring-2 focus:ring-secondary/15 outline-none" />
        {suffix && <span className="text-sm text-on-surface-variant font-medium">{suffix}</span>}
      </div>
    </div>
  );
}

export default function AdminCancellationPolicy({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const [profile,     setProfile]     = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null
  );
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [savingSpace, setSavingSpace] = useState(null);
  const [msg,         setMsg]         = useState(null);
  const [tab,         setTab]         = useState('global'); // 'global' | 'espaces'
  const navigate = useNavigate();

  // Politique globale
  const [form, setForm] = useState({
    delai_heures: 24, penalite_pct: 0,
    annulation_membre_autorisee: true, remboursement_auto: false, message_membre: '',
  });
  const [updatedAt, setUpdatedAt] = useState(null);

  // Politiques par espace
  const [spacePolicies, setSpacePolicies] = useState({});

  useEffect(() => { loadData(); }, [session]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  const loadData = async () => {
    try {
      setLoading(true);
      const { policy } = await settingsApi.getCancellationPolicy();
      setForm({
        delai_heures: policy.delai_heures ?? 24, penalite_pct: policy.penalite_pct ?? 0,
        annulation_membre_autorisee: policy.annulation_membre_autorisee ?? true,
        remboursement_auto: policy.remboursement_auto ?? false,
        message_membre: policy.message_membre ?? '',
      });
      setUpdatedAt(policy.updated_at);

      // Charger les politiques par espace
      try {
        const { policies } = await cancellationAdvancedApi.getPoliciesByEspace();
        const map = {};
        (policies || []).forEach(p => { map[p.type_espace] = p; });
        // Initialiser les valeurs par défaut pour les types manquants
        SPACE_TYPES.forEach(({ key }) => {
          if (!map[key]) map[key] = {
            type_espace: key, tranche_libre_heures: 24, tranche_tardive_heures: 12,
            penalite_tardive_pct: 50, penalite_tres_tardive_pct: 100, penalite_noshow_pct: 100,
            noshow_note_profil: true, credit_portefeuille_auto: false, credit_portefeuille_pct: 100,
          };
        });
        setSpacePolicies(map);
      } catch { /* table pas encore créée */ }
    } catch { setMsg({ type: 'error', text: 'Erreur de chargement.' }); }
    finally { setLoading(false); }
  };

  const handleSaveGlobal = async () => {
    setSaving(true); setMsg(null);
    try {
      const { policy } = await settingsApi.updateCancellationPolicy(form);
      setUpdatedAt(policy.updated_at);
      setMsg({ type: 'success', text: 'Politique globale mise à jour.' });
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setSaving(false); }
  };

  const handleSaveEspace = async (typeEspace) => {
    setSavingSpace(typeEspace);
    try {
      await cancellationAdvancedApi.upsertPolicyEspace(spacePolicies[typeEspace]);
      setMsg({ type: 'success', text: `Politique ${typeEspace} sauvegardée.` });
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setSavingSpace(null); }
  };

  const updateSpacePolicy = (type, key, val) => {
    setSpacePolicies(p => ({ ...p, [type]: { ...p[type], [key]: val } }));
  };

  if (loading) return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse mb-6" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse mb-4">
            <div className="h-4 w-40 bg-gray-200 rounded mb-3" />
            <div className="h-3 w-full bg-gray-100 rounded mb-2" />
            <div className="h-3 w-3/4 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </PortalLayout>
  );

  return (
    <PortalLayout profile={profile} onLogout={() => { supabase.auth.signOut(); navigate('/'); }}>
      <div className="max-w-4xl mx-auto p-4 sm:p-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Politique d'annulation</h1>
          <p className="text-on-surface-variant text-sm mt-1">Règles globales et règles spécifiques par type d'espace.</p>
        </div>

        {msg && (
          <div className={`mb-4 p-3 rounded-xl text-sm flex items-center gap-2 ${
            msg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{msg.type === 'success' ? 'check_circle' : 'error'}</span>
            {msg.text}
          </div>
        )}

        {/* Onglets */}
        <div className="flex gap-1 bg-surface-container-low p-1 rounded-2xl mb-6 w-fit">
          {[
            { key: 'global',  label: 'Règles globales',    icon: 'policy' },
            { key: 'espaces', label: 'Par type d\'espace',  icon: 'domain' },
          ].map(({ key, label, icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === key ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'
              }`}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* ── Onglet Règles globales ── */}
        {tab === 'global' && (
          <div className="space-y-4">
            <div className="bg-white rounded-3xl border border-outline-variant/20 p-6 shadow-sm">
              <h2 className="font-sora font-bold text-primary text-base mb-5 flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>schedule</span>
                Délais et pénalités généraux
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 mb-6">
                <NumInput label="Délai libre (heures)" value={form.delai_heures} max={168}
                  onChange={v => setForm(f => ({ ...f, delai_heures: v }))} suffix="h" />
                <NumInput label="Pénalité tardive" value={form.penalite_pct} step={5}
                  onChange={v => setForm(f => ({ ...f, penalite_pct: v }))} suffix="%" />
              </div>
              <div className="space-y-4 mb-6">
                <Toggle checked={form.annulation_membre_autorisee}
                  onChange={() => setForm(f => ({ ...f, annulation_membre_autorisee: !f.annulation_membre_autorisee }))}
                  label="Annulations en ligne autorisées"
                  sub="Si désactivé, les membres doivent contacter l'accueil." />
                <Toggle checked={form.remboursement_auto}
                  onChange={() => setForm(f => ({ ...f, remboursement_auto: !f.remboursement_auto }))}
                  label="Remboursement automatique"
                  sub="Rembourse automatiquement en cas d'annulation dans les délais." />
              </div>
              <div className="mb-5">
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1.5">Message affiché aux membres</label>
                <textarea rows={3} value={form.message_membre}
                  onChange={e => setForm(f => ({ ...f, message_membre: e.target.value }))}
                  placeholder="Ex : Annulation gratuite jusqu'à 24h avant le début."
                  className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-2.5 text-sm outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/15 resize-none" />
              </div>
              <div className="flex justify-between items-center">
                {updatedAt && <p className="text-xs text-on-surface-variant">Mis à jour : {new Date(updatedAt).toLocaleString('fr-FR')}</p>}
                <button onClick={handleSaveGlobal} disabled={saving}
                  className="px-5 py-2.5 bg-secondary text-white rounded-xl font-bold text-sm hover:bg-secondary/90 disabled:opacity-50">
                  {saving ? 'Sauvegarde…' : 'Sauvegarder'}
                </button>
              </div>
            </div>

            {/* Aperçu comportement */}
            <div className="bg-white rounded-3xl border border-outline-variant/20 p-6 shadow-sm">
              <h2 className="font-sora font-bold text-primary text-base mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>preview</span>
                Aperçu du comportement
              </h2>
              <div className="space-y-3">
                {[
                  { color: 'emerald', icon: 'check_circle', title: `Annulation ≥ ${form.delai_heures}h avant`, desc: form.penalite_pct === 0 ? 'Remboursement complet, aucune pénalité.' : `Pénalité de ${form.penalite_pct}% retenue.` },
                  { color: 'red', icon: 'cancel', title: `Annulation < ${form.delai_heures}h avant`, desc: !form.annulation_membre_autorisee ? 'Refusée — contacter l\'accueil.' : `100% retenu.` },
                  { color: 'amber', icon: 'person_off', title: 'No-show (absent sans annulation)', desc: '100% retenu + note sur le profil.' },
                ].map((item, i) => (
                  <div key={i} className={`flex items-start gap-3 p-3 rounded-xl bg-${item.color}-50 border border-${item.color}-200`}>
                    <span className={`material-symbols-outlined text-${item.color}-600 shrink-0 mt-0.5`} style={{ fontSize: 18 }}>{item.icon}</span>
                    <div>
                      <p className={`text-sm font-semibold text-${item.color}-800`}>{item.title}</p>
                      <p className={`text-xs text-${item.color}-700 mt-0.5`}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Onglet Par type d'espace ── */}
        {tab === 'espaces' && (
          <div className="space-y-4">
            <p className="text-sm text-on-surface-variant">
              Des règles différentes peuvent s'appliquer selon le type d'espace. Ces règles remplacent les règles globales.
            </p>
            {SPACE_TYPES.map(({ key, label }) => {
              const pol = spacePolicies[key] || {};
              return (
                <div key={key} className="bg-white rounded-3xl border border-outline-variant/20 p-6 shadow-sm">
                  <h3 className="font-sora font-bold text-primary text-base mb-5 flex items-center gap-2">
                    <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-secondary/10">
                      <span className="material-symbols-outlined text-secondary" style={{ fontSize: 15 }}>domain</span>
                    </span>
                    {label}
                  </h3>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
                    <NumInput label="Délai annulation libre" value={pol.tranche_libre_heures ?? 24} max={168}
                      onChange={v => updateSpacePolicy(key, 'tranche_libre_heures', v)} suffix="h" />
                    <NumInput label="Délai tardif" value={pol.tranche_tardive_heures ?? 12} max={168}
                      onChange={v => updateSpacePolicy(key, 'tranche_tardive_heures', v)} suffix="h" />
                    <NumInput label="Pénalité tardive" value={pol.penalite_tardive_pct ?? 50} step={5}
                      onChange={v => updateSpacePolicy(key, 'penalite_tardive_pct', v)} suffix="%" />
                    <NumInput label="Pénalité très tardive" value={pol.penalite_tres_tardive_pct ?? 100} step={5}
                      onChange={v => updateSpacePolicy(key, 'penalite_tres_tardive_pct', v)} suffix="%" />
                    <NumInput label="Pénalité no-show" value={pol.penalite_noshow_pct ?? 100} step={5}
                      onChange={v => updateSpacePolicy(key, 'penalite_noshow_pct', v)} suffix="%" />
                    <NumInput label="Crédit portefeuille" value={pol.credit_portefeuille_pct ?? 100} step={5}
                      onChange={v => updateSpacePolicy(key, 'credit_portefeuille_pct', v)} suffix="%" />
                  </div>

                  <div className="space-y-3 mb-5">
                    <Toggle checked={pol.noshow_note_profil ?? true}
                      onChange={() => updateSpacePolicy(key, 'noshow_note_profil', !(pol.noshow_note_profil ?? true))}
                      label="Ajouter note sur le profil en cas de no-show"
                      sub="Note visible uniquement par l'admin." />
                    <Toggle checked={pol.credit_portefeuille_auto ?? false}
                      onChange={() => updateSpacePolicy(key, 'credit_portefeuille_auto', !(pol.credit_portefeuille_auto ?? false))}
                      label="Proposer crédit portefeuille lors de l'annulation"
                      sub="Le montant remboursé est converti en crédit pour la prochaine réservation." />
                  </div>

                  <div className="flex justify-end">
                    <button onClick={() => handleSaveEspace(key)} disabled={savingSpace === key}
                      className="px-4 py-2 bg-secondary text-white rounded-xl font-bold text-sm hover:bg-secondary/90 disabled:opacity-50 flex items-center gap-1.5">
                      {savingSpace === key
                        ? <><span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full inline-block" />Sauvegarde…</>
                        : <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>save</span>Sauvegarder</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
