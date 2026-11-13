import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../services/superAdminApi';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import { exportBillingToExcel } from '../utils/exportBillingExcel';

const PLAN_LABELS = { free: 'Free', starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };
const STATUT_STYLES = {
  actif: 'bg-[#2fbe8f1a] text-[#2fbe8f]',
  suspendu: 'bg-[#ff6f591a] text-[#ff6f59]',
  inactif: 'bg-surface-container text-on-surface-variant',
};
const STATUT_LABELS = { actif: 'Payé', suspendu: 'Suspendu', inactif: 'Inactif' };

const MONTHS = ['JAN', 'FÉV', 'MAR', 'AVR', 'MAI', 'JUN'];

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

  const load = useCallback(async () => {
    try {
      const [data, s] = await Promise.all([
        superAdminApi.getTenants({ page, limit: 10 }),
        superAdminApi.getStats().catch(() => null),
      ]);
      setTenants(data?.tenants || []);
      setPagination(data?.pagination || { total: 0 });
      if (s) setStats(s);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
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

  if (!profile) {
    return null;
  }


  const barData = [32000, 35500, 38200, 41000, 43800, mrr || 45200];
  const maxBar = Math.max(...barData);

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="mb-6">
        <h1 className="font-sora text-xl sm:text-2xl font-bold text-primary">Facturation B2B</h1>
        <p className="text-on-surface-variant text-sm mt-1">Suivi des abonnements mensuels des coworkings clients</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {[
          { label: 'MRR Total', value: `${mrr.toLocaleString('fr-TN')} DT`, icon: 'payments', color: '#f95d00', sub: '+2.4% vs dernier mois' },
          { label: 'Coworkings Actifs', value: stats?.activeTenants ?? 0, icon: 'person_pin', color: '#f95d00', sub: `${stats?.suspendedTenants || 0} suspendus` },
          { label: 'Impayés B2B', value: `${unpaid.toLocaleString('fr-TN')} DT`, icon: 'warning', color: '#100f0d', sub: 'Nécessite une action' },
          { label: 'Croissance MRR', value: '+12.5%', icon: 'trending_up', color: '#f95d00', sub: 'Objectif atteint' },
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


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-3xl p-6 shadow-[0px_2px_4px_rgba(16,35,63,0.04)]">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-sora text-base font-semibold text-primary">Évolution MRR (6 mois)</h2>
            <button onClick={exportMrrCsv} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-outline-variant/30 hover:bg-surface-container-low text-on-surface-variant">Exporter en CSV</button>
          </div>
          <div className="flex items-end gap-3 h-48">
            {barData.map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-[10px] font-semibold text-on-surface-variant">{(val / 1000).toFixed(0)}k</span>
                <div className="w-full rounded-t-lg transition-all" style={{ height: `${(val / maxBar) * 100}%`, background: i === barData.length - 1 ? '#f95d00' : 'rgba(249,93,0,0.2)' }} />
                <span className={`text-xs font-semibold ${i === barData.length - 1 ? 'text-secondary font-bold' : 'text-on-surface-variant'}`}>{MONTHS[i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-3xl p-6 shadow-[0px_2px_4px_rgba(16,35,63,0.04)]">
          <h2 className="font-sora text-base font-semibold text-primary mb-1">Relances automatiques</h2>
          <p className="text-xs text-on-surface-variant mb-5">Paramétrez les alertes automatiques pour les factures en retard.</p>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-surface-container-low rounded-xl">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>mail</span>
                <div>
                  <p className="text-sm font-semibold text-primary">Alertes Email</p>
                  <p className="text-xs text-on-surface-variant">Envoyé à J+3, J+7, J+15</p>
                </div>
              </div>
              <button onClick={() => setEmailAlerts(!emailAlerts)} className={`relative w-11 h-6 rounded-full transition-colors ${emailAlerts ? 'bg-secondary' : 'bg-surface-variant'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${emailAlerts ? 'translate-x-5.5 left-0.5' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
          <button onClick={() => setNotice('La personnalisation des templates d\'email sera disponible dans une prochaine version.')}
            className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 border-secondary text-secondary hover:bg-secondary/5 transition-colors">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit_note</span>
            Personnaliser les templates
          </button>
          {notice && (
            <p className="mt-3 text-xs text-on-surface-variant bg-surface-container-low p-3 rounded-xl">{notice}</p>
          )}
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 shadow-[0px_2px_4px_rgba(16,35,63,0.04)] overflow-hidden">
        <div className="px-6 py-5 border-b border-outline-variant/10 flex items-center justify-between">
          <div>
            <h2 className="font-sora text-base font-bold text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: 20 }}>receipt_long</span>
              Suivi des Facturations Coworkings
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Statut de facturation et abonnement de chaque espace client</p>
          </div>
          <span className="text-xs font-semibold text-on-surface-variant px-3 py-1 bg-surface-container-low rounded-full">
            {pagination.total || tenants.length} coworking(s)
          </span>
        </div>

        <div className="table-responsive-wrapper">
          <table className="w-full text-sm min-w-[750px]">
            <thead>
              <tr className="bg-surface-container-low/60 border-b border-outline-variant/10">
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Coworking</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Offre</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Montant mensuel</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Créé le</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Statut Facturation</th>
                <th className="px-5 py-3.5 text-left font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Prochaine échéance</th>
                <th className="px-5 py-3.5 text-right font-bold uppercase tracking-wider text-[11px] text-on-surface-variant">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {tenants.map((t) => {
                const isActif = t.statut === 'actif';
                const planLabel = t.plan ? (PLAN_LABELS[t.plan.toLowerCase()] || t.plan.toUpperCase()) : 'STARTER';
                return (
                  <tr key={t.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>domain</span>
                        </div>
                        <div>
                          <p className="font-bold text-primary text-sm">{t.nom}</p>
                          <p className="text-[11px] text-on-surface-variant">{t.ville ? `${t.ville}, ` : ''}{t.pays || 'Tunisie'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-surface-container-high text-on-surface border border-outline-variant/15">
                        {planLabel}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-sora font-bold text-primary">
                        {parseFloat(t.montant_mensuel || 0).toLocaleString('fr-TN')} <span className="text-xs font-normal text-on-surface-variant">DT/mois</span>
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-on-surface-variant font-medium">
                      {new Date(t.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-4">
                      {isActif ? (
                        <span className="whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-xs">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          Payé · Actif
                        </span>
                      ) : (
                        <span className="whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 border border-red-200/60 shadow-xs">
                          <span className="w-2 h-2 rounded-full bg-red-500" />
                          Suspendu
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-on-surface-variant font-medium">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-on-surface-variant/70" style={{ fontSize: 14 }}>event</span>
                        {t.prochaine_echeance ? new Date(t.prochaine_echeance).toLocaleDateString('fr-FR') : '1er du mois'}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {!isActif ? (
                        <button
                          onClick={async () => { await superAdminApi.updateTenant(t.id, { statut: 'actif' }); load(); }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>play_arrow</span>
                          Réactiver
                        </button>
                      ) : (
                        <button
                          onClick={async () => { await superAdminApi.updateTenant(t.id, { statut: 'suspendu' }); load(); }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>pause</span>
                          Suspendre
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-on-surface-variant text-sm">
                    Aucun coworking trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-outline-variant/10 flex items-center justify-between">
          <span className="text-xs text-on-surface-variant">
            Affichage de {tenants.length > 0 ? ((page - 1) * 10 + 1) : 0}–{Math.min(page * 10, pagination.total || tenants.length)} sur {pagination.total || tenants.length} coworkings
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-xl border border-outline-variant/30 text-xs font-semibold disabled:opacity-40 hover:bg-surface-container-low transition-colors"
            >
              Précédent
            </button>
            <span className="text-xs font-bold text-secondary px-3 bg-secondary/10 rounded-xl py-1.5">
              {page}
            </span>
            <button
              disabled={tenants.length < 10}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-xl border border-outline-variant/30 text-xs font-semibold disabled:opacity-40 hover:bg-surface-container-low transition-colors"
            >
              Suivant
            </button>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
