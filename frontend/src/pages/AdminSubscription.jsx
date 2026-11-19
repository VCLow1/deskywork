import React, { useEffect, useState, useMemo } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { tenantAdminApi } from '../services/api';

function Gauge({ label, used, max, icon }) {
  const unlimited = max === null || max === undefined || Number(max) >= 9999;
  const pct = unlimited ? 100 : Math.min(100, Math.round(((used || 0) / Math.max(1, max)) * 100));
  const near = !unlimited && pct >= 85;
  return (
    <div className="p-4 rounded-2xl bg-surface-container-low/50 border border-outline-variant/10">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-on-surface-variant flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 17 }}>{icon}</span>
          {label}
        </span>
        <span className="font-sora font-bold text-sm text-primary">
          {used || 0} / {unlimited ? 'Illimité' : max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-container overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: unlimited ? '100%' : `${pct}%`,
            background: unlimited ? '#2fbe8f' : near ? '#ba1a1a' : '#f95d00',
          }}
        />
      </div>
    </div>
  );
}

const PACK_RANK = { essentiel: 1, standard: 2, premium: 3 };

export default function AdminSubscription({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = useMemo(
    () => (userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null),
    [userId, email, metadata]
  );
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [requestingPack, setRequestingPack] = useState(null);

  const loadSub = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await tenantAdminApi.getSubscription();
      setData(res);
    } catch (e) {
      setError(e.message || 'Erreur lors du chargement de votre abonnement.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSub();
  }, []);

  const handleRequestUpgrade = async (packKey) => {
    setRequestingPack(packKey);
    setError('');
    try {
      const res = await tenantAdminApi.requestPackUpgrade({ target_pack: packKey });
      setMsg(res.message);
      await loadSub();
    } catch (err) {
      setError(err.message);
    } finally {
      setRequestingPack(null);
    }
  };

  const activePack = data?.pack;
  const activeRank = PACK_RANK[activePack?.key || 'essentiel'] || 1;
  const invoices = data?.invoices || [];

  return (
    <PortalLayout profile={profile}>
      <div className="mb-6">
        <h1 className="font-sora font-bold text-2xl sm:text-3xl text-primary">Mon Abonnement DeskyWork</h1>
        <p className="text-sm text-on-surface-variant">
          Suivez votre pack SaaS actif, vos jauges d'utilisation et vos factures DeskyWork.
        </p>
      </div>

      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      {msg && <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">{msg}</div>}

      {loading ? (
        <div className="bg-surface-container-lowest rounded-3xl p-8 text-center text-sm text-on-surface-variant">Chargement…</div>
      ) : (
        <div className="space-y-6">
          {/* Pack Actuel + Jauges */}
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/15">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="inline-block px-3 py-1 rounded-full bg-[#f95d00]/12 text-[#f95d00] text-xs font-bold">
                    Pack Actif
                  </span>
                  {activePack?.is_partner && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-bold border border-emerald-500/30">
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>verified</span>
                      Partenaire Officiel — Remise Exceptionnelle (90.000 DT / mois HT au lieu de 220 DT)
                    </span>
                  )}
                </div>
                <h2 className="font-sora font-bold text-2xl text-primary">
                  Pack {activePack?.key === 'premium' ? 'Premium' : activePack?.name} — {activePack?.key === 'premium' ? '220,000' : Number(activePack?.prix || 0).toFixed(3)} DT <span className="text-sm font-normal text-on-surface-variant">/ mois HT</span>
                </h2>
              </div>
              <div className="text-right text-xs text-on-surface-variant">
                <p>Échéance suivante : <strong className="text-primary">{data?.tenant?.prochaine_echeance ? new Date(data.tenant.prochaine_echeance).toLocaleDateString('fr-FR') : 'Mensuelle'}</strong></p>
                <p>Statut établissement : <strong className="text-emerald-700 uppercase">{data?.tenant?.statut || 'actif'}</strong></p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Gauge label="Ressources / Espaces" used={data?.usage?.espaces?.used} max={data?.usage?.espaces?.max} icon="meeting_room" />
              <Gauge label="Membres actifs" used={data?.usage?.membres?.used} max={data?.usage?.membres?.max} icon="group" />
              <Gauge label="Comptes Staff" used={data?.usage?.staff?.used} max={data?.usage?.staff?.max} icon="badge" />
            </div>
          </div>

          {/* Packs disponibles (fonctionnalités supérieures verrouillées si pack inférieur) */}
          <div>
            <h2 className="font-sora font-bold text-lg text-primary mb-3">Comparer les packs & évoluer</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(data?.all_packs || []).map((p) => {
                const rank = PACK_RANK[p.key] || 1;
                const isCurrent = p.key === activePack?.key;
                const isHigher = rank > activeRank;
                return (
                  <div
                    key={p.key}
                    className={`rounded-3xl p-5 border flex flex-col justify-between transition ${
                      isCurrent
                        ? 'bg-surface-container-lowest border-[#f95d00] ring-2 ring-[#f95d00]/20'
                        : isHigher
                          ? 'bg-surface-container-low/50 border-outline-variant/20 opacity-85'
                          : 'bg-surface-container-lowest border-outline-variant/15 opacity-70'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-sora font-bold text-lg text-primary">{p.name}</h3>
                        {isCurrent ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">Actuel</span>
                        ) : isHigher ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[11px] font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>lock</span>
                            Pack supérieur
                          </span>
                        ) : null}
                      </div>
                      <div className="mb-4">
                        <p className="font-sora font-extrabold text-2xl text-[#f95d00]">
                          {p.key === 'premium' ? '220,000' : p.key === 'standard' ? '150,000' : '90,000'} DT <span className="text-xs font-normal text-on-surface-variant">/ mois HT</span>
                        </p>
                        {activePack?.is_partner && p.key === 'premium' && (
                          <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                            Tarif partenaire appliqué : 90,000 DT / mois HT (au lieu de 220,000 DT)
                          </p>
                        )}
                      </div>
                      <ul className="space-y-2 mb-5">
                        {(p.features || []).map((f, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-xs text-primary">
                            <span className="material-symbols-outlined text-xs mt-0.5" style={{ fontSize: 16, color: isHigher ? '#64748b' : '#2fbe8f' }}>
                              {isHigher ? 'lock_open' : 'check_circle'}
                            </span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {isHigher && (
                      <button
                        type="button"
                        disabled={requestingPack === p.key}
                        onClick={() => handleRequestUpgrade(p.key)}
                        className="w-full py-2.5 rounded-xl bg-[#f95d00] text-white font-semibold text-sm hover:bg-[#e55500] disabled:opacity-50"
                      >
                        {requestingPack === p.key ? 'Envoi…' : `Passer au Pack ${p.name}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Factures DeskyWork */}
          <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15">
            <h2 className="font-sora font-bold text-base text-primary mb-3">Factures DeskyWork</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/15 text-[11px] uppercase tracking-wider text-on-surface-variant">
                    <th className="py-3 px-4">N° Facture</th>
                    <th className="py-3 px-4">Période</th>
                    <th className="py-3 px-4">Pack</th>
                    <th className="py-3 px-4">Montant</th>
                    <th className="py-3 px-4">Statut</th>
                    <th className="py-3 px-4 text-right">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-container-low/40">
                      <td className="py-3 px-4 font-mono font-bold text-primary">{inv.numero}</td>
                      <td className="py-3 px-4 capitalize">{inv.periode}</td>
                      <td className="py-3 px-4">{inv.pack}</td>
                      <td className="py-3 px-4 font-bold">{Number(inv.montant || 0).toFixed(3)} DT</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          inv.statut === 'Payée'
                            ? 'bg-emerald-100 text-emerald-800'
                            : inv.statut === 'En retard'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}>
                          {inv.statut}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => tenantAdminApi.downloadDeskyInvoicePdf(inv.id)}
                          className="px-3 py-1.5 rounded-xl bg-surface-container-low text-xs font-semibold hover:bg-surface-container inline-flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
