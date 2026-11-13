import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { rgpdApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';

const STATUT_STYLES = {
  en_attente: 'bg-amber-50 text-amber-700 border-amber-200',
  en_cours:   'bg-[#f95d00]/10 text-[#f95d00] border-[#f95d00]/20',
  traite:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  refuse:     'bg-red-50 text-red-700 border-red-200',
};
const STATUT_LABELS = { en_attente: 'En attente', en_cours: 'En cours', traite: 'Traité', refuse: 'Refusé' };

const DEMANDE_TYPES = [
  { key: 'export',             label: 'Exporter mes données',    icon: 'download',       desc: 'Téléchargez toutes vos données personnelles (profil, réservations, paiements).' },
  { key: 'suppression',        label: 'Supprimer mon compte',    icon: 'delete_forever', desc: 'Demande de suppression de votre compte et de vos données (30 jours, sauf obligations légales).' },
  { key: 'rectification',      label: 'Corriger mes données',    icon: 'edit',           desc: 'Demandez une correction de vos données personnelles.' },
  { key: 'opposition_marketing', label: 'Opposition marketing',  icon: 'block',          desc: 'Refusez l\'utilisation de vos données à des fins commerciales.' },
  { key: 'portabilite',        label: 'Portabilité des données', icon: 'move_down',      desc: 'Obtenez une copie de vos données dans un format exploitable.' },
];

export default function MemberRGPD({ session }) {
  const [profile,   setProfile]   = useState(null);
  const [demandes,  setDemandes]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [submitting,setSubmitting]= useState('');
  const [success,   setSuccess]   = useState('');
  const [error,     setError]     = useState('');
  const [exportData, setExportData] = useState(null);

  useEffect(() => { loadData(); }, [session]);
  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); } }, [success]);
  useEffect(() => { if (error)   { const t = setTimeout(() => setError(''),   4000); return () => clearTimeout(t); } }, [error]);

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      setProfile(prof);
      const { demandes: d } = await rgpdApi.getMyRequests();
      setDemandes(d || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleRequest = async (type) => {
    setSubmitting(type);
    setError('');
    try {
      const res = await rgpdApi.submitRequest({ type_demande: type });
      if (res.error) { setError(res.error); return; }
      if (type === 'export' && res.export_data) {
        setExportData(res.export_data);
      }
      setSuccess(res.message || 'Demande enregistrée.');
      await loadData();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(''); }
  };

  const downloadExport = () => {
    if (!exportData) return;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `mes-données-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleMarketingToggle = async (key) => {
    try {
      await rgpdApi.updateMarketing({ [key]: !profile?.[key] });
      setProfile(p => ({ ...p, [key]: !p?.[key] }));
      setSuccess('Préférences mises à jour.');
    } catch (e) { setError(e.message); }
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
    </div>
  );

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="max-w-3xl mx-auto p-4 sm:p-6">

        <div className="mb-6">
          <h1 className="font-sora font-bold text-primary text-2xl sm:text-3xl">Mes données & confidentialité</h1>
          <p className="text-on-surface-variant text-sm mt-1">Gérez vos droits RGPD et vos préférences de communication.</p>
        </div>

        {success && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-sm flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>{success}
            {exportData && (
              <button onClick={downloadExport} className="ml-auto text-xs font-bold text-emerald-800 underline">Télécharger l'export</button>
            )}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-error-container text-on-error-container text-sm flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>{error}
          </div>
        )}

        {/* ── Préférences marketing ── */}
        <div className="bg-white rounded-3xl border border-outline-variant/20 p-6 mb-4 shadow-sm">
          <h2 className="font-sora font-bold text-primary text-base mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>notifications</span>
            Préférences de communication
          </h2>
          <div className="space-y-4">
            {[
              { key: 'marketing_email', label: 'Emails commerciaux', sub: 'Offres, promotions, actualités du coworking.' },
            ].map(({ key, label, sub }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-primary text-sm">{label}</p>
                  <p className="text-xs text-on-surface-variant">{sub}</p>
                </div>
                <button onClick={() => handleMarketingToggle(key)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${profile?.[key] ? 'bg-secondary' : 'bg-surface-container-highest'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${profile?.[key] ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-on-surface-variant mt-4 italic">
            Note : Les emails transactionnels (confirmations, reçus, rappels) ne peuvent pas être désactivés.
          </p>
        </div>

        {/* ── Droits RGPD ── */}
        <div className="bg-white rounded-3xl border border-outline-variant/20 p-6 mb-4 shadow-sm">
          <h2 className="font-sora font-bold text-primary text-base mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>security</span>
            Vos droits sur vos données
          </h2>
          <p className="text-xs text-on-surface-variant mb-5">
            Conformément au RGPD, vous disposez des droits suivants sur vos données personnelles.
          </p>
          <div className="space-y-3">
            {DEMANDE_TYPES.map(({ key, label, icon, desc }) => {
              const pending = demandes.find(d => d.type_demande === key && d.statut === 'en_attente');
              const isDanger = key === 'suppression';
              return (
                <div key={key} className={`flex items-start gap-4 p-4 rounded-2xl border transition-colors ${
                  isDanger ? 'border-red-200 bg-red-50/50' : 'border-outline-variant/15 bg-surface-container-low'
                }`}>
                  <span className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${
                    isDanger ? 'bg-red-100' : 'bg-secondary/10'
                  }`}>
                    <span className={`material-symbols-outlined ${isDanger ? 'text-red-500' : 'text-secondary'}`} style={{ fontSize: 18 }}>{icon}</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-primary text-sm">{label}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">{desc}</p>
                  </div>
                  <div className="shrink-0">
                    {pending ? (
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${STATUT_STYLES.en_attente}`}>
                        En attente
                      </span>
                    ) : (
                      <button onClick={() => handleRequest(key)} disabled={submitting === key}
                        className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all disabled:opacity-50 ${
                          isDanger
                            ? 'bg-red-500 text-white hover:bg-red-600'
                            : 'bg-secondary text-white hover:bg-secondary/90'
                        }`}>
                        {submitting === key
                          ? <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full inline-block" />
                          : key === 'export' ? 'Exporter' : 'Demander'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Historique demandes ── */}
        {demandes.length > 0 && (
          <div className="bg-white rounded-3xl border border-outline-variant/20 p-6 shadow-sm">
            <h2 className="font-sora font-bold text-primary text-base mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>history</span>
              Historique de mes demandes
            </h2>
            <div className="space-y-2">
              {demandes.map((d) => {
                const info = DEMANDE_TYPES.find(t => t.key === d.type_demande);
                return (
                  <div key={d.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-outline-variant/10">
                    <div>
                      <p className="font-semibold text-primary text-sm">{info?.label || d.type_demande}</p>
                      <p className="text-xs text-on-surface-variant">{new Date(d.created_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUT_STYLES[d.statut]}`}>
                      {STATUT_LABELS[d.statut]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
