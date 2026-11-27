import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { pricingApi, bookingApi, tenantAdminApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import { formatDT, formatDateTimeDMY } from '../utils/format';
import { SPACE_TYPE_LABELS } from '../constants/spaceTypes';
import Money from '../components/common/Money';
import { DEFAULT_TVA_PCT, roundMillime, computeTTC, computeHTFromTTC, checkRateCoherence } from '../utils/pricingMath';

const ITEMS_PER_PAGE = 10;

const SUBSCRIPTION_LABELS = {
  day_pass: 'Pass journée',
  week_pass: 'Pass semaine',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  annuel: 'Annuel',
  bureau_prive: 'Bureau privé',
};

const PLAN_LABELS = {
  standard: 'Standard',
  etudiant: 'Étudiant',
  entreprise: 'Entreprise',
};

const ESPACE_TYPE_LABELS = SPACE_TYPE_LABELS;

export default function AdminPricing({ session, embedded = false, initialTab = null }) {
  const [profile, setProfile] = useState(null);
  const [tarifs, setTarifs] = useState([]);
  const [promoCodes, setPromoCodes] = useState([]);
  const [occupation, setOccupation] = useState([]);
  const [tarifHistory, setTarifHistory] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [pageTarifs, setPageTarifs] = useState(1);
  const [pagePromo, setPagePromo] = useState(1);
  const [pageOccupation, setPageOccupation] = useState(1);
  const [actionId, setActionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(() => initialTab || 'espaces_tarifs');
  const [espacesList, setEspacesList] = useState([]);
  const [spaceDrafts, setSpaceDrafts] = useState({});
  const [savingSpaceId, setSavingSpaceId] = useState(null);
  const [typeRates, setTypeRates] = useState({});
  const [savingTypeRate, setSavingTypeRate] = useState(null);
  const [rateSuccess, setRateSuccess] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const [newTarif, setNewTarif] = useState({
    type_abonnement: 'mensuel',
    plan_tarifaire: 'standard',
    type_espace: '',
    prix: '',
    tva_pct: '19',
  });

  const [newPromo, setNewPromo] = useState({
    code: '',
    type_reduction: 'percent',
    valeur: '',
    utilisations_max: '',
  });

  useEffect(() => {
    loadData();
  }, [includeArchived]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profErr) throw profErr;
      if (!['super_admin', 'admin', 'staff'].includes(prof.role)) {
        throw new Error('Accès réservé aux administrateurs.');
      }
      setProfile(prof);

      const archParam = includeArchived ? { include_archived: 'true' } : {};
      const [tarifsData, promoData, espData, histData] = await Promise.all([
        pricingApi.getAllPlans(archParam),
        pricingApi.getPromoCodes(archParam),
        tenantAdminApi.getEspaces().catch(() => ({ espaces: [] })),
        tenantAdminApi.getTarifHistory().catch(() => ({ historique: [] })),
      ]);
      setTarifs(tarifsData.tarifs || []);
      setPromoCodes(promoData.promoCodes || []);
      setTarifHistory(histData.historique || []);
      const espArr = espData.espaces || [];
      setEspacesList(espArr);
      const drafts = {};
      espArr.forEach((esp) => {
        const tva = Number(esp.tva_pct ?? DEFAULT_TVA_PCT);
        const hHT = esp.tarif_horaire_ht != null ? Number(esp.tarif_horaire_ht) : computeHTFromTTC(esp.tarif_horaire || 0, tva);
        const jHT = esp.tarif_journalier_ht != null ? Number(esp.tarif_journalier_ht) : computeHTFromTTC(esp.tarif_journalier || 0, tva);
        const mHT = esp.tarif_mensuel_ht != null ? Number(esp.tarif_mensuel_ht) : computeHTFromTTC(esp.tarif_mensuel || 0, tva);
        const actifs = esp.tarifs_actifs && typeof esp.tarifs_actifs === 'object'
          ? { horaire: Boolean(esp.tarifs_actifs.horaire), journalier: Boolean(esp.tarifs_actifs.journalier), mensuel: Boolean(esp.tarifs_actifs.mensuel) }
          : { horaire: true, journalier: jHT > 0, mensuel: mHT > 0 };
        if (!actifs.horaire && !actifs.journalier && !actifs.mensuel) actifs.horaire = true;
        drafts[esp.id] = {
          tva_pct: tva,
          tarifs_actifs: actifs,
          tarif_horaire_ht: String(roundMillime(hHT)),
          tarif_journalier_ht: String(roundMillime(jHT)),
          tarif_mensuel_ht: String(roundMillime(mHT)),
          note: '',
        };
      });
      setSpaceDrafts(drafts);
      const rateDraft = {};
      Object.keys(ESPACE_TYPE_LABELS).forEach((t) => {
        const matching = espArr.filter((e) => e.type === t);
        rateDraft[t] = matching.length > 0 && matching[0].tarif_horaire != null ? String(matching[0].tarif_horaire) : '';
      });
      setTypeRates(rateDraft);

      const from = new Date();
      from.setDate(from.getDate() - 7);
      const to = new Date();
      to.setDate(to.getDate() + 7);
      const occ = await bookingApi.getOccupation({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      setOccupation(occ.report || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const handleCreateTarif = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await pricingApi.createPlan({
        ...newTarif,
        prix: Number(newTarif.prix),
        tva_pct: Number(newTarif.tva_pct),
      });
      setNewTarif({ type_abonnement: 'mensuel', plan_tarifaire: 'standard', type_espace: '', prix: '', tva_pct: '19' });
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleToggleTarif = async (id, actif) => {
    try {
      await pricingApi.updatePlan(id, { actif: !actif });
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleCreatePromo = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await pricingApi.createPromoCode({
        ...newPromo,
        valeur: Number(newPromo.valeur),
        utilisations_max: newPromo.utilisations_max ? Number(newPromo.utilisations_max) : null,
      });
      setNewPromo({ code: '', type_reduction: 'percent', valeur: '', utilisations_max: '' });
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleTogglePromo = async (id, actif) => {
    try {
      await pricingApi.updatePromoCode(id, { actif: !actif });
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F6F9]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-secondary" />
      </div>
    );
  }

  const pagedTarifs = tarifs.slice((pageTarifs - 1) * ITEMS_PER_PAGE, pageTarifs * ITEMS_PER_PAGE);
  const pagedPromoCodes = promoCodes.slice((pagePromo - 1) * ITEMS_PER_PAGE, pagePromo * ITEMS_PER_PAGE);
  const pagedOccupation = occupation.slice((pageOccupation - 1) * ITEMS_PER_PAGE, pageOccupation * ITEMS_PER_PAGE);

  const handleSaveSpaceTarifs = async (esp) => {
    const d = spaceDrafts[esp.id];
    if (!d) return;
    if (!d.tarifs_actifs.horaire && !d.tarifs_actifs.journalier && !d.tarifs_actifs.mensuel) {
      setError(`Au moins un type de tarif (Horaire, Journalier ou Mensuel) doit être actif pour "${esp.nom}".`);
      return;
    }
    setSavingSpaceId(esp.id);
    setError('');
    try {
      await tenantAdminApi.updateEspaceTarifs(esp.id, {
        tva_pct: Number(d.tva_pct ?? DEFAULT_TVA_PCT),
        tarifs_actifs: d.tarifs_actifs,
        tarif_horaire_ht: Number(d.tarif_horaire_ht || 0),
        tarif_journalier_ht: Number(d.tarif_journalier_ht || 0),
        tarif_mensuel_ht: Number(d.tarif_mensuel_ht || 0),
        note: d.note || '',
      });
      setRateSuccess(`Tarifs HT/TTC enregistrés pour "${esp.nom}".`);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSpaceId(null);
    }
  };

  const content = (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        {!embedded ? (
          <header>
            <h1 className="font-sora text-headline-lg text-primary">Tarification & formules</h1>
            <p className="text-on-surface-variant text-body-md mt-1">Source unique des tarifs HT/TTC, formules d'abonnement et codes promotionnels.</p>
          </header>
        ) : (
          <div>
            <h2 className="font-sora font-bold text-lg text-primary">
              {tab === 'promo' ? 'Codes promotionnels' : 'Tarifs et formules (HT / TTC)'}
            </h2>
            <p className="text-xs text-on-surface-variant">Saisie HT avec calcul TTC automatique au millime près (TVA 19% par défaut).</p>
          </div>
        )}
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-outline-variant/25 bg-white text-xs font-semibold cursor-pointer">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="accent-[#f95d00]" />
          Afficher les archivés
        </label>
      </div>

      {error && (
        <div className="mb-md p-sm bg-error-container text-on-error-container text-body-sm rounded-xl">
          {error}
        </div>
      )}
      {rateSuccess && (
        <div className="mb-md p-sm bg-emerald-50 border border-emerald-200 text-emerald-800 text-body-sm rounded-xl flex items-center justify-between">
          <span>{rateSuccess}</span>
          <button type="button" onClick={() => setRateSuccess('')} className="text-xs underline">Fermer</button>
        </div>
      )}

      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6 scrollbar-none">
        {[
          { id: 'espaces_tarifs', label: 'Tarifs des espaces (HT/TTC)' },
          { id: 'tarifs', label: 'Abonnements membres' },
          { id: 'types_espaces', label: 'Grille par catégorie' },
          { id: 'promo', label: 'Codes promo' },
          { id: 'historique', label: 'Historique des tarifs' },
          { id: 'occupation', label: 'Rapport occupation' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl font-semibold text-xs sm:text-sm whitespace-nowrap transition-all ${
              tab === t.id
                ? 'text-white border border-transparent shadow-sm'
                : 'bg-white border border-outline-variant/20 text-on-surface-variant hover:border-secondary'
            }`}
            style={tab === t.id ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'espaces_tarifs' && (
        <div className="space-y-4">
          {espacesList.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-sm text-on-surface-variant border border-outline-variant/15">
              Aucun espace configuré pour cet établissement.
            </div>
          ) : espacesList.map((esp) => {
            const d = spaceDrafts[esp.id] || {
              tva_pct: DEFAULT_TVA_PCT,
              tarifs_actifs: { horaire: true, journalier: false, mensuel: false },
              tarif_horaire_ht: '0',
              tarif_journalier_ht: '0',
              tarif_mensuel_ht: '0',
              note: '',
            };
            const tva = Number(d.tva_pct ?? DEFAULT_TVA_PCT);
            const alerts = checkRateCoherence({
              horaire: Number(d.tarif_horaire_ht || 0),
              journalier: Number(d.tarif_journalier_ht || 0),
              mensuel: Number(d.tarif_mensuel_ht || 0),
              actifs: d.tarifs_actifs,
            });
            const updateDraft = (patch) => setSpaceDrafts((prev) => ({ ...prev, [esp.id]: { ...d, ...patch } }));
            const toggleRate = (key) => {
              const nextActifs = { ...d.tarifs_actifs, [key]: !d.tarifs_actifs[key] };
              if (!nextActifs.horaire && !nextActifs.journalier && !nextActifs.mensuel) {
                setError('Au moins un type de tarif (Horaire, Journalier ou Mensuel) doit rester actif.');
                return;
              }
              updateDraft({ tarifs_actifs: nextActifs });
            };

            return (
              <div key={esp.id} className="bg-white rounded-2xl p-5 border border-outline-variant/15 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-sora font-bold text-base text-primary">{esp.nom}</h3>
                    <p className="text-xs text-on-surface-variant">{ESPACE_TYPE_LABELS[esp.type] || esp.type} · Capacité {esp.capacite} pers.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-on-surface-variant">TVA (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={d.tva_pct}
                      onChange={(e) => updateDraft({ tva_pct: e.target.value })}
                      className="w-20 px-2.5 py-1.5 rounded-xl border border-outline-variant/30 text-sm font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { key: 'horaire', label: 'Horaire', field: 'tarif_horaire_ht', unit: '/h' },
                    { key: 'journalier', label: 'Journalier', field: 'tarif_journalier_ht', unit: '/jour' },
                    { key: 'mensuel', label: 'Mensuel', field: 'tarif_mensuel_ht', unit: '/mois' },
                  ].map((item) => {
                    const active = d.tarifs_actifs[item.key];
                    const htVal = Number(d[item.field] || 0);
                    const ttcVal = computeTTC(htVal, tva);
                    return (
                      <div key={item.key} className={`p-3.5 rounded-2xl border ${active ? 'border-[#f95d00]/30 bg-orange-50/25' : 'border-outline-variant/20 bg-slate-50/60 opacity-65'}`}>
                        <label className="flex items-center justify-between cursor-pointer mb-2">
                          <span className="text-xs font-bold uppercase text-primary">{item.label}</span>
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleRate(item.key)}
                            className="w-4 h-4 accent-[#f95d00]"
                          />
                        </label>
                        {active ? (
                          <>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={d[item.field]}
                                onChange={(e) => updateDraft({ [item.field]: e.target.value })}
                                className="w-full px-3 py-1.5 rounded-xl border border-outline-variant/30 text-sm font-mono font-bold bg-white"
                              />
                              <span className="text-xs font-semibold text-on-surface-variant whitespace-nowrap">HT{item.unit}</span>
                            </div>
                            <p className="text-xs text-[#f95d00] font-bold mt-1.5">
                              Soit <Money amount={ttcVal} showTaxType="TTC" /> {item.unit}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-on-surface-variant italic">Désactivé pour cet espace</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {alerts.length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                    {alerts.map((w, idx) => (
                      <p key={idx} className="font-semibold flex items-center gap-1.5">
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>warning</span>
                        {w}
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <input
                    type="text"
                    value={d.note || ''}
                    onChange={(e) => updateDraft({ note: e.target.value })}
                    placeholder="Note de révision tarifaire (optionnelle)…"
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-outline-variant/25 text-xs"
                  />
                  <button
                    type="button"
                    disabled={savingSpaceId === esp.id}
                    onClick={() => handleSaveSpaceTarifs(esp)}
                    style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                    className="px-5 py-2 rounded-xl text-xs font-bold shadow-xs hover:opacity-95 disabled:opacity-50"
                  >
                    {savingSpaceId === esp.id ? 'Enregistrement…' : 'Enregistrer les tarifs'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'historique' && (
        <div className="bg-white rounded-2xl p-5 border border-outline-variant/15">
          <h3 className="font-sora font-bold text-base text-primary mb-3">Historique daté des modifications tarifaires</h3>
          {tarifHistory.length === 0 ? (
            <p className="text-sm text-on-surface-variant py-6 text-center">Aucune modification tarifaire historisée pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant/15 text-xs uppercase text-on-surface-variant">
                    <th className="py-2.5 px-3">Date (Tunis)</th>
                    <th className="py-2.5 px-3">Espace</th>
                    <th className="py-2.5 px-3">Horaire HT</th>
                    <th className="py-2.5 px-3">Journalier HT</th>
                    <th className="py-2.5 px-3">Mensuel HT</th>
                    <th className="py-2.5 px-3">TVA</th>
                    <th className="py-2.5 px-3">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {tarifHistory.map((h) => (
                    <tr key={h.id}>
                      <td className="py-2.5 px-3 whitespace-nowrap text-xs text-on-surface-variant">{formatDateTimeDMY(h.created_at)}</td>
                      <td className="py-2.5 px-3 font-semibold text-primary">{h.espaces?.nom || h.espace_nom || '—'}</td>
                      <td className="py-2.5 px-3"><Money amount={h.tarif_horaire_ht} showTaxType="HT" /></td>
                      <td className="py-2.5 px-3"><Money amount={h.tarif_journalier_ht} showTaxType="HT" /></td>
                      <td className="py-2.5 px-3"><Money amount={h.tarif_mensuel_ht} showTaxType="HT" /></td>
                      <td className="py-2.5 px-3">{h.tva_pct}%</td>
                      <td className="py-2.5 px-3 text-xs text-on-surface-variant">{h.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'types_espaces' && (
        <div className="bg-white rounded-2xl p-5 sm:p-6 custom-shadow border border-outline-variant/10 space-y-4">
          <div>
            <h2 className="font-sora font-bold text-base text-[#100f0d]">Grille tarifaire horaire par catégorie d'espace</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Définissez le tarif horaire de référence pour chaque type d'espace et appliquez-le à vos salles existantes en un clic.
            </p>
          </div>
          <div className="divide-y divide-outline-variant/15">
            {Object.entries(ESPACE_TYPE_LABELS).map(([typeKey, label]) => {
              const matching = espacesList.filter((e) => e.type === typeKey);
              return (
                <div key={typeKey} className="py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm text-primary">{label}</p>
                    <p className="text-xs text-on-surface-variant">
                      {matching.length} espace(s) configuré(s){matching.length > 0 ? ` : ${matching.map((e) => e.nom).join(', ')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="Tarif DT / h"
                      value={typeRates[typeKey] ?? ''}
                      onChange={(e) => setTypeRates((prev) => ({ ...prev, [typeKey]: e.target.value }))}
                      className="w-32 border border-outline-variant/30 rounded-xl px-3 py-1.5 text-sm font-mono font-bold"
                    />
                    <button
                      type="button"
                      disabled={savingTypeRate === typeKey || matching.length === 0 || !typeRates[typeKey]}
                      onClick={async () => {
                        const rate = Number(typeRates[typeKey]);
                        if (!Number.isFinite(rate) || rate < 0) return;
                        setSavingTypeRate(typeKey);
                        setError('');
                        try {
                          await Promise.all(matching.map((esp) => tenantAdminApi.updateEspace(esp.id, { tarif_horaire: rate })));
                          setRateSuccess(`Tarif horaire (${formatDT(rate)}/h) appliqué à ${matching.length} espace(s) "${label}".`);
                          await loadData();
                        } catch (err) {
                          setError(err.message);
                        } finally {
                          setSavingTypeRate(null);
                        }
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-[#f95d00] text-white text-xs font-bold hover:bg-[#e55500] disabled:opacity-45"
                    >
                      {savingTypeRate === typeKey ? 'Application…' : 'Appliquer'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'tarifs' && (
        <div className="space-y-4">
          <form onSubmit={handleCreateTarif} className="bg-white rounded-2xl p-4 sm:p-6 custom-shadow border border-outline-variant/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Type</label>
              <select
                value={newTarif.type_abonnement}
                onChange={(e) => setNewTarif({ ...newTarif, type_abonnement: e.target.value })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm outline-none focus:border-secondary"
              >
                {Object.entries(SUBSCRIPTION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Plan</label>
              <select
                value={newTarif.plan_tarifaire}
                onChange={(e) => setNewTarif({ ...newTarif, plan_tarifaire: e.target.value })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm outline-none focus:border-secondary"
              >
                {Object.entries(PLAN_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Type d'espace</label>
              <select
                value={newTarif.type_espace}
                onChange={(e) => setNewTarif({ ...newTarif, type_espace: e.target.value })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm outline-none focus:border-secondary"
              >
                <option value="">Tous les espaces</option>
                {Object.entries(ESPACE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Prix (DT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={newTarif.prix}
                onChange={(e) => setNewTarif({ ...newTarif, prix: e.target.value })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm outline-none focus:border-secondary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">TVA %</label>
              <input
                type="number"
                min="0"
                value={newTarif.tva_pct}
                onChange={(e) => setNewTarif({ ...newTarif, tva_pct: e.target.value })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm outline-none focus:border-secondary"
              />
            </div>
            <button type="submit" className="w-full bg-secondary text-white py-2.5 px-4 rounded-xl font-bold text-sm hover:bg-secondary/90 transition-colors">
              Ajouter
            </button>
          </form>

          <div className="bg-white rounded-2xl custom-shadow border border-outline-variant/10 overflow-hidden">
            <div className="table-responsive-wrapper">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-surface-container-low">
                  <tr>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Type</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Plan</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Type d'espace</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Prix</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">TVA</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Statut</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase text-right">Action</th>
                  </tr>
                </thead>
              <tbody>
                {pagedTarifs.map((t) => (
                  <tr key={t.id} className="border-t border-outline-variant/10">
                    <td className="p-sm">{SUBSCRIPTION_LABELS[t.type_abonnement] || t.type_abonnement}</td>
                    <td className="p-sm">{PLAN_LABELS[t.plan_tarifaire] || t.plan_tarifaire}</td>
                    <td className="p-sm">
                      {t.type_espace
                        ? (ESPACE_TYPE_LABELS[t.type_espace] || t.type_espace)
                        : 'Tous les espaces'}
                    </td>
                    <td className="p-sm font-semibold">
                      <Money amount={t.prix_ht ?? t.prix} showTaxType="HT" />
                      <span className="block text-xs text-on-surface-variant font-normal">
                        <Money amount={t.prix_ttc ?? computeTTC(t.prix, t.tva_pct ?? DEFAULT_TVA_PCT)} showTaxType="TTC" />
                      </span>
                    </td>
                    <td className="p-sm">{t.tva_pct}%</td>
                    <td className="p-sm">
                      <span className={`px-2 py-0.5 rounded-full text-label-sm ${t.archived_at ? 'bg-slate-200 text-slate-700' : t.actif ? 'bg-secondary-fixed' : 'bg-surface-container-high'}`}>
                        {t.archived_at ? 'Archivé' : t.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="p-sm space-x-2">
                      {t.archived_at ? (
                        <button type="button" onClick={async () => { await pricingApi.restorePlan(t.id); await loadData(); }} className="text-emerald-700 font-semibold text-xs hover:underline">
                          Restaurer
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => handleToggleTarif(t.id, t.actif)} className="text-[#f95d00] font-semibold text-xs hover:underline">
                            {t.actif ? 'Désactiver' : 'Activer'}
                          </button>
                          <button type="button" onClick={async () => { if (window.confirm('Archiver ce tarif ?')) { await pricingApi.archivePlan(t.id); await loadData(); } }} className="text-on-surface-variant font-semibold text-xs hover:underline">
                            Archiver
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={pageTarifs}
            totalItems={tarifs.length}
            itemsPerPage={ITEMS_PER_PAGE}
            onPageChange={setPageTarifs}
            label="tarifs"
          />
        </div>
      </div>
    )}

      {tab === 'promo' && (
        <div className="space-y-4">
          <form onSubmit={handleCreatePromo} className="bg-white rounded-2xl p-4 sm:p-6 custom-shadow border border-outline-variant/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Code</label>
              <input
                required
                value={newPromo.code}
                onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm uppercase outline-none focus:border-secondary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Type</label>
              <select
                value={newPromo.type_reduction}
                onChange={(e) => setNewPromo({ ...newPromo, type_reduction: e.target.value })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm outline-none focus:border-secondary"
              >
                <option value="percent">Pourcentage</option>
                <option value="fixed">Montant fixe</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Valeur</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={newPromo.valeur}
                onChange={(e) => setNewPromo({ ...newPromo, valeur: e.target.value })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm outline-none focus:border-secondary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Max utilisations</label>
              <input
                type="number"
                min="1"
                value={newPromo.utilisations_max}
                onChange={(e) => setNewPromo({ ...newPromo, utilisations_max: e.target.value })}
                className="w-full border border-outline-variant/30 rounded-xl px-3 py-2 text-sm outline-none focus:border-secondary"
                placeholder="Illimité"
              />
            </div>
            <button type="submit" className="w-full bg-secondary text-white py-2.5 px-4 rounded-xl font-bold text-sm hover:bg-secondary/90 transition-colors">
              Créer
            </button>
          </form>

          <div className="bg-white rounded-2xl custom-shadow border border-outline-variant/10 overflow-hidden">
            <div className="table-responsive-wrapper">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-surface-container-low">
                  <tr>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Code</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Réduction</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Utilisations</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Statut</th>
                    <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPromoCodes.map((p) => (
                    <tr key={p.id} className="border-t border-outline-variant/10">
                      <td className="p-3 font-mono font-semibold">{p.code}</td>
                      <td className="p-3">
                        {p.type_reduction === 'percent' ? `${p.valeur}%` : <Money amount={p.valeur} />}
                      </td>
                      <td className="p-3">
                        {p.utilisations_count}
                        {p.utilisations_max ? ` / ${p.utilisations_max}` : ''}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${p.archived_at ? 'bg-slate-200 text-slate-700' : p.actif ? 'bg-secondary-fixed text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                          {p.archived_at ? 'Archivé' : p.actif ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-2">
                        {p.archived_at ? (
                          <button type="button" onClick={async () => { await pricingApi.restorePromoCode(p.id); await loadData(); }} className="text-emerald-700 font-semibold text-xs hover:underline">
                            Restaurer
                          </button>
                        ) : (
                          <>
                            <button type="button" onClick={() => handleTogglePromo(p.id, p.actif)} className="text-[#f95d00] font-semibold text-xs hover:underline">
                              {p.actif ? 'Désactiver' : 'Activer'}
                            </button>
                            <button type="button" onClick={async () => { if (window.confirm('Archiver ce code promo ?')) { await pricingApi.archivePromoCode(p.id); await loadData(); } }} className="text-on-surface-variant font-semibold text-xs hover:underline">
                              Archiver
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={pagePromo}
              totalItems={promoCodes.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setPagePromo}
              label="codes promo"
            />
          </div>
        </div>
      )}

      {tab === 'occupation' && (
        <div className="bg-white rounded-2xl custom-shadow border border-outline-variant/10 overflow-hidden">
          <div className="table-responsive-wrapper">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="bg-surface-container-low">
                <tr>
                  <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Espace</th>
                  <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Type</th>
                  <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Capacité</th>
                  <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Réservations</th>
                  <th className="p-3 font-semibold text-xs text-on-surface-variant uppercase">Taux occupation</th>
                </tr>
              </thead>
              <tbody>
                {pagedOccupation.map((row) => (
                  <tr key={row.espace_id} className="border-t border-outline-variant/10">
                    <td className="p-3 font-semibold">{row.nom}</td>
                    <td className="p-3">{ESPACE_TYPE_LABELS[row.type] || row.type.replace('_', ' ')}</td>
                    <td className="p-3">{row.capacite}</td>
                    <td className="p-3">{row.reservations_count}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-grow h-2 bg-surface-container-high rounded-full overflow-hidden">
                          <div
                            className="h-full bg-secondary rounded-full"
                            style={{ width: `${Math.min(100, row.taux_occupation_pct)}%` }}
                          />
                        </div>
                        <span className="font-semibold text-xs w-12">{row.taux_occupation_pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={pageOccupation}
            totalItems={occupation.length}
            itemsPerPage={ITEMS_PER_PAGE}
            onPageChange={setPageOccupation}
            label="espaces"
          />
        </div>
      )}
    </div>
  );

  return embedded ? content : (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      {content}
    </PortalLayout>
  );
}
