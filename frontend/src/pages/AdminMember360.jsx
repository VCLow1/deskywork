// pages/AdminMember360.jsx — Fiche Membre / Invité / Prospect 360° (LOT 3)
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { tenantAdminApi, paymentApi } from '../services/api';
import { formatDateDMY, formatDateTimeDMY, formatTime24h } from '../utils/format';
import { formatTunisianPhone } from '../utils/tunisianPhone';
import Money from '../components/common/Money';

function StatusBadge({ label, cls, icon }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${cls}`}>
      {icon && <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{icon}</span>}
      <span>{label}</span>
    </span>
  );
}

export default function AdminMember360({ session }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const profile = useMemo(
    () => (userId ? { id: userId, email, role: metadata.role || 'admin', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata } : null),
    [userId, email, metadata]
  );

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [collectingId, setCollectingId] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await tenantAdminApi.getPersonne360(id);
      setData(res);
      setNotes(res.personne?.notes_internes || '');
    } catch (e) {
      setError(e.message || 'Impossible de charger la fiche 360°.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await tenantAdminApi.updatePersonneNotes(id, notes);
      setToast('Notes internes enregistrées.');
      setTimeout(() => setToast(''), 3000);
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleQuickCollect = async (p) => {
    setCollectingId(p.id);
    try {
      await paymentApi.collect(p.id, { mode_paiement: 'cash' });
      setToast('Paiement encaissé avec succès.');
      setTimeout(() => setToast(''), 3000);
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setCollectingId(null);
    }
  };

  const p = data?.personne;
  const fullName = p ? `${p.prenom || ''} ${p.nom || ''}`.trim() || p.email || 'Personne' : 'Fiche 360°';
  const phoneDigits = String(p?.telephone || '').replace(/\D/g, '');
  const waNumber = phoneDigits.startsWith('216') ? phoneDigits : (phoneDigits.length === 8 ? `216${phoneDigits}` : phoneDigits);
  const pendingPayments = (data?.paiements || []).filter((pay) => pay.statut === 'pending');

  const abo = data?.abonnement_actif;
  const totalQuota = Number(abo?.heures_incluses ?? abo?.credits_inclus ?? 0);
  const remainingQuota = Number(abo?.heures_restantes ?? abo?.credits_restants ?? 0);
  const usedQuota = totalQuota > 0 ? Math.max(0, totalQuota - remainingQuota) : 0;
  const gaugePct = totalQuota > 0 ? Math.min(100, Math.round((usedQuota / totalQuota) * 100)) : 0;

  return (
    <PortalLayout profile={profile}>
      <div className="max-w-7xl mx-auto space-y-6 text-left">
        <div className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
          <Link to="/admin/clients" className="hover:text-[#f95d00] flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
            Retour aux Membres
          </Link>
          <span>/</span>
          <span className="text-primary font-bold">Fiche 360°</span>
        </div>

        {toast && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800">{toast}</div>
        )}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-800">{error}</div>
        )}

        {loading ? (
          <div className="rounded-3xl bg-white p-10 text-center text-sm text-on-surface-variant border border-outline-variant/15">
            Chargement de la fiche 360°…
          </div>
        ) : !p ? (
          <div className="rounded-3xl bg-white p-10 text-center text-sm text-on-surface-variant border border-outline-variant/15">
            Fiche introuvable.
          </div>
        ) : (
          <>
            {/* En-tête + 4 Actions rapides */}
            <header className="bg-white rounded-3xl border border-outline-variant/15 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center font-sora font-bold text-lg text-white shrink-0"
                  style={{ backgroundColor: '#f95d00' }}
                >
                  {`${p.prenom?.[0] || ''}${p.nom?.[0] || ''}`.toUpperCase() || 'DW'}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-sora font-bold text-xl sm:text-2xl text-primary">{fullName}</h1>
                    <StatusBadge
                      label={p.type_personne === 'invite' ? 'Invité' : p.type_personne === 'prospect' ? 'Prospect' : 'Membre'}
                      cls="bg-amber-50 text-amber-800 border-amber-200"
                    />
                    <StatusBadge
                      label={p.statut_compte === 'suspendu' ? 'Suspendu' : p.statut_compte === 'archive' ? 'Archivé' : 'Actif'}
                      cls={p.statut_compte === 'actif' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-300'}
                    />
                  </div>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {p.telephone ? formatTunisianPhone(p.telephone) : 'Téléphone non renseigné'} · {p.email || 'E-mail non renseigné'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {p.telephone && (
                  <a
                    href={`tel:${p.telephone}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant/30 bg-white px-3.5 py-2 text-xs font-bold text-primary hover:bg-surface-container-low"
                  >
                    <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 16 }}>call</span>
                    Appeler
                  </a>
                )}
                {waNumber && (
                  <a
                    href={`https://wa.me/${waNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chat</span>
                    WhatsApp
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/admin/reservations?new=1&personne_id=${encodeURIComponent(p.id)}`)}
                  style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                  className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-xs hover:opacity-95"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>event_available</span>
                  Réserver
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (pendingPayments[0]) handleQuickCollect(pendingPayments[0]);
                    else navigate(`/admin/payments?search=${encodeURIComponent(p.email || p.nom || fullName)}`);
                  }}
                  disabled={Boolean(collectingId)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>payments</span>
                  {pendingPayments[0] ? 'Encaisser dû' : 'Encaisser'}
                </button>
              </div>
            </header>

            {/* Entreprise + Abonnement actif & jauge */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-2">
                <h2 className="font-sora font-bold text-sm text-primary flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 18 }}>business</span>
                  Entreprise
                </h2>
                {data.entreprise ? (
                  <div className="text-xs space-y-1">
                    <p className="font-bold text-sm text-primary">{data.entreprise.raison_sociale}</p>
                    {data.entreprise.matricule_fiscale && <p className="text-on-surface-variant">Matricule fiscale : {data.entreprise.matricule_fiscale}</p>}
                    {data.entreprise.email && <p className="text-on-surface-variant">{data.entreprise.email}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-on-surface-variant">Client particulier (aucune entreprise rattachée).</p>
                )}
              </section>

              <section className="bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-3">
                <h2 className="font-sora font-bold text-sm text-primary flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 18 }}>card_membership</span>
                  Abonnement actif &amp; jauge
                </h2>
                {abo ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-primary capitalize">{abo.type || abo.nom_formule || 'Abonnement'}</span>
                      <span className="text-on-surface-variant">
                        Valide jusqu&apos;au {formatDateDMY(abo.date_fin)}
                      </span>
                    </div>
                    {totalQuota > 0 && (
                      <div>
                        <div className="flex justify-between font-semibold mb-1">
                          <span>Consommation quota : {usedQuota} / {totalQuota}</span>
                          <span>{gaugePct}%</span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-[#f95d00]" style={{ width: `${gaugePct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-on-surface-variant">Aucun abonnement actif actuellement.</p>
                )}
              </section>
            </div>

            {/* Réservations + Paiements / Factures / Reçus */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-3">
                <h2 className="font-sora font-bold text-sm text-primary">Réservations ({data.reservations.length})</h2>
                {data.reservations.length === 0 ? (
                  <p className="text-xs text-on-surface-variant">Aucune réservation enregistrée.</p>
                ) : (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b text-on-surface-variant uppercase">
                          <th className="py-2 pr-2">Espace</th>
                          <th className="py-2 pr-2">Créneau (Tunis)</th>
                          <th className="py-2">Statut</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.reservations.map((r) => (
                          <tr key={r.id}>
                            <td className="py-2 pr-2 font-semibold">{r.espaces?.nom || 'Espace'}</td>
                            <td className="py-2 pr-2 whitespace-nowrap">
                              {formatDateDMY(r.date_debut)} · {formatTime24h(r.date_debut)} → {formatTime24h(r.date_fin)}
                            </td>
                            <td className="py-2 font-bold capitalize">{r.statut}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-3">
                <h2 className="font-sora font-bold text-sm text-primary">
                  Paiements, Factures &amp; Reçus ({data.paiements.length + (data.devis_factures?.length || 0)})
                </h2>
                {data.paiements.length === 0 ? (
                  <p className="text-xs text-on-surface-variant">Aucun paiement enregistré.</p>
                ) : (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b text-on-surface-variant uppercase">
                          <th className="py-2 pr-2">Date</th>
                          <th className="py-2 pr-2">Montant</th>
                          <th className="py-2 pr-2">Statut</th>
                          <th className="py-2 text-right">Reçu</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.paiements.map((pay) => (
                          <tr key={pay.id}>
                            <td className="py-2 pr-2 whitespace-nowrap">{formatDateDMY(pay.date_paiement || pay.created_at)}</td>
                            <td className="py-2 pr-2 font-bold"><Money amount={pay.montant} showTaxType="TTC" /></td>
                            <td className="py-2 pr-2 font-semibold">
                              {pay.statut === 'paid' ? 'Payé' : pay.statut === 'refunded' ? 'Remboursé' : 'En attente'}
                            </td>
                            <td className="py-2 text-right">
                              {pay.statut === 'paid' && (
                                <button
                                  type="button"
                                  onClick={() => paymentApi.downloadReceipt(pay.id)}
                                  className="text-xs font-bold text-[#f95d00] hover:underline"
                                >
                                  Télécharger le reçu
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            {/* Documents signés, Formations, Incidents */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <section className="bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-2 text-xs">
                <h2 className="font-sora font-bold text-sm text-primary">Documents signés ({data.documents_signes.length})</h2>
                {data.documents_signes.length === 0 ? (
                  <p className="text-on-surface-variant">Aucun document.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.documents_signes.map((d) => (
                      <li key={d.id} className="flex justify-between border-b border-outline-variant/10 pb-1">
                        <span className="font-semibold">{d.nom || d.type_doc}</span>
                        <span>{d.statut === 'signe' ? 'Signé' : 'En attente'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-2 text-xs">
                <h2 className="font-sora font-bold text-sm text-primary">Formations ({data.formations.length})</h2>
                {data.formations.length === 0 ? (
                  <p className="text-on-surface-variant">Aucune inscription.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.formations.map((f) => (
                      <li key={f.id} className="border-b border-outline-variant/10 pb-1">
                        <p className="font-semibold">{f.formations?.titre || 'Formation'}</p>
                        <p className="text-on-surface-variant">{formatDateDMY(f.formations?.date_debut)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-2 text-xs">
                <h2 className="font-sora font-bold text-sm text-primary">Incidents ({data.incidents.length})</h2>
                {data.incidents.length === 0 ? (
                  <p className="text-on-surface-variant">Aucun incident associé.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.incidents.map((inc) => (
                      <li key={inc.id} className="border-b border-outline-variant/10 pb-1">
                        <p className="font-semibold">{inc.titre}</p>
                        <p className="text-on-surface-variant capitalize">{inc.statut || 'ouvert'}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Notes internes + Chronologie complète */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <section className="lg:col-span-5 bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-3">
                <h2 className="font-sora font-bold text-sm text-primary">Notes internes</h2>
                <textarea
                  rows={5}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Informations utiles pour l'équipe d'accueil (jamais visibles par le membre)…"
                  className="w-full rounded-2xl border border-outline-variant/30 p-3 text-xs outline-none focus:border-[#f95d00]"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingNotes}
                    onClick={handleSaveNotes}
                    style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                    className="rounded-xl px-4 py-2 text-xs font-bold shadow-xs hover:opacity-95 disabled:opacity-50"
                  >
                    {savingNotes ? 'Enregistrement…' : 'Enregistrer les notes'}
                  </button>
                </div>
              </section>

              <section className="lg:col-span-7 bg-white rounded-3xl border border-outline-variant/15 p-5 space-y-3">
                <h2 className="font-sora font-bold text-sm text-primary">
                  Chronologie complète ({data.chronologie.length})
                </h2>
                {data.chronologie.length === 0 ? (
                  <p className="text-xs text-on-surface-variant">Aucun événement enregistré dans le journal d&apos;activité.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1 text-xs">
                    {data.chronologie.map((log) => (
                      <div key={log.id} className="rounded-xl border border-outline-variant/15 p-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-primary capitalize">
                            {log.action} · {log.entity_type}
                          </p>
                          <p className="text-on-surface-variant">{log.entity_label || 'Action système'}</p>
                          <p className="text-on-surface-variant/80">Par {log.actor_name || 'Système'}</p>
                        </div>
                        <span className="whitespace-nowrap text-on-surface-variant font-medium">
                          {formatDateTimeDMY(log.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
