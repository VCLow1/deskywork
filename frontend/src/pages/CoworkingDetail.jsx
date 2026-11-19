import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { guestApi } from '../services/api';
import BrandLogo from '../components/layout/BrandLogo';
import { useTheme } from '../context/ThemeContext';
import { formatDT } from '../utils/format';
import { PARTNER_THIRTY_THREE_BASE64, PARTNER_NERO_BASE64 } from '../assets/partners/partnerLogos';

/* ─── Charte DeskyWork dynamique ─── */
function getThemeColors(dark) {
  return {
    navy: dark ? '#fbffff' : '#100f0d',
    cobalt: '#f95d00',
    white: dark ? '#1b1a18' : '#ffffff',
    bg: dark ? '#100f0d' : '#f8f7f5',
    onNavy: dark ? '#cfcac3' : '#798bac',
    muted: dark ? '#a3a09b' : '#475569',
    outline: dark ? 'rgba(255,255,255,0.1)' : '#e2e8f0',
    cardBg: dark ? '#1b1a18' : '#ffffff',
    soft: dark ? 'rgba(249,93,0,0.18)' : '#fff7ed',
  };
}

const SPACE_LABELS = {
  open_space: 'Open Space',
  private_office: 'Bureau privé',
  meeting_room: 'Salle de réunion',
  training_room: 'Salle de formation',
  event_space: 'Espace événementiel',
  hot_desk: 'Poste nomade (Hot Desk)',
  dedicated_desk: 'Poste fixe (Dedicated Desk)',
};

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=600&fit=crop';

const FALLBACK_PARTNER_DETAILS = {
  'nero-coworking': {
    id: 'nero-coworking',
    nom: 'Nero Coworking Space',
    slug: 'nero-coworking',
    ville: 'Tunis',
    pays: 'Tunisie',
    adresse: 'Avenue Hédi Nouira, Ennasr 2, Tunis',
    telephone: '+216 71 888 999',
    email: 'contact@nerocoworking.tn',
    site_web: 'https://nerocoworking.tn',
    description: 'Un espace de coworking moderne et calme, pensé pour les freelances, startups et équipes en quête de productivité. Situé au cœur d’Ennasr 2, Nero Coworking offre un environnement stimulant doté de postes nomades, bureaux privatifs insonorisés et salles de réunion équipées de technologies audiovisuelles.',
    cover_url: 'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?w=1200&h=600&fit=crop',
    logo_url: PARTNER_NERO_BASE64,
    statut: 'actif',
    espaces: [
      { id: 'nero-os-1', nom: 'Open Space Nomade', type: 'open_space', capacite: 25, tarif_heure: 5.000, tarif_journee: 25.000, tarif_mois: 250.000, photos: ['https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?w=800&h=500&fit=crop'], equipements: ['Wi-Fi', 'Climatisation', 'Café / Thé', 'Imprimante'] },
      { id: 'nero-bp-1', nom: 'Bureau Privé 4 Personnes', type: 'private_office', capacite: 4, tarif_heure: 20.000, tarif_journee: 90.000, tarif_mois: 950.000, photos: ['https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800&h=500&fit=crop'], equipements: ['Wi-Fi', 'Climatisation', 'Accès 24/7', 'Tableau blanc'] },
      { id: 'nero-sr-1', nom: 'Salle de Réunion Prestige', type: 'meeting_room', capacite: 10, tarif_heure: 30.000, tarif_journee: 150.000, tarif_mois: null, photos: ['https://images.unsplash.com/photo-1517502884422-41eaead166d4?w=800&h=500&fit=crop'], equipements: ['Wi-Fi', 'Projecteur', 'Visioconférence', 'Tableau blanc', 'Climatisation'] },
    ],
    domiciliation: { actif: true, tarif_mensuel: 75.000, description: 'Adresse fiscale et commerciale au centre d\'Ennasr 2 avec gestion du courrier.' }
  },
  'thirty-three-space': {
    id: 'thirty-three-space',
    nom: 'Thirty Three Space',
    slug: 'thirty-three-space',
    ville: 'Tunis',
    pays: 'Tunisie',
    adresse: 'Les Berges du Lac 2, Tunis',
    telephone: '+216 71 999 333',
    email: 'contact@thirtythreespace.com',
    site_web: 'https://thirtythreespace.com/',
    description: 'Un lieu collaboratif et chaleureux conçu pour le coworking quotidien, les ateliers et les sessions de formation. Au bord du lac, profitez d’espaces baignés de lumière naturelle, d’un coin café convivial et d’une infrastructure réseau ultra haut-débit.',
    cover_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=600&fit=crop',
    logo_url: PARTNER_THIRTY_THREE_BASE64,
    statut: 'actif',
    espaces: [
      { id: 'tt-os-1', nom: 'Espace Collaboratif Lac', type: 'open_space', capacite: 30, tarif_heure: 6.000, tarif_journee: 28.000, tarif_mois: 280.000, photos: ['https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=500&fit=crop'], equipements: ['Wi-Fi', 'Café / Thé', 'Climatisation', 'Parking'] },
      { id: 'tt-sf-1', nom: 'Salle de Formation & Workshop', type: 'training_room', capacite: 20, tarif_heure: 35.000, tarif_journee: 180.000, tarif_mois: null, photos: ['https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=500&fit=crop'], equipements: ['Wi-Fi', 'Projecteur', 'Tableau blanc', 'Climatisation', 'Visioconférence'] },
      { id: 'tt-ev-1', nom: 'Espace Événementiel', type: 'event_space', capacite: 45, tarif_heure: 70.000, tarif_journee: 350.000, tarif_mois: null, photos: ['https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&h=500&fit=crop'], equipements: ['Wi-Fi', 'Projecteur', 'Sonorisation', 'Climatisation', 'Parking'] },
    ],
    domiciliation: { actif: true, tarif_mensuel: 85.000, description: 'Domiciliation juridique prestigieuse aux Berges du Lac 2.' }
  }
};

function mapsLink(coworking) {
  if (coworking.latitude && coworking.longitude) {
    return `https://www.google.com/maps?q=${coworking.latitude},${coworking.longitude}`;
  }
  const q = [coworking.adresse, coworking.ville, coworking.pays].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || coworking.nom)}`;
}

export default function CoworkingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { dark } = useTheme();
  const EC = getThemeColors(dark);

  const [coworking, setCoworking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        if (FALLBACK_PARTNER_DETAILS[id]) {
          try {
            const res = await guestApi.getCoworking(id);
            if (res?.coworking) {
              setCoworking(res.coworking);
              return;
            }
          } catch (_) {}
          setCoworking(FALLBACK_PARTNER_DETAILS[id]);
          return;
        }
        const res = await guestApi.getCoworking(id);
        if (res.error || !res.coworking) throw new Error(res.error || 'Coworking introuvable.');
        setCoworking(res.coworking);
      } catch (e) {
        if (FALLBACK_PARTNER_DETAILS[id]) {
          setCoworking(FALLBACK_PARTNER_DETAILS[id]);
        } else {
          setError(e.message);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: EC.bg }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '4px solid rgba(249,93,0,0.2)', borderTopColor: EC.cobalt, animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error || !coworking) {
    return (
      <div style={{ minHeight: '100vh', background: EC.bg, fontFamily: 'Inter, sans-serif' }}>
        <TopBar dark={dark} />
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center', padding: '6rem 24px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: EC.cobalt }}>error</span>
          <h1 style={{ fontFamily: 'Sora', fontWeight: 700, color: EC.navy, margin: '12px 0 6px' }}>
            Coworking introuvable
          </h1>
          <p style={{ color: EC.muted, marginBottom: 24 }}>{error || 'Cet espace n\'existe pas ou n\'est plus actif.'}</p>
          <Link to="/" style={{ background: EC.cobalt, color: '#ffffff', padding: '12px 28px', borderRadius: 12, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  const c = coworking;
  const isNero = Boolean(
    c.id === 'nero-coworking' ||
    (c.slug && c.slug.toLowerCase().includes('nero')) ||
    (c.nom && c.nom.toLowerCase().includes('nero')) ||
    (c.subdomain && c.subdomain.toLowerCase().includes('nero'))
  );
  const isThirtyThree = Boolean(
    c.id === 'thirty-three-space' ||
    (c.slug && c.slug.toLowerCase().includes('thirty')) ||
    (c.nom && c.nom.toLowerCase().includes('thirty'))
  );
  const effectiveLogo = isNero ? PARTNER_NERO_BASE64 : (isThirtyThree ? PARTNER_THIRTY_THREE_BASE64 : (c.logo_url || null));
  const heroImg = c.cover_url || effectiveLogo || FALLBACK_IMG;

  return (
    <div style={{ minHeight: '100vh', background: EC.bg, color: EC.navy, fontFamily: 'Inter, sans-serif', paddingBottom: 64, transition: 'background .3s ease, color .3s ease' }}>
      <TopBar dark={dark} />

      {/* ── HERO ── */}
      <div style={{ position: 'relative', height: 380, overflow: 'hidden' }}>
        <img src={heroImg} alt={c.nom} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(16,15,13,0.95) 8%, rgba(16,15,13,0.45) 58%, rgba(16,15,13,0.2) 100%)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '2.2rem 24px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              {effectiveLogo && (
                <div
                  style={{
                    height: 76,
                    minWidth: isNero ? 170 : 76,
                    maxWidth: isNero ? 220 : 120,
                    borderRadius: 18,
                    background: isNero ? '#1e293b' : '#ffffff',
                    border: isNero ? '2.5px solid rgba(255,255,255,0.85)' : '2.5px solid rgba(255,255,255,0.95)',
                    padding: isNero ? '10px 20px' : '8px 12px',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={effectiveLogo}
                    alt={c.nom}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = isNero ? PARTNER_NERO_BASE64 : (isThirtyThree ? PARTNER_THIRTY_THREE_BASE64 : FALLBACK_IMG);
                    }}
                    style={{
                      height: isNero ? 46 : 56,
                      maxWidth: isNero ? 170 : 90,
                      width: 'auto',
                      objectFit: 'contain',
                      display: 'block',
                      filter: isNero ? 'drop-shadow(0 2px 8px rgba(0,0,0,0.45))' : 'none',
                    }}
                  />
                </div>
              )}
              <div>
                <span style={{ background: 'linear-gradient(135deg,#f95d00,#ff8a3d)', color: '#ffffff', borderRadius: 8, padding: '5px 12px', fontSize: '.72rem', fontWeight: 800, display: 'inline-block', marginBottom: 10, letterSpacing: '.04em', boxShadow: '0 8px 18px rgba(249,93,0,0.3)' }}>
                  {c.ville || c.pays || 'Tunisie'}
                </span>
                <h1 style={{ fontFamily: 'Sora', fontWeight: 800, color: '#ffffff', fontSize: 'clamp(1.9rem,4vw,2.8rem)', margin: 0, textShadow: '0 2px 16px rgba(0,0,0,0.4)' }}>{c.nom}</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '2rem 24px 0' }}>

        {c.is_preview && (
          <div style={{
            marginBottom: 24,
            padding: '12px 18px',
            borderRadius: 14,
            background: dark ? 'rgba(245, 158, 11, 0.14)' : '#fffbeb',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            color: dark ? '#fde68a' : '#92400e',
            fontSize: '.9rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}>
            <span>Mode aperçu gérant : cet établissement ({c.preview_statut || 'en attente'}) n'est pas encore visible au public.</span>
            <Link to="/admin/dashboard" style={{ color: '#f95d00', fontWeight: 800, textDecoration: 'none' }}>
              ← Retour au tableau de bord
            </Link>
          </div>
        )}

        {/* ── INFOS / COORDONNÉES ── */}
        <div className="row g-4 mb-5">
          <div className="col-lg-7">
            <h2 style={{ fontFamily: 'Sora', fontWeight: 800, color: EC.navy, fontSize: '1.5rem', marginBottom: 12 }}>À propos</h2>
            <p style={{ color: EC.muted, lineHeight: 1.9, fontSize: '1rem', margin: 0 }}>
              {c.description || 'Espace de coworking premium pour professionnels ambitieux.'}
            </p>
          </div>
          <div className="col-lg-5">
            <div style={{ background: EC.cardBg, borderRadius: 22, border: `1.5px solid ${EC.outline}`, padding: '1.6rem', boxShadow: dark ? '0 10px 28px rgba(0,0,0,0.4)' : '0 10px 28px rgba(15,23,42,0.06)' }}>
              <h3 style={{ fontFamily: 'Sora', fontWeight: 800, color: EC.navy, fontSize: '1.05rem', marginBottom: 16 }}>Coordonnées & accès</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {c.adresse && (
                  <InfoRow icon="location_on" label="Adresse" value={`${c.adresse}${c.ville ? `, ${c.ville}` : ''}`} dark={dark} />
                )}
                {c.latitude && c.longitude && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: EC.soft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="material-symbols-outlined" style={{ color: EC.cobalt, fontSize: 20 }}>place</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '.72rem', fontWeight: 700, color: EC.muted, textTransform: 'uppercase', letterSpacing: '.07em' }}>GPS</div>
                      <a href={mapsLink(c)} target="_blank" rel="noreferrer" style={{ color: EC.cobalt, fontWeight: 600, fontSize: '.9rem', textDecoration: 'none' }}>
                        Voir sur la carte
                      </a>
                    </div>
                  </div>
                )}
                {c.telephone && <InfoRow icon="phone" label="Téléphone" value={c.telephone} dark={dark} />}
                {c.email && <InfoRow icon="mail" label="Email" value={c.email} dark={dark} />}
                {c.site_web && <InfoRow icon="public" label="Site web" value={c.site_web} link dark={dark} />}
              </div>
            </div>
          </div>
        </div>

        {/* ── ENCART DOMICILIATION D'ENTREPRISE (CDC v3.0) ── */}
        {c.domiciliation && (
          <div style={{
            background: dark ? 'linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.95))' : 'linear-gradient(135deg, #ffffff, #fff7ed)',
            borderRadius: 22,
            border: `1.5px solid ${dark ? 'rgba(249,93,0,0.35)' : '#fed7aa'}`,
            padding: '1.8rem',
            marginBottom: '2.5rem',
            boxShadow: dark ? '0 10px 30px rgba(0,0,0,0.3)' : '0 10px 30px rgba(249,93,0,0.08)',
          }}>
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3">
              <div style={{ maxWidth: 720 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{
                    background: 'linear-gradient(135deg, #f95d00, #ea580c)',
                    color: '#ffffff',
                    padding: '4px 12px',
                    borderRadius: 999,
                    fontSize: '.75rem',
                    fontWeight: 800,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                  }}>
                    🏢 Domiciliation d'entreprise disponible
                  </span>
                  {c.domiciliation.tarif_mensuel > 0 && (
                    <span style={{
                      fontFamily: 'Sora',
                      fontWeight: 800,
                      color: EC.cobalt,
                      fontSize: '1.05rem',
                    }}>
                      à partir de {Number(c.domiciliation.tarif_mensuel).toFixed(3)} DT / mois
                    </span>
                  )}
                </div>
                <h3 style={{ fontFamily: 'Sora', fontWeight: 800, color: EC.navy, fontSize: '1.25rem', margin: '4px 0 8px' }}>
                  Établissez le siège social de votre entreprise chez {c.nom}
                </h3>
                <p style={{ color: EC.muted, fontSize: '.92rem', lineHeight: 1.7, margin: 0 }}>
                  {c.domiciliation.description || 'Adresse commerciale et fiscale officielle, gestion du courrier et attestations pour votre immatriculation au Registre National des Entreprises (RNE).'}
                </p>
                {c.domiciliation.tarif_annuel > 0 && (
                  <p style={{ color: EC.muted, fontSize: '.82rem', marginTop: 8, marginBottom: 0, fontWeight: 600 }}>
                    💡 Formule annuelle avec remise : <strong style={{ color: EC.navy }}>{Number(c.domiciliation.tarif_annuel).toFixed(3)} DT / an</strong>
                  </p>
                )}
              </div>
              <div className="d-flex flex-column gap-2" style={{ minWidth: 200 }}>
                <a
                  href={`mailto:${c.email || 'contact@deskywork.com'}?subject=Demande de domiciliation - ${encodeURIComponent(c.nom)}&body=Bonjour, je souhaite souscrire au service de domiciliation d'entreprise auprès de votre établissement.`}
                  style={{
                    background: 'linear-gradient(135deg, #100f0d, #291a0c)',
                    color: '#ffffff',
                    padding: '12px 20px',
                    borderRadius: 12,
                    fontWeight: 800,
                    textDecoration: 'none',
                    fontSize: '.88rem',
                    textAlign: 'center',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>mail</span>
                  Demander ma domiciliation
                </a>
                <span style={{ fontSize: '.75rem', color: EC.muted, textAlign: 'center' }}>
                  Contrat &amp; règlement sécurisés sur place
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── ESPACES ── */}
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-4">
          <div>
            <h2 style={{ fontFamily: 'Sora', fontWeight: 800, color: EC.navy, fontSize: '1.5rem', margin: 0 }}>Espaces disponibles</h2>
            <p style={{ color: EC.muted, fontSize: '.95rem', margin: '6px 0 0' }}>
              Réservez sans compte — sélectionnez un espace et vos horaires.
            </p>
          </div>
          <Link to={`/book-guest?tenantId=${c.id}`}
            onClick={() => {
              fetch(`${import.meta.env.VITE_API_URL || ''}/api/public/coworkings/${c.id}/track`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'click' }),
              }).catch(() => {});
            }}
            style={{ background: 'linear-gradient(135deg, #f95d00 0%, #ff8a3d 100%)', color: '#ffffff', padding: '12px 22px', borderRadius: 12, fontWeight: 800, textDecoration: 'none', fontSize: '.9rem', boxShadow: '0 12px 22px rgba(249,93,0,0.25)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 17, verticalAlign: '-3px', marginRight: 6 }}>event_available</span>
            Réserver en tant qu'invité
          </Link>
        </div>

        {/* Équipements & Galerie Marketplace (CDC v3.0) */}
        {(Array.isArray(c.equipements) && c.equipements.length > 0) || (Array.isArray(c.gallery_photos) && c.gallery_photos.length > 0) ? (
          <div className="mb-5">
            {Array.isArray(c.equipements) && c.equipements.length > 0 && (
              <div className="mb-4">
                <h3 style={{ fontFamily: 'Sora', fontWeight: 800, color: EC.navy, fontSize: '1.15rem', marginBottom: 10 }}>Équipements & services inclus</h3>
                <div className="d-flex flex-wrap gap-2">
                  {c.equipements.map((eq, idx) => (
                    <span key={idx} style={{ background: EC.soft, color: EC.navy, border: `1px solid ${EC.outline}`, padding: '6px 12px', borderRadius: 999, fontSize: '.82rem', fontWeight: 600 }}>
                      ✓ {eq}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(c.gallery_photos) && c.gallery_photos.length > 0 && (
              <div>
                <h3 style={{ fontFamily: 'Sora', fontWeight: 800, color: EC.navy, fontSize: '1.15rem', marginBottom: 10 }}>Galerie photos</h3>
                <div className="row g-3">
                  {c.gallery_photos.map((url, idx) => (
                    <div key={idx} className="col-6 col-md-4 col-lg-3">
                      <img src={url} alt={`${c.nom} ${idx + 1}`} style={{ width: '100%', height: 145, objectFit: 'cover', borderRadius: 16, border: `1px solid ${EC.outline}` }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {!c.espaces || c.espaces.length === 0 ? (
          <div className="text-center" style={{ background: EC.cardBg, border: `1.5px solid ${EC.outline}`, borderRadius: 20, padding: '3rem' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 40, color: EC.outline }}>room</span>
            <p style={{ color: EC.muted, margin: '12px 0 0' }}>Aucun espace publié pour le moment.</p>
          </div>
        ) : (
          <div className="row g-4">
            {c.espaces.map((esp) => {
              const img = esp.photo_url || (Array.isArray(esp.photos_urls) && esp.photos_urls[0]) || (Array.isArray(esp.photos) && esp.photos[0]) || c.cover_url || FALLBACK_IMG;
              const tarifH = Number(esp.tarif_horaire ?? esp.tarif_heure ?? 0);
              return (
                <div key={esp.id} className="col-md-6 col-lg-4">
                  <div style={{ background: EC.cardBg, borderRadius: 22, overflow: 'hidden', border: `1.5px solid ${EC.outline}`, boxShadow: dark ? '0 12px 28px rgba(0,0,0,0.4)' : '0 12px 28px rgba(15,23,42,0.06)', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ height: 180, overflow: 'hidden', background: dark ? '#242220' : '#eef2ff' }}>
                      <img src={img} alt={esp.nom} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
                        <span style={{ background: dark ? 'rgba(249,93,0,0.2)' : '#e0f2fe', color: dark ? '#ffb599' : '#0f172a', padding: '4px 10px', borderRadius: 999, fontWeight: 800, fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                          {SPACE_LABELS[esp.type] || esp.type}
                        </span>
                        {tarifH > 0 && (
                          <span style={{ fontFamily: 'Sora', fontWeight: 800, color: EC.cobalt, fontSize: '1.1rem' }}>
                            {formatDT(tarifH)} <span style={{ fontSize: 11, fontWeight: 700, color: EC.muted }}>/ h</span>
                          </span>
                        )}
                      </div>
                      <h3 style={{ fontFamily: 'Sora', fontWeight: 800, color: EC.navy, fontSize: '1.15rem', marginBottom: 8 }}>{esp.nom}</h3>
                      <p style={{ color: EC.muted, fontSize: '.88rem', margin: '0 0 1rem', flex: 1, lineHeight: 1.7 }}>
                        Capacité : jusqu'à <strong style={{ color: EC.navy }}>{esp.capacite}</strong> personnes.
                      </p>
                      <button
                        onClick={() => navigate(`/book-guest?tenantId=${c.id}&espaceId=${esp.id}`)}
                        style={{ background: 'linear-gradient(135deg, #f95d00 0%, #ff8a3d 100%)', color: '#ffffff', border: 'none', borderRadius: 12, padding: '11px 12px', fontWeight: 800, cursor: 'pointer', fontSize: '.88rem', boxShadow: '0 12px 22px rgba(249,93,0,0.25)' }}
                      >
                        Réserver cet espace
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bandeau membre */}
        <div className="row mt-5">
          <div className="col-12">
            <div style={{ background: 'linear-gradient(135deg, #100f0d 0%, #1f1a14 100%)', borderRadius: 26, padding: '2.1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', boxShadow: '0 18px 42px rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ color: '#fbffff', flex: 1, minWidth: 260 }}>
                <h3 style={{ fontFamily: 'Sora', fontWeight: 800, margin: 0, fontSize: '1.45rem', lineHeight: 1.2, color: '#ffffff' }}>Membre du coworking ?</h3>
                <p style={{ color: '#cfcac3', margin: '10px 0 0', fontSize: '.98rem', lineHeight: 1.6, fontWeight: 500 }}>Connectez-vous pour accéder à vos réservations et meilleurs tarifs.</p>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <Link to="/login" style={{ background: 'linear-gradient(135deg, #f95d00 0%, #ff8a3d 100%)', color: '#ffffff', padding: '16px 28px', borderRadius: 14, fontWeight: 800, textDecoration: 'none', fontSize: '1rem', boxShadow: '0 12px 22px rgba(249,93,0,0.3)', minWidth: 175, textAlign: 'center', letterSpacing: '0.01em' }}>
                  Se connecter
                </Link>
                <Link to="/register" style={{ border: '2px solid rgba(255,255,255,0.4)', color: '#ffffff', padding: '15px 28px', borderRadius: 14, fontWeight: 700, textDecoration: 'none', fontSize: '1rem', background: 'rgba(255,255,255,0.04)', minWidth: 175, textAlign: 'center', letterSpacing: '0.01em' }}>
                  Devenir membre
                </Link>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function TopBar({ dark }) {
  const { toggle } = useTheme();
  return (
    <nav style={{ position: 'sticky', top: 0, zIndex: 60, background: dark ? 'rgba(16,15,13,0.92)' : 'rgba(255,255,255,0.88)', backdropFilter: 'blur(10px)', borderBottom: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', maxWidth: 1240, margin: '0 auto' }}>
        <BrandLogo to="/" height={40} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={toggle}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 10, border: 'none',
              cursor: 'pointer', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.06)',
              color: dark ? '#ffd966' : '#100f0d',
            }}
            title={dark ? 'Mode clair' : 'Mode sombre'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
              {dark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <Link to="/book-guest"
            style={{ background: 'linear-gradient(135deg, #f95d00 0%, #ff8a3d 100%)', color: '#ffffff', padding: '10px 18px', borderRadius: 12, fontWeight: 800, fontSize: '.85rem', textDecoration: 'none', boxShadow: '0 10px 20px rgba(249,93,0,0.25)' }}>
            Réserver sans compte
          </Link>
        </div>
      </div>
    </nav>
  );
}

function InfoRow({ icon, label, value, link, dark }) {
  const EC = getThemeColors(dark);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: EC.soft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${dark ? 'rgba(249,93,0,0.25)' : 'rgba(249,93,0,0.14)'}` }}>
        <span className="material-symbols-outlined" style={{ color: EC.cobalt, fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 800, color: EC.muted, textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</div>
        {link ? (
          <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noreferrer"
            style={{ color: EC.navy, fontWeight: 700, fontSize: '.92rem', textDecoration: 'none', wordBreak: 'break-all' }}>{value}</a>
        ) : (
          <div style={{ color: EC.navy, fontWeight: 600, fontSize: '.92rem' }}>{value}</div>
        )}
      </div>
    </div>
  );
}