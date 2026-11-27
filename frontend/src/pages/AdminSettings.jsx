import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { tenantAdminApi } from '../services/api';
import { formatDateTimeDMY } from '../utils/format';
import TunisianPhoneInput from '../components/common/TunisianPhoneInput';
import AdminCancellationPolicy from './AdminCancellationPolicy';
import AdminTeam from './AdminTeam';
import AdminSubscription from './AdminSubscription';

const SETTINGS_TABS = [
  { id: 'etablissement', label: 'Établissement', icon: 'storefront' },
  { id: 'annulation', label: "Politique d'annulation", icon: 'gavel' },
  { id: 'taxes', label: 'Taxes et facturation', icon: 'receipt_long' },
  { id: 'equipe', label: 'Équipe et rôles', icon: 'badge' },
  { id: 'notifications', label: 'Notifications et modèles', icon: 'notifications_active' },
  { id: 'abonnement', label: 'Mon abonnement DESKYWORK', icon: 'workspace_premium' },
  { id: 'journal', label: "Journal d'activité", icon: 'history' },
  { id: 'integrations', label: 'Intégrations', icon: 'extension' },
];

const DEFAULT_ALERTS = {
  alerte_fin_session_inapp: true,
  alerte_depassement_inapp: true,
  confirmation_reservation_email: true,
  recu_paiement_email: true,
  rappel_echeance_abonnement_email: true,
  relance_impaye_email: false,
  nouvelle_inscription_email: true,
};

export default function AdminSettings({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = useMemo(
    () => (userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null),
    [userId, email, metadata]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = SETTINGS_TABS.some((t) => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'etablissement';
  const [tab, setTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [etabForm, setEtabForm] = useState({
    nom: '', description: '', adresse: '', ville: '', pays: 'Tunisie',
    email: '', telephone: '', site_web: '',
    activite: 'mixte', module_formations_actif: true, auto_confirmation: false, tarif_depassement_heure: 0,
  });

  const [taxesForm, setTaxesForm] = useState({
    tva_defaut_pct: 19,
    timbre_fiscal: 1.000,
    matricule_fiscale: '',
    prefixe_facture: 'FAC',
    mentions_legales: 'TVA 19% applicable selon la législation tunisienne en vigueur.',
  });

  const [alertSettings, setAlertSettings] = useState({ ...DEFAULT_ALERTS });
  const [integrations, setIntegrations] = useState({
    google_calendar_sync: false,
    webhook_url: '',
    export_comptable_format: 'sage_csv',
  });

  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logActionFilter, setLogActionFilter] = useState('');
  const [logEntityFilter, setLogEntityFilter] = useState('');

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && SETTINGS_TABS.some((item) => item.id === t)) setTab(t);
  }, [searchParams]);

  const selectTab = (id) => {
    setTab(id);
    setSearchParams({ tab: id });
  };

  const showToast = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3500); };

  const loadSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const [tRes, notifRes] = await Promise.all([
        tenantAdminApi.getTenant(),
        tenantAdminApi.getSupportState().catch(() => null),
      ]);
      const t = tRes?.tenant || {};
      const s = t.settings || {};
      setEtabForm({
        nom: t.nom || '',
        description: t.description || '',
        adresse: t.adresse || '',
        ville: t.ville || '',
        pays: t.pays || 'Tunisie',
        email: t.email || '',
        telephone: t.telephone || '',
        site_web: t.site_web || '',
        activite: s.activite || 'mixte',
        module_formations_actif: s.module_formations_actif !== false,
        auto_confirmation: Boolean(s.auto_confirmation),
        tarif_depassement_heure: Number(s.tarif_depassement_heure || 0),
      });
      setTaxesForm({
        tva_defaut_pct: Number(s.tva_defaut_pct ?? 19),
        timbre_fiscal: Number(s.taxes_facturation?.timbre_fiscal ?? 1.000),
        matricule_fiscale: s.taxes_facturation?.matricule_fiscale || '',
        prefixe_facture: s.taxes_facturation?.prefixe_facture || 'FAC',
        mentions_legales: s.taxes_facturation?.mentions_legales || 'TVA 19% applicable selon la législation tunisienne en vigueur.',
      });
      if (notifRes?.alert_settings) {
        setAlertSettings({ ...DEFAULT_ALERTS, ...notifRes.alert_settings });
      }
      if (s.integrations) {
        setIntegrations({
          google_calendar_sync: Boolean(s.integrations.google_calendar_sync),
          webhook_url: s.integrations.webhook_url || '',
          export_comptable_format: s.integrations.export_comptable_format || 'sage_csv',
        });
      }
    } catch (e) {
      setError(e.message || 'Impossible de charger les paramètres.');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await tenantAdminApi.getActivityLog({
        action: logActionFilter || undefined,
        entite_type: logEntityFilter || undefined,
        limit: 120,
      });
      setLogs(res.logs || []);
    } catch (_) {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => { loadSettings(); }, []);
  useEffect(() => {
    if (tab === 'journal') loadLogs();
  }, [tab, logActionFilter, logEntityFilter]);

  const handleSaveEtab = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await tenantAdminApi.updateTenant({
        nom: etabForm.nom,
        description: etabForm.description,
        adresse: etabForm.adresse,
        ville: etabForm.ville,
        pays: etabForm.pays,
        email: etabForm.email,
        telephone: etabForm.telephone,
        site_web: etabForm.site_web,
        activite: etabForm.activite,
        module_formations_actif: etabForm.module_formations_actif,
        auto_confirmation: etabForm.auto_confirmation,
        tarif_depassement_heure: etabForm.tarif_depassement_heure,
      });
      window.dispatchEvent(new CustomEvent('tenant-settings-updated', {
        detail: {
          activite: etabForm.activite,
          module_formations_actif: etabForm.module_formations_actif,
        },
      }));
      showToast('Paramètres de l\'établissement enregistrés.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTaxes = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await tenantAdminApi.updateTenant({
        tva_defaut_pct: Number(taxesForm.tva_defaut_pct),
        taxes_facturation: {
          timbre_fiscal: Number(taxesForm.timbre_fiscal),
          matricule_fiscale: taxesForm.matricule_fiscale.trim(),
          prefixe_facture: taxesForm.prefixe_facture.trim() || 'FAC',
          mentions_legales: taxesForm.mentions_legales.trim(),
        },
      });
      showToast('Paramètres fiscaux et TVA enregistrés.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAlerts = async () => {
    setSaving(true);
    setError('');
    try {
      await tenantAdminApi.updateAlertSettings(alertSettings);
      showToast('Préférences de notifications enregistrées.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveIntegrations = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await tenantAdminApi.updateTenant({ integrations });
      showToast('Intégrations enregistrées.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalLayout profile={profile}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 text-left">
          <h1 className="font-sora font-bold text-2xl sm:text-3xl text-primary">Paramètres</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Configuration de l'établissement, fiscalité, équipe, abonnement DESKYWORK et journal d'activité.
          </p>
        </div>

        {/* Navigation par onglets */}
        <div className="flex flex-wrap gap-2 mb-6">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              style={tab === t.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition ${
                tab === t.id
                  ? 'shadow-xs'
                  : 'bg-surface-container-lowest border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {msg && <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold">{msg}</div>}
        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">{error}</div>}

        {loading && tab === 'etablissement' ? (
          <div className="bg-surface-container-lowest rounded-3xl p-10 text-center text-sm text-on-surface-variant">Chargement…</div>
        ) : null}

        {!loading && tab === 'etablissement' && (
          <form onSubmit={handleSaveEtab} className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/15 space-y-6">
            <div className="p-4 rounded-2xl border border-[#f95d00]/25 bg-orange-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="font-sora font-bold text-primary text-base">Module Formations</p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Désactivez ce module si votre établissement n'organise pas de formations : l'entrée et les KPI associés seront complètement masqués.
                </p>
              </div>
              <label className="inline-flex items-center gap-2.5 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={etabForm.module_formations_actif}
                  onChange={(e) => setEtabForm((f) => ({ ...f, module_formations_actif: e.target.checked }))}
                  className="w-5 h-5 accent-[#f95d00]"
                />
                <span className="text-sm font-bold text-primary">
                  {etabForm.module_formations_actif ? 'Activé' : 'Désactivé'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Nom de l'établissement *</label>
                <input required value={etabForm.nom} onChange={(e) => setEtabForm((f) => ({ ...f, nom: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">E-mail de contact</label>
                <input type="email" value={etabForm.email} onChange={(e) => setEtabForm((f) => ({ ...f, email: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Téléphone (+216)</label>
                <TunisianPhoneInput value={etabForm.telephone} onChange={(v) => setEtabForm((f) => ({ ...f, telephone: v }))} />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Ville</label>
                <input value={etabForm.ville} onChange={(e) => setEtabForm((f) => ({ ...f, ville: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Adresse</label>
                <input value={etabForm.adresse} onChange={(e) => setEtabForm((f) => ({ ...f, adresse: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Description</label>
                <textarea rows={3} value={etabForm.description} onChange={(e) => setEtabForm((f) => ({ ...f, description: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Activité</label>
                <select value={etabForm.activite} onChange={(e) => setEtabForm((f) => ({ ...f, activite: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm bg-white">
                  <option value="mixte">Mixte (Coworking & Formations)</option>
                  <option value="coworking">Coworking uniquement</option>
                  <option value="centre_formation">Centre de formation</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Majoration dépassement (DT/h)</label>
                <input type="number" min="0" step="0.001" value={etabForm.tarif_depassement_heure} onChange={(e) => setEtabForm((f) => ({ ...f, tarif_depassement_heure: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
            </div>

            <div className="flex justify-end">
              <button type="submit" disabled={saving} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="px-6 py-2.5 rounded-xl text-sm font-bold shadow-sm">
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        )}

        {tab === 'annulation' && <AdminCancellationPolicy session={session} embedded />}

        {tab === 'taxes' && (
          <form onSubmit={handleSaveTaxes} className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/15 space-y-5">
            <h2 className="font-sora font-bold text-lg text-primary">Taxes et facturation tunisienne</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">TVA par défaut (%)</label>
                <input type="number" min="0" max="100" step="0.5" value={taxesForm.tva_defaut_pct} onChange={(e) => setTaxesForm((f) => ({ ...f, tva_defaut_pct: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Timbre fiscal (DT)</label>
                <input type="number" min="0" step="0.001" value={taxesForm.timbre_fiscal} onChange={(e) => setTaxesForm((f) => ({ ...f, timbre_fiscal: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Matricule fiscale</label>
                <input value={taxesForm.matricule_fiscale} onChange={(e) => setTaxesForm((f) => ({ ...f, matricule_fiscale: e.target.value }))} placeholder="Ex : 1234567/A/M/000" className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Préfixe factures</label>
                <input value={taxesForm.prefixe_facture} onChange={(e) => setTaxesForm((f) => ({ ...f, prefixe_facture: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Mentions légales sur factures & devis</label>
                <textarea rows={2} value={taxesForm.mentions_legales} onChange={(e) => setTaxesForm((f) => ({ ...f, mentions_legales: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={saving} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="px-6 py-2.5 rounded-xl text-sm font-bold">
                {saving ? 'Enregistrement…' : 'Enregistrer la fiscalité'}
              </button>
            </div>
          </form>
        )}

        {tab === 'equipe' && <AdminTeam session={session} embedded />}

        {tab === 'notifications' && (
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/15 space-y-4">
            <h2 className="font-sora font-bold text-lg text-primary">Notifications automatiques & modèles</h2>
            <div className="divide-y divide-outline-variant/10">
              {[
                { key: 'alerte_fin_session_inapp', label: 'Alerte fin de session (-15 min) dans le portail' },
                { key: 'alerte_depassement_inapp', label: 'Alerte session en dépassement en temps réel' },
                { key: 'confirmation_reservation_email', label: 'E-mail de confirmation de réservation au client' },
                { key: 'recu_paiement_email', label: 'Envoi automatique du reçu PDF lors de l\'encaissement' },
                { key: 'rappel_echeance_abonnement_email', label: 'Rappel automatique J-7 avant expiration d\'abonnement' },
                { key: 'relance_impaye_email', label: 'Relance automatique des impayés en attente' },
                { key: 'nouvelle_inscription_email', label: 'Notification e-mail lors d\'une nouvelle inscription membre' },
              ].map((item) => (
                <label key={item.key} className="flex items-center justify-between py-3 cursor-pointer">
                  <span className="text-sm font-medium text-primary">{item.label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(alertSettings[item.key])}
                    onChange={(e) => setAlertSettings((s) => ({ ...s, [item.key]: e.target.checked }))}
                    className="w-4 h-4 accent-[#f95d00]"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" onClick={handleSaveAlerts} disabled={saving} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="px-6 py-2.5 rounded-xl text-sm font-bold">
                {saving ? 'Enregistrement…' : 'Enregistrer les notifications'}
              </button>
            </div>
          </div>
        )}

        {tab === 'abonnement' && <AdminSubscription session={session} embedded />}

        {tab === 'journal' && (
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/15 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-sora font-bold text-lg text-primary">Journal d'activité (Audit)</h2>
                <p className="text-xs text-on-surface-variant">Traçabilité automatique des créations, modifications, statuts, encaissements et archivages.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select value={logActionFilter} onChange={(e) => setLogActionFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-outline-variant/25 text-xs font-semibold bg-white">
                  <option value="">Toutes actions</option>
                  <option value="creation">Création</option>
                  <option value="modification">Modification</option>
                  <option value="changement_statut">Changement statut</option>
                  <option value="encaissement">Encaissement</option>
                  <option value="remboursement">Remboursement</option>
                  <option value="archivage">Archivage</option>
                  <option value="restauration">Restauration</option>
                </select>
                <select value={logEntityFilter} onChange={(e) => setLogEntityFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-outline-variant/25 text-xs font-semibold bg-white">
                  <option value="">Toutes entités</option>
                  <option value="espace">Espace</option>
                  <option value="tarif">Tarif</option>
                  <option value="reservation">Réservation</option>
                  <option value="paiement">Paiement</option>
                  <option value="abonnement">Abonnement</option>
                  <option value="personne">Personne</option>
                  <option value="staff">Équipe</option>
                  <option value="etablissement">Établissement</option>
                </select>
              </div>
            </div>

            {logsLoading ? (
              <div className="py-8 text-center text-sm text-on-surface-variant">Chargement du journal…</div>
            ) : logs.length === 0 ? (
              <div className="py-8 text-center text-sm text-on-surface-variant">Aucune entrée enregistrée pour ce filtre.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant">
                      <th className="py-2.5 px-3">Date (Tunis)</th>
                      <th className="py-2.5 px-3">Acteur</th>
                      <th className="py-2.5 px-3">Action</th>
                      <th className="py-2.5 px-3">Entité</th>
                      <th className="py-2.5 px-3">Détails</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 px-3 whitespace-nowrap text-xs text-on-surface-variant">{formatDateTimeDMY(l.created_at)}</td>
                        <td className="py-2.5 px-3 font-semibold text-primary">{l.acteur_nom || 'Système'}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-50 text-[#c2410c] border border-orange-200">{l.action}</span>
                        </td>
                        <td className="py-2.5 px-3 text-xs uppercase font-semibold text-on-surface-variant">{l.entite_type}</td>
                        <td className="py-2.5 px-3 text-primary">{l.details || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'integrations' && (
          <form onSubmit={handleSaveIntegrations} className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/15 space-y-5">
            <h2 className="font-sora font-bold text-lg text-primary">Intégrations & Exports comptables</h2>
            <label className="flex items-center justify-between py-2 cursor-pointer">
              <div>
                <p className="text-sm font-semibold text-primary">Synchronisation calendrier externe (iCal / Google Agenda)</p>
                <p className="text-xs text-on-surface-variant">Exporter les réservations confirmées au format flux calendrier.</p>
              </div>
              <input type="checkbox" checked={integrations.google_calendar_sync} onChange={(e) => setIntegrations((i) => ({ ...i, google_calendar_sync: e.target.checked }))} className="w-4 h-4 accent-[#f95d00]" />
            </label>
            <div>
              <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Format d'export comptable</label>
              <select value={integrations.export_comptable_format} onChange={(e) => setIntegrations((i) => ({ ...i, export_comptable_format: e.target.value }))} className="w-full sm:w-80 px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm bg-white">
                <option value="sage_csv">Sage / Comptabilité tunisienne (CSV)</option>
                <option value="excel_xlsx">Excel détaillé (.xlsx)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Webhook notifications sortantes (optionnel)</label>
              <input type="url" value={integrations.webhook_url} onChange={(e) => setIntegrations((i) => ({ ...i, webhook_url: e.target.value }))} placeholder="https://votre-serveur.tn/webhook/deskywork" className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant/30 text-sm" />
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={saving} style={{ backgroundColor: '#f95d00', color: '#ffffff' }} className="px-6 py-2.5 rounded-xl text-sm font-bold">
                {saving ? 'Enregistrement…' : 'Enregistrer les intégrations'}
              </button>
            </div>
          </form>
        )}
      </div>
    </PortalLayout>
  );
}
