// pages/BookingStep3.jsx — Étape 3 : Verrou 5 min, options, promo, HT/TVA/TTC, RG-46 & succès QR + .ics
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { useTheme } from '../context/ThemeContext';
import { bookingApi, memberApi } from '../services/api';
import { getBookerNav } from '../utils/roles';
import {
  formatDateDMY,
  formatPriceOrFree,
  tunisLocalToISO,
  buildCancellationPolicyMessage,
  downloadBookingIcs,
} from '../utils/format';
import { spaceTypeLabel } from '../constants/spaceTypes';
import { playNotificationSound } from '../utils/notificationSound';
import { validateTunisianPhone, normalizeTunisianPhone } from '../utils/tunisianPhone';
import Money from '../components/common/Money';
import TunisianPhoneInput from '../components/common/TunisianPhoneInput';
import BookingShell from '../components/booking/BookingShell';
import { QRCodeSVG } from 'qrcode.react';

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

export default function BookingStep3({ session }) {
  const { metadata } = useSessionUser(session);
  const { dark } = useTheme();
  const [searchParams] = useSearchParams();
  const espaceId = searchParams.get('espaceId');
  const date = searchParams.get('date');
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const itemId = searchParams.get('itemId') || '';
  const itemLabel = searchParams.get('itemLabel') || '';
  const initialUniteId = searchParams.get('uniteId') || '';
  const navigate = useNavigate();
  const [nav] = useState(() => getBookerNav(metadata.role || 'member'));

  const [space, setSpace] = useState(null);
  const [coworking, setCoworking] = useState(null);
  const [durationHours, setDurationHours] = useState(1);

  // Verrou temporaire 5 minutes (RM-08)
  const [holdId, setHoldId] = useState(null);
  const holdIdRef = useRef(null);
  holdIdRef.current = holdId;
  const [holdExpiresAt, setHoldExpiresAt] = useState(null);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState(300);
  const [holdError, setHoldError] = useState('');

  // Champs utilisateur / réservation
  const [contactPhone, setContactPhone] = useState('');
  const [nbParticipants, setNbParticipants] = useState('1');
  const [selectedUniteId, setSelectedUniteId] = useState(initialUniteId);
  const [spaceUnits, setSpaceUnits] = useState([]);
  const [availableServices, setAvailableServices] = useState([]);
  const [availableRessources, setAvailableRessources] = useState([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);
  const [selectedRessourceIds, setSelectedRessourceIds] = useState([]);

  // Code promo
  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState(null);
  const [promoError, setPromoError] = useState('');
  const [validatingPromo, setValidatingPromo] = useState(false);

  // Politique d'annulation (RG-46)
  const [cancellationPolicy, setCancellationPolicy] = useState(null);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);

  // Entreprise
  const [isEntreprise, setIsEntreprise] = useState(false);
  const [entrepriseInfo, setEntrepriseInfo] = useState({
    raison_sociale: '',
    matricule_fiscal: '',
    contact_nom: '',
    telephone_pro: '',
    email_facturation: '',
    nb_personnes: 1,
    besoin_description: '',
  });

  const [processing, setProcessing] = useState(false);
  const [submittedBooking, setSubmittedBooking] = useState(null);
  const [submittedPricing, setSubmittedPricing] = useState(null);
  const [memberQr, setMemberQr] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const releaseHoldQuietly = useCallback(() => {
    const idToRelease = holdIdRef.current;
    if (idToRelease) {
      bookingApi.releaseHold(idToRelease).catch(() => {});
      holdIdRef.current = null;
    }
  }, []);

  // Chargement initial : espace, coworking, profil (+216 prérempli), créneaux/options/politique
  useEffect(() => {
    if (!espaceId || !date || !start || !end) {
      navigate('/book/step1');
      return undefined;
    }

    let active = true;
    const startDateTime = new Date(`${date}T${start}:00+01:00`);
    const endDateTime = new Date(`${date}T${end}:00+01:00`);
    const hours = (endDateTime - startDateTime) / 3600000;
    setDurationHours(hours > 0 ? Number(hours.toFixed(2)) : 1);

    (async () => {
      const { data: sp } = await supabase.from('espaces').select('*').eq('id', espaceId).single();
      if (!active || !sp) return;
      setSpace(sp);

      if (sp.tenant_id) {
        const { data: tn } = await supabase
          .from('tenants')
          .select('id, nom, slug, ville, adresse, telephone, cover_url, logo_url, settings')
          .eq('id', sp.tenant_id)
          .maybeSingle();
        if (active && tn) setCoworking(tn);
      }

      try {
        const slotsRes = await bookingApi.checkSlots({ espace_id: espaceId, date });
        if (!active) return;
        setSpaceUnits(Array.isArray(slotsRes.units_status) ? slotsRes.units_status : []);
        setAvailableServices(Array.isArray(slotsRes.services) ? slotsRes.services : []);
        setAvailableRessources(Array.isArray(slotsRes.ressources) ? slotsRes.ressources : []);
        if (slotsRes.cancellation_policy) setCancellationPolicy(slotsRes.cancellation_policy);
      } catch (_) {}
    })();

    memberApi
      .getMe()
      .then(async ({ profile: prof }) => {
        if (!active || !prof) return;
        if (prof.telephone) setContactPhone(prof.telephone);
        const isComp = prof?.type_membre === 'entreprise' || prof?.role === 'company' || prof?.role === 'entreprise';
        if (isComp) {
          setIsEntreprise(true);
          let orgData = null;
          try {
            const { data: mems } = await supabase
              .from('memberships')
              .select('organizations(*)')
              .eq('user_id', prof.id)
              .maybeSingle();
            orgData = mems?.organizations;
          } catch (_) {}

          setEntrepriseInfo((prev) => ({
            ...prev,
            raison_sociale: prev.raison_sociale || orgData?.nom || prof.raison_sociale || '',
            matricule_fiscal: prev.matricule_fiscal || orgData?.matricule_fiscal || prof.matricule_fiscal || '',
            contact_nom: prev.contact_nom || `${prof.prenom || ''} ${prof.nom || ''}`.trim(),
            telephone_pro: prev.telephone_pro || prof.telephone || orgData?.telephone || '',
            email_facturation: prev.email_facturation || prof.email || '',
            nb_personnes: prev.nb_personnes || 1,
          }));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      releaseHoldQuietly();
    };
  }, [espaceId, date, start, end, navigate, releaseHoldQuietly]);

  // Verrouillage automatique 5 min dès l'entrée sur l'étape 3 (RM-08)
  useEffect(() => {
    if (!space || submittedBooking) return undefined;
    let active = true;
    const startDateTime = tunisLocalToISO(`${date}T${start}`);
    const endDateTime = tunisLocalToISO(`${date}T${end}`);

    setHoldError('');
    bookingApi
      .createHold({
        espace_id: espaceId,
        unite_id: selectedUniteId || null,
        floor_plan_item_id: itemId || null,
        date_debut: startDateTime,
        date_fin: endDateTime,
        nb_participants: Number(nbParticipants) || 1,
      })
      .then((res) => {
        if (!active) return;
        setHoldId(res.hold_id);
        setHoldExpiresAt(res.expires_at);
        setHoldSecondsLeft(res.seconds_remaining || 300);
      })
      .catch((err) => {
        if (!active) return;
        setHoldError(err.message || 'Ce créneau n’est plus disponible.');
      });

    return () => {
      active = false;
    };
  }, [space?.id, espaceId, date, start, end, selectedUniteId, itemId, submittedBooking]);

  // Décompte visuel du verrou temporaire 5 min
  useEffect(() => {
    if (!holdExpiresAt || submittedBooking) return undefined;
    const expMs = new Date(holdExpiresAt).getTime();
    const tick = () => {
      const diff = Math.max(0, Math.floor((expMs - Date.now()) / 1000));
      setHoldSecondsLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt, submittedBooking]);

  const holdExpired = Boolean(holdExpiresAt && holdSecondsLeft <= 0);
  const holdCountdownLabel = `${String(Math.floor(holdSecondsLeft / 60)).padStart(2, '0')}:${String(holdSecondsLeft % 60).padStart(2, '0')}`;

  // Calcul HT / Services / Promo / TVA / TTC en direct
  const pricingSummary = useMemo(() => {
    const tvaPct = Number(space?.tva_pct ?? coworking?.settings?.tva_defaut_pct ?? 19);
    const ttcRate = Number(space?.tarif_horaire || 0);
    const htRate =
      space?.tarif_horaire_ht != null
        ? Number(space.tarif_horaire_ht)
        : round3(ttcRate / (1 + tvaPct / 100));

    const spaceHT = round3(htRate * Math.max(0.25, durationHours));

    const pickedServices = availableServices.filter((s) => selectedServiceIds.includes(s.id || s.nom));
    const pickedRessources = availableRessources.filter((r) => selectedRessourceIds.includes(r.id || r.nom));
    const extrasHT = round3(
      [...pickedServices, ...pickedRessources].reduce(
        (acc, item) => acc + Number(item.prix_ht ?? item.tarif_ht ?? item.prix ?? 0),
        0
      )
    );

    const subtotalHT = round3(spaceHT + extrasHT);
    let discountHT = 0;
    if (promoApplied) {
      discountHT =
        promoApplied.type_reduction === 'percent'
          ? round3((subtotalHT * Number(promoApplied.valeur || 0)) / 100)
          : Math.min(subtotalHT, round3(promoApplied.valeur || 0));
    }
    const totalHT = round3(Math.max(0, subtotalHT - discountHT));
    const totalTVA = round3(totalHT * (tvaPct / 100));
    const totalTTC = round3(totalHT + totalTVA);

    return {
      htRate,
      tvaPct,
      spaceHT,
      extrasHT,
      subtotalHT,
      discountHT,
      totalHT,
      totalTVA,
      totalTTC,
      pickedServices,
      pickedRessources,
    };
  }, [space, coworking, durationHours, availableServices, availableRessources, selectedServiceIds, selectedRessourceIds, promoApplied]);

  const handleApplyPromo = async () => {
    if (!promoInput.trim()) return;
    setValidatingPromo(true);
    setPromoError('');
    try {
      const res = await bookingApi.validatePromo({
        code: promoInput.trim().toUpperCase(),
        tenant_id: space?.tenant_id,
        montant_ht: pricingSummary.subtotalHT,
      });
      setPromoApplied(res);
    } catch (e) {
      setPromoApplied(null);
      setPromoError(e.message || 'Code promo invalide ou expiré.');
    } finally {
      setValidatingPromo(false);
    }
  };

  const policyMessage = useMemo(() => {
    if (cancellationPolicy?.message_membre) return cancellationPolicy.message_membre;
    return buildCancellationPolicyMessage(cancellationPolicy || {});
  }, [cancellationPolicy]);

  const selectedUnitObj = useMemo(
    () => spaceUnits.find((u) => u.id === selectedUniteId) || null,
    [spaceUnits, selectedUniteId]
  );

  const handleConfirmBooking = async () => {
    setErrorMsg('');
    if (holdExpired || holdError) {
      setErrorMsg('Le verrou temporaire de 5 minutes a expiré ou le créneau est indisponible. Veuillez choisir à nouveau un horaire.');
      return;
    }
    if (!acceptedPolicy) {
      setErrorMsg("Vous devez accepter la politique d'annulation de l'établissement avant de confirmer.");
      return;
    }

    const phoneCheck = validateTunisianPhone(contactPhone);
    if (!phoneCheck.valid) {
      setErrorMsg(phoneCheck.error || 'Veuillez saisir un numéro tunisien valide (+216 suivi de 8 chiffres).');
      return;
    }

    if (space?.type === 'meeting_room') {
      const cap = Math.max(1, Number(space.capacite || 1));
      const n = Number(nbParticipants);
      if (!nbParticipants || !Number.isInteger(n) || n < 1 || n > cap) {
        setErrorMsg(`Veuillez indiquer un nombre de participants entre 1 et ${cap} pour cette salle de réunion.`);
        return;
      }
    }

    if (isEntreprise) {
      const { raison_sociale, matricule_fiscal, contact_nom, telephone_pro, email_facturation, besoin_description } = entrepriseInfo;
      if (!raison_sociale?.trim() || !matricule_fiscal?.trim() || !contact_nom?.trim() || !telephone_pro?.trim() || !email_facturation?.trim() || !besoin_description?.trim()) {
        setErrorMsg(
          'Pour une réservation Entreprise, renseignez raison sociale, matricule fiscal, contact, téléphone professionnel, e-mail de facturation et objet du besoin.'
        );
        return;
      }
    }

    setProcessing(true);
    const startDateTime = tunisLocalToISO(`${date}T${start}`);
    const endDateTime = tunisLocalToISO(`${date}T${end}`);
    const effUnitLabel = itemLabel || selectedUnitObj?.code || selectedUnitObj?.nom || '';

    try {
      const res = await bookingApi.create({
        espace_id: espaceId,
        unite_id: selectedUniteId || null,
        hold_id: holdId || null,
        date_debut: startDateTime,
        date_fin: endDateTime,
        mode: 'on_site',
        source: 'en_ligne',
        telephone_contact: normalizeTunisianPhone(contactPhone),
        nb_participants: Math.max(1, Number(nbParticipants) || 1),
        services_additionnels: pricingSummary.pickedServices.map((s) => ({
          id: s.id || s.nom,
          nom: s.nom,
          prix_ht: Number(s.prix_ht ?? s.tarif_ht ?? s.prix ?? 0),
          quantite: 1,
        })),
        ressources: pricingSummary.pickedRessources.map((r) => ({
          id: r.id || r.nom,
          nom: r.nom,
          prix_ht: Number(r.prix_ht ?? r.tarif_ht ?? r.prix ?? 0),
        })),
        promo_code: promoApplied?.code || null,
        client_type: isEntreprise ? 'entreprise' : 'particulier',
        ...(itemId || selectedUnitObj?.floor_plan_item_id ? { floor_plan_item_id: itemId || selectedUnitObj?.floor_plan_item_id } : {}),
        ...(effUnitLabel ? { floor_plan_item_label: effUnitLabel } : {}),
        ...(isEntreprise ? { entreprise_info: { ...entrepriseInfo, telephone_pro: normalizeTunisianPhone(entrepriseInfo.telephone_pro) } } : {}),
      });

      holdIdRef.current = null; // Hold déjà libéré par le serveur
      setSubmittedBooking(res.reservation);
      setSubmittedPricing(res.pricing || null);
      memberApi.getQr().then((q) => setMemberQr(q)).catch(() => {});

      try {
        playNotificationSound('booking_confirmed');
      } catch (_) {}

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErrorMsg(e.message || 'Échec de la réservation.');
    } finally {
      setProcessing(false);
    }
  };

  const cardBg = dark ? '#181715' : '#ffffff';
  const cardBorder = dark ? 'rgba(255,255,255,0.09)' : 'rgba(16,15,13,0.08)';
  const subtleBg = dark ? '#1f1d1a' : '#f8f6f2';
  const textMain = dark ? '#fbffff' : '#100f0d';
  const textMuted = dark ? '#cfcac3' : '#5e5a55';

  if (!space) {
    return (
      <BookingShell activeStep={3} nav={nav} onExit={releaseHoldQuietly}>
        <div className="flex items-center justify-center py-24">
          <div className="w-12 h-12 rounded-full border-4 border-[#f95d00] border-t-transparent animate-spin" />
        </div>
      </BookingShell>
    );
  }

  // Écran de succès : QR code d'accès dynamique + bouton .ics (ZÉRO téléchargement automatique de reçu)
  if (submittedBooking) {
    const finalTotalTTC = submittedPricing?.montant_ttc ?? pricingSummary.totalTTC;
    const effUnitLabel = itemLabel || selectedUnitObj?.code || selectedUnitObj?.nom || '';
    const isAutoConfirmed = submittedBooking.statut === 'confirmed';

    return (
      <BookingShell activeStep={4} nav={nav} subtitle={coworking?.nom || space.nom}>
        <div className="max-w-xl mx-auto animate-fadeIn">
          <div
            className="rounded-3xl p-7 sm:p-10 text-center shadow-2xl space-y-6"
            style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              style={{
                backgroundColor: dark ? 'rgba(16,185,129,0.18)' : '#ecfdf5',
                border: '2px solid rgba(16,185,129,0.45)',
                color: '#10b981',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 34 }}>check_circle</span>
            </div>

            <div>
              <span
                className="inline-block px-3.5 py-1 rounded-full text-xs font-extrabold uppercase tracking-wide mb-3"
                style={{
                  backgroundColor: isAutoConfirmed ? '#ecfdf5' : '#fef3c7',
                  color: isAutoConfirmed ? '#047857' : '#b45309',
                }}
              >
                {isAutoConfirmed ? 'Confirmée · Prête pour votre arrivée' : 'Enregistrée · En attente de confirmation'}
              </span>

              <h1 className="font-sora font-extrabold text-2xl sm:text-3xl mb-2" style={{ color: textMain }}>
                Votre réservation est enregistrée !
              </h1>
              <p className="text-sm leading-relaxed" style={{ color: textMuted }}>
                Votre créneau pour <strong style={{ color: textMain }}>{space.nom}</strong>
                {coworking ? ` chez ${coworking.nom}` : ''} a bien été enregistré.{' '}
                <strong style={{ color: textMain }}>Règlement sur place à votre arrivée.</strong>
              </p>
            </div>

            {/* QR Code d'accès dynamique (RM-36) */}
            {memberQr?.status !== 'blocked' && (memberQr?.payload || memberQr?.qr_token) && (
              <div className="rounded-2xl p-5 bg-[#100f0d] text-white inline-flex flex-col items-center gap-3 mx-auto">
                <span className="text-xs font-bold uppercase tracking-wider text-[#ffedd8]">
                  Votre code d&apos;accès à présenter à l&apos;accueil
                </span>
                <div className="bg-white p-3 rounded-xl">
                  <QRCodeSVG
                    value={memberQr.payload || memberQr.qr_token}
                    size={160}
                    bgColor="#ffffff"
                    fgColor="#100f0d"
                    level="M"
                    includeMargin={false}
                  />
                </div>
                {memberQr.short_code && (
                  <p className="text-xs font-bold tracking-widest text-[#a3a09b]">
                    Code de secours : <span className="text-white">{memberQr.short_code}</span>
                  </p>
                )}
              </div>
            )}

            {/* Récapitulatif */}
            <div
              className="rounded-2xl p-5 text-left text-xs sm:text-sm space-y-2"
              style={{ backgroundColor: subtleBg, border: `1px solid ${cardBorder}` }}
            >
              {coworking && (
                <div className="flex justify-between gap-2">
                  <span style={{ color: textMuted }}>Établissement :</span>
                  <strong style={{ color: textMain }}>{coworking.nom}</strong>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span style={{ color: textMuted }}>Espace :</span>
                <strong style={{ color: textMain }}>
                  {space.nom}
                  {effUnitLabel ? ` · ${effUnitLabel}` : ''}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span style={{ color: textMuted }}>Date :</span>
                <strong style={{ color: textMain }}>{formatDateDMY(date)}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span style={{ color: textMuted }}>Créneau :</span>
                <strong style={{ color: textMain }}>
                  {start} → {end} ({durationHours} h)
                </strong>
              </div>
              <div className="flex justify-between items-center pt-3 mt-1" style={{ borderTop: `1px solid ${cardBorder}` }}>
                <span className="font-bold" style={{ color: textMain }}>Total TTC à régler sur place :</span>
                <strong className="font-sora text-lg text-[#f95d00]">
                  <Money amount={finalTotalTTC} zeroLabel="Gratuit" />
                </strong>
              </div>
            </div>

            {/* Action .ics + Navigation */}
            <button
              type="button"
              onClick={() =>
                downloadBookingIcs({
                  id: submittedBooking.id,
                  spaceName: space.nom,
                  unitLabel: effUnitLabel,
                  coworkingName: coworking?.nom || 'DeskyWork',
                  address: [coworking?.adresse, coworking?.ville].filter(Boolean).join(', '),
                  dateDebut: tunisLocalToISO(`${date}T${start}`),
                  dateFin: tunisLocalToISO(`${date}T${end}`),
                  statusLabel: isAutoConfirmed ? 'Confirmée' : 'En attente',
                })
              }
              className="w-full py-3 px-5 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border cursor-pointer"
              style={{ backgroundColor: subtleBg, color: textMain, borderColor: cardBorder }}
            >
              <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 18 }}>event_available</span>
              Ajouter au calendrier (.ics)
            </button>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to={nav.home}
                className="flex-1 py-3 px-5 rounded-2xl text-sm font-bold text-center"
                style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}`, textDecoration: 'none' }}
              >
                Accueil
              </Link>
              <Link
                to={nav.bookings}
                className="flex-1 py-3 px-5 rounded-2xl text-sm font-extrabold text-center"
                style={{
                  backgroundColor: '#f95d00',
                  color: '#ffffff',
                  textDecoration: 'none',
                  boxShadow: '0 8px 20px rgba(249,93,0,0.3)',
                }}
              >
                Mes réservations →
              </Link>
            </div>
          </div>
        </div>
      </BookingShell>
    );
  }

  const backToStep2 = `/book/step2?espaceId=${espaceId}${selectedUniteId ? `&uniteId=${encodeURIComponent(selectedUniteId)}` : ''}${
    itemId ? `&itemId=${encodeURIComponent(itemId)}` : ''
  }${itemLabel ? `&itemLabel=${encodeURIComponent(itemLabel)}` : ''}`;

  return (
    <BookingShell
      activeStep={3}
      nav={nav}
      onExit={releaseHoldQuietly}
      subtitle={coworking?.nom || space.nom}
      onStepClick={(st) => {
        releaseHoldQuietly();
        if (st === 1) navigate('/book/step1?browse=1');
        if (st === 2) navigate(backToStep2);
      }}
    >
      <div className="max-w-5xl mx-auto animate-fadeIn">
        <div className="mb-5">
          <h1 className="font-sora font-extrabold text-2xl sm:text-3xl m-0" style={{ color: textMain }}>
            Confirmation de réservation
          </h1>
          <p className="text-sm mt-1 mb-0" style={{ color: textMuted }}>
            Complétez vos informations et acceptez les conditions avant validation finale.
          </p>
        </div>

        {/* Bannière verrou temporaire 5 minutes (RM-08) */}
        <div
          className="mb-6 px-4 py-3 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-bold"
          style={{
            backgroundColor: holdError || holdExpired ? '#fef2f2' : '#ecfdf5',
            color: holdError || holdExpired ? '#991b1b' : '#065f46',
            border: `1px solid ${holdError || holdExpired ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.35)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${holdError || holdExpired ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
            <span>
              {holdError
                ? holdError
                : holdExpired
                ? 'Le verrou temporaire de 5 minutes a expiré. Choisissez à nouveau votre créneau.'
                : `Créneau bloqué temporairement pour vous : ${holdCountdownLabel}`}
            </span>
          </div>
          {(holdError || holdExpired) && (
            <Link to={backToStep2} className="underline font-extrabold" style={{ color: 'inherit' }}>
              Modifier l&apos;horaire →
            </Link>
          )}
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-2xl text-xs sm:text-sm font-bold bg-red-50 border border-red-200 text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Colonne gauche */}
          <div className="lg:col-span-7 space-y-6">
            {/* Carte Coworking + Espace */}
            <div className="rounded-3xl p-6 space-y-4" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
              <div className="flex items-center gap-4">
                <img
                  src={space.photo_url || coworking?.cover_url || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop'}
                  alt={space.nom}
                  className="w-20 h-20 rounded-2xl object-cover shrink-0 border border-black/10"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase bg-[#ffedd8] text-[#f95d00]">
                      {spaceTypeLabel(space.type)}
                    </span>
                    {(itemLabel || selectedUnitObj) && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-500/15 text-emerald-700">
                        Unité · {itemLabel || selectedUnitObj?.code || selectedUnitObj?.nom}
                      </span>
                    )}
                  </div>
                  <h2 className="font-sora font-bold text-lg m-0 truncate" style={{ color: textMain }}>
                    {space.nom}
                  </h2>
                  {coworking && (
                    <p className="text-xs mt-0.5 mb-0" style={{ color: textMuted }}>
                      {coworking.nom}
                      {coworking.adresse || coworking.ville ? ` · ${[coworking.adresse, coworking.ville].filter(Boolean).join(', ')}` : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl p-4 space-y-2 text-xs sm:text-sm" style={{ backgroundColor: subtleBg }}>
                <div className="flex justify-between">
                  <span style={{ color: textMuted }}>Date</span>
                  <strong style={{ color: textMain }}>{formatDateDMY(date)}</strong>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: textMuted }}>Créneau horaire</span>
                  <strong style={{ color: textMain }}>{start} → {end} ({durationHours} h)</strong>
                </div>
              </div>
            </div>

            {/* Coordonnées & Participants & Unité */}
            <div className="rounded-3xl p-6 space-y-4" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
              <h3 className="font-sora font-bold text-base m-0" style={{ color: textMain }}>
                Détails de votre venue
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1" style={{ color: textMuted }}>
                    Téléphone de contact (+216) <span className="text-[#f95d00]">*</span>
                  </label>
                  <TunisianPhoneInput
                    value={contactPhone}
                    onChange={setContactPhone}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="booking-nb-participants" className="block text-xs font-bold mb-1" style={{ color: textMuted }}>
                    Nombre de participants {space?.type === 'meeting_room' ? <span className="text-[#f95d00]">*</span> : ''}
                  </label>
                  <input
                    id="booking-nb-participants"
                    type="number"
                    min={1}
                    max={Math.max(1, Number(space.capacite || 1))}
                    value={nbParticipants}
                    onChange={(e) => setNbParticipants(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold outline-none"
                    style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                  />
                  <span className="text-xs block mt-1" style={{ color: textMuted }}>
                    Capacité max : {space.capacite || 1} pers.
                  </span>
                </div>
              </div>

              {spaceUnits.length > 0 && !itemId && (
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: textMuted }}>
                    Poste / Unité souhaité(e)
                  </label>
                  <select
                    value={selectedUniteId}
                    onChange={(e) => setSelectedUniteId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold outline-none"
                    style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                  >
                    <option value="">Attribution automatique à l&apos;accueil</option>
                    {spaceUnits
                      .filter((u) => !u.statut || u.statut === 'disponible')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code || u.nom} ({u.capacite || 1} place{(u.capacite || 1) > 1 ? 's' : ''})
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            {/* Services & Ressources additionnels */}
            {(availableServices.length > 0 || availableRessources.length > 0) && (
              <div className="rounded-3xl p-6 space-y-4" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
                <h3 className="font-sora font-bold text-base m-0" style={{ color: textMain }}>
                  Services &amp; Ressources additionnels
                </h3>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {availableServices.map((srv) => {
                    const key = srv.id || srv.nom;
                    const checked = selectedServiceIds.includes(key);
                    const priceHT = Number(srv.prix_ht ?? srv.tarif_ht ?? srv.prix ?? 0);
                    return (
                      <label
                        key={key}
                        className="flex items-center justify-between gap-2 p-3 rounded-xl border cursor-pointer"
                        style={{
                          backgroundColor: checked ? '#ffedd8' : subtleBg,
                          borderColor: checked ? '#f95d00' : cardBorder,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedServiceIds((prev) =>
                                prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
                              )
                            }
                            className="accent-[#f95d00]"
                          />
                          <span className="text-xs font-bold" style={{ color: textMain }}>{srv.nom}</span>
                        </div>
                        <span className="text-xs font-extrabold text-[#f95d00]">
                          <Money amount={priceHT} zeroLabel="Inclus" />
                        </span>
                      </label>
                    );
                  })}
                  {availableRessources.map((res) => {
                    const key = res.id || res.nom;
                    const checked = selectedRessourceIds.includes(key);
                    const priceHT = Number(res.prix_ht ?? res.tarif_ht ?? res.prix ?? 0);
                    return (
                      <label
                        key={key}
                        className="flex items-center justify-between gap-2 p-3 rounded-xl border cursor-pointer"
                        style={{
                          backgroundColor: checked ? '#ffedd8' : subtleBg,
                          borderColor: checked ? '#f95d00' : cardBorder,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedRessourceIds((prev) =>
                                prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
                              )
                            }
                            className="accent-[#f95d00]"
                          />
                          <span className="text-xs font-bold" style={{ color: textMain }}>{res.nom}</span>
                        </div>
                        <span className="text-xs font-extrabold text-[#f95d00]">
                          <Money amount={priceHT} zeroLabel="Inclus" />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Profil Entreprise (B2B) */}
            <div className="rounded-3xl p-6 space-y-4" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isEntreprise}
                  onChange={(e) => setIsEntreprise(e.target.checked)}
                  className="w-4 h-4 accent-[#f95d00]"
                />
                <div>
                  <span className="font-sora font-bold text-sm block" style={{ color: textMain }}>
                    Facturation Entreprise (B2B)
                  </span>
                  <span className="text-xs" style={{ color: textMuted }}>
                    Cochez pour inclure votre raison sociale et matricule fiscal.
                  </span>
                </div>
              </label>

              {isEntreprise && (
                <div className="pt-3 grid gap-3" style={{ borderTop: `1px solid ${cardBorder}` }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold mb-1" style={{ color: textMuted }}>Raison sociale *</label>
                      <input
                        type="text"
                        value={entrepriseInfo.raison_sociale}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, raison_sociale: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1" style={{ color: textMuted }}>Matricule fiscal *</label>
                      <input
                        type="text"
                        value={entrepriseInfo.matricule_fiscal}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, matricule_fiscal: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold mb-1" style={{ color: textMuted }}>Contact *</label>
                      <input
                        type="text"
                        value={entrepriseInfo.contact_nom}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, contact_nom: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1" style={{ color: textMuted }}>Téléphone pro *</label>
                      <TunisianPhoneInput
                        value={entrepriseInfo.telephone_pro}
                        onChange={(val) => setEntrepriseInfo((p) => ({ ...p, telephone_pro: val }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold mb-1" style={{ color: textMuted }}>Email facturation *</label>
                      <input
                        type="email"
                        value={entrepriseInfo.email_facturation}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, email_facturation: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1" style={{ color: textMuted }}>Objet du besoin *</label>
                      <input
                        type="text"
                        value={entrepriseInfo.besoin_description}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, besoin_description: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Colonne droite : Promo + HT/TVA/TTC + Politique annulation RG-46 + Validation */}
          <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-5">
            <div className="rounded-3xl p-6 space-y-5 shadow-xl" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
              <h3 className="font-sora font-extrabold text-lg m-0" style={{ color: textMain }}>
                Récapitulatif HT / TVA / TTC
              </h3>

              {/* Code promo */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold" style={{ color: textMuted }}>Code promo</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    placeholder="Ex : BIENVENUE20"
                    className="flex-1 px-3 py-2 rounded-xl text-xs font-bold uppercase outline-none"
                    style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                  />
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    disabled={validatingPromo || !promoInput.trim()}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold text-white cursor-pointer disabled:opacity-45"
                    style={{ backgroundColor: '#100f0d' }}
                  >
                    {validatingPromo ? '…' : 'Appliquer'}
                  </button>
                </div>
                {promoError && <p className="text-xs font-semibold text-red-600 m-0">{promoError}</p>}
                {promoApplied && (
                  <p className="text-xs font-semibold text-emerald-700 m-0">
                    Code « {promoApplied.code} » appliqué (-<Money amount={pricingSummary.discountHT} /> HT)
                  </p>
                )}
              </div>

              {/* Ventilation HT / TVA / TTC */}
              <div className="space-y-2 text-xs sm:text-sm pt-2" style={{ borderTop: `1px solid ${cardBorder}` }}>
                <div className="flex justify-between">
                  <span style={{ color: textMuted }}>Espace ({durationHours} h)</span>
                  <strong style={{ color: textMain }}>
                    <Money amount={pricingSummary.spaceHT} taxType="HT" zeroLabel="Gratuit" />
                  </strong>
                </div>
                {pricingSummary.extrasHT > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: textMuted }}>Services &amp; ressources</span>
                    <strong style={{ color: textMain }}>
                      <Money amount={pricingSummary.extrasHT} taxType="HT" />
                    </strong>
                  </div>
                )}
                {pricingSummary.discountHT > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Remise promo</span>
                    <strong>-<Money amount={pricingSummary.discountHT} taxType="HT" /></strong>
                  </div>
                )}
                <div className="flex justify-between pt-2" style={{ borderTop: `1px dashed ${cardBorder}` }}>
                  <span style={{ color: textMuted }}>Total HT</span>
                  <strong style={{ color: textMain }}><Money amount={pricingSummary.totalHT} zeroLabel="Gratuit" /></strong>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: textMuted }}>TVA ({pricingSummary.tvaPct}%)</span>
                  <strong style={{ color: textMain }}><Money amount={pricingSummary.totalTVA} zeroLabel="Gratuit" /></strong>
                </div>
                <div className="flex justify-between items-center pt-3" style={{ borderTop: `1px solid ${cardBorder}` }}>
                  <span className="font-sora font-bold text-base" style={{ color: textMain }}>Total TTC à régler</span>
                  <span className="font-sora font-extrabold text-2xl text-[#f95d00]">
                    <Money amount={pricingSummary.totalTTC} zeroLabel="Gratuit" />
                  </span>
                </div>
              </div>

              {/* Politique d'annulation dynamique (RG-46) + case à cocher obligatoire */}
              <div className="p-4 rounded-2xl text-xs space-y-3" style={{ backgroundColor: subtleBg, border: `1px solid ${cardBorder}` }}>
                <div>
                  <p className="font-bold m-0 mb-1" style={{ color: textMain }}>
                    Politique d&apos;annulation
                  </p>
                  <p className="m-0 leading-relaxed" style={{ color: textMuted }}>
                    {policyMessage}
                  </p>
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={acceptedPolicy}
                    onChange={(e) => setAcceptedPolicy(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#f95d00]"
                  />
                  <span className="font-semibold" style={{ color: textMain }}>
                    J&apos;ai lu et j&apos;accepte la politique d&apos;annulation de l&apos;établissement.
                  </span>
                </label>
              </div>

              {/* Règlement sur place */}
              <div className="p-3.5 rounded-2xl text-xs bg-amber-50 border border-amber-200 text-amber-900">
                <strong>Règlement sur place uniquement</strong> (espèces, chèque, carte bancaire ou virement à l&apos;accueil).
              </div>

              <button
                type="button"
                onClick={handleConfirmBooking}
                disabled={processing || holdExpired || Boolean(holdError) || !acceptedPolicy}
                className="w-full py-3.5 px-5 rounded-2xl text-sm font-extrabold cursor-pointer transition-transform hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #f95d00 0%, #ff8234 100%)',
                  color: '#ffffff',
                  border: 'none',
                  boxShadow: '0 10px 24px rgba(249,93,0,0.32)',
                }}
              >
                {processing
                  ? 'Enregistrement en cours...'
                  : `Confirmer la réservation (${formatPriceOrFree(pricingSummary.totalTTC, { zeroLabel: 'Gratuit' })})`}
              </button>

              <Link
                to={backToStep2}
                onClick={releaseHoldQuietly}
                className="block text-center text-xs font-bold py-1.5"
                style={{ color: textMuted, textDecoration: 'none' }}
              >
                ← Modifier l&apos;horaire
              </Link>
            </div>
          </div>
        </div>
      </div>
    </BookingShell>
  );
}
