import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { bookingApi, paymentApi, memberApi } from '../services/api';
import BrandLogo from '../components/layout/BrandLogo';
import { getBookerNav } from '../utils/roles';
import { formatDT } from '../utils/format';
import { spaceTypeLabel } from '../constants/spaceTypes';

export default function BookingStep3({ session }) {
  const { metadata } = useSessionUser(session);
  const [searchParams] = useSearchParams();
  const espaceId = searchParams.get('espaceId');
  const date = searchParams.get('date');
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const navigate = useNavigate();
  // Initialisation synchrone depuis le JWT — 0 appel DB
  const [nav, setNav] = useState(() => getBookerNav(metadata.role || 'member'));

  const [space, setSpace] = useState(null);
  const [durationHours, setDurationHours] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);
  const [paymentMode] = useState('sur_place'); // CDC v3.0 D1 : 100 % sur place en v1
  const [isEntreprise, setIsEntreprise] = useState(false);
  const [entrepriseInfo, setEntrepriseInfo] = useState({
    raison_sociale: '',
    contact_nom: '',
    telephone_pro: '',
    email_facturation: '',
    besoin_description: '',
  });
  const [processing, setProcessing] = useState(false);
  const [submittedBooking, setSubmittedBooking] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [occupancy, setOccupancy] = useState(null);

  // nav déjà initialisé depuis le JWT, plus d'appel DB nécessaire

  useEffect(() => {
    if (!espaceId || !date || !start || !end) {
      navigate('/book/step1');
      return;
    }
    fetchSpace();
    calculatePrice();
    memberApi.getMe().then(({ profile: prof }) => {
      if (prof?.type_membre === 'entreprise') {
        setIsEntreprise(true);
        setEntrepriseInfo((prev) => ({
          ...prev,
          contact_nom: prev.contact_nom || `${prof.prenom || ''} ${prof.nom || ''}`.trim(),
          telephone_pro: prev.telephone_pro || prof.telephone || '',
          email_facturation: prev.email_facturation || prof.email || '',
        }));
      }
    }).catch(() => {});
  }, [espaceId, date, start, end]);

  const fetchSpace = async () => {
    const { data: sp } = await supabase
      .from('espaces')
      .select('*')
      .eq('id', espaceId)
      .single();
    if (sp) setSpace(sp);
  };

  const calculatePrice = () => {
    const startDateTime = new Date(`${date}T${start}:00`);
    const endDateTime = new Date(`${date}T${end}:00`);
    const hours = (endDateTime - startDateTime) / 3600000;
    setDurationHours(hours > 0 ? hours : 1);
  };

  useEffect(() => {
    if (space && durationHours > 0) {
      setTotalPrice(durationHours * space.tarif_horaire);
    }
  }, [space, durationHours]);

  useEffect(() => {
    if (!space || space.type !== 'open_space' || !date || !start || !end) return;
    const startDateTime = new Date(`${date}T${start}:00`).toISOString();
    const endDateTime = new Date(`${date}T${end}:00`).toISOString();
    bookingApi.checkAvailability({
      espace_id: espaceId,
      date_debut: startDateTime,
      date_fin: endDateTime,
    }).then((result) => {
      if (result.shared) {
        setOccupancy({
          remaining: result.remaining ?? 0,
          capacity: result.capacity ?? space.capacite ?? 0,
          occupied: result.overlapsCount ?? 0,
        });
      }
    }).catch(() => {});
  }, [space, date, start, end, espaceId]);

  const handleConfirmBooking = async () => {
    setErrorMsg('');
    if (isEntreprise) {
      const { raison_sociale, contact_nom, telephone_pro, email_facturation, besoin_description } = entrepriseInfo;
      if (!raison_sociale.trim() || !contact_nom.trim() || !telephone_pro.trim() || !email_facturation.trim() || !besoin_description.trim()) {
        setErrorMsg('Pour une réservation Entreprise, veuillez remplir la raison sociale, la personne de contact, le téléphone professionnel, l’e-mail de facturation et l’objet du besoin.');
        return;
      }
    }
    setProcessing(true);
    const startDateTime = new Date(`${date}T${start}:00`).toISOString();
    const endDateTime = new Date(`${date}T${end}:00`).toISOString();

    try {
      const availability = await bookingApi.checkAvailability({
        espace_id: espaceId,
        date_debut: startDateTime,
        date_fin: endDateTime,
      });

      if (!availability.isAvailable) {
        throw new Error(availability.message || 'Ce créneau n\'est plus disponible. Veuillez en choisir un autre.');
      }

      // Créer la réservation avec statut 'pending' et le mode choisi
      const res = await bookingApi.create({
        espace_id: espaceId,
        date_debut: startDateTime,
        date_fin: endDateTime,
        mode: 'on_site',
        client_type: isEntreprise ? 'entreprise' : 'particulier',
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

      // Afficher l'écran de confirmation
      setSubmittedBooking(newBooking);
    } catch (e) {
      setErrorMsg(e.message || 'Échec de la réservation.');
    } finally {
      setProcessing(false);
    }
  };

  if (!space) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F6F9' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '4px solid #f95d00', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // Écran de succès après soumission de la demande
  if (submittedBooking) {
    return (
      <div style={{ backgroundColor: '#F4F6F9', minHeight: '100vh', fontFamily: 'Inter, sans-serif', paddingBottom: '48px' }}>
        <nav style={{ position: 'fixed', top: 0, width: '100%', zIndex: 50, backgroundColor: '#ffffff', borderBottom: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', maxWidth: '1240px', margin: '0 auto' }}>
            <BrandLogo to={nav.home} />
            <Link 
              to={nav.bookings} 
              style={{ padding: '7px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: 600, backgroundColor: '#f95d00', color: '#ffffff', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Mes réservations
            </Link>
          </div>
        </nav>

        <main style={{ paddingTop: '88px', maxWidth: '580px', margin: '0 auto', paddingLeft: '16px', paddingRight: '16px' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: '24px', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 12px 36px rgba(0,0,0,0.06)', padding: 'clamp(18px, 4vw, 36px)', textAlign: 'center' }}>
            
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#fff7ed', border: '2px solid #fdba74', color: '#f95d00', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>hourglass_top</span>
            </div>

            <span style={{ display: 'inline-block', padding: '4px 14px', borderRadius: '99px', backgroundColor: '#fef3c7', color: '#b45309', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', marginBottom: '12px' }}>
              Demande envoyée · En attente d'approbation
            </span>

            <h1 style={{ fontFamily: 'Sora, sans-serif', fontSize: '22px', fontWeight: 700, color: '#100f0d', marginBottom: '12px' }}>
              Votre réservation a bien été enregistrée !
            </h1>

            <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.6, marginBottom: '24px' }}>
              Votre demande pour <strong>{space.nom}</strong> a bien été enregistrée. <strong>Règlement à effectuer sur place (espèces, chèque ou virement) lors de votre arrivée.</strong>
            </p>

            {/* Récapitulatif box */}
            <div style={{ backgroundColor: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '20px', marginBottom: '28px', textAlign: 'left', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>Espace :</span>
                <strong style={{ color: '#0f172a' }}>{space.nom}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>Date :</span>
                <strong style={{ color: '#0f172a' }}>{new Date(date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>Créneau :</span>
                <strong style={{ color: '#0f172a' }}>{start} → {end} ({durationHours}h)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>Mode de paiement :</span>
                <strong style={{ color: '#f95d00' }}>Sur place (espèces, chèque ou virement)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '10px', marginTop: '8px' }}>
                <span style={{ color: '#0f172a', fontWeight: 700 }}>Total :</span>
                <strong style={{ color: '#f95d00', fontSize: '16px' }}>{formatDT(totalPrice)}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <Link
                to={nav.home}
                style={{ flex: 1, padding: '12px 20px', borderRadius: '12px', border: '1px solid #cbd5e1', color: '#334155', fontWeight: 600, fontSize: '14px', textDecoration: 'none', backgroundColor: '#ffffff' }}
              >
                Tableau de bord
              </Link>
              <Link
                to={nav.bookings}
                style={{ flex: 1, padding: '12px 20px', borderRadius: '12px', backgroundColor: '#f95d00', color: '#ffffff', fontWeight: 700, fontSize: '14px', textDecoration: 'none', boxShadow: '0 4px 14px rgba(249,93,0,0.3)' }}
              >
                Mes réservations →
              </Link>
            </div>

          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#F4F6F9', minHeight: '100vh', fontFamily: 'Inter, sans-serif', paddingBottom: '48px' }}>
      
      {/* Top Header */}
      <nav style={{ position: 'fixed', top: 0, width: '100%', zIndex: 50, backgroundColor: '#ffffff', borderBottom: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', maxWidth: '1240px', margin: '0 auto' }}>
          <BrandLogo to={nav.home} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#f95d00', backgroundColor: '#ffedd8', padding: '5px 12px', borderRadius: '99px', whiteSpace: 'nowrap' }}>
              Étape 3 sur 3
            </span>
            <Link 
              to={`/book/step2?espaceId=${espaceId}`} 
              style={{ padding: '5px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: '1px solid #c5c6ce', color: '#100f0d', textDecoration: 'none', backgroundColor: '#fff', whiteSpace: 'nowrap' }}
            >
              Retour
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main style={{ paddingTop: '88px', maxWidth: '620px', margin: '0 auto', paddingLeft: '16px', paddingRight: '16px' }}>
        
        {/* Card Form */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '24px', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 8px 30px rgba(0,0,0,0.05)', padding: 'clamp(20px, 5vw, 32px)' }}>
          
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontFamily: 'Sora, sans-serif', fontSize: '24px', fontWeight: 700, color: '#100f0d', marginBottom: '6px' }}>
              Récapitulatif & Paiement
            </h1>
            <p style={{ fontSize: '14px', color: '#5a6a8a', margin: 0 }}>
              Choisissez comment vous souhaitez régler votre réservation.
            </p>
          </div>

          {errorMsg && (
            <div style={{ marginBottom: '20px', padding: '14px 18px', borderRadius: '12px', fontSize: '13px', fontWeight: 600, backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>
              {errorMsg}
            </div>
          )}

          {/* Details Box */}
          <div style={{ backgroundColor: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '20px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#100f0d' }}>{space.nom}</span>
              <span style={{ backgroundColor: '#ffedd8', color: '#f95d00', padding: '4px 12px', borderRadius: '99px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' }}>
                {spaceTypeLabel(space.type)}
              </span>
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#5a6a8a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Date</span>
                <strong style={{ color: '#000d23' }}>{new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Créneau horaire</span>
                <strong style={{ color: '#000d23' }}>{start} - {end} ({durationHours} h)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Tarif horaire</span>
                <strong style={{ color: '#000d23' }}>{formatDT(space.tarif_horaire)} / h</strong>
              </div>
              {occupancy && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Places restantes</span>
                  <strong style={{ color: occupancy.remaining > 0 ? '#059669' : '#dc2626' }}>
                    {occupancy.remaining} / {occupancy.capacity}
                  </strong>
                </div>
              )}
            </div>
          </div>

          {/* OPTION ENTREPRISE (auto-activée si compte Entreprise, CDC v3.0 Chantier 3.2) */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isEntreprise}
                onChange={(e) => setIsEntreprise(e.target.checked)}
              />
              Réservation professionnelle (Entreprise)
            </label>

            {isEntreprise && (
              <div style={{ marginTop: '12px', padding: '16px', borderRadius: '14px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', display: 'grid', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Raison sociale *</label>
                  <input type="text" value={entrepriseInfo.raison_sociale} onChange={(e) => setEntrepriseInfo((p) => ({ ...p, raison_sociale: e.target.value }))} placeholder="Ex: TechStart SARL" className="form-input" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Personne de contact *</label>
                    <input type="text" value={entrepriseInfo.contact_nom} onChange={(e) => setEntrepriseInfo((p) => ({ ...p, contact_nom: e.target.value }))} className="form-input" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Téléphone professionnel *</label>
                    <input type="tel" value={entrepriseInfo.telephone_pro} onChange={(e) => setEntrepriseInfo((p) => ({ ...p, telephone_pro: e.target.value }))} className="form-input" />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Email de facturation *</label>
                  <input type="email" value={entrepriseInfo.email_facturation} onChange={(e) => setEntrepriseInfo((p) => ({ ...p, email_facturation: e.target.value }))} className="form-input" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Objet du besoin / Description *</label>
                  <textarea rows={2} value={entrepriseInfo.besoin_description} onChange={(e) => setEntrepriseInfo((p) => ({ ...p, besoin_description: e.target.value }))} placeholder="Séminaire, réunion client…" className="form-input" />
                </div>
              </div>
            )}
          </div>

          {/* RÈGLEMENT SUR PLACE UNIQUEMENT (CDC v3.0 D1) */}
          <div style={{ marginBottom: '24px', padding: '14px 16px', borderRadius: '14px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', fontSize: '13px', color: '#78350f', lineHeight: 1.55 }}>
            <strong>Règlement à effectuer sur place</strong> (espèces, chèque ou virement) lors de votre arrivée à l'établissement. Un reçu PDF numéroté vous sera remis après encaissement.
          </div>

          {/* Total Price */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', marginBottom: '24px' }}>
            <span style={{ fontFamily: 'Sora, sans-serif', fontSize: '18px', fontWeight: 700, color: '#100f0d' }}>Estimation Total</span>
            <span style={{ fontFamily: 'Sora, sans-serif', fontSize: '24px', fontWeight: 800, color: '#f95d00' }}>{formatDT(totalPrice)}</span>
          </div>

          <button
            onClick={handleConfirmBooking}
            disabled={processing}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: '#f95d00',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '14px',
              border: 'none',
              cursor: processing ? 'not-allowed' : 'pointer',
              opacity: processing ? 0.7 : 1,
              boxShadow: '0 4px 16px rgba(249,93,0,0.3)',
              transition: 'all 0.15s ease',
            }}
          >
            {processing ? 'Enregistrement de la demande...' : `Envoyer la demande de réservation (${formatDT(totalPrice)})`}
          </button>

        </div>
      </main>
    </div>
  );
}
