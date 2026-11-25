import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../services/superAdminApi';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import { exportBillingToExcel } from '../utils/exportBillingExcel';
import { formatDT } from '../utils/currency';

const PLAN_LABELS = {
  free: 'Essentiel',
  starter: 'Essentiel',
  pro: 'Standard',
  enterprise: 'Premium',
  essentiel: 'Essentiel',
  standard: 'Standard',
  premium: 'Premium',
};

const MONTHS = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUN'];

function getCurrentMonthLabel() {
  const raw = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default function TenantBilling({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'super_admin', ...metadata } : null
  );
  const [tenants, setTenants] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0 });
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [notice, setNotice] = useState(null);

  // Gestion des Factures B2B DeskyWork
  const [invoices, setInvoices] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all'); // all, emise, payee, retard
  const [showEmitModal, setShowEmitModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  // Formulaire Émettre Facture
  const [emitForm, setEmitForm] = useState({
    tenant_id: '',
    mois: getCurrentMonthLabel(),
    montant: 90,
    date_echeance: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    notes: 'Abonnement SaaS DeskyWork mensuel',
  });

  // Formulaire Saisir Paiement Manuel
  const [paymentForm, setPaymentForm] = useState({
    mode: 'virement',
    reference: '',
    date_reglement: new Date().toISOString().slice(0, 10),
    notes: 'Paiement vérifié et encaissé',
  });

  const showNotice = (type, text) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 5000);
  };

  const load = useCallback(async () => {
    try {
      const [data, s] = await Promise.all([
        superAdminApi.getTenants({ page, limit: 20 }),
        superAdminApi.getStats().catch(() => null),
      ]);
      const loadedTenants = data?.tenants || [];
      setTenants(loadedTenants);
      setPagination(data?.pagination || { total: 0 });
      if (s) setStats(s);

      // Collecter les factures réelles enregistrées dans les settings de chaque tenant
      const todayISO = new Date().toISOString().slice(0, 10);
      const allInvoices = [];
      loadedTenants.forEach((t) => {
        const tenantInvoices = Array.isArray(t.settings?.factures_deskywork) ? t.settings.factures_deskywork : [];
        tenantInvoices.forEach((inv) => {
          const computedStatut =
            inv.statut === 'emise' && inv.date_echeance && inv.date_echeance < todayISO
              ? 'retard'
              : inv.statut;
          allInvoices.push({
            ...inv,
            statut: computedStatut,
            tenant_nom: t.nom,
            tenant_ville: t.ville,
            tenant_email: t.email,
            tenant_id: t.id,
          });
        });
      });
      setInvoices(allInvoices);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!userId) { navigate('/login'); return; }
    if (profile?.role && profile.role !== 'super_admin') { navigate('/admin/dashboard'); }
  }, [userId, profile, navigate]);

  useEffect(() => { if (profile) load(); }, [load, profile]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login'); };

  const exportMrrCsv = () => {
    exportBillingToExcel(tenants, MONTHS, barData);
  };

  const mrr = (tenants || []).filter(t => t.statut === 'actif').reduce((acc, t) => acc + (parseFloat(t.montant_mensuel) || 0), 0);
  const unpaid = (tenants || []).filter(t => t.statut === 'suspendu').reduce((acc, t) => acc + (parseFloat(t.montant_mensuel) || 0), 0);

  // Action : Émettre une facture
  const handleEmitInvoice = async (e) => {
    e.preventDefault();
    const targetTenant = tenants.find(t => t.id === emitForm.tenant_id);
    if (!targetTenant) return;

    const year = new Date().getFullYear();
    const newInvoice = {
      id: `FAC-${Date.now()}`,
      numero: `FAC-DW-${year}-${Math.floor(1000 + Math.random() * 9000)}`,
      tenant_id: targetTenant.id,
      tenant_nom: targetTenant.nom,
      tenant_ville: targetTenant.ville,
      tenant_email: targetTenant.email,
      mois: emitForm.mois,
      montant: parseFloat(emitForm.montant) || 90,
      statut: 'emise',
      date_emission: new Date().toISOString().slice(0, 10),
      date_echeance: emitForm.date_echeance,
      notes: emitForm.notes,
    };

    const existingFactures = Array.isArray(targetTenant.settings?.factures_deskywork) ? targetTenant.settings.factures_deskywork : [];
    const updatedFactures = [newInvoice, ...existingFactures];

    try {
      await superAdminApi.updateTenant(targetTenant.id, {
        settings: {
          ...(targetTenant.settings || {}),
          factures_deskywork: updatedFactures,
        },
      });

      setShowEmitModal(false);
      showNotice('success', `Facture ${newInvoice.numero} émise pour ${targetTenant.nom}.`);
      load();
    } catch (err) {
      showNotice('error', 'Erreur enregistrement facture : ' + err.message);
    }
  };

  // Action : Saisir un paiement manuel
  const handleManualPayment = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    const targetTenant = tenants.find(t => t.id === selectedInvoice.tenant_id);
    if (!targetTenant) return;

    const existingFactures = Array.isArray(targetTenant.settings?.factures_deskywork) ? targetTenant.settings.factures_deskywork : [];
    const updatedFactures = existingFactures.map((inv) => {
      if (inv.id === selectedInvoice.id || inv.numero === selectedInvoice.numero) {
        return {
          ...inv,
          statut: 'payee',
          mode_paiement: paymentForm.mode === 'virement' ? 'Virement bancaire' : paymentForm.mode === 'cheque' ? 'Chèque bancaire' : 'Espèces',
          reference_paiement: paymentForm.reference || 'RECU-MANUEL',
          date_reglement: paymentForm.date_reglement,
        };
      }
      return inv;
    });

    try {
      await superAdminApi.updateTenant(targetTenant.id, {
        statut: 'actif',
        settings: {
          ...(targetTenant.settings || {}),
          factures_deskywork: updatedFactures,
        },
      });

      setShowPaymentModal(false);
      setSelectedInvoice(null);
      showNotice('success', `Règlement enregistré pour la facture ${selectedInvoice.numero}.`);
      load();
    } catch (err) {
      showNotice('error', 'Erreur enregistrement règlement : ' + err.message);
    }
  };

  // Action : Suspendre ou Réactiver un établissement
  const handleToggleTenantStatus = async (tenantId, currentStatus, tenantName) => {
    const isCurrentlyActive = currentStatus === 'actif';
    const action = isCurrentlyActive ? 'suspendre' : 'réactiver';
    if (!confirm(`Confirmez-vous vouloir ${action} l'établissement "${tenantName}" ?`)) return;

    try {
      const nextStatus = isCurrentlyActive ? 'suspendu' : 'actif';
      await superAdminApi.updateTenant(tenantId, { statut: nextStatus });
      showNotice('success', `Établissement "${tenantName}" mis à jour (${nextStatus}).`);
      await load();
    } catch (err) {
      showNotice('error', `Erreur lors de la mise à jour de l'établissement : ${err.message}`);
    }
  };

  // Action : Générer Reçu PDF (fenêtre d'impression propre)
  const handlePrintReceipt = (inv) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Facture & Reçu - ${inv.numero}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #0f172a; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #f95d00; padding-bottom: 20px; }
          .logo { font-size: 24px; font-weight: 800; color: #f95d00; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: bold; background: #ecfdf5; color: #047857; }
          .details { margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
          .table { width: 100%; border-collapse: collapse; margin-top: 30px; }
          .table th { background: #f8fafc; padding: 12px; text-align: left; font-size: 12px; border-bottom: 1px solid #e2e8f0; }
          .table td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
          .total { margin-top: 20px; text-align: right; font-size: 18px; font-weight: bold; color: #f95d00; }
          .footer { margin-top: 50px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="logo">DESKYWORK</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Plateforme Nationale de Coworking & Espaces de Travail</div>
            <div style="font-size: 11px; color: #64748b;">Tunis, Tunisie · contact@deskywork.tn</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 18px; font-weight: bold;">REÇU / FACTURE</div>
            <div style="font-size: 13px; font-family: monospace; font-weight: bold; color: #334155;">${inv.numero}</div>
            <div style="margin-top: 6px;"><span class="badge">${inv.statut === 'payee' ? 'PAYÉE · ENCAISSÉE' : 'ÉMISE · À RÉGLER'}</span></div>
          </div>
        </div>

        <div class="details">
          <div>
            <strong style="font-size: 11px; text-transform: uppercase; color: #64748b;">Facturé à :</strong>
            <div style="font-size: 15px; font-weight: bold; margin-top: 4px;">${inv.tenant_nom}</div>
            <div style="font-size: 12px; color: #475569;">${inv.tenant_ville || 'Tunis'}, Tunisie</div>
            <div style="font-size: 12px; color: #475569;">${inv.tenant_email || '—'}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; color: #64748b;">Date d'émission : <strong>${inv.date_emission}</strong></div>
            ${inv.date_reglement ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px;">Date de règlement : <strong>${inv.date_reglement}</strong></div>` : ''}
            ${inv.mode_paiement ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px;">Mode de règlement : <strong>${inv.mode_paiement}</strong></div>` : ''}
            ${inv.reference_paiement ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px;">Réf. Transaction : <strong>${inv.reference_paiement}</strong></div>` : ''}
          </div>
        </div>

        <table class="table">
          <thead>
            <tr>
              <th>DÉSIGNATION</th>
              <th>PÉRIODE</th>
              <th style="text-align: right;">MONTANT HT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Abonnement Plateforme Coworking DeskyWork</strong><br><span style="font-size: 11px; color: #64748b;">Pack Partenaire / Plateforme SaaS de gestion & référencement</span></td>
              <td>${inv.mois}</td>
              <td style="text-align: right; font-weight: bold;">${parseFloat(inv.montant).toFixed(3)} DT</td>
            </tr>
          </tbody>
        </table>

        <div class="total">
          TOTAL ENCAISSÉ : ${parseFloat(inv.montant).toFixed(3)} DT
        </div>

        <div class="footer">
          Document officiel généré par DeskyWork · Règlement par virement bancaire ou espèces sur place · Conforme CDC v3.0
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 400);
  };

  const filteredInvoices = useMemo(() => {
    if (activeFilter === 'all') return invoices;
    return invoices.filter(i => i.statut === activeFilter);
  }, [invoices, activeFilter]);

  const barData = useMemo(() => {
    const growth = Array.isArray(stats?.monthlyGrowth) ? stats.monthlyGrowth : [];
    if (growth.length >= 6) {
      return growth.slice(-6).map((g) => Number(g.mrr ?? g.ca ?? g.value ?? 0));
    }
    return [0, 0, 0, 0, 0, mrr || 0];
  }, [stats, mrr]);

  if (!profile) return null;

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      {notice && (
        <div
          className={`mb-4 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center justify-between gap-3 border ${
            notice.type === 'error'
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">
              {notice.type === 'error' ? 'error' : 'check_circle'}
            </span>
            {notice.text}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-sora text-xl sm:text-2xl font-bold text-primary">Facturation & Abonnements Coworkings</h1>
          <p className="text-on-surface-variant text-sm mt-1">Émission des factures mensuelles, saisie des paiements manuels et suivi des règlements</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setEmitForm({
                tenant_id: tenants[0]?.id || '',
                mois: getCurrentMonthLabel(),
                montant: 90,
                date_echeance: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
                notes: 'Abonnement mensuel DeskyWork',
              });
              setShowEmitModal(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-[#f95d00] hover:bg-[#e05300] text-white text-xs font-bold flex items-center gap-2 shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">receipt_long</span>
            Émettre une facture
          </button>
        </div>
      </div>

      {/* Cartes KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {[
          { label: 'MRR Total Actif', value: formatDT(mrr), icon: 'payments', color: '#f95d00', sub: 'Chiffre récurrent mensuel' },
          { label: 'Coworkings Actifs', value: stats?.activeTenants ?? tenants.length, icon: 'domain', color: '#f95d00', sub: `${tenants.filter(t => t.statut === 'suspendu').length} suspendus` },
          { label: 'Factures Émises', value: invoices.filter(i => i.statut === 'emise').length, icon: 'pending_actions', color: '#3b82f6', sub: 'En attente de paiement' },
          { label: 'Factures En Retard', value: invoices.filter(i => i.statut === 'retard').length, icon: 'warning', color: '#ba1a1a', sub: 'Relance requise' },
        ].map((c, i) => (
          <div key={i} className="bg-surface-container-lowest rounded-2xl p-4 sm:p-5 shadow-[0px_2px_4px_rgba(16,35,63,0.04)] border border-outline-variant/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{c.label}</span>
              <span className="material-symbols-outlined p-2 rounded-xl" style={{ fontSize: 18, color: c.color, background: `${c.color}12` }}>{c.icon}</span>
            </div>
            <p className="font-sora text-xl sm:text-2xl font-bold text-primary">{c.value}</p>
            <p className="text-xs text-on-surface-variant mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* SECTION FACTURES ÉMISES & SUIVI B2B (Mise à jour demandée par le CDC) */}
      <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 shadow-[0px_2px_4px_rgba(16,35,63,0.04)] overflow-hidden mb-6">
        <div className="px-6 py-5 border-b border-outline-variant/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="font-sora text-base font-bold text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>receipt</span>
              Registre des Factures Établissements (SaaS DeskyWork)
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Suivi des factures mensuelles, encaissements manuels et génération de reçus</p>
          </div>

          {/* Onglets Filtres : Toutes / Émise / Payée / En retard */}
          <div className="inline-flex p-1 bg-surface-container-low rounded-xl text-xs font-semibold">
            {[
              { key: 'all', label: 'Toutes' },
              { key: 'emise', label: 'Émises' },
              { key: 'payee', label: 'Payées' },
              { key: 'retard', label: 'En retard' },
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeFilter === tab.key
                    ? 'bg-white text-primary shadow-xs font-bold'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="table-responsive-wrapper">
          <table className="w-full text-sm min-w-[850px]">
            <thead>
              <tr className="bg-surface-container-low/60 border-b border-outline-variant/10">
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">N° Facture</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Établissement</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Période</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Montant HT</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Statut</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Règlement</th>
                <th className="px-5 py-3.5 text-right font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {filteredInvoices.map((inv) => {
                const isPaid = inv.statut === 'payee';
                const isLate = inv.statut === 'retard';
                return (
                  <tr key={inv.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="px-5 py-4 font-mono font-bold text-primary text-xs">
                      {inv.numero}
                    </td>
                    <td className="px-5 py-4">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-primary text-sm">{inv.tenant_nom}</p>
                          {tenants.find(t => t.id === inv.tenant_id)?.statut === 'suspendu' && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                              Suspendu
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-on-surface-variant">{inv.tenant_ville || 'Tunis'}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs font-semibold text-primary">
                      {inv.mois}
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-sora font-bold text-primary">
                        {formatDT(inv.montant)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Payée
                        </span>
                      ) : isLate ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          En retard
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Émise
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-on-surface-variant">
                      {isPaid ? (
                        <div>
                          <p className="font-semibold text-primary">{inv.mode_paiement || 'Virement'}</p>
                          <p className="text-[10px] text-on-surface-variant">{inv.reference_paiement || 'Encaissé'}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">En attente</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isPaid && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedInvoice(inv);
                              setPaymentForm({
                                mode: 'virement',
                                reference: '',
                                date_reglement: new Date().toISOString().slice(0, 10),
                                notes: `Paiement ${inv.mois}`,
                              });
                              setShowPaymentModal(true);
                            }}
                            className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs"
                            title="Saisir un paiement reçu manuellement"
                          >
                            Encaisser
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handlePrintReceipt(inv)}
                          className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-outline-variant/30 text-primary hover:bg-surface-container-low transition-colors flex items-center gap-1"
                          title="Générer & Télécharger Reçu PDF"
                        >
                          <span className="material-symbols-outlined text-[15px] text-[#f95d00]">picture_as_pdf</span>
                          PDF
                        </button>
                        {tenants.find(t => t.id === inv.tenant_id)?.statut === 'suspendu' ? (
                          <button
                            type="button"
                            onClick={() => handleToggleTenantStatus(inv.tenant_id, 'suspendu', inv.tenant_nom)}
                            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center gap-1"
                            title="Réactiver cet établissement"
                          >
                            <span className="material-symbols-outlined text-[15px]">check_circle</span>
                            Réactiver
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleTenantStatus(inv.tenant_id, 'actif', inv.tenant_nom)}
                            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-rose-300 text-rose-700 hover:bg-rose-50 transition-colors flex items-center gap-1"
                            title="Suspendre cet établissement"
                          >
                            <span className="material-symbols-outlined text-[15px]">block</span>
                            Suspendre
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-on-surface-variant text-xs">
                    Aucune facture ne correspond à ce filtre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL ÉMETTRE FACTURE */}
      {showEmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setShowEmitModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <h3 className="font-sora font-bold text-lg text-primary mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[#f95d00]">receipt_long</span>
              Émettre une Facture Mensuelle
            </h3>
            <form onSubmit={handleEmitInvoice} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Établissement client *</label>
                <select
                  value={emitForm.tenant_id}
                  onChange={(e) => {
                    const tid = e.target.value;
                    const target = tenants.find(t => t.id === tid);
                    const isPart = target?.slug === 'nero-coworking' || target?.slug === 'thirty-three-space' || target?.settings?.partenaire_officiel;
                    setEmitForm({
                      ...emitForm,
                      tenant_id: tid,
                      montant: isPart ? 90 : (parseFloat(target?.montant_mensuel) || 90),
                    });
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 font-semibold"
                  required
                >
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.nom} ({t.ville || 'Tunis'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Période / Mois *</label>
                  <input
                    type="text"
                    value={emitForm.mois}
                    onChange={(e) => setEmitForm({ ...emitForm, mois: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Montant HT (DT) *</label>
                  <input
                    type="number"
                    step="0.001"
                    value={emitForm.montant}
                    onChange={(e) => setEmitForm({ ...emitForm, montant: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-bold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Date d'échéance</label>
                <input
                  type="date"
                  value={emitForm.date_echeance}
                  onChange={(e) => setEmitForm({ ...emitForm, date_echeance: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notes / Description</label>
                <textarea
                  rows={2}
                  value={emitForm.notes}
                  onChange={(e) => setEmitForm({ ...emitForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEmitModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#f95d00] hover:bg-[#e05300] font-bold text-white shadow-sm"
                >
                  Émettre la facture
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL SAISIE PAIEMENT MANUEL */}
      {showPaymentModal && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => { setShowPaymentModal(false); setSelectedInvoice(null); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <h3 className="font-sora font-bold text-lg text-primary mb-1 flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-600">payments</span>
              Saisir un Paiement Reçu
            </h3>
            <p className="text-xs text-on-surface-variant mb-4">
              Facture <strong>{selectedInvoice.numero}</strong> · {selectedInvoice.tenant_nom} ({formatDT(selectedInvoice.montant)})
            </p>

            <form onSubmit={handleManualPayment} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Mode d'encaissement *</label>
                <select
                  value={paymentForm.mode}
                  onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 font-semibold"
                >
                  <option value="virement">Virement bancaire</option>
                  <option value="especes">Espèces (règlement sur place)</option>
                  <option value="cheque">Chèque bancaire</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Référence du règlement / Transaction *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: VIR-BNA-2026-9810 ou RECU-ESP-012"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Date d'encaissement *</label>
                <input
                  type="date"
                  required
                  value={paymentForm.date_reglement}
                  onChange={(e) => setPaymentForm({ ...paymentForm, date_reglement: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowPaymentModal(false); setSelectedInvoice(null); }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-bold text-white shadow-sm"
                >
                  Confirmer l'encaissement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
