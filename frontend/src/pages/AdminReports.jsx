import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import ExcelJS from 'exceljs';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { kpiApi } from '../services/api';
import { formatDT, formatDateDMY, formatDateTimeDMY } from '../utils/format';
import { SPACE_TYPE_LABELS } from '../constants/spaceTypes';
import Money from '../components/common/Money';
import AdminMarketplaceStats from './AdminMarketplaceStats';

const MODE_LABELS = {
  cash: 'Espèces',
  cheque: 'Chèque',
  virement: 'Virement bancaire',
  bank_transfer: 'Virement bancaire',
  carte: 'Carte sur place',
};

export default function AdminReports({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = useMemo(
    () => (userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null),
    [userId, email, metadata]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [hubTab, setHubTab] = useState(() => (searchParams.get('tab') === 'marketplace' ? 'marketplace' : 'rapports'));
  const [period, setPeriod] = useState('mois');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [espaceId, setEspaceId] = useState('');
  const [activeTab, setActiveTab] = useState('ca');
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { period, espace_id: espaceId || undefined };
      if (period === 'custom' && fromDate && toDate) {
        params.from = fromDate;
        params.to = toDate;
      }
      const res = await kpiApi.getDetailedReport(params);
      setReport(res);
    } catch (e) {
      setError(e.message || 'Impossible de générer le rapport.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (period === 'custom' && (!fromDate || !toDate)) return;
    loadReport();
  }, [period, espaceId, fromDate, toDate]);

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const params = { period, espace_id: espaceId || undefined };
      if (period === 'custom' && fromDate && toDate) {
        params.from = fromDate;
        params.to = toDate;
      }
      await kpiApi.downloadPdfReport(params);
    } catch (e) {
      setError(e.message);
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    if (!report) return;
    setExportingExcel(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'DeskyWork';
      wb.created = new Date();

      // Feuille 1 : Synthèse & CA
      const wsCa = wb.addWorksheet('CA & Encaissements');
      wsCa.addRow(['Rapport DeskyWork', report.tenant?.nom || 'Établissement', report.periode?.label || '']);
      wsCa.addRow(['CA Total', report.ca?.total || 0, 'Transactions', report.ca?.transactions || 0, 'Panier moyen', report.ca?.panier_moyen || 0]);
      wsCa.addRow([]);
      wsCa.addRow(['Date', 'Membre / Client', 'Espace', 'Mode', 'N° Reçu', 'Montant (DT)']);
      (report.ca?.liste || []).forEach((p) => {
        wsCa.addRow([
          p.date_paiement ? formatDateDMY(p.date_paiement) : '—',
          p.profiles ? `${p.profiles.prenom || ''} ${p.profiles.nom || ''}`.trim() : 'Client',
          p.reservations?.espaces?.nom || '—',
          MODE_LABELS[(p.mode || 'cash').toLowerCase()] || p.mode || 'Espèces',
          p.numero_recu || '—',
          Number(p.montant || 0),
        ]);
      });

      // Feuille 2 : Occupation
      const wsOcc = wb.addWorksheet('Occupation');
      wsOcc.addRow(['Espace', 'Type', 'Réservations', 'Heures réservées', 'Occupation (%)', 'CA (DT)']);
      (report.occupation?.par_espace || []).forEach((o) => {
        wsOcc.addRow([o.nom, SPACE_TYPE_LABELS[o.type] || o.type, o.reservations, o.heures_reservees, o.taux_occupation, o.ca]);
      });

      // Feuille 3 : Présence
      const wsPres = wb.addWorksheet('Présence');
      wsPres.addRow(['Membre', 'Espace', 'Check-in', 'Check-out', 'Dépassement (min)', 'Surplus (DT)']);
      (report.presence?.liste || []).forEach((s) => {
        wsPres.addRow([
          s.profiles ? `${s.profiles.prenom || ''} ${s.profiles.nom || ''}`.trim() : 'Membre',
          s.espaces?.nom || '—',
          s.checkin_at ? formatDateTimeDMY(s.checkin_at) : '—',
          s.checkout_at ? formatDateTimeDMY(s.checkout_at) : 'En cours',
          s.duree_depassement_min || 0,
          Number(s.montant_depassement || 0),
        ]);
      });

      // Feuille 4 : Membres
      const wsMem = wb.addWorksheet('Membres');
      wsMem.addRow(['Nom', 'Prénom', 'E-mail', 'Téléphone', 'Type', 'Statut']);
      (report.membres?.liste || []).forEach((m) => {
        wsMem.addRow([m.nom, m.prenom, m.email, m.telephone || '—', m.type_membre || 'particulier', m.statut_compte || 'actif']);
      });

      // Feuille 5 : Impayés
      const wsImp = wb.addWorksheet('Impayés');
      wsImp.addRow(['Client', 'E-mail', 'Motif / Référence', 'Montant dû (DT)', 'Date']);
      (report.impayes?.liste || []).forEach((i) => {
        wsImp.addRow([
          i.profiles ? `${i.profiles.prenom || ''} ${i.profiles.nom || ''}`.trim() : 'Client',
          i.profiles?.email || '—',
          i.reference_externe || 'À encaisser',
          Number(i.montant || 0),
          i.created_at ? formatDateDMY(i.created_at) : '—',
        ]);
      });

      // Feuille 6 : Formations
      const wsForm = wb.addWorksheet('Formations');
      wsForm.addRow(['Titre', 'Formateur', 'Date début', 'Inscrits', 'Capacité', 'Remplissage (%)', 'CA estimé (DT)']);
      (report.formations?.liste || []).forEach((f) => {
        wsForm.addRow([
          f.titre,
          f.formateur,
          f.date_debut ? formatDateDMY(f.date_debut) : '—',
          f.inscrits,
          f.capacite,
          f.taux_remplissage,
          f.ca_estime,
        ]);
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DeskyWork-Rapports-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError('Erreur export Excel : ' + e.message);
    } finally {
      setExportingExcel(false);
    }
  };

  const moduleFormationsActif = report?.module_formations_actif !== false;
  const TABS = [
    { id: 'ca', label: 'Chiffre d\'affaires', icon: 'payments' },
    { id: 'occupation', label: 'Occupation', icon: 'domain' },
    { id: 'presence', label: 'Présence', icon: 'how_to_reg' },
    { id: 'membres', label: 'Membres', icon: 'group' },
    { id: 'impayes', label: 'Impayés', icon: 'pending_actions' },
    ...(moduleFormationsActif ? [{ id: 'formations', label: 'Formations', icon: 'school' }] : []),
  ];

  return (
    <PortalLayout profile={profile}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="text-left">
          <h1 className="font-sora font-bold text-2xl sm:text-3xl text-primary">Analyses</h1>
          <p className="text-sm text-on-surface-variant">
            Rapports détaillés alignés sur les formules KPI officielles et Visibilité Marketplace.
          </p>
        </div>
        {hubTab === 'rapports' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exportingPdf || loading}
              className="px-4 py-2 rounded-xl bg-surface-container-lowest border border-outline-variant/20 text-primary font-semibold text-sm hover:bg-surface-container-low flex items-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 18 }}>picture_as_pdf</span>
              {exportingPdf ? 'Génération PDF…' : 'Export PDF'}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exportingExcel || !report}
              style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
              className="px-4 py-2 rounded-xl font-semibold text-sm hover:opacity-95 flex items-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>table_view</span>
              {exportingExcel ? 'Export Excel…' : 'Export Excel (.xlsx)'}
            </button>
          </div>
        )}
      </div>

      {/* Onglets Hub Analyses : Rapports | Visibilité Marketplace */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { id: 'rapports', label: 'Rapports', icon: 'analytics' },
          { id: 'marketplace', label: 'Visibilité Marketplace', icon: 'monitoring' },
        ].map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => {
              setHubTab(h.id);
              setSearchParams(h.id === 'marketplace' ? { tab: 'marketplace' } : {});
            }}
            style={hubTab === h.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition ${
              hubTab === h.id
                ? 'shadow-xs'
                : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/15 hover:bg-surface-container-low'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{h.icon}</span>
            {h.label}
          </button>
        ))}
      </div>

      {hubTab === 'marketplace' ? (
        <AdminMarketplaceStats session={session} embedded />
      ) : (
        <>

      {/* Filtres Période & Espace */}
      <div className="bg-surface-container-lowest rounded-3xl p-4 border border-outline-variant/15 mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Période</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-outline-variant/20 text-sm bg-surface-container-low/40 font-semibold"
          >
            <option value="jour">Aujourd'hui</option>
            <option value="mois">Ce mois-ci</option>
            <option value="annee">Cette année</option>
            <option value="tout">Tout l'historique</option>
            <option value="custom">Période personnalisée</option>
          </select>
        </div>

        {period === 'custom' && (
          <>
            <div>
              <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Du</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-3 py-2 rounded-xl border border-outline-variant/20 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Au</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-3 py-2 rounded-xl border border-outline-variant/20 text-sm"
              />
            </div>
          </>
        )}

        <div>
          <label className="block text-xs font-bold uppercase text-on-surface-variant mb-1">Filtrer par espace</label>
          <select
            value={espaceId}
            onChange={(e) => setEspaceId(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-outline-variant/20 text-sm bg-surface-container-low/40 font-semibold"
          >
            <option value="">Tous les espaces</option>
            {(report?.espaces || []).map((e) => (
              <option key={e.id} value={e.id}>{e.nom} ({SPACE_TYPE_LABELS[e.type] || e.type})</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      {/* Onglets rapports */}
      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            style={activeTab === t.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition ${
              activeTab === t.id
                ? 'shadow-xs'
                : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/15 hover:bg-surface-container-low'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-surface-container-lowest rounded-3xl p-8 text-center text-sm text-on-surface-variant">Calcul des indicateurs…</div>
      ) : !report ? null : (
        <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
          {activeTab === 'ca' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl bg-surface-container-low/60">
                  <p className="text-xs text-on-surface-variant font-bold uppercase">CA net encaissé</p>
                  <p className="font-sora font-bold text-2xl text-[#2fbe8f] mt-1"><Money amount={report.ca?.total} showTaxType="TTC" /></p>
                </div>
                <div className="p-4 rounded-2xl bg-surface-container-low/60">
                  <p className="text-xs text-on-surface-variant font-bold uppercase">Remboursements déduits</p>
                  <p className="font-sora font-bold text-2xl text-[#ba1a1a] mt-1"><Money amount={report.remboursements?.total || report.ca?.remboursements || 0} showTaxType="TTC" /></p>
                </div>
                <div className="p-4 rounded-2xl bg-surface-container-low/60">
                  <p className="text-xs text-on-surface-variant font-bold uppercase">Transactions</p>
                  <p className="font-sora font-bold text-2xl text-[#100f0d] mt-1">{report.ca?.transactions || 0}</p>
                </div>
                <div className="p-4 rounded-2xl bg-surface-container-low/60">
                  <p className="text-xs text-on-surface-variant font-bold uppercase">Panier moyen</p>
                  <p className="font-sora font-bold text-2xl text-[#100f0d] mt-1"><Money amount={report.ca?.panier_moyen} showTaxType="TTC" /></p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Client</th>
                      <th className="py-2.5 px-3">Espace</th>
                      <th className="py-2.5 px-3">Mode</th>
                      <th className="py-2.5 px-3">Reçu</th>
                      <th className="py-2.5 px-3 text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {(report.ca?.liste || []).length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-on-surface-variant">Aucune transaction sur cette période.</td></tr>
                    ) : report.ca.liste.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 px-3 text-xs">{p.date_paiement ? formatDateDMY(p.date_paiement) : '—'}</td>
                        <td className="py-2.5 px-3 font-semibold">{p.profiles ? `${p.profiles.prenom} ${p.profiles.nom}` : 'Client'}</td>
                        <td className="py-2.5 px-3 text-xs">{p.reservations?.espaces?.nom || '—'}</td>
                        <td className="py-2.5 px-3 text-xs">{MODE_LABELS[(p.mode || 'cash').toLowerCase()] || p.mode || 'Espèces'}</td>
                        <td className="py-2.5 px-3 font-mono text-xs">{p.numero_recu || '—'}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-[#2fbe8f]"><Money amount={p.montant} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'occupation' && (
            <div className="overflow-x-auto">
              <p className="text-sm font-semibold text-[#100f0d] mb-3">
                Taux d'occupation moyen : <span className="text-[#f95d00]">{report.occupation?.taux_moyen || 0}%</span> ({report.occupation?.total_reservations || 0} réservations)
              </p>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant">
                    <th className="py-2.5 px-3">Espace</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Réservations</th>
                    <th className="py-2.5 px-3">Heures</th>
                    <th className="py-2.5 px-3">Occupation</th>
                    <th className="py-2.5 px-3 text-right">CA généré</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {(report.occupation?.par_espace || []).map((o) => (
                    <tr key={o.id}>
                      <td className="py-2.5 px-3 font-semibold text-[#100f0d]">{o.nom}</td>
                      <td className="py-2.5 px-3 text-xs">{SPACE_TYPE_LABELS[o.type] || o.type}</td>
                      <td className="py-2.5 px-3">{o.reservations}</td>
                      <td className="py-2.5 px-3">{o.heures_reservees} h</td>
                      <td className="py-2.5 px-3 font-bold text-[#f95d00]">{o.taux_occupation}%</td>
                      <td className="py-2.5 px-3 text-right font-bold"><Money amount={o.ca} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'presence' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-surface-container-low/60">
                  <p className="text-xs font-bold uppercase text-on-surface-variant">Sessions</p>
                  <p className="font-sora font-bold text-xl text-[#100f0d]">{report.presence?.total_sessions || 0}</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-surface-container-low/60">
                  <p className="text-xs font-bold uppercase text-on-surface-variant">En cours</p>
                  <p className="font-sora font-bold text-xl text-emerald-700">{report.presence?.en_cours || 0}</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-surface-container-low/60">
                  <p className="text-xs font-bold uppercase text-on-surface-variant">Dépassements</p>
                  <p className="font-sora font-bold text-xl text-amber-700">{report.presence?.depassements || 0}</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-surface-container-low/60">
                  <p className="text-xs font-bold uppercase text-on-surface-variant">No-show (Absents) / Annulées</p>
                  <p className="font-sora font-bold text-xl text-red-700">{report.presence?.no_shows_annulations || 0}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant">
                      <th className="py-2.5 px-3">Membre</th>
                      <th className="py-2.5 px-3">Espace</th>
                      <th className="py-2.5 px-3">Check-in</th>
                      <th className="py-2.5 px-3">Check-out</th>
                      <th className="py-2.5 px-3">Dépassement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {(report.presence?.liste || []).length === 0 ? (
                      <tr><td colSpan={5} className="py-8 text-center text-on-surface-variant">Aucune session enregistrée.</td></tr>
                    ) : report.presence.liste.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-3 font-semibold">{s.profiles ? `${s.profiles.prenom} ${s.profiles.nom}` : 'Membre'}</td>
                        <td className="py-2.5 px-3 text-xs">{s.espaces?.nom || '—'}</td>
                        <td className="py-2.5 px-3 text-xs">{s.checkin_at ? formatDateTimeDMY(s.checkin_at) : '—'}</td>
                        <td className="py-2.5 px-3 text-xs">{s.checkout_at ? formatDateTimeDMY(s.checkout_at) : 'Active'}</td>
                        <td className="py-2.5 px-3 text-xs font-bold text-red-600">{s.duree_depassement_min ? `+${s.duree_depassement_min} min` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'membres' && (
            <div className="space-y-4">
              <p className="text-sm text-[#100f0d] font-semibold">
                Total : {report.membres?.total || 0} membre(s) · Actifs : {report.membres?.actifs || 0} · Entreprises : {report.membres?.entreprises || 0} · Nouveaux sur la période : {report.membres?.nouveaux_periode || 0}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant">
                      <th className="py-2.5 px-3">Membre</th>
                      <th className="py-2.5 px-3">E-mail</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {(report.membres?.liste || []).map((m) => (
                      <tr key={m.id}>
                        <td className="py-2.5 px-3 font-semibold">{m.prenom} {m.nom}</td>
                        <td className="py-2.5 px-3 text-xs">{m.email}</td>
                        <td className="py-2.5 px-3 text-xs">{m.type_membre || 'particulier'}</td>
                        <td className="py-2.5 px-3 text-xs font-bold">{m.statut_compte || 'actif'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'impayes' && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-red-700">
                Total Impayés (Montants dus en attente) : <Money amount={report.impayes?.total} /> ({report.impayes?.count || 0} dossier(s))
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant">
                      <th className="py-2.5 px-3">Client</th>
                      <th className="py-2.5 px-3">Motif / Détail</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3 text-right">Montant dû</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {(report.impayes?.liste || []).length === 0 ? (
                      <tr><td colSpan={4} className="py-8 text-center text-on-surface-variant">Aucun impayé en cours.</td></tr>
                    ) : report.impayes.liste.map((i) => (
                      <tr key={i.id}>
                        <td className="py-2.5 px-3 font-semibold">{i.profiles ? `${i.profiles.prenom} ${i.profiles.nom}` : 'Client'}</td>
                        <td className="py-2.5 px-3 text-xs">{i.reference_externe || i.reservations?.espaces?.nom || 'À encaisser sur place'}</td>
                        <td className="py-2.5 px-3 text-xs">{formatDateDMY(i.created_at)}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-red-600"><Money amount={i.montant} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'formations' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant">
                    <th className="py-2.5 px-3">Formation</th>
                    <th className="py-2.5 px-3">Formateur</th>
                    <th className="py-2.5 px-3">Date début</th>
                    <th className="py-2.5 px-3">Inscrits</th>
                    <th className="py-2.5 px-3">Remplissage</th>
                    <th className="py-2.5 px-3 text-right">CA estimé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {(report.formations?.liste || []).length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-on-surface-variant">Aucune formation enregistrée.</td></tr>
                  ) : report.formations.liste.map((f) => (
                    <tr key={f.id}>
                      <td className="py-2.5 px-3 font-semibold text-[#100f0d]">{f.titre}</td>
                      <td className="py-2.5 px-3 text-xs">{f.formateur}</td>
                      <td className="py-2.5 px-3 text-xs">{f.date_debut ? formatDateDMY(f.date_debut) : '—'}</td>
                      <td className="py-2.5 px-3">{f.inscrits}/{f.capacite || '∞'}</td>
                      <td className="py-2.5 px-3 font-bold text-[#f95d00]">{f.taux_remplissage}%</td>
                      <td className="py-2.5 px-3 text-right font-bold"><Money amount={f.ca_estime} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </PortalLayout>
  );
}
