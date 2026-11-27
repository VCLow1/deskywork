import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { tenantAdminApi } from '../services/api';
import { supabase } from '../supabaseClient';
import { formatDateTimeDMY } from '../utils/format';

export default function AdminMarketplaceStats({ session, embedded = false }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = userId
    ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata }
    : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mpStats, setMpStats] = useState(null);
  const [tenant, setTenant] = useState(null);

  const loadStats = async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, tenantRes] = await Promise.all([
        tenantAdminApi.getMarketplaceStats(),
        tenantAdminApi.getTenant().catch(() => null),
      ]);
      setMpStats(statsRes);
      if (tenantRes?.tenant) setTenant(tenantRes.tenant);
    } catch (e) {
      setError(e.message || 'Impossible de charger les statistiques Marketplace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) loadStats();
  }, [userId]);

  const vues = Number(mpStats?.stats?.vues || 0);
  const clics = Number(mpStats?.stats?.clics || 0);
  const reservations = Number(mpStats?.stats?.reservations || 0);
  const conversion = Number(mpStats?.stats?.taux_conversion || 0);
  const clickRate = vues > 0 ? Math.min(100, Math.round((clics / vues) * 1000) / 10) : 0;

  const isPartner = Boolean(
    mpStats?.is_partner ||
    tenant?.settings?.partenaire_officiel ||
    tenant?.slug === 'nero-coworking' ||
    tenant?.slug === 'thirty-three-space' ||
    tenant?.id === 'a1111111-1111-4111-8111-111111111111' ||
    tenant?.id === 'a3333333-3333-4333-8333-333333333333'
  );
  const isLocked = !isPartner && Boolean(mpStats?.locked);

  const content = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              {!embedded && (
                <h1 className="font-sora font-bold text-2xl sm:text-3xl text-[#100f0d]">
                  Visibilité Marketplace
                </h1>
              )}
              {isPartner ? (
                <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border border-emerald-500/30">
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>verified</span>
                  Partenaire Officiel — Pack Premium (90 DT/mois)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-[#f95d00]/12 text-[#f95d00] text-xs font-bold uppercase tracking-wider">
                  Pack Premium
                </span>
              )}
            </div>
            <p className="text-sm text-on-surface-variant mt-1">
              Suivez l'audience, les clics et les réservations générées depuis votre fiche publique DeskyWork.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tenant?.id && (
              <Link
                to={`/coworking/${tenant.id}`}
                className="px-3.5 py-2 rounded-xl border border-outline-variant/25 bg-surface-container-lowest text-xs font-semibold text-primary hover:bg-surface-container-low flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span>
                Voir ma fiche publique
              </Link>
            )}
            <button
              type="button"
              onClick={loadStats}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-surface-container-low text-xs font-semibold text-primary hover:bg-surface-container flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
              Actualiser
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 rounded-3xl bg-surface-container-lowest border border-outline-variant/10 animate-pulse" />
            ))}
          </div>
        ) : isLocked ? (
          <div className="bg-surface-container-lowest rounded-3xl p-6 sm:p-8 border border-outline-variant/15 shadow-xs space-y-5 relative overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-[#f95d00]/12 text-[#f95d00] flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined" style={{ fontSize: 26 }}>lock</span>
                </div>
                <div>
                  <h2 className="font-sora font-bold text-lg text-[#100f0d]">
                    Module Visibilité Marketplace réservé au Pack Premium
                  </h2>
                  <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
                    Votre pack actuel (<strong className="capitalize">{mpStats.current_pack || 'essentiel'}</strong>) inclut la présence sur la Marketplace DeskyWork.
                    Passez au pack <strong>Premium (220,000 DT/mois)</strong> pour débloquer l'analyse complète d'audience et de conversion.
                  </p>
                </div>
              </div>
              <Link
                to="/admin/settings?tab=abonnement"
                style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                className="px-5 py-2.5 rounded-xl text-sm font-bold hover:opacity-95 transition shrink-0"
              >
                Passer au pack Premium
              </Link>
            </div>

            {/* Aperçu flouté LOT 2 */}
            <div className="relative rounded-2xl border border-outline-variant/15 p-4 bg-surface-container-low/40 select-none">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 blur-[6px] pointer-events-none opacity-80">
                {[
                  { icon: 'visibility', title: 'Vues de la fiche', val: '1 428' },
                  { icon: 'ads_click', title: 'Clics réservation', val: '312' },
                  { icon: 'event_available', title: 'Réservations (30j)', val: '49' },
                  { icon: 'trending_up', title: 'Taux de conversion', val: '3,4 %' },
                ].map((feat) => (
                  <div key={feat.title} className="p-4 rounded-2xl bg-white border border-outline-variant/15">
                    <div className="flex items-center gap-2 text-on-surface-variant mb-1.5">
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{feat.icon}</span>
                      <span className="text-xs font-bold uppercase tracking-wider">{feat.title}</span>
                    </div>
                    <p className="font-sora font-bold text-2xl text-primary">{feat.val}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-center text-xs font-semibold text-on-surface-variant">
                Aperçu verrouillé — Activez le pack Premium pour consulter vos statistiques en direct.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 shadow-xs">
                <div className="flex items-center justify-between text-on-surface-variant mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider">Vues fiche</span>
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>visibility</span>
                </div>
                <p className="font-sora font-bold text-3xl text-[#100f0d]">{vues}</p>
                <p className="text-xs text-on-surface-variant mt-1">Visites enregistrées sur la fiche publique</p>
              </div>

              <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 shadow-xs">
                <div className="flex items-center justify-between text-on-surface-variant mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider">Clics réservation</span>
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>ads_click</span>
                </div>
                <p className="font-sora font-bold text-3xl text-[#100f0d]">{clics}</p>
                <p className="text-xs text-on-surface-variant mt-1">Taux de clic : {clickRate}% des vues</p>
              </div>

              <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 shadow-xs">
                <div className="flex items-center justify-between text-on-surface-variant mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider">Réservations (30j)</span>
                  <span className="material-symbols-outlined text-[#2fbe8f]" style={{ fontSize: 20 }}>event_available</span>
                </div>
                <p className="font-sora font-bold text-3xl text-[#2fbe8f]">{reservations}</p>
                <p className="text-xs text-on-surface-variant mt-1">Réservations sur les 30 derniers jours</p>
              </div>

              <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 shadow-xs">
                <div className="flex items-center justify-between text-on-surface-variant mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider">Conversion globale</span>
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>trending_up</span>
                </div>
                <p className="font-sora font-bold text-3xl text-[#f95d00]">{conversion}%</p>
                <p className="text-xs text-on-surface-variant mt-1">Ratio réservations / vues de la fiche</p>
              </div>
            </div>

            {/* Entonnoir & Optimisation fiche */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 space-y-4">
                <h2 className="font-sora font-bold text-base text-[#100f0d]">Entonnoir de visibilité Marketplace</h2>
                {[
                  { label: 'Vues de la fiche publique', value: vues, pct: 100, color: '#100f0d' },
                  { label: 'Clics vers la réservation', value: clics, pct: vues > 0 ? Math.min(100, Math.round((clics / vues) * 100)) : 0, color: '#f95d00' },
                  { label: 'Réservations enregistrées (30j)', value: reservations, pct: vues > 0 ? Math.min(100, Math.round((reservations / vues) * 100)) : 0, color: '#2fbe8f' },
                ].map((step) => (
                  <div key={step.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#100f0d]">{step.label}</span>
                      <span className="font-bold text-[#100f0d]">{step.value} ({step.pct}%)</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-surface-container-low overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${step.pct}%`, background: step.color }} />
                    </div>
                  </div>
                ))}
                {mpStats?.stats?.last_updated && (
                  <p className="text-xs text-on-surface-variant pt-1">
                    Dernière activité suivie : {formatDateTimeDMY(mpStats.stats.last_updated)}
                  </p>
                )}
              </div>

              <div className="lg:col-span-5 bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/15 space-y-3">
                <h2 className="font-sora font-bold text-base text-primary">Optimiser votre fiche publique</h2>
                <p className="text-xs text-on-surface-variant">
                  Une fiche complète augmente significativement votre taux de conversion sur DeskyWork :
                </p>
                <ul className="space-y-2 text-xs text-primary">
                  <li className="flex items-center gap-2">
                    <span className={`material-symbols-outlined text-sm ${tenant?.cover_url ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {tenant?.cover_url ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    Photo de couverture & logo renseignés
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`material-symbols-outlined text-sm ${(tenant?.settings?.gallery_photos?.length || 0) >= 3 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {(tenant?.settings?.gallery_photos?.length || 0) >= 3 ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    Galerie photos complète ({tenant?.settings?.gallery_photos?.length || 0} photo(s))
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`material-symbols-outlined text-sm ${(tenant?.settings?.equipements?.length || 0) >= 3 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {(tenant?.settings?.equipements?.length || 0) >= 3 ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    Équipements détaillés ({tenant?.settings?.equipements?.length || 0} sélectionné(s))
                  </li>
                </ul>
                <Link
                  to="/admin/settings?tab=etablissement"
                  style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                  className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-xl text-xs font-bold hover:opacity-95"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>tune</span>
                  Compléter mon profil & galerie
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
  );

  return embedded ? content : (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      {content}
    </PortalLayout>
  );
}

