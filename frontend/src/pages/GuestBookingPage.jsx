import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { guestApi } from '../services/api';
import { SPACE_TYPE_LABELS } from '../constants/spaceTypes';
import { formatDT, formatDateTunis, formatTimeTunis, tunisLocalToISO } from '../utils/format';
import { validateTunisianPhone, normalizeTunisianPhone } from '../utils/tunisianPhone';
import TunisianPhoneInput from '../components/common/TunisianPhoneInput';

const SPACE_LABELS = SPACE_TYPE_LABELS; // 7 typologies officielles

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=600&fit=crop';

export default function GuestBookingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tenantParam = searchParams.get('tenantId');
  const espaceParam = searchParams.get('espaceId');
  const debutParam = searchParams.get('debut') || '';
  const finParam = searchParams.get('fin') || '';
  const itemIdParam = searchParams.get('itemId') || '';
  const itemLabelParam = searchParams.get('itemLabel') || '';

  const [step, setStep]         = useState(1); // 1=espace 2=infos 3=confirmation
  const [coworking, setCoworking] = useState(null); // coworking sélectionné (image + coordonnées)
  const [coworkings, setCoworkings] = useState([]); // liste dispo quand pas de tenantId
  const [espaces, setEspaces]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [nbParticipants, setNbParticipants] = useState('');
  const [clientType, setClientType] = useState('particulier'); // 'particulier' | 'entreprise'
  const [form, setForm]         = useState({ nom: '', prenom: '', email: '', telephone: '' });
  const [entrepriseInfo, setEntrepriseInfo] = useState({
    raison_sociale: '',
    contact_nom: '',
    telephone_pro: '',
    email_facturation: '',
    besoin_description: '',
  });
  const [dates, setDates]       = useState({ debut: debutParam, fin: finParam });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [listLoaded, setListLoaded] = useState(false);
  const [result, setResult]     = useState(null);

  useEffect(() => {
    (async () => {
      let tenantLoaded = false;

      // 1) Établissement ciblé (?tenantId=…) : on charge sa fiche + ses espaces.
      //    `espaceId` est facultatif : sans lui, l'utilisateur choisit l'espace à l'étape 1.
      if (tenantParam) {
        try {
          const res = await guestApi.getCoworking(tenantParam);
          if (res?.coworking) {
            const spaces = res.coworking.espaces || [];
            setCoworking(res.coworking);
            setEspaces(spaces);
            tenantLoaded = true;
            if (espaceParam) {
              const match = spaces.find((s) => s.id === espaceParam);
              if (match) {
                setSelected(match);
                if (debutParam && finParam) setStep(2);
              }
            }
          } else {
            setError(res?.error || "Cet établissement n'est plus disponible. Choisissez-en un autre ci-dessous.");
          }
        } catch (e) {
          setError(e.message);
        }
      }

      // 2) Pas d'établissement (ou introuvable) : liste de repli pour ne jamais bloquer le visiteur.
      if (!tenantLoaded) {
        try {
          const res = await guestApi.getCoworkings();
          if (res?.error) throw new Error(res.error);
          setCoworkings(res?.coworkings || []);
        } catch (e) {
          setError(e.message);
        } finally {
          setListLoaded(true);
        }
      }
    })();
  }, [tenantParam, espaceParam]);

  const selectCoworking = async (t) => {
    setCoworking(t);
    setSelected(null);
    try {
      const res = await guestApi.getPublicEspaces(t.id);
      setEspaces(res.espaces || []);
    } catch (e) { setError(e.message); }
  };

  const resetCoworking = () => {
    setCoworking(null);
    setSelected(null);
    setEspaces([]);
  };

  const handleSubmit = async () => {
    if (!selected?.id) { setError('Veuillez choisir un espace.'); setStep(1); return; }
    if (!form.nom || !form.prenom || !form.email || !form.telephone) {
      setError('Tous les champs sont obligatoires.'); return;
    }
    const phoneCheck = validateTunisianPhone(form.telephone, { required: true });
    if (!phoneCheck.valid) { setError(phoneCheck.error); return; }
    if (selected?.type === 'meeting_room') {
      const cap = Math.max(1, Number(selected.capacite || 1));
      const n = Number(nbParticipants);
      if (!nbParticipants || !Number.isInteger(n) || n < 1 || n > cap) {
        setError(`Veuillez indiquer un nombre de participants valide entre 1 et ${cap} pour cette salle de réunion.`);
        return;
      }
    }
    if (clientType === 'entreprise') {
      const { raison_sociale, contact_nom, telephone_pro, email_facturation, besoin_description } = entrepriseInfo;
      if (!raison_sociale.trim() || !contact_nom.trim() || !telephone_pro.trim() || !email_facturation.trim() || !besoin_description.trim()) {
        setError('Pour une réservation Entreprise, veuillez remplir la raison sociale, la personne de contact, le téléphone professionnel, l’e-mail de facturation et l’objet du besoin.');
        return;
      }
      const proTelCheck = validateTunisianPhone(telephone_pro, { required: true });
      if (!proTelCheck.valid) { setError(proTelCheck.error); return; }
    }
    if (!dates.debut || !dates.fin) { setError('Veuillez choisir un créneau.'); return; }
    if (new Date(dates.debut) >= new Date(dates.fin)) {
      setError('La date de fin doit être après la date de début.'); return;
    }
    setLoading(true); setError('');
    try {
      const res = await guestApi.booking({
        ...form,
        telephone: normalizeTunisianPhone(form.telephone),
        espace_id: selected.id,
        date_debut: tunisLocalToISO(dates.debut), date_fin: tunisLocalToISO(dates.fin),
        tenant_id: coworking?.id || selected.tenant_id || null,
        client_type: clientType,
        ...(itemIdParam ? { floor_plan_item_id: itemIdParam } : {}),
        ...(itemLabelParam ? { floor_plan_item_label: itemLabelParam } : {}),
        ...(selected?.type === 'meeting_room' ? { nb_participants: Number(nbParticipants) } : {}),
        ...(clientType === 'entreprise' ? { entreprise_info: { ...entrepriseInfo, telephone_pro: normalizeTunisianPhone(entrepriseInfo.telephone_pro) } } : {}),
      });
      if (res.error) { setError(res.error); return; }
      setResult(res);
      setStep(3);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const coworkingImg = (c) => c?.cover_url || c?.logo_url || FALLBACK_IMG;
  const coworkingPlace = (c) => [c?.adresse, c?.ville, c?.pays].filter(Boolean).join(', ');

  if (step === 3 && result) {
    const isPending = result.statut !== 'confirmed';

    return (
      <div className="min-h-screen bg-[#f4f5f7] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_25px_60px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-200 bg-gradient-to-br from-[#f8fafc] to-[#eef2f7] px-6 py-8 text-center sm:px-8">
              <div className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border-4 shadow-inner ${isPending ? 'border-[#fdf0d5] bg-[#fff8e8] text-[#d98a00]' : 'border-[#dff7ef] bg-[#ebfaf4] text-[#18a873]'}`}>
                <span className="material-symbols-outlined" style={{ fontSize: 42 }}>{isPending ? 'hourglass_top' : 'check'}</span>
              </div>

              <h1 className="font-sora text-3xl font-bold tracking-[-0.04em] text-slate-900 sm:text-4xl">
                {isPending ? 'Réservation en attente' : 'Réservation confirmée'}
              </h1>

              <p className="mt-4 text-base leading-7 text-slate-600">
                {isPending
                  ? "Votre demande a été transmise à l'établissement, qui doit la valider."
                  : 'Votre créneau est réservé.'}{' '}
                Un e-mail de suivi sera envoyé à{' '}
                <span className="font-semibold text-slate-800">{form.email}</span>.
              </p>
            </div>

            <div className="px-6 py-6 sm:px-8">
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="note">
                <span className="material-symbols-outlined shrink-0" style={{ fontSize: 22 }}>payments</span>
                <p className="leading-6">
                  <strong>Règlement à effectuer sur place</strong> (espèces, chèque ou virement) lors de votre arrivée.
                  Un reçu numéroté vous sera remis après l'encaissement.
                </p>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#fff2e9] text-[#f97316]">
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>location_on</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Établissement</p>
                    <p className="text-lg font-bold text-slate-900">{coworking?.nom || 'Établissement'}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Espace</p>
                    <p className="mt-1 text-base font-semibold text-slate-800">{selected?.nom || 'Espace sélectionné'}{itemLabelParam ? ` · Poste ${itemLabelParam}` : ''}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Date</p>
                    <p className="mt-1 text-base font-semibold text-slate-800">{formatDateTunis(tunisLocalToISO(dates.debut))}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Horaire (heure de Tunis)</p>
                    <p className="mt-1 text-base font-semibold text-slate-800">
                      {formatTimeTunis(tunisLocalToISO(dates.debut))} → {formatTimeTunis(tunisLocalToISO(dates.fin))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Statut</p>
                    <p className="mt-1 text-base font-semibold text-slate-800">{isPending ? 'En attente' : 'Confirmée'}</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => navigate('/register')}
                  className="flex-1 rounded-2xl bg-[#ff6a2b] px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(255,106,43,0.28)] transition hover:-translate-y-0.5 hover:bg-[#f55d1f]"
                >
                  Créer mon compte membre
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Retour à l'accueil
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f5f7] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Réservation rapide</p>
          <h1 className="mt-2 font-sora text-3xl font-bold tracking-[-0.04em] text-slate-900 sm:text-4xl">
            Réserver un espace
          </h1>
          <p className="mt-3 text-sm text-slate-600">Aucun compte requis — vous réservez en quelques clics.</p>
        </div>

        <div className="mb-8 flex items-center justify-center gap-3">
          {[1, 2].map((s) => (
            <React.Fragment key={s}>
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-all ${
                  step >= s ? 'bg-[#ff6a2b] text-white shadow-[0_8px_20px_rgba(255,106,43,0.25)]' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {s}
              </div>
              {s < 2 && (
                <div className={`h-1 w-16 rounded-full ${step > s ? 'bg-[#ff6a2b]' : 'bg-slate-200'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <div className="mx-auto mb-6 max-w-3xl rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
              {error}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
              {!coworking && (
                <>
                  <h2 className="font-sora text-xl font-bold text-slate-900">Choisissez un établissement</h2>
                  <p className="mt-2 text-sm text-slate-600">Sélectionnez un établissement pour démarrer votre réservation.</p>

                  {coworkings.length === 0 ? (
                    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                      {listLoaded
                        ? (error ? 'Impossible de charger la liste des établissements. Réessayez dans un instant.' : 'Aucun établissement disponible pour le moment.')
                        : 'Chargement des établissements…'}
                    </div>
                  ) : (
                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                      {coworkings.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => selectCoworking(c)}
                          className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-[#ff6a2b]/40 hover:shadow-md"
                        >
                          <img src={coworkingImg(c)} alt={c.nom} loading="lazy" decoding="async" className="h-28 w-full object-cover" />
                          <div className="p-4">
                            <p className="font-bold text-slate-900">{c.nom}</p>
                            <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>location_on</span>
                              {coworkingPlace(c) || c.pays || 'Tunisie'}
                            </p>
                            <p className="mt-2 text-xs font-medium text-slate-500">
                              {c.space_count ?? 0} espace(s)
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {coworking && (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-sora text-xl font-bold text-slate-900">{coworking.nom}</h2>
                      <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>location_on</span>
                        {coworkingPlace(coworking) || 'Tunisie'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={resetCoworking}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Changer
                    </button>
                  </div>

                  <img src={coworkingImg(coworking)} alt={coworking.nom} loading="lazy" decoding="async" className="h-44 w-full rounded-2xl object-cover" />

                  <div>
                    <h3 className="font-sora text-lg font-bold text-slate-900">Choisissez votre espace</h3>
                    {espaces.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                        Aucun espace disponible dans cet établissement.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {espaces.map((esp) => (
                          <button
                            key={esp.id}
                            onClick={() => { setSelected(esp); setNbParticipants(''); }}
                            className={`rounded-2xl border p-4 text-left transition ${
                              selected?.id === esp.id
                                ? 'border-[#ff6a2b] bg-[#fff4ef] ring-2 ring-[#ff6a2b]/15'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <p className="font-bold text-slate-900">{esp.nom}</p>
                            <p className="mt-1 text-xs text-slate-500">{SPACE_LABELS[esp.type] || esp.type}{esp.capacite ? ` · ${esp.capacite} pers.` : ''}</p>
                            {esp.tarif_horaire && (
                              <p className="mt-2 text-sm font-bold text-[#ff6a2b]">{formatDT(esp.tarif_horaire)} / h</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selected && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          Début du créneau (heure de Tunis)
                        </label>
                        <input
                          type="datetime-local"
                          value={dates.debut}
                          onChange={(e) => setDates((d) => ({ ...d, debut: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#ff6a2b] focus:ring-2 focus:ring-[#ff6a2b]/10"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          Fin du créneau (heure de Tunis)
                        </label>
                        <input
                          type="datetime-local"
                          value={dates.fin}
                          onChange={(e) => setDates((d) => ({ ...d, fin: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#ff6a2b] focus:ring-2 focus:ring-[#ff6a2b]/10"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => { setError(''); setStep(2); }}
                    disabled={!coworking || !selected || !dates.debut || !dates.fin}
                    className="w-full rounded-2xl bg-[#ff6a2b] px-4 py-3.5 text-sm font-bold text-white shadow-[0_12px_25px_rgba(255,106,43,0.28)] transition hover:bg-[#f55d1f] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Continuer
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
              <h3 className="font-sora text-lg font-bold text-slate-900">Résumé</h3>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff2e9] text-[#f97316]">
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>hotel</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{coworking?.nom || 'Sélectionnez un établissement'}</p>
                    <p className="text-xs text-slate-500">{selected?.nom || 'Aucun espace sélectionné'}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-3 text-sm text-slate-600">
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-medium">Date</span>
                    <span className="text-right text-slate-800">
                      {dates.debut ? new Date(dates.debut).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-medium">Horaire</span>
                    <span className="text-right text-slate-800">
                      {dates.debut && dates.fin ? `${new Date(dates.debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} → ${new Date(dates.fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mx-auto max-w-3xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_45px_rgba(15,23,42,0.04)] sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Étape 2</p>
                <h2 className="font-sora text-2xl font-bold text-slate-900">Vos coordonnées</h2>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Modifier
              </button>
            </div>

            <div className="mb-6 rounded-2xl border border-[#ffefe8] bg-[#fffaf7] p-4">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#ff6a2b]" style={{ fontSize: 22 }}>location_on</span>
                <div className="flex-1">
                  <p className="font-bold text-slate-900">{selected?.nom}{itemLabelParam ? ` · Poste ${itemLabelParam}` : ''}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {coworking?.nom} · {new Date(dates.debut).toLocaleDateString('fr-FR')} · {new Date(dates.debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} → {new Date(dates.fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>

            {/* Type de client : Particulier vs Entreprise */}
            <div className="mb-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Type de réservation</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'particulier', label: 'Particulier', icon: 'person' },
                  { id: 'entreprise', label: 'Entreprise', icon: 'business_center' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setClientType(opt.id)}
                    className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                      clientType === opt.id
                        ? 'border-[#ff6a2b] bg-[#fff4ef] text-[#ff6a2b]'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'
                    }`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {[
                { key: 'prenom', label: 'Prénom *' },
                { key: 'nom', label: 'Nom *' },
                { key: 'email', label: 'Email *', type: 'email' },
                { key: 'telephone', label: 'Téléphone *', type: 'tel' },
              ].map(({ key, label, type = 'text' }) => (
                <div key={key} className="sm:col-span-1">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</label>
                  {key === 'telephone' ? (
                    <TunisianPhoneInput
                      required
                      value={form.telephone}
                      onChange={(val) => setForm((f) => ({ ...f, telephone: val }))}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#ff6a2b] focus:ring-2 focus:ring-[#ff6a2b]/10"
                    />
                  ) : (
                    <input
                      type={type}
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#ff6a2b] focus:ring-2 focus:ring-[#ff6a2b]/10"
                    />
                  )}
                </div>
              ))}
            </div>

            {selected?.type === 'meeting_room' && (
              <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label htmlFor="guest-nb-participants" className="text-xs font-bold uppercase tracking-[0.1em] text-slate-700">
                    Nombre de participants *
                  </label>
                  <span className="text-xs font-bold text-[#ff6a2b]">
                    1 à {selected.capacite || 1} personne{(selected.capacite || 1) > 1 ? 's' : ''}
                  </span>
                </div>
                <input
                  id="guest-nb-participants"
                  type="number"
                  min={1}
                  max={selected.capacite || 1}
                  step={1}
                  required
                  value={nbParticipants}
                  onChange={(e) => setNbParticipants(e.target.value)}
                  placeholder={`Ex : 4 (capacité max ${selected.capacite || 1})`}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-[#ff6a2b]"
                />
              </div>
            )}

            {clientType === 'entreprise' && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-700">
                  Informations Entreprise obligatoires
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Raison sociale *</label>
                    <input
                      type="text"
                      value={entrepriseInfo.raison_sociale}
                      onChange={(e) => setEntrepriseInfo((p) => ({ ...p, raison_sociale: e.target.value }))}
                      placeholder="Ex: TechStart SARL"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-[#ff6a2b]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Personne de contact *</label>
                    <input
                      type="text"
                      value={entrepriseInfo.contact_nom}
                      onChange={(e) => setEntrepriseInfo((p) => ({ ...p, contact_nom: e.target.value }))}
                      placeholder="Nom & Prénom du référent"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-[#ff6a2b]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Téléphone professionnel *</label>
                    <TunisianPhoneInput
                      required
                      value={entrepriseInfo.telephone_pro}
                      onChange={(val) => setEntrepriseInfo((p) => ({ ...p, telephone_pro: val }))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-[#ff6a2b]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Email de facturation *</label>
                    <input
                      type="email"
                      value={entrepriseInfo.email_facturation}
                      onChange={(e) => setEntrepriseInfo((p) => ({ ...p, email_facturation: e.target.value }))}
                      placeholder="compta@entreprise.tn"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-[#ff6a2b]"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Objet du besoin / Description de la demande *</label>
                  <textarea
                    rows={3}
                    value={entrepriseInfo.besoin_description}
                    onChange={(e) => setEntrepriseInfo((p) => ({ ...p, besoin_description: e.target.value }))}
                    placeholder="Réunion client, séminaire d'équipe, besoins audiovisuels…"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-[#ff6a2b]"
                  />
                </div>
              </div>
            )}

            <p className="mt-5 text-sm text-slate-500">
              * La création de compte est optionnelle. Aucun paiement en ligne : le règlement s'effectue sur place (espèces, chèque ou virement) à votre arrivée.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                ← Retour
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 rounded-2xl bg-[#ff6a2b] px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(255,106,43,0.28)] transition hover:bg-[#f55d1f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Confirmation...' : 'Confirmer la réservation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}