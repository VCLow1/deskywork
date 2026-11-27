// components/reservations/NewReservationModal.jsx — Modale 11 étapes complète Admin Réservations (LOT 3)
import React, { useState, useEffect, useMemo } from 'react';
import { bookingApi, tenantAdminApi } from '../../services/api';
import { formatDateDMY, tunisLocalToISO } from '../../utils/format';
import { normalizeTunisianPhone, validateTunisianPhone } from '../../utils/tunisianPhone';
import { DEFAULT_TVA_PCT, computeTTC, computeHTFromTTC, roundMillime } from '../../utils/pricingMath';
import TunisianPhoneInput from '../common/TunisianPhoneInput';
import Money from '../common/Money';

const SOURCE_OPTIONS = [
  { value: 'en_ligne', label: 'En ligne' },
  { value: 'telephone', label: 'Téléphone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sur_place', label: 'Sur place' },
  { value: 'autre', label: 'Autre' },
];

const PAYMENT_MODES = [
  { value: 'cash', label: 'Sur place (Espèces)' },
  { value: 'card', label: 'Sur place (TPE / Carte)' },
  { value: 'check', label: 'Chèque' },
  { value: 'bank_transfer', label: 'Virement bancaire' },
  { value: 'quota_abonnement', label: 'Quota abonnement actif' },
];

export default function NewReservationModal({
  isOpen,
  onClose,
  onCreated,
  espaces = [],
  userRole = 'admin',
  initialPersonneId = '',
  initialEspaceId = '',
  initialDate = '',
}) {
  const isManager = ['admin', 'super_admin'].includes(String(userRole || '').toLowerCase());
  const todayYmd = new Date().toISOString().slice(0, 10);

  // Données chargées
  const [personnes, setPersonnes] = useState([]);
  const [unites, setUnites] = useState([]);
  const [services, setServices] = useState([]);
  const [ressources, setRessources] = useState([]);
  const [slotsInfo, setSlotsInfo] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Étape 1 : Recherche Personne / Création invité à la volée
  const [personSearch, setPersonSearch] = useState('');
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [createInlineInvite, setCreateInlineInvite] = useState(false);
  const [inlineInvite, setInlineInvite] = useState({ nom: '', prenom: '', telephone: '', email: '' });
  const [phoneDupMatch, setPhoneDupMatch] = useState(null);

  // Étape 2-10
  const [espaceId, setEspaceId] = useState(initialEspaceId || '');
  const [uniteId, setUniteId] = useState('');
  const [date, setDate] = useState(initialDate || todayYmd);
  const [heureDebut, setHeureDebut] = useState('09:00');
  const [heureFin, setHeureFin] = useState('12:00');
  const [nbParticipants, setNbParticipants] = useState(1);
  const [telephoneContact, setTelephoneContact] = useState('');
  const [selectedServices, setSelectedServices] = useState([]); // { id, nom, prix_ht, quantite }
  const [selectedRessources, setSelectedRessources] = useState([]);
  const [source, setSource] = useState('telephone');
  const [codePromo, setCodePromo] = useState('');
  const [deduireQuota, setDeduireQuota] = useState(false);
  const [modePaiement, setModePaiement] = useState('cash');
  const [notes, setNotes] = useState('');
  const [confirmationManuelle, setConfirmationManuelle] = useState(false);
  const [delaiConfirmationH, setDelaiConfirmationH] = useState(2);
  const [motifRetroactif, setMotifRetroactif] = useState('');
  const [overrideConflit, setOverrideConflit] = useState(false);

  // Soumission & conflits
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [conflictAlternatives, setConflictAlternatives] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setConflictAlternatives(null);
    if (initialEspaceId) setEspaceId(initialEspaceId);
    if (initialDate) setDate(initialDate);

    Promise.all([
      tenantAdminApi.getClientsOverview().catch(() => ({ personnes: [] })),
      tenantAdminApi.getUnites().catch(() => ({ unites: [] })),
      tenantAdminApi.getServices().catch(() => ({ items: [] })),
      tenantAdminApi.getRessources().catch(() => ({ items: [] })),
    ]).then(([clientsRes, unitsRes, svcRes, resList]) => {
      const persList = clientsRes.personnes || [];
      setPersonnes(persList);
      setUnites(unitsRes.unites || []);
      setServices((svcRes.items || []).filter((s) => !s.archived_at));
      setRessources((resList.items || []).filter((r) => !r.archived_at));

      if (initialPersonneId) {
        const found = persList.find((p) => p.id === initialPersonneId || p.profile_id === initialPersonneId);
        if (found) {
          setSelectedPerson(found);
          if (found.telephone) setTelephoneContact(found.telephone);
        }
      }
    });
  }, [isOpen, initialPersonneId, initialEspaceId, initialDate]);

  // Charger les créneaux disponibles quand espace ou date change
  useEffect(() => {
    if (!isOpen || !espaceId || !date) {
      setSlotsInfo(null);
      return;
    }
    setLoadingSlots(true);
    bookingApi
      .checkSlots({ espace_id: espaceId, unite_id: uniteId || null, date, duration_minutes: 60, nb_participants: nbParticipants })
      .then((res) => setSlotsInfo(res))
      .catch(() => setSlotsInfo(null))
      .finally(() => setLoadingSlots(false));
  }, [isOpen, espaceId, uniteId, date, nbParticipants]);

  // Détection doublon téléphone lors création invité inline
  useEffect(() => {
    if (!createInlineInvite) {
      setPhoneDupMatch(null);
      return;
    }
    const check = validateTunisianPhone(inlineInvite.telephone);
    if (!check.valid || !check.normalized) {
      setPhoneDupMatch(null);
      return;
    }
    tenantAdminApi
      .checkPersonnePhone(check.normalized)
      .then((res) => setPhoneDupMatch(res.exists ? res.match : null))
      .catch(() => setPhoneDupMatch(null));
  }, [createInlineInvite, inlineInvite.telephone]);

  const filteredPersonnes = useMemo(() => {
    const q = personSearch.trim().toLowerCase();
    const active = personnes.filter((p) => !p.archived_at);
    if (!q) return active.slice(0, 8);
    return active
      .filter((p) => `${p.prenom || ''} ${p.nom || ''} ${p.telephone || ''} ${p.email || ''}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [personnes, personSearch]);

  const selectedEspace = useMemo(() => espaces.find((e) => e.id === espaceId) || null, [espaces, espaceId]);
  const spaceUnits = useMemo(() => unites.filter((u) => u.espace_id === espaceId && !u.archived_at), [unites, espaceId]);
  const selectedUnite = useMemo(() => spaceUnits.find((u) => u.id === uniteId) || null, [spaceUnits, uniteId]);

  const pricingSummary = useMemo(() => {
    if (!selectedEspace) return { hours: 0, ht: 0, tvaPct: DEFAULT_TVA_PCT, tva: 0, ttc: 0 };
    const [h1, m1] = (heureDebut || '09:00').split(':').map(Number);
    const [h2, m2] = (heureFin || '12:00').split(':').map(Number);
    const hours = Math.max(0.5, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
    const tvaPct = Number(selectedEspace.tva_pct ?? DEFAULT_TVA_PCT);
    const tarifHT = selectedEspace.tarif_horaire_ht != null
      ? Number(selectedEspace.tarif_horaire_ht)
      : computeHTFromTTC(selectedEspace.tarif_horaire || 0, tvaPct);
    const spaceHT = roundMillime(hours * tarifHT);
    const svcHT = roundMillime(
      selectedServices.reduce((s, it) => s + Number(it.prix_ht || 0) * Math.max(1, Number(it.quantite || 1)), 0)
    );
    const totalHT = roundMillime(spaceHT + svcHT);
    const totalTTC = computeTTC(totalHT, tvaPct);
    const totalTVA = roundMillime(totalTTC - totalHT);
    return { hours, spaceHT, svcHT, ht: totalHT, tvaPct, tva: totalTVA, ttc: totalTTC };
  }, [selectedEspace, heureDebut, heureFin, selectedServices]);

  const isPastSlot = useMemo(() => {
    try {
      const iso = tunisLocalToISO(`${date}T${heureDebut}`);
      return new Date(iso).getTime() < Date.now() - 5 * 60 * 1000;
    } catch {
      return false;
    }
  }, [date, heureDebut]);

  if (!isOpen) return null;

  const toggleService = (svc) => {
    setSelectedServices((prev) => {
      const exists = prev.find((s) => s.id === svc.id);
      if (exists) return prev.filter((s) => s.id !== svc.id);
      return [...prev, { id: svc.id, nom: svc.nom, prix_ht: Number(svc.prix_ht || 0), quantite: 1 }];
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setConflictAlternatives(null);

    if (!selectedPerson && !createInlineInvite) {
      setError('1. Veuillez sélectionner une personne ou créer un invité à la volée.');
      return;
    }
    if (!espaceId) {
      setError('2. Veuillez sélectionner un espace.');
      return;
    }
    if (selectedUnite && selectedUnite.statut !== 'disponible') {
      setError(`L'unité ${selectedUnite.code} est actuellement ${selectedUnite.statut === 'en_maintenance' ? 'en maintenance' : 'non disponible'}.`);
      return;
    }
    const maxCap = Math.max(1, parseInt(selectedUnite?.capacite || selectedEspace?.capacite, 10) || 1);
    const nbPart = parseInt(nbParticipants, 10) || 1;
    if (selectedEspace?.type === 'meeting_room' && (nbPart < 1 || nbPart > maxCap)) {
      setError(`4. Pour une salle de réunion, le nombre de participants doit être compris entre 1 et ${maxCap}.`);
      return;
    }

    const phoneVal = createInlineInvite ? inlineInvite.telephone : telephoneContact;
    const phoneCheck = validateTunisianPhone(phoneVal, { required: true });
    if (!phoneCheck.valid) {
      setError(`5. ${phoneCheck.error}`);
      return;
    }

    if (isPastSlot && !isManager) {
      setError('Seul un Responsable peut effectuer une saisie rétroactive.');
      return;
    }
    if (isPastSlot && !String(motifRetroactif || '').trim()) {
      setError('Un motif obligatoire est requis pour toute saisie rétroactive.');
      return;
    }

    setSubmitting(true);
    try {
      const date_debut = tunisLocalToISO(`${date}T${heureDebut}`);
      const date_fin = tunisLocalToISO(`${date}T${heureFin}`);

      const payload = {
        espace_id: espaceId,
        unite_id: uniteId || null,
        date_debut,
        date_fin,
        nb_participants: nbPart,
        telephone_contact: phoneCheck.normalized,
        services_additionnels: selectedServices,
        ressources: selectedRessources,
        source,
        code_promo: codePromo.trim() || null,
        deduire_quota_abonnement: deduireQuota,
        mode_paiement: deduireQuota && modePaiement === 'quota_abonnement' ? 'quota_abonnement' : modePaiement,
        notes,
        confirmation_manuelle: confirmationManuelle,
        delai_confirmation_heures: delaiConfirmationH,
        override_conflit: isManager ? overrideConflit : false,
        motif_retroactif: isPastSlot ? motifRetroactif : '',
        ...(createInlineInvite
          ? {
            new_invite: {
              nom: inlineInvite.nom.trim(),
              prenom: inlineInvite.prenom.trim(),
              telephone: phoneCheck.normalized,
              email: inlineInvite.email.trim(),
            },
          }
          : selectedPerson?.profile_id
            ? { user_id: selectedPerson.profile_id }
            : selectedPerson?.source === 'guest'
              ? { guest_id: selectedPerson.id }
              : { personne_id: selectedPerson.id }),
      };

      const res = await bookingApi.create(payload);
      onCreated?.(res);
      onClose?.();
    } catch (err) {
      const errData = err?.data || err?.body;
      if (err?.status === 409 && errData?.alternatives) {
        setConflictAlternatives(errData.alternatives);
      }
      setError(err.message || 'Erreur lors de la création de la réservation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-4 backdrop-blur-xs">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-5 sm:p-6 shadow-2xl space-y-5 text-left"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3 sticky top-0 bg-white z-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#f95d00]">Création guidée</p>
            <h3 className="font-sora text-lg font-bold text-slate-900">Nouvelle réservation</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-900">
            Fermer
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-800 space-y-2">
            <p>{error}</p>
            {conflictAlternatives && (
              <div className="space-y-2 pt-1">
                {conflictAlternatives.slots?.length > 0 && (
                  <div>
                    <p className="font-bold text-slate-800 mb-1">Créneaux libres proposés ce jour :</p>
                    <div className="flex flex-wrap gap-1.5">
                      {conflictAlternatives.slots.map((sl) => (
                        <button
                          key={sl.label}
                          type="button"
                          onClick={() => {
                            setHeureDebut(sl.heure_debut);
                            setHeureFin(sl.heure_fin);
                            setError('');
                            setConflictAlternatives(null);
                          }}
                          className="rounded-lg border border-orange-300 bg-white px-2.5 py-1 text-xs font-bold text-[#f95d00] hover:bg-orange-50"
                        >
                          {sl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {conflictAlternatives.units?.length > 0 && (
                  <div>
                    <p className="font-bold text-slate-800 mb-1">Unités disponibles sur ce créneau :</p>
                    <div className="flex flex-wrap gap-1.5">
                      {conflictAlternatives.units.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setUniteId(u.id);
                            setError('');
                            setConflictAlternatives(null);
                          }}
                          className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                        >
                          {u.code} · {u.nom}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 1. Personne ou Invité à la volée */}
        <section className="rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-sora text-xs font-bold uppercase tracking-wider text-slate-800">1. Client / Personne *</h4>
            <button
              type="button"
              onClick={() => {
                setCreateInlineInvite((v) => !v);
                setSelectedPerson(null);
              }}
              style={createInlineInvite ? { backgroundColor: '#f95d00', color: '#ffffff' } : undefined}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              {createInlineInvite ? 'Rechercher une fiche existante' : '+ Créer un invité à la volée'}
            </button>
          </div>

          {!createInlineInvite ? (
            <div className="space-y-2">
              <input
                type="search"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Rechercher par nom, prénom ou téléphone (+216)…"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
              {selectedPerson ? (
                <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs">
                  <div>
                    <span className="font-bold text-slate-900">{selectedPerson.prenom} {selectedPerson.nom}</span>
                    <span className="text-slate-600 ml-2">{selectedPerson.telephone || selectedPerson.email || ''}</span>
                    {selectedPerson.abonnement_actif && (
                      <span className="ml-2 rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-bold text-emerald-900">
                        Abonnement actif
                      </span>
                    )}
                  </div>
                  <button type="button" onClick={() => setSelectedPerson(null)} className="text-xs font-bold text-red-700 underline">
                    Changer
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                  {filteredPersonnes.map((p) => (
                    <button
                      key={`${p.source}-${p.id}`}
                      type="button"
                      onClick={() => {
                        setSelectedPerson(p);
                        if (p.telephone) setTelephoneContact(p.telephone);
                      }}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs hover:border-[#f95d00] hover:bg-orange-50/40"
                    >
                      <p className="font-bold text-slate-900 truncate">{p.prenom} {p.nom}</p>
                      <p className="text-slate-500 truncate">{p.telephone || p.email || '—'}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl">
              <div>
                <label className="block text-xs font-bold mb-1">Nom invité *</label>
                <input
                  required
                  value={inlineInvite.nom}
                  onChange={(e) => setInlineInvite((f) => ({ ...f, nom: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Prénom</label>
                <input
                  value={inlineInvite.prenom}
                  onChange={(e) => setInlineInvite((f) => ({ ...f, prenom: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Téléphone (+216) *</label>
                <TunisianPhoneInput
                  required
                  value={inlineInvite.telephone}
                  onChange={(val) => {
                    setInlineInvite((f) => ({ ...f, telephone: val }));
                    setTelephoneContact(val);
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">E-mail (optionnel)</label>
                <input
                  type="email"
                  value={inlineInvite.email}
                  onChange={(e) => setInlineInvite((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                />
              </div>
              {phoneDupMatch && (
                <div className="sm:col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-amber-900">
                    Doublon détecté : <strong>{phoneDupMatch.prenom} {phoneDupMatch.nom}</strong> possède déjà ce numéro.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateInlineInvite(false);
                      setSelectedPerson(phoneDupMatch);
                      setTelephoneContact(phoneDupMatch.telephone || inlineInvite.telephone);
                    }}
                    style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                    className="rounded-lg px-3 py-1 text-xs font-bold"
                  >
                    Réutiliser cette fiche
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 2. Espace puis Unité / Poste */}
        <section className="rounded-2xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <h4 className="font-sora text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">2a. Espace *</h4>
            <select
              required
              value={espaceId}
              onChange={(e) => {
                setEspaceId(e.target.value);
                setUniteId('');
                setNbParticipants(1);
              }}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
            >
              <option value="">— Sélectionner un espace —</option>
              {espaces.filter((e) => !e.archived_at).map((esp) => (
                <option key={esp.id} value={esp.id}>
                  {esp.nom} (capacité {esp.capacite})
                </option>
              ))}
            </select>
          </div>
          <div>
            <h4 className="font-sora text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">2b. Unité / Poste</h4>
            <select
              value={uniteId}
              onChange={(e) => setUniteId(e.target.value)}
              disabled={!espaceId || spaceUnits.length === 0}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              <option value="">{spaceUnits.length === 0 ? 'Aucune unité dédiée' : '— Attribution automatique / au choix —'}</option>
              {spaceUnits.map((u) => (
                <option key={u.id} value={u.id} disabled={u.statut !== 'disponible'}>
                  {u.code} · {u.nom} {u.statut === 'en_maintenance' ? '(En maintenance)' : u.statut === 'non_disponible' ? '(Non disponible)' : '(Disponible)'}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* 3, 4, 5 : Date & Créneaux, Participants, Téléphone +216 */}
        <section className="rounded-2xl border border-slate-200 p-4 space-y-3">
          <h4 className="font-sora text-xs font-bold uppercase tracking-wider text-slate-800">3. Date & créneaux · 4. Participants · 5. Téléphone</h4>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">Date *</label>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Début *</label>
              <input type="time" required value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Fin *</label>
              <input type="time" required value={heureFin} onChange={(e) => setHeureFin(e.target.value)} className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">
                Participants {selectedEspace?.type === 'meeting_room' ? '*' : ''}
              </label>
              <input
                type="number"
                min={1}
                max={Math.max(1, parseInt(selectedUnite?.capacite || selectedEspace?.capacite, 10) || 100)}
                required={selectedEspace?.type === 'meeting_room'}
                value={nbParticipants}
                onChange={(e) => setNbParticipants(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Téléphone (+216) *</label>
              <TunisianPhoneInput
                required
                value={telephoneContact}
                onChange={setTelephoneContact}
                className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs"
              />
            </div>
          </div>

          {slotsInfo && (
            <div className="pt-1">
              <p className="text-xs font-semibold text-slate-600 mb-1.5">
                Horaires : {slotsInfo.horaires} · Tampon entre réservations : {slotsInfo.tampon_minutes} min
                {loadingSlots ? ' · Actualisation…' : ''}
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                {(slotsInfo.available_slots || []).slice(0, 12).map((sl) => (
                  <button
                    key={sl.label}
                    type="button"
                    onClick={() => {
                      setHeureDebut(sl.heure_debut);
                      setHeureFin(sl.heure_fin);
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      heureDebut === sl.heure_debut && heureFin === sl.heure_fin
                        ? 'border-[#f95d00] bg-orange-50 text-[#f95d00]'
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {sl.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 6 & 7 : Services/Ressources & Source */}
        <section className="rounded-2xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <h4 className="font-sora text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">6. Services & ressources additionnels</h4>
            <div className="space-y-1.5 max-h-28 overflow-y-auto">
              {services.length === 0 && ressources.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun service ou ressource configuré.</p>
              ) : (
                <>
                  {services.map((svc) => {
                    const checked = selectedServices.some((s) => s.id === svc.id);
                    return (
                      <label key={svc.id} className="flex items-center justify-between gap-2 text-xs cursor-pointer rounded-lg px-2 py-1 hover:bg-slate-50">
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={checked} onChange={() => toggleService(svc)} className="accent-[#f95d00]" />
                          <span className="font-semibold">{svc.nom}</span>
                        </span>
                        <Money amount={svc.prix_ht || 0} showTaxType="HT" />
                      </label>
                    );
                  })}
                  {ressources.map((r) => {
                    const checked = selectedRessources.includes(r.id);
                    return (
                      <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer rounded-lg px-2 py-1 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedRessources((prev) => (prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]))
                          }
                          className="accent-[#f95d00]"
                        />
                        <span>Ressource : {r.nom}</span>
                      </label>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          <div>
            <h4 className="font-sora text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">7. Source de la réservation</h4>
            <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold">
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmationManuelle}
                  onChange={(e) => setConfirmationManuelle(e.target.checked)}
                  className="accent-[#f95d00]"
                />
                <span>Mettre en attente de confirmation par téléphone</span>
              </label>
              {confirmationManuelle && (
                <div className="flex items-center gap-2 text-xs pl-5">
                  <span>Expiration automatique après</span>
                  <input
                    type="number"
                    min={0.5}
                    max={48}
                    step={0.5}
                    value={delaiConfirmationH}
                    onChange={(e) => setDelaiConfirmationH(e.target.value)}
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold"
                  />
                  <span>h (rappel 30 min avant)</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 8, 9, 10 : Calcul prix en direct, Mode paiement, Notes + Responsable */}
        <section className="rounded-2xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2.5">
            <h4 className="font-sora text-xs font-bold uppercase tracking-wider text-slate-800">8. Tarification en direct (HT / TVA / TTC)</h4>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">Durée ({pricingSummary.hours} h)</span>
                <Money amount={pricingSummary.ht} showTaxType="HT" />
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">TVA ({pricingSummary.tvaPct}%)</span>
                <Money amount={pricingSummary.tva} />
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900">
                <span>Total estimé</span>
                <span className="text-[#f95d00]"><Money amount={pricingSummary.ttc} showTaxType="TTC" /></span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={codePromo}
                onChange={(e) => setCodePromo(e.target.value.toUpperCase())}
                placeholder="Code promo (optionnel)"
                className="rounded-xl border border-slate-300 px-3 py-2 text-xs uppercase"
              />
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer px-2">
                <input
                  type="checkbox"
                  checked={deduireQuota}
                  onChange={(e) => setDeduireQuota(e.target.checked)}
                  disabled={!selectedPerson?.abonnement_actif}
                  className="accent-[#f95d00]"
                />
                <span className={!selectedPerson?.abonnement_actif ? 'opacity-50' : ''}>Déduire quota</span>
              </label>
            </div>
          </div>

          <div className="space-y-2.5">
            <h4 className="font-sora text-xs font-bold uppercase tracking-wider text-slate-800">9. Mode de paiement · 10. Notes</h4>
            <select value={modePaiement} onChange={(e) => setModePaiement(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold">
              {PAYMENT_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes internes ou demandes particulières…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
          </div>
        </section>

        {/* Garde Responsable rétroactif / override */}
        {(isPastSlot || isManager) && isManager && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2 text-xs">
            <p className="font-bold text-amber-900">Contrôles Responsable</p>
            {isPastSlot && (
              <div>
                <label className="block font-semibold mb-1">Motif de saisie rétroactive *</label>
                <input
                  type="text"
                  required
                  value={motifRetroactif}
                  onChange={(e) => setMotifRetroactif(e.target.value)}
                  placeholder="Ex : Régularisation client venu hier matin…"
                  className="w-full rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>
            )}
            <label className="flex items-center gap-2 font-semibold cursor-pointer">
              <input type="checkbox" checked={overrideConflit} onChange={(e) => setOverrideConflit(e.target.checked)} className="accent-[#f95d00]" />
              <span>Déroger à un éventuel conflit horaire (Responsable uniquement)</span>
            </label>
          </section>
        )}

        {/* 11. Récapitulatif avant validation */}
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <p className="font-bold uppercase tracking-wider text-slate-600">11. Récapitulatif</p>
            <p className="font-semibold text-slate-900">
              {selectedEspace ? selectedEspace.nom : 'Aucun espace'}
              {selectedUnite ? ` (${selectedUnite.code})` : ''} · {formatDateDMY(date)} de {heureDebut} à {heureFin} · {nbParticipants} pers.
            </p>
            <p className="text-slate-600">
              Source : {SOURCE_OPTIONS.find((s) => s.value === source)?.label} · {confirmationManuelle ? `Attente confirmation (${delaiConfirmationH}h)` : 'Demande immédiate'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
              className="rounded-xl px-5 py-2.5 text-xs font-bold shadow-sm hover:opacity-95 disabled:opacity-50"
            >
              {submitting ? 'Validation atomique…' : 'Confirmer la réservation'}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}
