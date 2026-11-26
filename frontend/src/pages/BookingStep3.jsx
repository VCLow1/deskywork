// pages/BookingStep3.jsx — Récapitulatif final, vérification temps réel continue & confirmation (100 % sur place)
import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { useTheme } from '../context/ThemeContext';
import { bookingApi, paymentApi, memberApi } from '../services/api';
import { getBookerNav } from '../utils/roles';
import { formatDT, tunisLocalToISO } from '../utils/format';
import { spaceTypeLabel } from '../constants/spaceTypes';
import { playNotificationSound } from '../utils/notificationSound';
import BookingShell from '../components/booking/BookingShell';

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
  const navigate = useNavigate();
  const [nav] = useState(() => getBookerNav(metadata.role || 'member'));

  const [space, setSpace] = useState(null);
  const [coworking, setCoworking] = useState(null);
  const [durationHours, setDurationHours] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);
  const [paymentMode] = useState('sur_place'); // CDC v3.0 D1 : 100 % sur place
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
  const [errorMsg, setErrorMsg] = useState('');
  const [occupancy, setOccupancy] = useState(null);
  const [liveStatus, setLiveStatus] = useState({ checking: true, available: true, message: '' });

  useEffect(() => {
    if (!espaceId || !date || !start || !end) {
      navigate('/book/step1');
      return;
    }

    let active = true;
    (async () => {
      const { data: sp } = await supabase.from('espaces').select('*').eq('id', espaceId).single();
      if (!active || !sp) return;
      setSpace(sp);
      if (sp.tenant_id) {
        const { data: tn } = await supabase
          .from('tenants')
          .select('id, nom, slug, ville, adresse, telephone, cover_url, logo_url')
          .eq('id', sp.tenant_id)
          .maybeSingle();
        if (active && tn) setCoworking(tn);
      }
    })();

    const startDateTime = new Date(`${date}T${start}:00+01:00`);
    const endDateTime = new Date(`${date}T${end}:00+01:00`);
    const hours = (endDateTime - startDateTime) / 3600000;
    setDurationHours(hours > 0 ? Number(hours.toFixed(2)) : 1);

    memberApi
      .getMe()
      .then(async ({ profile: prof }) => {
        const isComp = prof?.type_membre === 'entreprise' || prof?.role === 'company' || prof?.role === 'entreprise';
        if (isComp && active) {
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
    };
  }, [espaceId, date, start, end, navigate]);

  useEffect(() => {
    if (space && durationHours > 0) {
      setTotalPrice(durationHours * Number(space.tarif_horaire || 0));
    }
  }, [space, durationHours]);

  // Vérification temps réel continue (montage + toutes les 15 s + Realtime)
  const checkLiveSlot = useCallback(async () => {
    if (!espaceId || !date || !start || !end || submittedBooking) return;
    const startDateTime = tunisLocalToISO(`${date}T${start}`);
    const endDateTime = tunisLocalToISO(`${date}T${end}`);
    try {
      const result = await bookingApi.checkAvailability({
        espace_id: espaceId,
        date_debut: startDateTime,
        date_fin: endDateTime,
        ...(itemId ? { floor_plan_item_id: itemId } : {}),
      });
      if (result.shared) {
        setOccupancy({
          remaining: result.remaining ?? 0,
          capacity: result.capacity ?? space?.capacite ?? 0,
          occupied: result.overlapsCount ?? 0,
        });
      }
      setLiveStatus({
        checking: false,
        available: Boolean(result.isAvailable),
        message: result.isAvailable
          ? 'Créneau vérifié disponible en temps réel.'
          : result.message || 'Attention : ce créneau vient d’être réservé.',
      });
    } catch {
      setLiveStatus((prev) => ({ ...prev, checking: false }));
    }
  }, [espaceId, date, start, end, itemId, space?.capacite, submittedBooking]);

  useEffect(() => {
    if (!space) return undefined;
    checkLiveSlot();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        checkLiveSlot();
      }
    }, 15000);

    let channel = null;
    if (space.tenant_id) {
      channel = supabase
        .channel(`step3-live-${space.tenant_id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'reservations', filter: `tenant_id=eq.${space.tenant_id}` },
          () => checkLiveSlot()
        )
        .subscribe();
    }

    return () => {
      clearInterval(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [space, checkLiveSlot]);

  const handleConfirmBooking = async () => {
    setErrorMsg('');
    if (isEntreprise) {
      const { raison_sociale, matricule_fiscal, contact_nom, telephone_pro, email_facturation, besoin_description } = entrepriseInfo;
      if (!raison_sociale?.trim() || !matricule_fiscal?.trim() || !contact_nom?.trim() || !telephone_pro?.trim() || !email_facturation?.trim() || !besoin_description?.trim()) {
        setErrorMsg(
          'Pour une réservation Entreprise, veuillez renseigner la raison sociale, le matricule fiscal, la personne de contact, le téléphone professionnel, l’e-mail de facturation et l’objet du besoin.'
        );
        return;
      }
    }
    setProcessing(true);
    const startDateTime = tunisLocalToISO(`${date}T${start}`);
    const endDateTime = tunisLocalToISO(`${date}T${end}`);

    try {
      const availability = await bookingApi.checkAvailability({
        espace_id: espaceId,
        date_debut: startDateTime,
        date_fin: endDateTime,
        ...(itemId ? { floor_plan_item_id: itemId } : {}),
      });

      if (!availability.isAvailable) {
        setLiveStatus({
          checking: false,
          available: false,
          message: availability.message || 'Ce créneau n’est plus disponible.',
        });
        throw new Error(availability.message || "Ce créneau n'est plus disponible. Veuillez en choisir un autre.");
      }

      const res = await bookingApi.create({
        espace_id: espaceId,
        date_debut: startDateTime,
        date_fin: endDateTime,
        mode: 'on_site',
        client_type: isEntreprise ? 'entreprise' : 'particulier',
        ...(itemId ? { floor_plan_item_id: itemId } : {}),
        ...(itemLabel ? { floor_plan_item_label: itemLabel } : {}),
        ...(isEntreprise ? { entreprise_info: entrepriseInfo } : {}),
      });

      const newBooking = res.reservation;

      if (!res.payment) {
        try {
          await paymentApi.createSelf({
            reservation_id: newBooking.id,
            montant: totalPrice,
            mode: paymentMode,
            statut: 'pending',
          });
        } catch (payErr) {
          console.warn('Création du paiement préventive:', payErr.message);
        }
      }

      try {
        playNotificationSound('booking_confirmed');
      } catch (_) {}

      setSubmittedBooking(newBooking);
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
      <BookingShell activeStep={3} nav={nav} backTo="/book/step1" backLabel="Retour">
        <div className="flex items-center justify-center py-24">
          <div className="w-12 h-12 rounded-full border-4 border-[#f95d00] border-t-transparent animate-spin" />
        </div>
      </BookingShell>
    );
  }

  // Écran de succès après soumission
  if (submittedBooking) {
    return (
      <BookingShell activeStep={4} nav={nav} backTo={nav.home} backLabel="Tableau de bord" subtitle={coworking?.nom || space.nom}>
        <div className="max-w-xl mx-auto animate-fadeIn">
          <div
            className="rounded-3xl p-7 sm:p-10 text-center shadow-2xl"
            style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{
                backgroundColor: dark ? 'rgba(16,185,129,0.18)' : '#ecfdf5',
                border: '2px solid rgba(16,185,129,0.45)',
                color: '#10b981',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 34 }}>check_circle</span>
            </div>

            <span
              className="inline-block px-3.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wide mb-3"
              style={{ backgroundColor: dark ? 'rgba(245,158,11,0.18)' : '#fef3c7', color: dark ? '#fcd34d' : '#b45309' }}
            >
              Demande enregistrée · En attente de validation accueil
            </span>

            <h1 className="font-sora font-extrabold text-2xl sm:text-3xl mb-2" style={{ color: textMain }}>
              Votre réservation est enregistrée !
            </h1>

            <p className="text-sm leading-relaxed mb-6" style={{ color: textMuted }}>
              Votre créneau pour <strong style={{ color: textMain }}>{space.nom}</strong>
              {coworking ? ` chez ${coworking.nom}` : ''} a bien été bloqué en temps réel.{' '}
              <strong style={{ color: textMain }}>Règlement à effectuer sur place lors de votre arrivée.</strong>
            </p>

            {/* Récapitulatif */}
            <div
              className="rounded-2xl p-5 mb-7 text-left text-xs sm:text-sm space-y-2.5"
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
                  {itemLabel ? ` · Poste ${itemLabel}` : ''}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span style={{ color: textMuted }}>Date :</span>
                <strong style={{ color: textMain }}>
                  {new Date(date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span style={{ color: textMuted }}>Créneau :</span>
                <strong style={{ color: textMain }}>
                  {start} → {end} ({durationHours} h)
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span style={{ color: textMuted }}>Paiement :</span>
                <strong className="text-[#f95d00]">Sur place (espèces, chèque ou virement)</strong>
              </div>
              <div className="flex justify-between items-center pt-3 mt-1" style={{ borderTop: `1px solid ${cardBorder}` }}>
                <span className="font-bold" style={{ color: textMain }}>Total à régler :</span>
                <strong className="font-sora text-lg text-[#f95d00]">{formatDT(totalPrice)}</strong>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to={nav.home}
                className="flex-1 py-3 px-5 rounded-2xl text-sm font-bold text-center"
                style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}`, textDecoration: 'none' }}
              >
                Tableau de bord
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

  const backToStep2 = `/book/step2?espaceId=${espaceId}${itemId ? `&itemId=${encodeURIComponent(itemId)}` : ''}${
    itemLabel ? `&itemLabel=${encodeURIComponent(itemLabel)}` : ''
  }`;

  return (
    <BookingShell
      activeStep={3}
      nav={nav}
      backTo={backToStep2}
      backLabel="Modifier horaire"
      subtitle={coworking?.nom || space.nom}
      onStepClick={(st) => {
        if (st === 1) navigate(space.tenant_id ? `/book/step1?tenantId=${space.tenant_id}` : '/book/step1');
        if (st === 2) navigate(backToStep2);
      }}
    >
      <div className="max-w-5xl mx-auto animate-fadeIn">
        <div className="mb-6">
          <h1 className="font-sora font-extrabold text-2xl sm:text-3xl m-0" style={{ color: textMain }}>
            Confirmation de réservation
          </h1>
          <p className="text-sm mt-1 mb-0" style={{ color: textMuted }}>
            Vérifiez les détails de votre créneau et confirmez votre réservation en temps réel.
          </p>
        </div>

        {/* Statut temps réel du créneau */}
        <div
          className="mb-6 px-4 py-3 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-bold"
          style={{
            backgroundColor: liveStatus.available
              ? (dark ? 'rgba(16,185,129,0.14)' : '#ecfdf5')
              : (dark ? 'rgba(239,68,68,0.14)' : '#fef2f2'),
            color: liveStatus.available ? (dark ? '#6ee7b7' : '#065f46') : (dark ? '#fca5a5' : '#991b1b'),
            border: `1px solid ${liveStatus.available ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${liveStatus.available ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span>{liveStatus.checking ? 'Vérification temps réel du créneau...' : liveStatus.message}</span>
          </div>
          {!liveStatus.available && (
            <Link to={backToStep2} className="underline font-extrabold" style={{ color: 'inherit' }}>
              Choisir un autre créneau →
            </Link>
          )}
        </div>

        {errorMsg && (
          <div
            className="mb-6 p-4 rounded-2xl text-xs sm:text-sm font-bold"
            style={{
              backgroundColor: dark ? 'rgba(239,68,68,0.15)' : '#fee2e2',
              color: dark ? '#fca5a5' : '#991b1b',
              border: '1px solid rgba(239,68,68,0.35)',
            }}
          >
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Colonne gauche : Détails, Entreprise & Règlement */}
          <div className="lg:col-span-7 space-y-6">
            {/* Carte Coworking + Espace */}
            <div
              className="rounded-3xl p-6 space-y-4"
              style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
            >
              <div className="flex items-center gap-4">
                <img
                  src={
                    space.photo_url ||
                    coworking?.cover_url ||
                    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop'
                  }
                  alt={space.nom}
                  className="w-20 h-20 rounded-2xl object-cover shrink-0 border border-black/10"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase"
                      style={{ backgroundColor: dark ? 'rgba(249,93,0,0.18)' : '#ffedd8', color: '#f95d00' }}
                    >
                      {spaceTypeLabel(space.type)}
                    </span>
                    {itemLabel && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                        Plan 2D · {itemLabel}
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

              <div className="rounded-2xl p-4 space-y-2.5 text-xs sm:text-sm" style={{ backgroundColor: subtleBg }}>
                <div className="flex justify-between">
                  <span style={{ color: textMuted }}>Date</span>
                  <strong style={{ color: textMain }}>
                    {new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: textMuted }}>Créneau horaire</span>
                  <strong style={{ color: textMain }}>
                    {start} → {end} ({durationHours} h)
                  </strong>
                </div>
                {itemLabel && (
                  <div className="flex justify-between">
                    <span style={{ color: textMuted }}>Poste / Emplacement 2D</span>
                    <strong className="text-[#f95d00]">{itemLabel}</strong>
                  </div>
                )}
                {occupancy && (
                  <div className="flex justify-between">
                    <span style={{ color: textMuted }}>Places restantes</span>
                    <strong className={occupancy.remaining > 0 ? 'text-emerald-500' : 'text-red-500'}>
                      {occupancy.remaining} / {occupancy.capacity}
                    </strong>
                  </div>
                )}
              </div>
            </div>

            {/* Option Entreprise (B2B) */}
            <div
              className="rounded-3xl p-6 space-y-4"
              style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
            >
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isEntreprise}
                  onChange={(e) => setIsEntreprise(e.target.checked)}
                  className="w-4 h-4 accent-[#f95d00]"
                />
                <div>
                  <span className="font-sora font-bold text-sm block" style={{ color: textMain }}>
                    Réservation professionnelle (Compte Entreprise)
                  </span>
                  <span className="text-xs" style={{ color: textMuted }}>
                    Cochez si vous souhaitez inclure vos informations fiscales de facturation B2B.
                  </span>
                </div>
              </label>

              {isEntreprise && (
                <div className="pt-3 grid gap-3" style={{ borderTop: `1px solid ${cardBorder}` }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold mb-1" style={{ color: textMuted }}>Raison sociale *</label>
                      <input
                        type="text"
                        value={entrepriseInfo.raison_sociale}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, raison_sociale: e.target.value }))}
                        placeholder="Ex: TechStart SARL"
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold mb-1" style={{ color: textMuted }}>Matricule fiscal / TVA *</label>
                      <input
                        type="text"
                        value={entrepriseInfo.matricule_fiscal}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, matricule_fiscal: e.target.value }))}
                        placeholder="Ex: 1234567/A/M/000"
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold mb-1" style={{ color: textMuted }}>Personne de contact *</label>
                      <input
                        type="text"
                        value={entrepriseInfo.contact_nom}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, contact_nom: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold mb-1" style={{ color: textMuted }}>Téléphone professionnel *</label>
                      <input
                        type="tel"
                        value={entrepriseInfo.telephone_pro}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, telephone_pro: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold mb-1" style={{ color: textMuted }}>Email de facturation *</label>
                      <input
                        type="email"
                        value={entrepriseInfo.email_facturation}
                        onChange={(e) => setEntrepriseInfo((p) => ({ ...p, email_facturation: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold mb-1" style={{ color: textMuted }}>Nb personnes</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={entrepriseInfo.nb_personnes}
                        onChange={(e) =>
                          setEntrepriseInfo((p) => ({ ...p, nb_personnes: Math.max(1, parseInt(e.target.value, 10) || 1) }))
                        }
                        className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                        style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold mb-1" style={{ color: textMuted }}>Objet du besoin / Description *</label>
                    <textarea
                      rows={2}
                      value={entrepriseInfo.besoin_description}
                      onChange={(e) => setEntrepriseInfo((p) => ({ ...p, besoin_description: e.target.value }))}
                      placeholder="Séminaire d'équipe, réunion client, journée collaborative…"
                      className="w-full px-3 py-2.5 rounded-xl text-xs sm:text-sm outline-none"
                      style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Colonne droite : Résumé tarifaire & Validation sticky */}
          <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-5">
            <div
              className="rounded-3xl p-6 space-y-5 shadow-xl"
              style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
            >
              <h3 className="font-sora font-extrabold text-lg m-0" style={{ color: textMain }}>
                Récapitulatif tarifaire
              </h3>

              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: textMuted }}>Tarif horaire</span>
                  <strong style={{ color: textMain }}>{formatDT(space.tarif_horaire)} / h</strong>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: textMuted }}>Durée sélectionnée</span>
                  <strong style={{ color: textMain }}>{durationHours} h</strong>
                </div>
                <div className="flex justify-between pt-3" style={{ borderTop: `1px solid ${cardBorder}` }}>
                  <span className="font-sora font-bold text-base" style={{ color: textMain }}>Total à régler</span>
                  <span className="font-sora font-extrabold text-2xl text-[#f95d00]">{formatDT(totalPrice)}</span>
                </div>
              </div>

              {/* Notice règlement sur place uniquement */}
              <div
                className="p-4 rounded-2xl text-xs leading-relaxed"
                style={{
                  backgroundColor: dark ? 'rgba(245,158,11,0.12)' : '#fffbeb',
                  border: '1px solid rgba(245,158,11,0.35)',
                  color: dark ? '#fde68a' : '#78350f',
                }}
              >
                <div className="flex items-center gap-2 font-extrabold mb-1">
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>payments</span>
                  <span>Règlement 100 % sur place uniquement</span>
                </div>
                Aucun paiement en ligne n&apos;est demandé. Vous réglez directement à l&apos;accueil (espèces, chèque ou virement) avec remise de reçu PDF.
              </div>

              <button
                type="button"
                onClick={handleConfirmBooking}
                disabled={processing || !liveStatus.available}
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
                  : `Confirmer la réservation (${formatDT(totalPrice)})`}
              </button>

              <Link
                to={backToStep2}
                className="block text-center text-xs font-bold py-2"
                style={{ color: textMuted, textDecoration: 'none' }}
              >
                ← Modifier la date ou l&apos;horaire
              </Link>
            </div>
          </div>
        </div>
      </div>
    </BookingShell>
  );
}
