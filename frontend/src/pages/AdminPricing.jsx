import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { pricingApi, bookingApi, tenantAdminApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import Pagination from '../components/Pagination';
import { formatDT } from '../utils/format';
import { SPACE_TYPE_LABELS } from '../constants/spaceTypes';
import Money from '../components/common/Money';

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

export default function AdminPricing({ session }) {
  const [profile, setProfile] = useState(null);
  const [tarifs, setTarifs] = useState([]);
  const [promoCodes, setPromoCodes] = useState([]);
  const [occupation, setOccupation] = useState([]);
  const [pageTarifs, setPageTarifs] = useState(1);
  const [pagePromo, setPagePromo] = useState(1);
  const [pageOccupation, setPageOccupation] = useState(1);
  const [actionId, setActionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('tarifs');
  const [espacesList, setEspacesList] = useState([]);
  const [typeRates, setTypeRates] = useState({});
  const [savingTypeRate, setSavingTypeRate] = useState(null);
  const [rateSuccess, setRateSuccess] = useState('');
  const navigate = useNavigate();

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
  }, []);

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

      const [tarifsData, promoData, espData] = await Promise.all([
        pricingApi.getAllPlans(),
        pricingApi.getPromoCodes(),
        tenantAdminApi.getEspaces().catch(() => ({ espaces: [] })),
      ]);
      setTarifs(tarifsData.tarifs || []);
      setPromoCodes(promoData.promoCodes || []);
      const espArr = espData.espaces || [];
      setEspacesList(espArr);
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

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <header className="mb-lg">
        <h1 className="font-sora text-headline-lg text-primary">Tarification & formules</h1>
        <p className="text-on-surface-variant text-body-md mt-1">Gérez vos formules tarifaires, abonnements et codes promotionnels.</p>
      </header>

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
          { id: 'tarifs', label: 'Abonnements membres' },
          { id: 'types_espaces', label: 'Tarifs des 7 types d\'espaces' },
          { id: 'promo', label: 'Codes promo' },
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
            style={tab === t.id ? { backgroundColor: '#f95d00' } : {}}
          >
            {t.label}
          </button>
        ))}
      </div>

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
                    <td className="p-sm font-semibold"><Money amount={t.prix} /></td>
                    <td className="p-sm">{t.tva_pct}%</td>
                    <td className="p-sm">
                      <span className={`px-2 py-0.5 rounded-full text-label-sm ${t.actif ? 'bg-secondary-fixed' : 'bg-surface-container-high'}`}>
                        {t.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="p-sm">
                      <button
                        type="button"
                        onClick={() => handleToggleTarif(t.id, t.actif)}
                        className="text-secondary font-semibold text-label-sm hover:underline"
                      >
                        {t.actif ? 'Désactiver' : 'Activer'}
                      </button>
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
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${p.actif ? 'bg-secondary-fixed text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                          {p.actif ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleTogglePromo(p.id, p.actif)}
                          className="text-secondary font-semibold text-xs hover:underline"
                        >
                          {p.actif ? 'Désactiver' : 'Activer'}
                        </button>
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
    </PortalLayout>
  );
}
