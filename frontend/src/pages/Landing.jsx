
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { guestApi } from '../services/api';
import { API_URL } from '../services/api';
import Navbar from '../components/layout/Navbar';
import BrandLogo from '../components/layout/BrandLogo';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { SPACE_TYPES, SPACE_TYPE_LABELS, EQUIPMENTS } from '../constants/spaceTypes';
import { SAAS_PACKS } from '../constants/saasPacks';
import { formatDT, formatDateTunis, formatTimeTunis } from '../utils/format';
import { PARTNER_THIRTY_THREE_BASE64, PARTNER_NERO_BASE64 } from '../assets/partners/partnerLogos';
const partnerThirtyThree = PARTNER_THIRTY_THREE_BASE64;
const partnerNero = PARTNER_NERO_BASE64;

const EQUIPMENT_ICONS = {
  'Wi-Fi': 'wifi',
  'Projecteur': 'videocam',
  'Visioconférence': 'video_camera_front',
  'Tableau blanc': 'draw',
  'Imprimante': 'print',
  'Climatisation': 'ac_unit',
  'Café / Thé': 'local_cafe',
  'Parking': 'local_parking',
  'Accès 24/7': 'schedule',
};

/* ─── Charte DeskyWork dynamique ─── */
function getThemeColors(dark) {
  return {
    navy: dark ? '#fbffff' : '#100f0d',
    navyMid: dark ? '#282623' : '#1c1b18',
    cobalt: '#f95d00',
    cobaltLight: dark ? 'rgba(249,93,0,0.18)' : '#ffedd8',
    cobaltDim: '#ffb599',
    onNavy: dark ? '#cfcac3' : '#798bac',
    white: dark ? '#1b1a18' : '#ffffff',
    cardBg: dark ? '#1b1a18' : '#ffffff',
    bg: dark ? '#100f0d' : '#fbf9fb',
    bgLow: dark ? '#151412' : '#f5f3f6',
    text: dark ? '#fbffff' : '#1b1b1e',
    muted: dark ? '#a3a09b' : '#44474d',
    outline: dark ? 'rgba(255,255,255,0.1)' : '#cfcac3',
    success: '#2fbe8f',
  };
}

/* ─── Animated counter hook ─── */
function useCountUp(target, duration = 1800) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      let val = 0;
      const step = Math.max(1, Math.ceil(target / (duration / 16)));
      const timer = setInterval(() => {
        val += step;
        if (val >= target) { setCount(target); clearInterval(timer); }
        else setCount(val);
      }, 16);
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target, duration]);
  return [count, ref];
}

/* ─── KPI Counter ─── */
function KpiCounter({ value, suffix, label, dark }) {
  const [count, ref] = useCountUp(value);
  const EC = getThemeColors(dark);
  return (
    <div ref={ref} className="text-center px-2">
      <div style={{ fontSize: 'clamp(2rem,4vw,2.8rem)', fontWeight: 800, color: dark ? '#ffb599' : '#dae2ff', fontFamily: 'Sora,sans-serif', lineHeight: 1 }}>
        {count}{suffix}
      </div>
      <div style={{ color: EC.onNavy, fontSize: '.875rem', marginTop: 6 }}>{label}</div>
    </div>
  );
}

/* ─── Feature Card ─── */
function FeatureCard({ icon, title, desc, dark }) {
  const [hov, setHov] = useState(false);
  const EC = getThemeColors(dark);
  return (
    <div className="col-md-6 col-lg-4">
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          backgroundColor: EC.cardBg,
          borderRadius: 20,
          padding: '2rem',
          height: '100%',
          border: `1.5px solid ${hov ? EC.cobalt : EC.outline}`,
          boxShadow: hov
            ? (dark ? '0 12px 32px rgba(0,0,0,.6)' : '0 12px 32px rgba(249,93,0,.14)')
            : (dark ? '0 2px 10px rgba(0,0,0,.3)' : '0 2px 8px rgba(0,13,35,.05)'),
          transition: 'all .3s ease',
          transform: hov ? 'translateY(-6px)' : 'none',
        }}
      >
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          backgroundColor: hov ? EC.cobalt : EC.cobaltLight,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '1.25rem', transition: 'background .3s',
        }}>
          <span className="material-symbols-outlined" style={{ color: hov ? '#ffffff' : (dark ? '#ff8a3d' : '#f95d00'), fontSize: 26 }}>{icon}</span>
        </div>
        <h5 style={{ fontFamily: 'Sora,sans-serif', fontWeight: 700, color: EC.navy, marginBottom: '.5rem' }}>{title}</h5>
        <p style={{ color: EC.muted, fontSize: '.9rem', lineHeight: 1.75, margin: 0 }}>{desc}</p>
      </div>
    </div>
  );
}

/* ─── Pricing Card ─── */
function PricingCard({ badge, title, price, period, desc, features, highlighted, cta, ctaTo, dark }) {
  const [hov, setHov] = useState(false);
  const EC = getThemeColors(dark);
  return (
    <div className="col-md-4">
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          backgroundColor: highlighted ? (dark ? '#221408' : '#100f0d') : EC.cardBg,
          borderRadius: 24,
          padding: '2rem',
          height: '100%',
          border: highlighted ? `1.5px solid ${dark ? 'rgba(249,93,0,0.4)' : 'transparent'}` : `1.5px solid ${hov ? EC.cobalt : EC.outline}`,
          boxShadow: hov
            ? '0 16px 48px rgba(249,93,0,.2)'
            : highlighted
              ? (dark ? '0 8px 32px rgba(249,93,0,.25)' : '0 8px 32px rgba(0,13,35,.18)')
              : (dark ? '0 2px 10px rgba(0,0,0,.3)' : '0 2px 8px rgba(0,13,35,.04)'),
          transition: 'all .3s ease',
          transform: hov ? 'translateY(-4px)' : 'none',
          position: 'relative', overflow: 'hidden',
        }}
      >
        {highlighted && (
          <div style={{
            position: 'absolute', top: 0, right: 0, width: 160, height: 160,
            background: `radial-gradient(circle, ${EC.cobalt}44 0%, transparent 70%)`,
            borderRadius: '50%', transform: 'translate(30%,-30%)', pointerEvents: 'none',
          }} />
        )}
        {badge && (
          <span style={{
            display: 'inline-block', marginBottom: '1rem',
            backgroundColor: highlighted ? EC.cobalt : EC.cobaltLight,
            color: highlighted ? '#ffffff' : (dark ? '#ff8a3d' : '#100f0d'),
            fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
            padding: '5px 14px', borderRadius: 100,
          }}>{badge}</span>
        )}
        <h4 style={{ fontFamily: 'Sora,sans-serif', fontWeight: 700, color: highlighted ? '#fbffff' : EC.navy, marginBottom: '.4rem' }}>{title}</h4>
        <p style={{ color: highlighted ? '#cfcac3' : EC.muted, fontSize: '.875rem', marginBottom: '1.5rem' }}>{desc}</p>
        <div style={{ marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '2.6rem', fontWeight: 800, fontFamily: 'Sora,sans-serif', color: highlighted ? '#fbffff' : EC.navy }}>{price}</span>
          {period && <span style={{ color: highlighted ? '#cfcac3' : EC.muted, fontSize: '.875rem', marginLeft: 6 }}>{period}</span>}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.75rem 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {features.map((f, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span className="material-symbols-outlined" style={{ color: highlighted ? EC.cobaltDim : EC.cobalt, fontSize: 18, marginTop: 2, flexShrink: 0 }}>check_circle</span>
              <span style={{ color: highlighted ? '#cfcac3' : (dark ? '#e6e4df' : EC.muted), fontSize: '.875rem' }}>{f}</span>
            </li>
          ))}
        </ul>
        <Link to={ctaTo} style={{
          display: 'block', textAlign: 'center', textDecoration: 'none', fontWeight: 700, fontSize: '.9rem',
          backgroundColor: highlighted ? EC.cobalt : 'transparent',
          color: highlighted ? '#ffffff' : EC.cobalt,
          border: highlighted ? 'none' : `2px solid ${EC.cobalt}`,
          borderRadius: 12, padding: '12px 0',
          transition: 'all .25s',
        }}>
          {cta}
        </Link>
      </div>
    </div>
  );
}

/* ─── Testimonial Card ─── */
function TestiCard({ quote, name, role, initial, dark }) {
  const EC = getThemeColors(dark);
  return (
    <div className="col-md-4">
      <div style={{
        backgroundColor: EC.cardBg, borderRadius: 20, padding: '2rem', height: '100%',
        border: `1.5px solid ${EC.outline}`, display: 'flex', flexDirection: 'column',
        boxShadow: dark ? '0 2px 10px rgba(0,0,0,.3)' : '0 2px 8px rgba(0,13,35,.04)',
      }}>
        <div className="d-flex align-items-center gap-1 mb-3">
          {[...Array(5)].map((_, i) => (
            <span key={i} className="material-symbols-outlined" style={{ color: '#f59e0b', fontSize: 18, fontVariationSettings: "'FILL' 1" }}>star</span>
          ))}
        </div>
        <p style={{ color: EC.navy, fontSize: '.95rem', lineHeight: 1.75, flex: 1, marginBottom: '1.5rem', fontStyle: 'italic' }}>
          "{quote}"
        </p>
        <div className="d-flex align-items-center gap-3">
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            backgroundColor: EC.cobalt, color: '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '1.1rem', flexShrink: 0,
          }}>
            {initial}
          </div>
          <div>
            <div style={{ fontFamily: 'Sora,sans-serif', fontWeight: 700, color: EC.navy, fontSize: '.95rem' }}>{name}</div>
            <div style={{ color: EC.muted, fontSize: '.8rem' }}>{role}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Diaporama d'images en fond ─── */
const HERO_SLIDES = [
  { src: '/images/coworking/space-1.jpg', title: 'Open Space', tag: 'Travail collaboratif' },
  { src: '/images/coworking/space-2.jpg', title: 'Bureaux privatifs', tag: 'Concentration totale' },
  { src: '/images/coworking/space-3.jpg', title: 'Bureaux dédiés', tag: 'Équipes & startups' },
  { src: '/images/coworking/space-4.jpg', title: 'Salles de réunion', tag: 'Réunions & workshops' },
  { src: '/images/coworking/space-5.jpg', title: 'Espace lounge', tag: 'Pause & networking' },
];

/* ─── Modale Promos ─── */
function PromoModal({ tenant, onClose, dark }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    fetch(`${API_URL}/api/public/coworkings/${tenant.id}/promos`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [tenant]);

  if (!tenant) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: dark ? '#181614' : '#ffffff',
          color: dark ? '#fbffff' : '#100f0d',
          borderRadius: 24, maxWidth: 520, width: '100%', maxHeight: '85vh',
          overflowY: 'auto', border: `1.5px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(16,15,13,0.1)'}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.08)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'between',
        }}>
          <div>
            <span style={{
              fontSize: '.68rem', fontWeight: 800, textTransform: 'uppercase',
              color: '#f95d00', letterSpacing: '.08em', display: 'block',
            }}>
              Offres Spéciales
            </span>
            <h3 className="sora fw-bold mb-0" style={{ fontSize: '1.2rem' }}>{tenant.nom}</h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: dark ? '#cfcac3' : '#797570',
              cursor: 'pointer', padding: 6, borderRadius: 8, marginLeft: 'auto',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
          </button>
        </div>

        <div style={{ padding: '1.5rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: dark ? '#cfcac3' : '#797570' }}>
              Chargement des promotions…
            </div>
          ) : !data?.promos || data.promos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: dark ? '#cfcac3' : '#797570' }}>
              Aucun code promo actif pour cet établissement pour le moment.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.promos.map((p) => {
                const isPct = p.type === 'percentage';
                const valStr = isPct ? `-${p.valeur}%` : `-${formatDT(p.valeur)}`;
                return (
                  <div
                    key={p.id}
                    style={{
                      border: `1.5px dashed ${dark ? 'rgba(249,93,0,0.5)' : '#f95d00'}`,
                      borderRadius: 16, padding: '1rem',
                      background: dark ? 'rgba(249,93,0,0.06)' : '#fff8f2',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{
                        fontFamily: 'monospace', fontWeight: 800, fontSize: '1.1rem',
                        letterSpacing: '.08em', color: '#f95d00',
                      }}>
                        {p.code}
                      </span>
                      <span style={{
                        background: '#f95d00', color: '#fff', borderRadius: 8,
                        padding: '3px 10px', fontSize: '.78rem', fontWeight: 800,
                      }}>
                        {valStr}
                      </span>
                    </div>
                    {p.description && (
                      <p style={{ margin: '0 0 6px 0', fontSize: '.84rem', color: dark ? '#cfcac3' : '#44474d' }}>
                        {p.description}
                      </p>
                    )}
                    <div style={{ fontSize: '.72rem', color: dark ? '#a3a09b' : '#797570' }}>
                      {p.valide_jusquau && `Valable jusqu'au ${new Date(p.valide_jusquau).toLocaleDateString('fr-FR')}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: 10 }}>
            <Link
              to={`/coworking/${tenant.id}`}
              onClick={onClose}
              style={{
                flex: 1, textAlign: 'center', background: '#f95d00', color: '#fff',
                borderRadius: 12, padding: '11px 0', fontWeight: 700, fontSize: '.9rem',
                textDecoration: 'none',
              }}
            >
              Voir l'établissement &amp; Réserver
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const STATIC_FALLBACK_TENANTS = [
  {
    id: 'thirty-three-space',
    nom: 'Thirty Three Space',
    slug: 'thirty-three-space',
    ville: 'Tunis',
    adresse: 'Les Berges du Lac 2, Tunis',
    description: 'Espace de coworking moderne, bureaux privatifs et communauté innovante au Lac 2.',
    cover_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=600&fit=crop',
    logo_url: partnerThirtyThree,
    is_featured: true,
    space_count: 6,
    member_count: 54,
    has_promo: true,
  },
  {
    id: 'nero-coworking',
    nom: 'Néro Coworking Space',
    slug: 'nero-coworking',
    ville: 'Tunis',
    adresse: 'Avenue Hédi Nouira, Ennasr 2, Tunis',
    description: 'Coworking premium, salles de réunion high-tech et flex office pour créatifs et équipes.',
    cover_url: 'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?w=800&h=600&fit=crop',
    logo_url: partnerNero,
    is_featured: true,
    space_count: 8,
    member_count: 68,
    has_promo: true,
  },
  {
    id: 'the-hive-coworking',
    nom: 'The Hive Coworking Space',
    slug: 'the-hive-coworking',
    ville: 'Sousse',
    adresse: 'Zone Touristique El Kantaoui, Sousse',
    description: 'Espace stimulant au bord de mer avec postes nomades, formations et réseau d\'entrepreneurs.',
    cover_url: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&h=600&fit=crop',
    is_featured: true,
    space_count: 5,
    member_count: 35,
    has_promo: false,
  },
];

const STATIC_FALLBACK_ESPACES = [
  {
    id: 'esp-open-33',
    tenant_id: 'thirty-three-space',
    nom: 'Poste Nomade (Open Space)',
    type: 'open_space',
    capacite: 30,
    tarif_horaire: 5,
    photo_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=600&fit=crop',
    equipements: ['Wi-Fi Fibre', 'Climatisation', 'Café/Thé', 'Prises dédiées'],
    tenants: { nom: 'Thirty Three Space', ville: 'Tunis' },
  },
  {
    id: 'esp-bureau-nero',
    tenant_id: 'nero-coworking',
    nom: 'Bureau Privatif 4 Personnes',
    type: 'private_office',
    capacite: 4,
    tarif_horaire: 22,
    photo_url: 'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?w=800&h=600&fit=crop',
    equipements: ['Wi-Fi Fibre', 'Climatisation', 'Écran 4K', 'Tableau blanc'],
    tenants: { nom: 'Néro Coworking Space', ville: 'Tunis' },
  },
  {
    id: 'esp-reunion-33',
    tenant_id: 'thirty-three-space',
    nom: 'Salle de Réunion Vision',
    type: 'meeting_room',
    capacite: 10,
    tarif_horaire: 35,
    photo_url: 'https://images.unsplash.com/photo-1517502884422-41eaead166d4?w=800&h=600&fit=crop',
    equipements: ['Wi-Fi Fibre', 'Visioconférence', 'Projecteur', 'Tableau blanc'],
    tenants: { nom: 'Thirty Three Space', ville: 'Tunis' },
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE PRINCIPALE — LANDING PAGE (CDC DeskyWork v3.0)
═══════════════════════════════════════════════════════════════════════════ */
export default function Landing({ session }) {
  const { dark } = useTheme();
  const { lang, t } = useLanguage();
  const EC = getThemeColors(dark);
  const location = useLocation();

  const [isAtTop, setIsAtTop] = useState(true);

  // Défilement fluide vers ancre hashée (ex: /#partenaires depuis menu ou autre page)
  useEffect(() => {
    if (location.hash) {
      const hashId = location.hash.replace('#', '');
      const el = document.getElementById(hashId) || (hashId === 'partenaires' ? document.getElementById('entreprises') : null);
      if (el) {
        const timer = setTimeout(() => {
          const yOffset = -85;
          const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }, 120);
        return () => clearTimeout(timer);
      }
    }
  }, [location.hash]);

  useEffect(() => {
    const handleScroll = () => {
      setIsAtTop(window.scrollY < 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleScrollButton = () => {
    if (isAtTop) {
      const target = document.getElementById('about') || document.getElementById('avantages');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const [contactForm, setContactForm] = useState({ nom: '', email: '', sujet: '', message: '' });
  const [contactStatus, setContactStatus] = useState({ type: '', text: '' });
  const [contactLoading, setContactLoading] = useState(false);

  const handleContactSubmit = async (event) => {
    event.preventDefault();
    setContactLoading(true);
    setContactStatus({ type: '', text: '' });
    try {
      const response = await fetch(`${API_URL}/api/contact`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contactForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible d’envoyer le message.');
      setContactForm({ nom: '', email: '', sujet: '', message: '' });
      setContactStatus({ type: 'success', text: t('landing.contactSuccess') });
    } catch (error) {
      setContactStatus({ type: 'error', text: error.message });
    } finally {
      setContactLoading(false);
    }
  };

  const [tenants, setTenants] = useState(STATIC_FALLBACK_TENANTS);
  const [publicEspaces, setPublicEspaces] = useState(STATIC_FALLBACK_ESPACES);
  const [publicFormations, setPublicFormations] = useState([]);
  const [searchVille, setSearchVille] = useState('');
  const [searchType, setSearchType] = useState('');
  const [searchCapacite, setSearchCapacite] = useState('');
  const [searchDate, setSearchDate] = useState('');
  const [searchHeureDebut, setSearchHeureDebut] = useState('09:00');
  const [searchHeureFin, setSearchHeureFin] = useState('17:00');
  const [searchEquipements, setSearchEquipements] = useState([]);
  const [searchBudgetMax, setSearchBudgetMax] = useState('');
  const [searchPartnerOnly, setSearchPartnerOnly] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  /* Compteur de filtres actifs */
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchVille) count++;
    if (searchType) count++;
    if (searchCapacite) count++;
    if (searchBudgetMax) count++;
    if (searchPartnerOnly) count++;
    if (searchKeyword) count++;
    count += searchEquipements.length;
    return count;
  }, [searchVille, searchType, searchCapacite, searchBudgetMax, searchPartnerOnly, searchKeyword, searchEquipements]);

  const resetAllFilters = () => {
    setSearchVille('');
    setSearchType('');
    setSearchCapacite('');
    setSearchBudgetMax('');
    setSearchPartnerOnly(false);
    setSearchKeyword('');
    setSearchEquipements([]);
    setSearchDate('');
  };

  /* Onglets d'intention Hero (CDC v3.0 Premium) */
  const [activeHeroTab, setActiveHeroTab] = useState('espaces'); // 'espaces' | 'formations' | 'b2b'
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const filterPopoverRef = useRef(null);

  /* Recherche Formations */
  const [searchFormationKeyword, setSearchFormationKeyword] = useState('');
  const [searchFormationVille, setSearchFormationVille] = useState('');
  const [searchFormationDate, setSearchFormationDate] = useState('');
  const [selectedFormationModal, setSelectedFormationModal] = useState(null);

  /* Rotation dynamique de mot-clé H1 */
  const rotatingWords = useMemo(() => {
    return lang === 'en'
      ? ['private office', 'meeting room', 'workshop', 'open space']
      : ['bureau privé', 'salle de réunion', 'formation', 'open space'];
  }, [lang]);
  const [currentWordIdx, setCurrentWordIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentWordIdx((prev) => (prev + 1) % rotatingWords.length);
    }, 2800);
    return () => clearInterval(timer);
  }, [rotatingWords.length]);

  // Fermer le popover filtres au clic extérieur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(e.target)) {
        setShowFilterPopover(false);
      }
    };
    if (showFilterPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilterPopover]);

  const [slide, setSlide] = useState(0);
  const [hovering, setHovering] = useState(false);
  const FALLBACK_PARTNER_TENANTS = STATIC_FALLBACK_TENANTS;

  const FALLBACK_PARTNER_ESPACES = STATIC_FALLBACK_ESPACES;

  const [hidden, setHidden] = useState(false);
  const [promoTenant, setPromoTenant] = useState(null);
  const paused = hovering || hidden;

  useEffect(() => {
    fetchTenants();
    fetchMarketplaceData();
  }, []);

  const fetchTenants = async () => {
    try {
      const res = await guestApi.getCoworkings();
      if (res?.coworkings && res.coworkings.length > 0) {
        setTenants(res.coworkings);
      } else {
        setTenants(FALLBACK_PARTNER_TENANTS);
      }
    } catch (e) {
      setTenants(FALLBACK_PARTNER_TENANTS);
    }
  };

  const fetchMarketplaceData = async () => {
    try {
      const [espRes, formRes] = await Promise.all([
        guestApi.getPublicEspaces().catch(() => ({ espaces: [] })),
        guestApi.getPublicFormations(12).catch(() => ({ formations: [] })),
      ]);
      setPublicEspaces(espRes?.espaces && espRes.espaces.length > 0 ? espRes.espaces : FALLBACK_PARTNER_ESPACES);
      setPublicFormations(formRes?.formations || []);
    } catch (_) {
      setPublicEspaces(FALLBACK_PARTNER_ESPACES);
    }
  };

  const toggleEquipement = (eq) => {
    setSearchEquipements((prev) =>
      prev.includes(eq) ? prev.filter((item) => item !== eq) : [...prev, eq]
    );
  };

  const villesDisponibles = Array.from(
    new Set(
      [
        ...tenants.map((t) => t.ville),
        ...publicEspaces.map((e) => e.tenants?.ville),
      ].filter(Boolean)
    )
  ).sort();

  const filteredEspaces = publicEspaces.filter((esp) => {
    const villeEsp = esp.tenants?.ville || '';
    const nomEsp = esp.nom || '';
    const tenantNom = esp.tenants?.nom || '';

    if (searchKeyword && !(`${nomEsp} ${tenantNom} ${villeEsp}`).toLowerCase().includes(searchKeyword.toLowerCase())) return false;
    if (searchVille && !villeEsp.toLowerCase().includes(searchVille.toLowerCase())) return false;
    if (searchType && esp.type !== searchType) return false;
    if (searchCapacite && Number(esp.capacite || 1) < Number(searchCapacite)) return false;
    if (searchBudgetMax && Number(esp.tarif_horaire || 0) > Number(searchBudgetMax)) return false;
    if (searchPartnerOnly) {
      const isOfficial = /nero|thirty\s*three/i.test(tenantNom);
      if (!isOfficial) return false;
    }
    if (searchEquipements.length > 0) {
      const espEq = Array.isArray(esp.equipements)
        ? esp.equipements.map((x) => String(x).toLowerCase())
        : [];
      const hasAll = searchEquipements.every((wanted) =>
        espEq.some((have) => have.includes(wanted.toLowerCase()))
      );
      if (!hasAll) return false;
    }
    return true;
  });

  const filteredPublicFormations = useMemo(() => {
    return publicFormations.filter((f) => {
      if (searchFormationKeyword) {
        const kw = searchFormationKeyword.toLowerCase().trim();
        const matchesTitle = f.titre?.toLowerCase().includes(kw);
        const matchesDesc = f.description?.toLowerCase().includes(kw);
        const matchesProg = f.programme?.toLowerCase().includes(kw);
        const matchesTrainer = (f.formateur_nom || f.formateur || '')?.toLowerCase().includes(kw);
        const matchesTenant = (f.etablissement || f.tenant_nom || '')?.toLowerCase().includes(kw);
        if (!matchesTitle && !matchesDesc && !matchesProg && !matchesTrainer && !matchesTenant) return false;
      }
      if (searchFormationVille) {
        const v = searchFormationVille.toLowerCase().trim();
        const matchesVille = f.ville?.toLowerCase().includes(v) || (f.etablissement && f.etablissement.toLowerCase().includes(v));
        if (!matchesVille) return false;
      }
      if (searchFormationDate) {
        if (!f.date_debut?.startsWith(searchFormationDate)) return false;
      }
      return true;
    });
  }, [publicFormations, searchFormationKeyword, searchFormationVille, searchFormationDate]);

  const buildSearchBookingLink = (esp) => {
    const tid = esp.tenant_id || '';
    const params = new URLSearchParams({ tenantId: tid, espaceId: esp.id });
    if (searchDate) {
      params.set('debut', `${searchDate}T${searchHeureDebut || '09:00'}`);
      params.set('fin', `${searchDate}T${searchHeureFin || '17:00'}`);
    }
    return `/book-guest?${params.toString()}`;
  };

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % HERO_SLIDES.length), 3000);
    return () => clearInterval(t);
  }, [paused]);

  const goSlide = (dir) => setSlide((s) => (s + dir + HERO_SLIDES.length) % HERO_SLIDES.length);

  /* Rotation équitable des établissements mis en avant (pack Premium) à chaque chargement de page */
  const rotatedTenants = useMemo(() => {
    if (!tenants || tenants.length === 0) return [];
    const featured = tenants.filter((t) => t.is_featured);
    const others = tenants.filter((t) => !t.is_featured);
    if (featured.length > 1) {
      const offset = Math.floor(Math.random() * featured.length);
      const shuffledFeatured = [...featured.slice(offset), ...featured.slice(0, offset)];
      return [...shuffledFeatured, ...others];
    }
    return tenants;
  }, [tenants]);

  /* CDC v3.0 — 6 Atouts réels DeskyWork SaaS & Marketplace */
  const features = [
    { icon: 'calendar_month', title: t('landing.adv1Title'), desc: t('landing.adv1Desc') },
    { icon: 'timer', title: t('landing.adv2Title'), desc: t('landing.adv2Desc') },
    { icon: 'dashboard', title: t('landing.adv3Title'), desc: t('landing.adv3Desc') },
    { icon: 'receipt_long', title: t('landing.adv4Title'), desc: t('landing.adv4Desc') },
    { icon: 'school', title: t('landing.adv5Title'), desc: t('landing.adv5Desc') },
    { icon: 'public', title: t('landing.adv6Title'), desc: t('landing.adv6Desc') },
  ];

  /* CDC v3.0 — 3 Packs SaaS B2B officiels pour les établissements */
  const plans = [
    {
      badge: null,
      title: t('landing.packEssentielName'),
      price: `${t('landing.packEssentielPrice')} DT`,
      period: t('landing.perMonth'),
      desc: t('landing.packEssentielDesc'),
      features: [
        t('landing.packEssentielF1'),
        t('landing.packEssentielF2'),
        t('landing.packEssentielF3'),
        t('landing.packEssentielF4'),
        t('landing.packEssentielF5'),
      ],
      cta: `${t('landing.choosePlan')} ${t('landing.packEssentielName')}`,
      ctaTo: '/register?type=coworking&pack=essentiel',
      highlighted: false,
    },
    {
      badge: t('landing.mostPopular'),
      title: t('landing.packStandardName'),
      price: `${t('landing.packStandardPrice')} DT`,
      period: t('landing.perMonth'),
      desc: t('landing.packStandardDesc'),
      features: [
        t('landing.packStandardF1'),
        t('landing.packStandardF2'),
        t('landing.packStandardF3'),
        t('landing.packStandardF4'),
        t('landing.packStandardF5'),
        t('landing.packStandardF6'),
      ],
      cta: `${t('landing.choosePlan')} ${t('landing.packStandardName')}`,
      ctaTo: '/register?type=coworking&pack=standard',
      highlighted: true,
    },
    {
      badge: t('landing.featuredBadgeTag'),
      title: t('landing.packPremiumName'),
      price: `${t('landing.packPremiumPrice')} DT`,
      period: t('landing.perMonth'),
      desc: t('landing.packPremiumDesc'),
      features: [
        t('landing.packPremiumF1'),
        t('landing.packPremiumF2'),
        t('landing.packPremiumF3'),
        t('landing.packPremiumF4'),
        t('landing.packPremiumF5'),
        t('landing.packPremiumF6'),
      ],
      cta: `${t('landing.choosePlan')} ${t('landing.packPremiumName')}`,
      ctaTo: '/register?type=coworking&pack=premium',
      highlighted: false,
    },
  ];

  const testimonials = [
    { quote: t('landing.testi1Text'), name: t('landing.testi1Name'), role: t('landing.testi1Role'), initial: 'T' },
    { quote: t('landing.testi2Text'), name: t('landing.testi2Name'), role: t('landing.testi2Role'), initial: 'N' },
    { quote: t('landing.testi3Text'), name: t('landing.testi3Name'), role: t('landing.testi3Role'), initial: 'M' },
  ];

  return (
    <>
      {/* ── Styles globaux de la page ── */}
      <style>{`
        html { scroll-behavior:smooth; scroll-padding-top:80px; }
        body {
          font-family:'Inter',sans-serif;
          background-color: ${EC.bg};
          color: ${EC.navy};
          transition: background-color .3s ease, color .3s ease;
        }
        .sora { font-family:'Sora',sans-serif !important; }

        /* HERO — Background moderne & lumineux avec overlay subtil */
        .hero-wrap {
          position:relative; min-height:860px; display:flex; align-items:center;
          padding:130px 0 110px;
          background:${dark ? '#0c0b0a' : '#f7f5f0'};
          transition:background .3s ease;
        }
        .hero-bg { position:absolute; inset:0; z-index:0; overflow:hidden; }
        .hero-bg-slide {
          position:absolute; inset:0; opacity:0; transition:opacity 1.2s ease-in-out;
        }
        .hero-bg-slide.active { opacity:1; }
        .hero-bg-slide img {
          width:100%; height:100%; object-fit:cover; display:block;
          filter:${dark ? 'brightness(0.70) saturate(1.15)' : 'brightness(0.94) saturate(1.08)'};
          transition:filter .4s ease;
        }

        /* Effet Ken Burns lent */
        @keyframes kbA {
          0%   { transform: scale(1) translate(0, 0); }
          50%  { transform: scale(1.06) translate(-1%, -1%); }
          100% { transform: scale(1) translate(0, 0); }
        }
        @keyframes kbB {
          0%   { transform: scale(1.06) translate(-1%, 0); }
          50%  { transform: scale(1) translate(1%, -1%); }
          100% { transform: scale(1.06) translate(-1%, 0); }
        }
        .hero-bg-slide.active img.kb-a { animation: kbA 20s ease-in-out infinite alternate; }
        .hero-bg-slide.active img.kb-b { animation: kbB 20s ease-in-out infinite alternate; }

        .hero-shade {
          position:absolute; inset:0; z-index:1;
          background:${dark
          ? 'linear-gradient(180deg, rgba(12,11,10,0.72) 0%, rgba(12,11,10,0.58) 42%, rgba(12,11,10,0.94) 100%)'
          : 'linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.58) 42%, rgba(255,255,255,0.95) 100%)'};
          pointer-events:none;
          transition:background .3s ease;
        }
        .hero-vignette {
          position:absolute; inset:0; z-index:1;
          background: radial-gradient(ellipse at 45% 25%, rgba(249,93,0,0.12) 0%, transparent 60%);
          pointer-events:none;
        }

        .hero-content { position:relative; z-index:2; }

        /* Animation Fly-in / stagger du hero */
        @keyframes heroFlyIn {
          0%   { opacity:0; transform:translateY(22px); filter:blur(4px); }
          100% { opacity:1; transform:translateY(0); filter:blur(0); }
        }
        .hero-fly { animation: heroFlyIn .8s cubic-bezier(.16,1,.3,1) both; }
        .hero-fly-1 { animation-delay:.15s; }
        .hero-fly-2 { animation-delay:.35s; }
        .hero-fly-3 { animation-delay:.5s; }

        /* Badge live */
        .hero-live-pill {
          display:inline-flex; align-items:center; gap:9px;
          background:${dark ? 'rgba(249,93,0,0.14)' : 'rgba(255,255,255,0.88)'};
          border:1px solid ${dark ? 'rgba(249,93,0,0.35)' : 'rgba(249,93,0,0.3)'};
          box-shadow:0 4px 14px rgba(0,0,0,0.06);
          padding:6px 16px; border-radius:999px;
          backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
        }
        .live-pulse-dot {
          width:8px; height:8px; border-radius:50%;
          background:#10b981;
          box-shadow:0 0 0 0 rgba(16,185,129,0.7);
          animation:liveGreenPulse 2s infinite;
        }
        @keyframes liveGreenPulse {
          0%   { box-shadow:0 0 0 0 rgba(16,185,129,0.7); }
          70%  { box-shadow:0 0 0 8px rgba(16,185,129,0); }
          100% { box-shadow:0 0 0 0 rgba(16,185,129,0); }
        }
        .live-pill-text {
          font-size:.76rem; font-weight:700;
          letter-spacing:.05em; text-transform:uppercase;
          color:${dark ? '#ffb599' : '#c2410c'};
        }

        /* Titre rotatif H1 */
        .hero-title-h1 {
          font-family:'Sora',sans-serif;
          font-weight:800;
          color:${dark ? '#ffffff' : '#0f172a'};
          font-size:clamp(2.1rem, 4.4vw, 3.5rem);
          line-height:1.15;
          letter-spacing:-.025em;
          margin-top:.85rem;
          margin-bottom:.85rem;
          max-width:880px;
        }
        .rotating-word-container {
          display:inline-block;
          position:relative;
          vertical-align:bottom;
          overflow:hidden;
          height:1.24em;
          min-width:180px;
        }
        @media(min-width:640px) {
          .rotating-word-container { min-width:270px; }
        }
        .rotating-word-active {
          display:inline-block;
          background:linear-gradient(135deg, #f95d00 0%, #ff8a3d 100%);
          -webkit-background-clip:text;
          -webkit-text-fill-color:transparent;
          animation:wordSlideUp .45s cubic-bezier(.16,1,.3,1) both;
          font-weight:900;
        }
        @keyframes wordSlideUp {
          0%   { transform:translateY(100%); opacity:0; filter:blur(4px); }
          100% { transform:translateY(0); opacity:1; filter:blur(0); }
        }
        .hero-sub-text {
          color:${dark ? '#cbd5e1' : '#334155'};
          font-size:1.05rem;
          line-height:1.68;
          max-width:680px;
        }

        /* Onglets d'intention (Segmented Tabs) */
        .hero-tabs-wrapper { display:flex; align-items:center; }
        .hero-tabs-dock {
          display:inline-flex; align-items:center; padding:5px; gap:4px;
          background:${dark ? 'rgba(30, 26, 23, 0.78)' : 'rgba(255, 255, 255, 0.92)'};
          border:1px solid ${dark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(16, 15, 13, 0.12)'};
          border-radius:999px;
          backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);
          box-shadow:0 8px 24px rgba(0, 0, 0, 0.14);
        }
        .hero-tab-btn {
          display:inline-flex; align-items:center; gap:8px;
          padding:9px 18px; border-radius:999px;
          font-size:.86rem; font-weight:700;
          border:none; background:transparent;
          color:${dark ? '#cbd5e1' : '#475569'};
          cursor:pointer;
          transition:all .22s cubic-bezier(0.16, 1, 0.3, 1);
          white-space:nowrap;
        }
        .hero-tab-btn:hover {
          color:${dark ? '#ffffff' : '#0f172a'};
          background:${dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)'};
        }
        .hero-tab-btn.active {
          background:#f95d00 !important;
          color:#ffffff !important;
          box-shadow:0 4px 16px rgba(249, 93, 0, 0.4);
        }
        .hero-tab-badge {
          font-size:.62rem; font-weight:800;
          letter-spacing:.05em; padding:2px 7px;
          border-radius:999px; background:rgba(255, 255, 255, 0.22);
          color:#ffffff;
        }

        /* Moteur de recherche Hero — Dock Unifié & Élégant */
        .hero-search-dock {
          background:#ffffff;
          border-radius:24px;
          box-shadow:0 24px 60px -12px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.85);
          transition:all .25s ease;
          position:relative;
          overflow:hidden;
        }
        .dark .hero-search-dock {
          background:rgba(26,24,22,0.96);
          box-shadow:0 24px 60px -12px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.12);
        }

        .hero-dock-fields {
          display:grid;
          grid-template-columns: minmax(180px, 1.4fr) minmax(220px, 1.8fr) minmax(140px, 1.15fr) minmax(110px, 0.9fr) auto auto;
          align-items:center;
          padding:8px 12px;
          gap:6px;
        }
        @media(max-width:1199px) {
          .hero-dock-fields {
            grid-template-columns:1fr 1fr;
            gap:10px; padding:14px;
          }
        }
        @media(max-width:640px) {
          .hero-dock-fields {
            grid-template-columns:1fr;
            gap:10px; padding:14px;
          }
        }

        .hero-dock-cell {
          display:flex; align-items:center; gap:10px;
          padding:10px 14px; height:58px;
          border-radius:14px;
          transition:background .18s ease;
          position:relative;
        }
        .hero-dock-cell:hover, .hero-dock-cell:focus-within {
          background:${dark ? 'rgba(255,255,255,0.06)' : 'rgba(249,93,0,0.04)'};
        }
        @media(min-width:1200px) {
          .hero-dock-cell:not(:last-child):not(.no-divider)::after {
            content:''; position:absolute; right:0; top:20%; height:60%; width:1px;
            background:${dark ? 'rgba(255,255,255,0.1)' : 'rgba(16,15,13,0.08)'};
          }
        }
        @media(max-width:1199px) {
          .hero-dock-cell {
            border:1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,13,35,0.08)'};
          }
        }

        .hero-cell-icon {
          width:36px; height:36px; border-radius:10px;
          background:rgba(249,93,0,0.1); color:#f95d00;
          display:flex; align-items:center; justify-content:center;
          flex-shrink:0;
        }
        .hero-cell-meta { flex:1; min-width:0; }
        .hero-cell-label {
          font-size:.65rem; font-weight:800;
          text-transform:uppercase; letter-spacing:.08em;
          color:${dark ? '#94a3b8' : '#64748b'};
          display:block; line-height:1.1; margin-bottom:2px;
        }
        .hero-cell-input, .hero-cell-select {
          border:none !important; outline:none !important;
          background:transparent !important; width:100%;
          font-size:.9rem; font-weight:600;
          color:${dark ? '#fbffff' : '#0f172a'};
          padding:0;
        }
        .hero-cell-input::placeholder {
          color:${dark ? '#64748b' : '#94a3b8'}; font-weight:500; font-size:.85rem;
        }
        .hero-cell-select {
          cursor:pointer; appearance:none; -webkit-appearance:none;
          padding-right:18px; font-size:.85rem;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23f95d00' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
          background-repeat:no-repeat; background-position:right center;
        }

        /* Bouton Filtres trigger */
        .btn-filter-trigger {
          height:52px; padding:0 18px;
          border-radius:14px;
          border:1.5px solid ${dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'};
          background:${dark ? 'rgba(255,255,255,0.06)' : '#ffffff'};
          color:${dark ? '#cbd5e1' : '#334155'};
          font-weight:700; font-size:.88rem;
          display:inline-flex; align-items:center; gap:8px;
          cursor:pointer; transition:all .2s ease;
          user-select:none;
        }
        .btn-filter-trigger:hover {
          border-color:#f95d00; color:#f95d00;
          background:${dark ? 'rgba(249,93,0,0.1)' : 'rgba(249,93,0,0.04)'};
        }
        .btn-filter-trigger.active {
          border-color:#f95d00;
          background:${dark ? 'rgba(249,93,0,0.18)' : '#fff7ed'};
          color:#ea580c;
        }
        .filter-badge-count {
          min-width:20px; height:20px; padding:0 6px; border-radius:10px;
          background:#f95d00; color:#fff;
          font-size:.72rem; font-weight:800;
          display:inline-flex; align-items:center; justify-content:center;
        }

        /* CTA principal shimmer */
        .btn-hero-cta {
          height:52px; padding:0 24px;
          border-radius:14px; border:none;
          background:linear-gradient(135deg, #f95d00 0%, #ff7624 100%);
          color:#ffffff !important; font-weight:700; font-size:.95rem;
          cursor:pointer; display:inline-flex; align-items:center; justify-content:center;
          gap:8px; box-shadow:0 8px 24px rgba(249,93,0,0.38);
          transition:all .22s ease; position:relative; overflow:hidden;
          white-space:nowrap;
        }
        .btn-hero-cta::before {
          content:''; position:absolute; top:0; left:-100%; width:60%; height:100%;
          background:linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent);
          transform:skewX(-25deg); transition:all .75s ease;
        }
        .btn-hero-cta:hover {
          background:linear-gradient(135deg, #ff7624 0%, #f95d00 100%);
          transform:translateY(-1px) scale(1.02);
          box-shadow:0 12px 30px rgba(249,93,0,0.52);
        }
        .btn-hero-cta:hover::before { left:150%; }
        .btn-hero-cta:hover .cta-arrow { transform:translateX(3px); }
        .cta-arrow { transition:transform .2s ease; }

        /* Tiroir de filtres intégrés dans le dock — Version Premium */
        .hero-dock-expandable-filters {
          padding: 22px 26px 20px;
          border-top: 1.5px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(249,93,0,0.12)'};
          background: ${dark ? 'linear-gradient(180deg, rgba(28,24,21,0.98) 0%, rgba(19,17,15,0.99) 100%)' : 'linear-gradient(180deg, #ffffff 0%, #faf8f5 100%)'};
          border-bottom-left-radius: 24px;
          border-bottom-right-radius: 24px;
          animation: expandFilterTray .25s cubic-bezier(.16,1,.3,1) both;
          box-shadow: ${dark ? '0 12px 32px rgba(0,0,0,0.45)' : '0 16px 36px rgba(0,0,0,0.06)'};
        }
        @keyframes expandFilterTray {
          0% { opacity: 0; transform: translateY(-8px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        .filter-drawer-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
          padding-bottom: 14px;
          border-bottom: 1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
        }
        .filter-drawer-title-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .filter-drawer-icon-box {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: ${dark ? 'rgba(249,93,0,0.18)' : '#fff3eb'};
          color: #f95d00;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(249,93,0,0.2);
          flex-shrink: 0;
        }
        .filter-drawer-title {
          font-family: 'Sora', sans-serif;
          font-size: .92rem;
          font-weight: 800;
          letter-spacing: .01em;
          color: ${dark ? '#f8fafc' : '#0f172a'};
          margin: 0 0 2px 0;
        }
        .filter-drawer-subtitle {
          font-size: .78rem;
          color: ${dark ? '#94a3b8' : '#64748b'};
          margin: 0;
        }

        .btn-filter-reset {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: none;
          color: #f95d00;
          font-size: .78rem;
          font-weight: 700;
          cursor: pointer;
          padding: 6px 10px;
          border-radius: 8px;
          transition: all .2s;
        }
        .btn-filter-reset:hover {
          background: rgba(249,93,0,0.1);
        }
        .btn-filter-close-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'};
          border: 1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'};
          color: ${dark ? '#cbd5e1' : '#475569'};
          font-size: .78rem;
          font-weight: 700;
          cursor: pointer;
          padding: 6px 14px;
          border-radius: 100px;
          transition: all .2s;
        }
        .btn-filter-close-pill:hover {
          color: #f95d00;
          border-color: #f95d00;
          background: rgba(249,93,0,0.06);
        }

        .filter-chips-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 16px;
        }
        .filter-chip-pill {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 9px 16px;
          border-radius: 14px;
          font-size: .86rem;
          font-weight: 600;
          cursor: pointer;
          transition: all .2s cubic-bezier(0.16, 1, 0.3, 1);
          background: ${dark ? 'rgba(255,255,255,0.05)' : '#ffffff'};
          border: 1.5px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'};
          color: ${dark ? '#cbd5e1' : '#334155'};
          box-shadow: 0 1px 3px rgba(0,0,0,0.03);
          user-select: none;
        }
        .filter-chip-pill:hover {
          border-color: #f95d00;
          color: #f95d00;
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(249,93,0,0.14);
        }
        .filter-chip-pill .chip-icon {
          font-size: 19px;
          color: ${dark ? '#94a3b8' : '#64748b'};
          transition: color .2s;
        }
        .filter-chip-pill:hover .chip-icon {
          color: #f95d00;
        }
        .filter-chip-pill .chip-plus-badge {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'};
          color: ${dark ? '#94a3b8' : '#64748b'};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 2px;
          transition: all .2s;
        }
        .filter-chip-pill:hover .chip-plus-badge {
          background: rgba(249,93,0,0.15);
          color: #f95d00;
        }
        .filter-chip-pill.active {
          background: ${dark ? 'rgba(249,93,0,0.18)' : '#fff7ed'};
          border-color: #f95d00;
          color: #ea580c;
          font-weight: 700;
          box-shadow: 0 4px 14px rgba(249,93,0,0.2);
          transform: translateY(-1px);
        }
        .filter-chip-pill.active .chip-icon {
          color: #f95d00;
        }
        .filter-chip-pill.active .chip-check-badge {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #f95d00;
          color: #ffffff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 2px;
        }

        .filter-timeslot-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border-radius: 12px;
          background: ${dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'};
          border: 1px dashed ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'};
          margin-bottom: 14px;
        }
        .filter-timeslot-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: .82rem;
          font-weight: 700;
          color: ${dark ? '#cbd5e1' : '#334155'};
        }
        .filter-time-capsule {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: ${dark ? 'rgba(255,255,255,0.06)' : '#ffffff'};
          border: 1px solid ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
          padding: 5px 10px;
          border-radius: 8px;
        }
        .filter-time-input {
          border: none;
          background: transparent;
          font-size: .82rem;
          font-weight: 700;
          color: ${dark ? '#f8fafc' : '#0f172a'};
          outline: none;
          cursor: pointer;
        }

        .filter-drawer-footer {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding-top: 14px;
          border-top: 1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
        }
        .filter-counter-text {
          font-size: .82rem;
          font-weight: 600;
          color: ${dark ? '#94a3b8' : '#64748b'};
        }
        .btn-apply-filter {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 40px;
          padding: 0 20px;
          border-radius: 12px;
          border: none;
          background: linear-gradient(135deg, #f95d00 0%, #ff7624 100%);
          color: #ffffff;
          font-weight: 700;
          font-size: .86rem;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(249,93,0,0.3);
          transition: all .2s;
        }
        .btn-apply-filter:hover {
          background: linear-gradient(135deg, #ff7624 0%, #f95d00 100%);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(249,93,0,0.45);
        }

        /* Formations dock */
        .formations-dock-fields {
          display:grid;
          grid-template-columns:1.5fr 1.2fr 1fr auto;
          align-items:center;
          padding:8px 12px;
          gap:8px;
        }
        @media(max-width:991px) {
          .formations-dock-fields { grid-template-columns:1fr; }
        }

        /* B2B Card */
        .b2b-hero-card {
          padding:28px 32px;
          background:${dark ? 'rgba(26,24,22,0.96)' : '#ffffff'};
          border-radius:24px;
          box-shadow:0 24px 60px -12px rgba(0,0,0,0.35), 0 0 0 1px rgba(249,93,0,0.2);
        }
        .b2b-card-badge {
          display:inline-flex; align-items:center; gap:6px;
          background:rgba(249,93,0,0.12); color:#f95d00;
          border:1px solid rgba(249,93,0,0.25);
          font-size:.72rem; font-weight:800; text-transform:uppercase;
          letter-spacing:.08em; padding:4px 12px; border-radius:999px;
        }

        /* Barre de réassurance Hero */
        .hero-reassurance-bar {
          display:flex; flex-wrap:wrap; align-items:center; gap:14px;
          padding:10px 20px; border-radius:999px;
          background:${dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.78)'};
          backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
          border:1px solid ${dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(16, 15, 13, 0.08)'};
          box-shadow:0 6px 18px rgba(0,0,0,0.06);
          width:fit-content;
        }
        .reassurance-item {
          display:inline-flex; align-items:center; gap:6px;
          font-size:.78rem; font-weight:700;
          color:${dark ? '#e2e8f0' : '#1e293b'};
        }
        .reassurance-separator {
          width:4px; height:4px; border-radius:50%;
          background:rgba(249, 93, 0, 0.6);
        }
        @media(max-width:640px) {
          .hero-reassurance-bar {
            border-radius:18px; flex-direction:column; align-items:flex-start;
            gap:8px; padding:12px 18px;
          }
          .reassurance-separator { display:none; }
        }

        /* Boutons d'action B2B Hero */
        .btn-primary-hero {
          background:linear-gradient(135deg, #f95d00 0%, #ff7624 100%);
          color:#ffffff !important; border:none; border-radius:14px;
          padding:13px 26px; font-weight:700; font-size:.95rem;
          text-decoration:none !important; transition:all .25s ease;
          display:inline-flex; align-items:center; gap:8px;
          box-shadow:0 8px 24px rgba(249,93,0,.45);
        }
        .btn-primary-hero:hover {
          background:linear-gradient(135deg, #ff7624 0%, #f95d00 100%);
          transform:translateY(-2px);
          box-shadow:0 14px 32px rgba(249,93,0,.6);
        }
        .btn-ghost-hero {
          background:${dark ? 'rgba(255,255,255,0.08)' : '#ffffff'};
          color:${dark ? '#ffffff' : '#100f0d'} !important;
          border:1.5px solid ${dark ? 'rgba(255,255,255,0.2)' : 'rgba(16,15,13,0.15)'};
          border-radius:14px; padding:13px 24px; font-weight:700;
          font-size:.95rem; text-decoration:none !important;
          transition:all .25s ease; display:inline-flex;
          align-items:center; gap:8px; box-shadow:0 6px 18px rgba(0,0,0,.08);
        }
        .btn-ghost-hero:hover {
          border-color:#f95d00; color:#f95d00 !important;
          transform:translateY(-2px);
        }

        /* Flèches slideshow */
        .hero-arrow {
          position:absolute; top:50%; transform:translateY(-50%); z-index:2;
          width:44px; height:44px; border-radius:50%;
          background:rgba(16,15,13,.45); border:1.5px solid rgba(255,255,255,.28);
          color:#fff; display:flex; align-items:center; justify-content:center;
          cursor:pointer; transition:all .2s; backdrop-filter:blur(8px);
          -webkit-backdrop-filter:blur(8px);
        }
        .hero-arrow:hover {
          background:#f95d00; border-color:#f95d00;
          transform:translateY(-50%) scale(1.08);
          box-shadow:0 8px 22px rgba(249,93,0,.45);
        }
        .hero-arrow.prev { left:24px; }
        .hero-arrow.next { right:24px; }

        /* TRUST BAR — 2 LOGOS EN CERCLE (STATIQUES) */
        .trust-bar {
          background: ${dark ? '#1a1612' : '#ffedd8'};
          border-top: 1px solid ${dark ? 'rgba(249,93,0,.2)' : 'rgba(249,93,0,.12)'};
          border-bottom: 1px solid ${dark ? 'rgba(249,93,0,.2)' : 'rgba(249,93,0,.12)'};
          transition: background .3s ease;
        }
        .trust-circle-card {
          width: 104px;
          height: 104px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          text-decoration: none;
          cursor: pointer;
          transition: transform .25s cubic-bezier(0.34, 1.56, 0.64, 1), border-color .25s ease, box-shadow .25s ease;
          position: relative;
          padding: 14px;
          box-sizing: border-box;
        }
        .trust-circle-card:hover {
          transform: translateY(-4px) scale(1.08);
          border-color: #f95d00 !important;
          box-shadow: 0 10px 26px rgba(249,93,0,0.32) !important;
        }
        .trust-circle-card.light-card {
          background: ${dark ? 'rgba(255,255,255,0.96)' : '#ffffff'};
          border: 2px solid ${dark ? 'rgba(249,93,0,0.28)' : 'rgba(249,93,0,0.18)'};
          box-shadow: 0 4px 16px rgba(0,0,0,0.06);
        }
        .trust-circle-card.dark-card {
          background: ${dark ? '#0c1222' : '#1e293b'};
          border: 2px solid ${dark ? 'rgba(249,93,0,0.35)' : '#334155'};
          box-shadow: 0 4px 18px rgba(0,0,0,0.22);
        }
        @media (max-width: 640px) {
          .trust-circle-card {
            width: 88px;
            height: 88px;
            padding: 10px;
          }
        }

        /* PARTNER CARD (EXCLUSIVE PARTNERS NERO & THIRTY THREE) */
        .partner-card {
          position: relative;
          background: ${EC.cardBg};
          border: 1.5px solid ${EC.outline};
          border-radius: 24px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          height: 100%;
          transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.28s ease, border-color 0.28s ease;
          box-shadow: ${dark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.06)'};
        }
        .partner-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 22px 48px rgba(249,93,0,0.22);
          border-color: rgba(249,93,0,0.5);
        }
        .partner-card .partner-visual {
          width: 100%;
          height: 220px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          padding: 24px 32px;
        }
        .partner-card .partner-tag {
          display: inline-block;
          font-size: 0.78rem;
          font-weight: 600;
          padding: 5px 12px;
          border-radius: 8px;
          background: ${EC.bgLow};
          color: ${EC.navy};
          border: 1px solid ${EC.outline};
        }
        .btn-discover-partner {
          transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }
        .btn-discover-partner:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 28px rgba(249,93,0,0.36) !important;
        }
        .btn-discover-partner:hover .material-symbols-outlined {
          transform: translateX(4px);
        }
        .btn-discover-partner .material-symbols-outlined {
          transition: transform 0.2s ease;
        }

        /* KPI */
        .kpi-strip { background:#100f0d; }

        /* SECTION BADGE */
        .sec-badge {
          display:inline-block; font-size:.72rem; font-weight:800;
          letter-spacing:.12em; text-transform:uppercase;
          color:#f95d00; background:rgba(249,93,0,.12);
          padding:5px 14px; border-radius:100px; margin-bottom:.75rem;
        }
        .sec-badge.inv {
          background:rgba(249,93,0,.22); color:#ffb599; border:1px solid rgba(249,93,0,.45);
        }

        /* SPACE CARD */
        .space-card {
          position:relative; border-radius:24px; overflow:hidden;
          border:1px solid rgba(255,255,255,.08);
          box-shadow:0 8px 32px rgba(0,0,0,.35);
          transition:transform .3s ease, box-shadow .3s ease;
        }
        .space-card:hover { transform:translateY(-6px); box-shadow:0 16px 48px rgba(249,93,0,.25); }
        .space-card img { width:100%; height:100%; object-fit:cover; transition:transform .6s ease; }
        .space-card:hover img { transform:scale(1.04); }
        .space-overlay {
          position:absolute; inset:0;
          background:linear-gradient(180deg, rgba(16,15,13,.1) 0%, rgba(16,15,13,.75) 65%, #100f0d 100%);
        }
        .space-body { position:absolute; bottom:0; left:0; right:0; padding:1.5rem; z-index:3; }

        /* CTA SECTION */
        .cta-sec {
          background: linear-gradient(135deg, #100f0d 0%, #1f140a 100%);
          position:relative; overflow:hidden;
        }
        .cta-grid {
          position:absolute; inset:0;
          background-image: linear-gradient(to right, rgba(249,93,0,.08) 1px, transparent 1px),
                            linear-gradient(to bottom, rgba(249,93,0,.08) 1px, transparent 1px);
          background-size:48px 48px; pointer-events:none;
        }

        /* INPUT */
        .ec-input {
          width:100%; padding:12px 16px; border-radius:12px;
          border:1.5px solid ${EC.outline};
          background:${EC.cardBg}; color:${EC.navy};
          font-size:.9rem; font-family:'Inter',sans-serif;
          transition:all .2s;
        }
        .ec-input:focus {
          outline:none; border-color:${EC.cobalt};
          box-shadow:0 0 0 3px rgba(249,93,0,.15);
        }

        /* BACK TO TOP */
        .back-to-top {
          position:fixed; bottom:28px; right:28px; z-index:99;
          width:50px; height:50px; border-radius:50%;
          background: #f95d00;
          color:#ffffff; border:none; box-shadow:0 6px 20px rgba(249,93,0,.45);
          display:flex; align-items:center; justify-content:center;
          cursor:pointer; transition:all .25s ease;
        }
        .back-to-top:hover {
          background: #ff7624;
          transform: translateY(-3px) scale(1.05);
          box-shadow:0 10px 28px rgba(249,93,0,.6);
        }

        /* BADGE PROMO */
        @keyframes promoPulse {
          0%,100% { box-shadow:0 4px 14px rgba(249,93,0,.55); }
          50%     { box-shadow:0 6px 22px rgba(249,93,0,.85); }
        }

        @media(max-width:991px) {
          .hero-arrow { display:none; }
        }
        @media(max-width:479px) {
          .hero-wrap { min-height:80vh; padding:80px 0 48px; }
          .btn-primary-hero, .btn-ghost-hero { padding:11px 20px; font-size:.9rem; }
        }

        /* ══ FOOTER STYLES (Dynamic Light & Dark Modes) ══ */
        .ec-footer {
          background: ${dark ? '#0c0e12' : '#f8fafc'} !important;
          border-top: 1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'} !important;
          color: ${dark ? '#cbd5e1' : '#475569'};
          transition: background .3s ease, border-color .3s ease, color .3s ease;
        }
        .ec-footer .footer-col-title {
          font-family: 'Sora', sans-serif;
          color: ${dark ? '#ffffff' : '#0f172a'} !important;
          font-size: .82rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .08em;
          margin-bottom: 1rem;
        }
        .ec-footer .footer-desc {
          color: ${dark ? '#94a3b8' : '#475569'} !important;
          font-size: .9rem;
          line-height: 1.8;
          max-width: 330px;
          margin: 0;
          font-weight: 500;
        }
        .ec-footer a.footer-link {
          color: ${dark ? '#94a3b8' : '#475569'} !important;
          font-weight: 500;
          font-size: .88rem;
          text-decoration: none !important;
          transition: all .2s ease;
          display: inline-block;
        }
        .ec-footer a.footer-link:hover {
          color: #f95d00 !important;
          transform: translateX(3px);
        }
        .ec-footer .soc-btn {
          border: 1px solid ${dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.1)'} !important;
          background: ${dark ? 'rgba(255,255,255,0.05)' : '#ffffff'} !important;
          color: ${dark ? '#ffffff' : '#0f172a'} !important;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none !important;
          box-shadow: ${dark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)'};
          transition: all .2s ease;
        }
        .ec-footer .soc-btn:hover {
          border-color: #f95d00 !important;
          color: #f95d00 !important;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(249,93,0,0.2) !important;
        }
        .ec-footer .footer-divider {
          border-color: ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'} !important;
          margin: 0;
        }
        .ec-footer .footer-bottom-text {
          color: ${dark ? '#888480' : '#64748b'} !important;
          font-size: .85rem;
          font-weight: 500;
        }
      `}</style>

      {/* ══ NAVBAR ══ */}
      <Navbar session={session} />

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — HERO & TROUVER UN ESPACE (#search / #marketplace / #top)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="search" className="hero-wrap">
        <span id="marketplace" style={{ position: 'absolute', top: 0 }} />
        <span id="top" style={{ position: 'absolute', top: 0 }} />

        {/* Slideshow plein écran en arrière-plan */}
        <div className="hero-bg" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
          {HERO_SLIDES.map((s, i) => (
            <div key={s.src} className={`hero-bg-slide ${i === slide ? 'active' : ''}`} aria-hidden={i !== slide}>
              <img
                src={s.src}
                alt={''}
                loading={i === 0 ? 'eager' : 'lazy'}
                className={i % 2 === 0 ? 'kb-a' : 'kb-b'}
              />
            </div>
          ))}
        </div>
        <div className="hero-shade" />
        <div className="hero-vignette" />

        <div className="hero-content container">
          <div className="row align-items-center g-4">
            <div className="col-lg-12">
              {/* Badge live temps réel */}
              <div className="hero-live-pill mb-3 hero-fly hero-fly-1">
                <span className="live-pulse-dot" />
                <span className="live-pill-text">{t('landing.liveBadge')}</span>
              </div>

              {/* H1 avec rotation de mot-clé fluide */}
              <h1 className="hero-title-h1 hero-fly hero-fly-1">
                {t('landing.heroTitlePrefix')}&nbsp;
                <span className="rotating-word-container">
                  <span key={currentWordIdx} className="rotating-word-active">
                    {rotatingWords[currentWordIdx]}
                  </span>
                </span>&nbsp;
                {t('landing.heroTitleSuffix')}
              </h1>

              {/* Sous-titre bénéfice */}
              <p className="hero-sub-text hero-fly hero-fly-2 mb-4">
                {t('landing.heroSubtext')}
              </p>

              {/* ── SYSTÈME D'ONGLETS D'INTENTION (Segmented Tabs) ── */}
              <div className="hero-tabs-wrapper mb-3 hero-fly hero-fly-2">
                <div className="hero-tabs-dock">
                  <button
                    type="button"
                    onClick={() => setActiveHeroTab('espaces')}
                    className={`hero-tab-btn ${activeHeroTab === 'espaces' ? 'active' : ''}`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>meeting_room</span>
                    <span>{t('landing.tabSpaces')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveHeroTab('formations')}
                    className={`hero-tab-btn ${activeHeroTab === 'formations' ? 'active' : ''}`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>school</span>
                    <span>{t('landing.tabWorkshops')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveHeroTab('b2b')}
                    className={`hero-tab-btn ${activeHeroTab === 'b2b' ? 'active' : ''}`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>domain</span>
                    <span>{t('landing.tabB2B')}</span>
                    <span className="hero-tab-badge">PRO</span>
                  </button>
                </div>
              </div>

              {/* ── CONTENU DYNAMIQUE SELON L'ONGLET SÉLECTIONNÉ ── */}
              {activeHeroTab === 'espaces' && (
                <div className="hero-fly hero-fly-3" style={{ maxWidth: 1140, width: '100%' }}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setShowSearchResults(true);
                      const el = document.getElementById('search-results') || document.getElementById('espaces') || document.getElementById('about');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="hero-search-dock"
                  >
                    <div className="hero-dock-fields">
                      {/* 1. Ville */}
                      <div className="hero-dock-cell">
                        <div className="hero-cell-icon">
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>location_on</span>
                        </div>
                        <div className="hero-cell-meta">
                          <label className="hero-cell-label">{t('landing.city')}</label>
                          <input
                            list="deskywork-villes"
                            value={searchVille}
                            onChange={(e) => setSearchVille(e.target.value)}
                            placeholder="Tunis, Sousse, Sfax..."
                            className="hero-cell-input"
                          />
                          <datalist id="deskywork-villes">
                            {villesDisponibles.map((v) => <option key={v} value={v} />)}
                          </datalist>
                        </div>
                      </div>

                      {/* 2. Typologie d'espace */}
                      <div className="hero-dock-cell">
                        <div className="hero-cell-icon">
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>meeting_room</span>
                        </div>
                        <div className="hero-cell-meta">
                          <label className="hero-cell-label">{t('landing.spaceType')}</label>
                          <select
                            value={searchType}
                            onChange={(e) => setSearchType(e.target.value)}
                            className="hero-cell-select"
                          >
                            <option value="">{t('landing.allTypes')}</option>
                            {SPACE_TYPES.map((st) => (
                              <option key={st.value} value={st.value}>
                                {lang === 'en' ? (st.labelEn || st.label) : st.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* 3. Date */}
                      <div className="hero-dock-cell">
                        <div className="hero-cell-icon">
                          <span className="material-symbols-outlined" style={{ fontSize: 19 }}>calendar_month</span>
                        </div>
                        <div className="hero-cell-meta">
                          <label className="hero-cell-label">{t('landing.date')}</label>
                          <input
                            type="date"
                            value={searchDate}
                            onChange={(e) => setSearchDate(e.target.value)}
                            className="hero-cell-input"
                          />
                        </div>
                      </div>

                      {/* 4. Capacité / Personnes */}
                      <div className="hero-dock-cell no-divider">
                        <div className="hero-cell-icon">
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>group</span>
                        </div>
                        <div className="hero-cell-meta">
                          <label className="hero-cell-label">{t('landing.capacity')}</label>
                          <input
                            type="number"
                            min={1}
                            value={searchCapacite}
                            onChange={(e) => setSearchCapacite(e.target.value)}
                            placeholder="2 pers."
                            className="hero-cell-input"
                          />
                        </div>
                      </div>

                      {/* 5. Bouton Filtres trigger */}
                      <div style={{ padding: '4px' }}>
                        <button
                          type="button"
                          onClick={() => setShowFilterPopover(!showFilterPopover)}
                          className={`btn-filter-trigger ${showFilterPopover || activeFiltersCount > 0 ? 'active' : ''}`}
                          title={(t('landing.filters') || 'Filtres').replace(':', '').trim()}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>tune</span>
                          <span>{(t('landing.filters') || 'Filtres').replace(':', '').trim()}</span>
                          {activeFiltersCount > 0 && (
                            <span className="filter-badge-count">{activeFiltersCount}</span>
                          )}
                          <span
                            className="material-symbols-outlined"
                            style={{
                              fontSize: 18,
                              transition: 'transform .2s ease',
                              transform: showFilterPopover ? 'rotate(180deg)' : 'none',
                              opacity: 0.7,
                            }}
                          >
                            expand_more
                          </span>
                        </button>
                      </div>

                      {/* 6. CTA Principal Shimmer */}
                      <div style={{ padding: '4px' }}>
                        <button type="submit" className="btn-hero-cta">
                          <span>{t('landing.ctaExploreSpaces')}</span>
                          <span className="material-symbols-outlined cta-arrow" style={{ fontSize: 20 }}>arrow_forward</span>
                        </button>
                      </div>
                    </div>

                    {/* Tiroir de filtres intégrés dans le dock — Version Premium */}
                    {showFilterPopover && (
                      <div className="hero-dock-expandable-filters">
                        <div className="filter-drawer-header">
                          <div className="filter-drawer-title-group">
                            <div className="filter-drawer-icon-box">
                              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>tune</span>
                            </div>
                            <div>
                              <h6 className="filter-drawer-title">
                                {(t('landing.filters') || 'Filtres').replace(':', '').trim()} & Équipements inclus
                              </h6>
                              <p className="filter-drawer-subtitle">
                                Cochez les commodités indispensables pour vos séances de travail
                              </p>
                            </div>
                          </div>
                          <div className="d-flex align-items-center gap-2">
                            {searchEquipements.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setSearchEquipements([])}
                                className="btn-filter-reset"
                                title="Effacer tous les filtres"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>restart_alt</span>
                                <span>{t('landing.resetFilters') || 'Réinitialiser'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowFilterPopover(false)}
                              className="btn-filter-close-pill"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                              <span>Fermer</span>
                            </button>
                          </div>
                        </div>

                        {/* 1. Filtres rapides : Partenaire Officiel & Budget */}
                        <div className="mb-4 pb-3" style={{ borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
                          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
                            <button
                              type="button"
                              onClick={() => setSearchPartnerOnly(!searchPartnerOnly)}
                              className={`filter-chip-pill ${searchPartnerOnly ? 'active' : ''}`}
                              style={{ borderColor: searchPartnerOnly ? '#f95d00' : undefined }}
                            >
                              <span className="material-symbols-outlined chip-icon" style={{ color: searchPartnerOnly ? '#f95d00' : '#f59e0b' }}>verified</span>
                              <span className="chip-label">Partenaires officiels uniquement (Nero & Thirty Three)</span>
                              {searchPartnerOnly && (
                                <span className="chip-check-badge">
                                  <span className="material-symbols-outlined" style={{ fontSize: 13, fontWeight: 900 }}>check</span>
                                </span>
                              )}
                            </button>

                            <div className="d-flex align-items-center gap-2">
                              <span style={{ fontSize: '.78rem', fontWeight: 700, color: dark ? '#cbd5e1' : '#475569' }}>
                                Budget max :
                              </span>
                              <div className="d-flex align-items-center gap-1">
                                {[
                                  { label: 'Tous', val: '' },
                                  { label: '≤ 10 DT', val: '10' },
                                  { label: '≤ 25 DT', val: '25' },
                                  { label: '≤ 50 DT', val: '50' },
                                ].map((b) => (
                                  <button
                                    key={b.label}
                                    type="button"
                                    onClick={() => setSearchBudgetMax(searchBudgetMax === b.val ? '' : b.val)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                      searchBudgetMax === b.val
                                        ? 'bg-[#f95d00] text-white shadow-xs'
                                        : dark
                                          ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                    }`}
                                  >
                                    {b.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Capacité minimale rapide */}
                          <div className="d-flex align-items-center gap-2">
                            <span style={{ fontSize: '.78rem', fontWeight: 700, color: dark ? '#cbd5e1' : '#475569' }}>
                              Capacité requise :
                            </span>
                            <div className="d-flex flex-wrap align-items-center gap-1">
                              {[
                                { label: 'Toutes', val: '' },
                                { label: '1+ pers', val: '1' },
                                { label: '4+ pers', val: '4' },
                                { label: '10+ pers', val: '10' },
                                { label: '20+ pers', val: '20' },
                              ].map((c) => (
                                <button
                                  key={c.label}
                                  type="button"
                                  onClick={() => setSearchCapacite(searchCapacite === c.val ? '' : c.val)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                    searchCapacite === c.val
                                      ? 'bg-indigo-600 text-white shadow-xs'
                                      : dark
                                        ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                  }`}
                                >
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* 2. Grille des commodités & équipements */}
                        <div className="mb-2">
                          <label className="d-block mb-2" style={{ fontSize: '.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: dark ? '#94a3b8' : '#64748b' }}>
                            Équipements & Commodités indispensables :
                          </label>
                          <div className="filter-chips-grid">
                            {EQUIPMENTS.map((eq) => {
                              const active = searchEquipements.includes(eq);
                              const icon = EQUIPMENT_ICONS[eq] || 'check_circle';
                              return (
                                <button
                                  key={eq}
                                  type="button"
                                  onClick={() => toggleEquipement(eq)}
                                  className={`filter-chip-pill ${active ? 'active' : ''}`}
                                  aria-pressed={active}
                                >
                                  <span className="material-symbols-outlined chip-icon">{icon}</span>
                                  <span className="chip-label">{eq}</span>
                                  {active ? (
                                    <span className="chip-check-badge">
                                      <span className="material-symbols-outlined" style={{ fontSize: 13, fontWeight: 900 }}>check</span>
                                    </span>
                                  ) : (
                                    <span className="chip-plus-badge">
                                      <span className="material-symbols-outlined" style={{ fontSize: 13, fontWeight: 900 }}>add</span>
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* 3. Ligne de créneau horaire */}
                        <div className="filter-timeslot-row">
                          <div className="filter-timeslot-label">
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f95d00' }}>schedule</span>
                            <span>Créneau horaire souhaité (fuseau Tunis) :</span>
                          </div>
                          <div className="d-flex align-items-center gap-2">
                            <div className="filter-time-capsule">
                              <span style={{ fontSize: '.74rem', color: dark ? '#94a3b8' : '#64748b', fontWeight: 600 }}>De</span>
                              <input
                                type="time"
                                value={searchHeureDebut}
                                onChange={(e) => setSearchHeureDebut(e.target.value)}
                                className="filter-time-input"
                              />
                            </div>
                            <span style={{ color: dark ? '#64748b' : '#94a3b8', fontWeight: 700 }}>→</span>
                            <div className="filter-time-capsule">
                              <span style={{ fontSize: '.74rem', color: dark ? '#94a3b8' : '#64748b', fontWeight: 600 }}>À</span>
                              <input
                                type="time"
                                value={searchHeureFin}
                                onChange={(e) => setSearchHeureFin(e.target.value)}
                                className="filter-time-input"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Pied du tiroir avec actions & compteur en direct */}
                        <div className="filter-drawer-footer">
                          <div className="filter-counter-text">
                            <span className="d-flex align-items-center gap-1.5" style={{ color: '#f95d00', fontWeight: 700 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span>
                              <strong>{filteredEspaces.length}</strong> espace{filteredEspaces.length > 1 ? 's' : ''} disponible{filteredEspaces.length > 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="d-flex align-items-center gap-2">
                            {activeFiltersCount > 0 && (
                              <button
                                type="button"
                                onClick={resetAllFilters}
                                className="btn-filter-reset"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>restart_alt</span>
                                <span>Réinitialiser tout</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setShowFilterPopover(false);
                                const el = document.getElementById('search-results') || document.getElementById('featured');
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                              }}
                              className="btn-apply-filter"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>done_all</span>
                              <span>Voir les {filteredEspaces.length} espaces</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </form>
                </div>
              )}

              {activeHeroTab === 'formations' && (
                <div className="hero-search-dock hero-fly hero-fly-3" style={{ maxWidth: 980 }}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const el = document.getElementById('formations') || document.getElementById('search-results');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="formations-dock-fields"
                  >
                    {/* 1. Mot-clé / Thématique */}
                    <div className="hero-dock-cell">
                      <div className="hero-cell-icon">
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>search</span>
                      </div>
                      <div className="hero-cell-meta">
                        <label className="hero-cell-label">{t('landing.keywordLabel')}</label>
                        <input
                          type="text"
                          value={searchFormationKeyword}
                          onChange={(e) => setSearchFormationKeyword(e.target.value)}
                          placeholder="React, Marketing, IA..."
                          className="hero-cell-input"
                        />
                      </div>
                    </div>

                    {/* 2. Ville */}
                    <div className="hero-dock-cell">
                      <div className="hero-cell-icon">
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>location_on</span>
                      </div>
                      <div className="hero-cell-meta">
                        <label className="hero-cell-label">{t('landing.city')}</label>
                        <input
                          list="deskywork-villes"
                          value={searchFormationVille}
                          onChange={(e) => setSearchFormationVille(e.target.value)}
                          placeholder="Tunis, Sousse..."
                          className="hero-cell-input"
                        />
                      </div>
                    </div>

                    {/* 3. Date */}
                    <div className="hero-dock-cell no-divider">
                      <div className="hero-cell-icon">
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>calendar_month</span>
                      </div>
                      <div className="hero-cell-meta">
                        <label className="hero-cell-label">{t('landing.date')}</label>
                        <input
                          type="date"
                          value={searchFormationDate}
                          onChange={(e) => setSearchFormationDate(e.target.value)}
                          className="hero-cell-input"
                        />
                      </div>
                    </div>

                    {/* 4. CTA Formations */}
                    <div style={{ padding: '4px' }}>
                      <button type="submit" className="btn-hero-cta">
                        <span>{t('landing.ctaExploreWorkshops')}</span>
                        <span className="material-symbols-outlined cta-arrow" style={{ fontSize: 20 }}>arrow_forward</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {activeHeroTab === 'b2b' && (
                <div className="b2b-hero-card hero-fly hero-fly-3" style={{ maxWidth: 860 }}>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span className="b2b-card-badge">
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>domain</span>
                      B2B Coworking & Formation
                    </span>
                  </div>
                  <h3 className="sora fw-bold mb-2" style={{ fontSize: '1.28rem', color: dark ? '#ffffff' : '#0f172a' }}>
                    {t('landing.b2bHeadline')}
                  </h3>
                  <p style={{ fontSize: '.95rem', lineHeight: 1.6, color: dark ? '#cbd5e1' : '#475569', marginBottom: '1.25rem', maxWidth: 680 }}>
                    {t('landing.b2bSubtitle')}
                  </p>
                  <div className="d-flex flex-wrap align-items-center gap-3">
                    <Link to="/register?role=coworking" className="btn-primary-hero">
                      <span>{t('landing.b2bCtaRegister')}</span>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
                    </Link>
                    <a
                      href="#tarifs"
                      onClick={(e) => {
                        e.preventDefault();
                        const el = document.getElementById('tarifs');
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="btn-ghost-hero"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>workspace_premium</span>
                      <span>{t('landing.b2bCtaPricing')}</span>
                    </a>
                  </div>
                </div>
              )}

              {/* ── BARRE DE RÉASSURANCE DISCRÈTE (SOCIAL PROOF) ── */}
              <div className="hero-reassurance-bar hero-fly hero-fly-3">
                <span className="reassurance-item">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 16 }}>verified</span>
                  {t('landing.reassurance1')}
                </span>
                <span className="reassurance-separator" />
                <span className="reassurance-item">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 16 }}>payments</span>
                  {t('landing.reassurance2')}
                </span>
                <span className="reassurance-separator" />
                <span className="reassurance-item">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 16 }}>receipt_long</span>
                  {t('landing.reassurance3')}
                </span>
                <span className="reassurance-separator" />
                <span className="reassurance-item">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 16 }}>account_circle</span>
                  {t('landing.reassurance4')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Flèches ancrés sur les côtés du hero */}
        <button type="button" className="hero-arrow prev" onClick={() => goSlide(-1)} aria-label="Image précédente">
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_left</span>
        </button>
        <button type="button" className="hero-arrow next" onClick={() => goSlide(1)} aria-label="Image suivante">
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_right</span>
        </button>
      </section>

      {/* ══ TRUST BAR (PARTENAIRES HISTORIQUES — 2 LOGOS EN CERCLE) ══ */}
      <section id="partenaires-logos" className="trust-bar py-5" style={{ scrollMarginTop: '100px' }}>
        <div className="container">
          <p className="text-center mb-4" style={{ color: EC.cobalt, fontSize: '.76rem', fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase' }}>
            {t('landing.trustText')}
          </p>
          <div className="d-flex flex-wrap justify-content-center align-items-center gap-4 gap-sm-5">
            <Link
              to="/coworking/thirty-three-space"
              title="Thirty Three Space — Partenaire officiel"
              className="trust-circle-card light-card"
            >
              <img
                src={partnerThirtyThree}
                alt="Thirty Three Space"
                style={{ width: '64px', height: '64px', objectFit: 'contain', display: 'block' }}
              />
            </Link>

            <Link
              to="/coworking/nero-coworking"
              title="Néro Coworking Space — Partenaire officiel"
              className="trust-circle-card dark-card"
            >
              <img
                src={partnerNero}
                alt="Néro Coworking Space"
                style={{
                  width: '74px',
                  height: '34px',
                  objectFit: 'contain',
                  display: 'block',
                  filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))',
                }}
              />
            </Link>
          </div>
        </div>
      </section>

      {/* ══ KPI STRIP ══ */}
      <section className="kpi-strip py-5">
        <div className="container">
          <div className="row g-4 justify-content-center">
            {[
              { value: 200, suffix: '+', label: t('landing.kpiMembers') },
              { value: 12, suffix: '', label: t('landing.kpiSpaces') },
              { value: 98, suffix: '%', label: t('landing.kpiSatisfaction') },
              { value: 3, suffix: '+', label: t('landing.kpiExperience') },
            ].map((k, i) => (
              <div key={i} className="col-6 col-md-3">
                <KpiCounter {...k} dark={dark} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ RÉSULTATS RECHERCHE MULTI-CRITÈRES (SI RECHERCHE ACTIVE) ══ */}
      {(showSearchResults || searchVille || searchType || searchCapacite || searchEquipements.length > 0) && (
        <section id="search-results" className="py-5" style={{ backgroundColor: EC.bg, borderBottom: `1px solid ${EC.outline}` }}>
          <div className="container py-2">
            {/* En-tête des résultats & Filtres actifs */}
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
              <div>
                <span className="sec-badge">{t('landing.searchResultsBadge')}</span>
                <h2 className="sora fw-bold mb-1" style={{ color: EC.navy, fontSize: 'clamp(1.4rem,2.4vw,1.9rem)' }}>
                  {filteredEspaces.length} espace{filteredEspaces.length > 1 ? 's' : ''} trouvé{filteredEspaces.length > 1 ? 's' : ''}
                </h2>
                <p style={{ color: EC.muted, fontSize: '.85rem', margin: 0 }}>
                  Espaces de travail professionnels prêts à réserver chez nos partenaires.
                </p>
              </div>
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="d-flex align-items-center gap-1.5"
                  style={{
                    background: 'transparent', border: `1.5px solid ${EC.outline}`,
                    borderRadius: 12, padding: '8px 16px', fontSize: '.82rem', fontWeight: 700, color: '#f95d00', cursor: 'pointer',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>restart_alt</span>
                  <span>Réinitialiser les filtres ({activeFiltersCount})</span>
                </button>
              )}
            </div>

            {/* Barre de badges / pills de filtres actifs */}
            {activeFiltersCount > 0 && (
              <div className="d-flex flex-wrap align-items-center gap-2 mb-4 p-3 rounded-2xl" style={{ background: dark ? 'rgba(255,255,255,0.04)' : '#f1f5f9' }}>
                <span style={{ fontSize: '.76rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: EC.muted, marginRight: 4 }}>
                  Filtres actifs :
                </span>
                {searchVille && (
                  <span className="d-inline-flex align-items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f95d00' }}>location_on</span>
                    {searchVille}
                    <button type="button" onClick={() => setSearchVille('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 2, color: '#94a3b8' }}>✕</button>
                  </span>
                )}
                {searchType && (
                  <span className="d-inline-flex align-items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f95d00' }}>category</span>
                    {SPACE_TYPE_LABELS[searchType] || searchType}
                    <button type="button" onClick={() => setSearchType('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 2, color: '#94a3b8' }}>✕</button>
                  </span>
                )}
                {searchPartnerOnly && (
                  <span className="d-inline-flex align-items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: '#fff7ed', border: '1px solid #fdba74', color: '#ea580c' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f95d00' }}>verified</span>
                    Partenaires officiels (Nero & Thirty Three)
                    <button type="button" onClick={() => setSearchPartnerOnly(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 2, color: '#ea580c' }}>✕</button>
                  </span>
                )}
                {searchBudgetMax && (
                  <span className="d-inline-flex align-items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f95d00' }}>payments</span>
                    Max {searchBudgetMax} DT/h
                    <button type="button" onClick={() => setSearchBudgetMax('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 2, color: '#94a3b8' }}>✕</button>
                  </span>
                )}
                {searchCapacite && (
                  <span className="d-inline-flex align-items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f95d00' }}>group</span>
                    {searchCapacite}+ pers
                    <button type="button" onClick={() => setSearchCapacite('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 2, color: '#94a3b8' }}>✕</button>
                  </span>
                )}
                {searchEquipements.map((eq) => (
                  <span key={eq} className="d-inline-flex align-items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f95d00' }}>{EQUIPMENT_ICONS[eq] || 'check'}</span>
                    {eq}
                    <button type="button" onClick={() => toggleEquipement(eq)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 2, color: '#94a3b8' }}>✕</button>
                  </span>
                ))}
              </div>
            )}

            {/* Onglets segmentés rapides de type d'espace */}
            <div className="d-flex flex-wrap gap-2 mb-4">
              {[
                { label: 'Tous les espaces', val: '', icon: 'apps' },
                { label: 'Open Space', val: 'open_space', icon: 'chair' },
                { label: 'Bureaux Privés', val: 'private_office', icon: 'meeting_room' },
                { label: 'Salles de Réunion', val: 'meeting_room', icon: 'groups' },
                { label: 'Salles de Formation', val: 'training_room', icon: 'school' },
                { label: 'Événements', val: 'event_space', icon: 'celebration' },
              ].map((tab) => {
                const isAct = searchType === tab.val;
                return (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => setSearchType(isAct && tab.val !== '' ? '' : tab.val)}
                    className="d-flex align-items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
                    style={{
                      backgroundColor: isAct ? '#f95d00' : dark ? 'rgba(255,255,255,0.06)' : '#ffffff',
                      color: isAct ? '#ffffff' : EC.navy,
                      border: `1.5px solid ${isAct ? '#f95d00' : EC.outline}`,
                      cursor: 'pointer',
                      boxShadow: isAct ? '0 4px 14px rgba(249,93,0,0.25)' : undefined,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {filteredEspaces.length === 0 ? (
              <div className="text-center p-5" style={{ backgroundColor: EC.cardBg, borderRadius: 20, border: `1px solid ${EC.outline}` }}>
                <p style={{ color: EC.muted, margin: 0 }}>{t('landing.noResults')}</p>
              </div>
            ) : (
              <div className="row g-4">
                {filteredEspaces.slice(0, 9).map((esp) => {
                  const img = esp.photo_url || (Array.isArray(esp.photos_urls) && esp.photos_urls[0]) || esp.tenants?.cover_url || esp.tenants?.logo_url || '/images/coworking/space-1.jpg';
                  return (
                    <div key={esp.id} className="col-md-6 col-lg-4">
                      <div style={{ backgroundColor: EC.cardBg, borderRadius: 20, overflow: 'hidden', border: `1.5px solid ${EC.outline}`, height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Link to={buildSearchBookingLink(esp)} className="d-block cursor-pointer overflow-hidden" title={`Réserver ${esp.nom}`}>
                          <img src={img} alt={esp.nom} style={{ height: 170, width: '100%', objectFit: 'cover', display: 'block', transition: 'transform .3s ease' }} className="hover-scale" loading="lazy" />
                        </Link>
                        <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <div className="d-flex align-items-center gap-1.5">
                              <span style={{ fontSize: '.7rem', fontWeight: 800, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999, background: EC.cobaltLight, color: dark ? '#ffb599' : '#100f0d' }}>
                                {SPACE_TYPE_LABELS[esp.type] || esp.type}
                              </span>
                              {/nero|thirty\s*three/i.test(esp.tenants?.nom || '') && (
                                <span style={{ fontSize: '.65rem', fontWeight: 800, padding: '3px 8px', borderRadius: 999, background: '#fff7ed', color: '#ea580c', border: '1px solid #fdba74' }}>
                                  ★ Partenaire
                                </span>
                              )}
                            </div>
                            <span className="sora fw-bold" style={{ color: EC.cobalt, fontSize: '.95rem' }}>
                              {formatDT(esp.tarif_horaire)} {t('landing.perHour')}
                            </span>
                          </div>
                          <h4 className="sora fw-bold mb-1" style={{ color: EC.navy, fontSize: '1.05rem' }}>
                            <Link to={buildSearchBookingLink(esp)} style={{ color: 'inherit', textDecoration: 'none' }} className="hover:underline">
                              {esp.nom}
                            </Link>
                          </h4>
                          <p style={{ color: EC.muted, fontSize: '.82rem', marginBottom: '0.75rem' }}>
                            {esp.tenants?.nom || 'Établissement'} {esp.tenants?.ville ? `· ${esp.tenants.ville}` : ''} · {t('landing.capacityPers', { count: esp.capacite })}
                          </p>
                          <div className="mt-auto d-flex gap-2">
                            <Link
                              to={buildSearchBookingLink(esp)}
                              className="btn flex-grow-1"
                              style={{ backgroundColor: EC.cobalt, color: '#fff', borderRadius: 10, padding: '9px 12px', fontWeight: 700, fontSize: '.84rem', textDecoration: 'none', textAlign: 'center' }}
                            >
                              {t('landing.bookBtn')}
                            </Link>
                            {esp.tenant_id && (
                              <Link
                                to={`/coworking/${esp.tenant_id}`}
                                className="btn"
                                style={{ border: `1.5px solid ${EC.outline}`, color: EC.navy, borderRadius: 10, padding: '9px 12px', fontWeight: 600, fontSize: '.84rem', textDecoration: 'none' }}
                              >
                                {t('landing.viewCardBtn')}
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — À PROPOS (#about / #avantages)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="about" className="py-5" style={{ backgroundColor: EC.bgLow, transition: 'background .3s ease' }}>
        <span id="avantages" style={{ position: 'absolute', top: 0 }} />
        <div className="container py-4">
          <div className="row mb-5">
            <div className="col-lg-9 col-xl-8">
              <span className="sec-badge">{t('landing.aboutBadge')}</span>
              <h2 className="sora fw-bold mb-3" style={{ color: EC.navy, fontSize: 'clamp(1.8rem,3vw,2.4rem)', letterSpacing: '-.02em' }}>
                {t('landing.aboutTitle')}
              </h2>
              <p style={{ color: EC.muted, fontSize: '1.05rem', lineHeight: 1.8 }}>
                {t('landing.aboutSubtitle')}
              </p>
            </div>
          </div>
          <div className="row g-4">
            {features.map((f, i) => <FeatureCard key={i} {...f} dark={dark} />)}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3 — ÉTABLISSEMENTS MIS EN AVANT (#featured / #espaces)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="featured" className="py-5" style={{ backgroundColor: '#100f0d' }}>
        <span id="espaces" style={{ position: 'absolute', top: 0 }} />
        <div className="container py-4">
          <div className="text-center mb-5">
            <span className="sec-badge inv">{t('landing.featuredBadge')}</span>
            <h2 className="sora fw-bold text-white mb-3" style={{ fontSize: 'clamp(1.8rem,3vw,2.4rem)' }}>
              {t('landing.featuredTitle')}
            </h2>
            <p style={{ color: '#cfcac3', maxWidth: 600, margin: '0 auto', lineHeight: 1.8 }}>
              {t('landing.featuredSubtitle')}
            </p>
          </div>
          {rotatedTenants.length === 0 ? (
            <div className="text-center py-5">
              <p style={{ color: '#cfcac3', fontSize: '1rem' }}>{t('landing.noEstablishments')}</p>
            </div>
          ) : (
            <div className="row g-4">
              {rotatedTenants.map((tenant) => (
                <div key={tenant.id} className="col-lg-4">
                  <div
                    className="space-card cursor-pointer group"
                    style={{ minHeight: 400, position: 'relative', borderRadius: 24, overflow: 'hidden' }}
                    onClick={() => navigate(`/coworking/${tenant.id}`)}
                  >
                    <Link
                      to={`/coworking/${tenant.id}`}
                      className="d-block w-100 h-100 cursor-pointer"
                      title={`Voir la fiche de ${tenant.nom}`}
                    >
                      <img
                        src={tenant.cover_url || tenant.logo_url || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=600&fit=crop'}
                        alt={tenant.nom}
                        loading="lazy"
                        decoding="async"
                        style={{ cursor: 'pointer', height: '100%', objectFit: 'cover' }}
                      />
                      <div className="space-overlay cursor-pointer" />
                    </Link>

                    {/* Badge Pack Premium « Mis en avant » (CDC v3.0 D6) */}
                    {tenant.is_featured && (
                      <div style={{
                        position: 'absolute', top: 16, left: 16,
                        background: 'rgba(16,15,13,0.92)', color: '#ffb599',
                        border: '1px solid rgba(249,93,0,0.7)',
                        borderRadius: 10, padding: '6px 12px',
                        fontSize: '.7rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase',
                        display: 'flex', alignItems: 'center', gap: 5, zIndex: 5,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                      }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#f95d00' }}>workspace_premium</span>
                        {t('landing.featuredBadgeTag')}
                      </div>
                    )}

                    {/* Badge PROMO */}
                    {tenant.has_promo && (
                      <div style={{
                        position: 'absolute', top: 16, right: 16,
                        background: 'linear-gradient(135deg,#f95d00,#ff8a3d)',
                        color: '#fff', borderRadius: 10, padding: '6px 12px',
                        fontSize: '.7rem', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
                        display: 'flex', alignItems: 'center', gap: 5,
                        boxShadow: '0 4px 14px rgba(249,93,0,.55)', zIndex: 5,
                        animation: 'promoPulse 2.4s ease-in-out infinite',
                      }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>local_offer</span>
                        {t('landing.promoTag')}
                        {tenant.promo_count > 1 && (
                          <span style={{ background: 'rgba(255,255,255,.3)', borderRadius: 6, padding: '1px 6px', fontSize: '.65rem', fontWeight: 700 }}>
                            ×{tenant.promo_count}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="space-body" style={{ background: 'linear-gradient(180deg, transparent 0%, rgba(16,15,13,0.85) 35%, #100f0d 100%)', paddingTop: '3rem' }}>
                      <span style={{ backgroundColor: '#f95d00', color: '#ffffff', borderRadius: 8, padding: '4px 12px', fontSize: '.72rem', fontWeight: 800, display: 'inline-block', marginBottom: 8, letterSpacing: '.04em' }}>
                        {tenant.ville || tenant.pays || 'Tunisie'}
                      </span>
                      <h3 className="sora fw-bold mb-2" style={{ color: '#ffffff' }}>
                        <Link to={`/coworking/${tenant.id}`} className="text-decoration-none hover-underline cursor-pointer" style={{ color: '#ffffff' }}>
                          {tenant.nom}
                        </Link>
                      </h3>
                      <p className="mb-2" style={{ color: '#e6ded7', fontSize: '.88rem', maxWidth: 460, lineHeight: 1.5 }}>
                        {tenant.description || 'Établissement partenaire DeskyWork.'}
                      </p>
                      <div className="d-flex align-items-center gap-3 mb-3" style={{ color: '#cfcac3', fontSize: '.8rem' }}>
                        {tenant.adresse && (
                          <span className="d-inline-flex align-items-center gap-1">
                            <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#f95d00' }}>location_on</span>
                            {tenant.adresse}
                          </span>
                        )}
                      </div>

                      <div className="d-flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        <Link
                          to={`/coworking/${tenant.id}`}
                          className="btn d-inline-flex align-items-center gap-2"
                          style={{ backgroundColor: '#f95d00', color: '#ffffff', borderRadius: 12, padding: '10px 18px', fontWeight: 700, border: 'none', fontSize: '.88rem', transition: 'all .25s', boxShadow: '0 4px 14px rgba(249,93,0,0.35)' }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>visibility</span>
                          {t('landing.viewEstablishment')}
                        </Link>
                        {tenant.has_promo ? (
                          <button
                            onClick={() => setPromoTenant(tenant)}
                            className="btn d-inline-flex align-items-center gap-2"
                            style={{
                              background: 'linear-gradient(135deg,#f95d00,#ff8a3d)',
                              color: '#ffffff', border: 'none', borderRadius: 12,
                              padding: '10px 18px', fontWeight: 700, fontSize: '.88rem',
                              cursor: 'pointer', boxShadow: '0 4px 14px rgba(249,93,0,.4)',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_offer</span>
                            {t('landing.promotionsBtn')}
                          </button>
                        ) : (
                          <Link
                            to={`/coworking/${tenant.id}`}
                            className="btn d-inline-flex align-items-center gap-2"
                            style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: '#ffffff', border: '1.5px solid rgba(255,255,255,0.7)', borderRadius: 12, padding: '10px 18px', fontWeight: 700, fontSize: '.88rem' }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>event_available</span>
                            {t('landing.bookEstablishment')}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ══ TYPOLOGIES D'ESPACES (7 TYPES OFFICIELS CDC v3.0) ══ */}
      <section className="py-5" style={{ backgroundColor: EC.bg, transition: 'background .3s ease' }}>
        <div className="container py-3">
          <div className="text-center mb-4">
            <span className="sec-badge">7 Typologies Officielles</span>
            <h2 className="sora fw-bold mb-2" style={{ color: EC.navy, fontSize: 'clamp(1.6rem,2.6vw,2.1rem)' }}>
              Des espaces adaptés à chaque usage
            </h2>
          </div>
          <div className="row g-3 justify-content-center">
            {SPACE_TYPES.map((st) => (
              <div key={st.value} className="col-6 col-md-4 col-lg-3">
                <button
                  type="button"
                  onClick={() => {
                    setSearchType(st.value);
                    setShowSearchResults(true);
                    const el = document.getElementById('search-results') || document.getElementById('search');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="w-100 text-start p-3 rounded-4 transition-all"
                  style={{
                    backgroundColor: searchType === st.value ? EC.cobaltLight : EC.cardBg,
                    border: searchType === st.value ? `2px solid ${EC.cobalt}` : `1.5px solid ${EC.outline}`,
                    cursor: 'pointer',
                  }}
                >
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <span className="material-symbols-outlined" style={{ color: EC.cobalt, fontSize: 22 }}>{st.icon}</span>
                    <span className="sora fw-bold" style={{ color: EC.navy, fontSize: '.9rem' }}>
                      {lang === 'en' ? (st.labelEn || st.label) : st.label}
                    </span>
                  </div>
                  <p className="mb-0 text-truncate" style={{ color: EC.muted, fontSize: '.76rem' }}>
                    {st.desc}
                  </p>
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4 — TARIFS & ABONNEMENTS (#tarifs / #pricing)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="tarifs" className="py-5" style={{ backgroundColor: EC.bgLow, transition: 'background .3s ease' }}>
        <span id="pricing" style={{ position: 'absolute', top: 0 }} />
        <div className="container py-4">
          <div className="text-center mb-5">
            <span className="sec-badge">{t('landing.pricingBadge')}</span>
            <h2 className="sora fw-bold mb-3" style={{ color: EC.navy, fontSize: 'clamp(1.8rem,3vw,2.4rem)' }}>
              {t('landing.pricingTitle')}
            </h2>
            <p style={{ color: EC.muted, maxWidth: 580, margin: '0 auto', lineHeight: 1.8 }}>
              {t('landing.pricingSubtitle')}
            </p>
          </div>
          <div className="row g-4 align-items-stretch">
            {plans.map((p, i) => <PricingCard key={i} {...p} dark={dark} />)}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5 — PARTENAIRES EXCLUSIFS (#partenaires)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="partenaires" className="py-5" style={{ backgroundColor: EC.bg, transition: 'background .3s ease', scrollMarginTop: '90px' }}>
        <span id="entreprises" style={{ position: 'absolute', top: 0 }} />
        <div className="container py-4">
          <div className="text-center mb-5">
            <span className="sec-badge">{t('landing.partnersBadge')}</span>
            <h2 className="sora fw-bold mb-3" style={{ color: EC.navy, fontSize: 'clamp(1.7rem,2.8vw,2.3rem)' }}>
              {t('landing.partnersTitle')}
            </h2>
            <p style={{ color: EC.muted, maxWidth: 680, margin: '0 auto', lineHeight: 1.8, fontSize: '1.02rem' }}>
              {t('landing.partnersSubtitle')}
            </p>
          </div>

          <div className="row justify-content-center g-4">
            {/* 1. NERO COWORKING SPACE */}
            <div className="col-lg-5 col-md-6 col-12">
              <div className="partner-card">
                <div
                  className="partner-visual"
                  style={{
                    background: 'linear-gradient(135deg, #1e293b 0%, #334155 50%, #1e293b 100%)',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    padding: '24px 32px',
                  }}
                >
                  <img
                    src={partnerNero}
                    alt="Nero Coworking Space"
                    style={{
                      height: 115,
                      maxHeight: 120,
                      maxWidth: '88%',
                      width: 'auto',
                      objectFit: 'contain',
                      display: 'block',
                      filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 14,
                      right: 14,
                      background: 'rgba(15,23,42,0.85)',
                      border: '1px solid rgba(249,93,0,0.5)',
                      color: '#ffb599',
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: '.68rem',
                      fontWeight: 800,
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      backdropFilter: 'blur(6px)',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#f95d00' }}>verified</span>
                    {t('landing.officialPartnerBadge')}
                  </div>
                </div>

                <div style={{ padding: '1.8rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span
                      style={{
                        background: EC.soft,
                        border: `1px solid ${EC.outline}`,
                        color: EC.cobalt,
                        fontSize: '.75rem',
                        fontWeight: 700,
                        borderRadius: 999,
                        padding: '3px 10px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14, color: EC.cobalt }}>location_on</span>
                      Tunis · Ennasr 2
                    </span>
                  </div>

                  <h3 className="sora fw-bold mb-2" style={{ color: EC.navy, fontSize: '1.35rem' }}>
                    {t('landing.neroTitle')}
                  </h3>

                  <p style={{ color: EC.muted, fontSize: '.92rem', lineHeight: 1.75, marginBottom: '1.25rem', flex: 1 }}>
                    {t('landing.neroDesc')}
                  </p>

                  <div className="d-flex flex-wrap gap-2 mb-4">
                    <span className="partner-tag">{t('landing.neroTag1')}</span>
                    <span className="partner-tag">{t('landing.neroTag2')}</span>
                    <span className="partner-tag">{t('landing.neroTag3')}</span>
                  </div>

                  <Link
                    to="/coworking/nero-coworking"
                    className="btn-discover-partner"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '12px 20px',
                      borderRadius: 14,
                      background: 'linear-gradient(135deg, #f95d00 0%, #ea580c 100%)',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '.92rem',
                      textDecoration: 'none',
                      boxShadow: '0 8px 20px rgba(249,93,0,0.22)',
                      transition: 'transform .2s ease, box-shadow .2s ease',
                    }}
                  >
                    <span>{t('landing.discoverSpace')}</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
                  </Link>
                </div>
              </div>
            </div>

            {/* 2. THIRTY THREE SPACE */}
            <div className="col-lg-5 col-md-6 col-12">
              <div className="partner-card">
                <div
                  className="partner-visual"
                  style={{
                    background: '#ffffff',
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                    padding: '20px 32px',
                  }}
                >
                  <img
                    src={partnerThirtyThree}
                    alt="Thirty Three Space"
                    style={{
                      height: 145,
                      maxHeight: 150,
                      maxWidth: '85%',
                      width: 'auto',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 14,
                      right: 14,
                      background: 'rgba(255,255,255,0.92)',
                      border: '1px solid rgba(249,93,0,0.4)',
                      color: '#f95d00',
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: '.68rem',
                      fontWeight: 800,
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#f95d00' }}>verified</span>
                    {t('landing.officialPartnerBadge')}
                  </div>
                </div>

                <div style={{ padding: '1.8rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span
                      style={{
                        background: EC.soft,
                        border: `1px solid ${EC.outline}`,
                        color: EC.cobalt,
                        fontSize: '.75rem',
                        fontWeight: 700,
                        borderRadius: 999,
                        padding: '3px 10px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14, color: EC.cobalt }}>location_on</span>
                      Tunis · Les Berges du Lac 2
                    </span>
                  </div>

                  <h3 className="sora fw-bold mb-2" style={{ color: EC.navy, fontSize: '1.35rem' }}>
                    {t('landing.thirtyTitle')}
                  </h3>

                  <p style={{ color: EC.muted, fontSize: '.92rem', lineHeight: 1.75, marginBottom: '1.25rem', flex: 1 }}>
                    {t('landing.thirtyDesc')}
                  </p>

                  <div className="d-flex flex-wrap gap-2 mb-4">
                    <span className="partner-tag">{t('landing.thirtyTag1')}</span>
                    <span className="partner-tag">{t('landing.thirtyTag2')}</span>
                    <span className="partner-tag">{t('landing.thirtyTag3')}</span>
                  </div>

                  <Link
                    to="/coworking/thirty-three-space"
                    className="btn-discover-partner"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '12px 20px',
                      borderRadius: 14,
                      background: 'linear-gradient(135deg, #f95d00 0%, #ea580c 100%)',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '.92rem',
                      textDecoration: 'none',
                      boxShadow: '0 8px 20px rgba(249,93,0,0.22)',
                      transition: 'transform .2s ease, box-shadow .2s ease',
                    }}
                  >
                    <span>{t('landing.discoverSpace')}</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5.5 — POUR LES ENTREPRISES (#entreprises)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="entreprises" className="py-5" style={{ backgroundColor: EC.bgLow, transition: 'background .3s ease', scrollMarginTop: '90px' }}>
        <div className="container py-4">
          <div className="row align-items-center g-5">
            <div className="col-lg-6">
              <span className="sec-badge" style={{ backgroundColor: 'rgba(249,93,0,0.12)', color: '#f95d00', border: '1px solid rgba(249,93,0,0.3)' }}>
                B2B &amp; Sociétés
              </span>
              <h2 className="sora fw-bold mt-2 mb-3" style={{ color: EC.navy, fontSize: 'clamp(1.8rem,3vw,2.4rem)', lineHeight: 1.2 }}>
                DeskyWork pour les Entreprises : Réservez <span style={{ color: '#f95d00' }}>sans aucun frais</span>.
              </h2>
              <p style={{ color: EC.muted, fontSize: '1.02rem', lineHeight: 1.7, marginBottom: '1.75rem' }}>
                Startups, PME et grands comptes : trouvez et réservez gratuitement vos postes nomades, bureaux privatifs et salles de réunion auprès de tous les coworkings partenaires DeskyWork en Tunisie, sans surcoût ni intermédiaire.
              </p>

              <div className="d-flex flex-column gap-3 mb-4">
                {[
                  {
                    icon: 'verified',
                    title: 'Réservation 100% sans surcoût pour l\'entreprise',
                    desc: 'Tarifs directs des établissements partenaires. Aucun frais d\'intermédiation sur vos réservations.',
                  },
                  {
                    icon: 'apartment',
                    title: 'Offres de domiciliation d\'entreprise avantageuses',
                    desc: 'Installez votre siège social auprès d\'adresses renommées (Nero à Ennasr 2, Thirty Three au Lac 2) avec contrat direct.',
                  },
                  {
                    icon: 'receipt_long',
                    title: 'Profil B2B enrichi & Reçus fiscaux PDF',
                    desc: 'Pré-remplissage automatique (Raison sociale, Matricule fiscal, interlocuteur) et téléchargement de vos factures et reçus.',
                  },
                ].map((item, idx) => (
                  <div key={idx} className="d-flex align-items-start gap-3">
                    <span
                      style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        backgroundColor: 'rgba(249,93,0,0.12)', color: '#f95d00',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{item.icon}</span>
                    </span>
                    <div>
                      <h5 className="sora fw-bold mb-1" style={{ fontSize: '.95rem', color: EC.navy }}>{item.title}</h5>
                      <p style={{ fontSize: '.85rem', color: EC.muted, margin: 0, lineHeight: 1.5 }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="d-flex flex-wrap align-items-center gap-3">
                <Link
                  to="/register?role=entreprise"
                  className="btn"
                  style={{
                    backgroundColor: '#f95d00', color: '#ffffff',
                    borderRadius: 14, padding: '12px 24px', fontWeight: 700, fontSize: '.95rem',
                    boxShadow: '0 6px 20px rgba(249,93,0,0.35)', border: 'none',
                  }}
                >
                  Créer un compte Entreprise (Gratuit) →
                </Link>
                <a
                  href="#espaces"
                  className="btn"
                  style={{
                    backgroundColor: 'transparent', color: EC.navy,
                    border: `1.5px solid ${EC.outline}`, borderRadius: 14,
                    padding: '12px 20px', fontWeight: 700, fontSize: '.95rem',
                  }}
                >
                  Découvrir les espaces
                </a>
              </div>
            </div>

            <div className="col-lg-6">
              <div
                style={{
                  background: dark ? 'linear-gradient(145deg, #181512 0%, #201b15 100%)' : '#ffffff',
                  borderRadius: 24, padding: '2rem',
                  border: `1.5px solid ${dark ? 'rgba(249,93,0,0.25)' : 'rgba(0,13,35,0.08)'}`,
                  boxShadow: '0 16px 40px rgba(0,0,0,0.08)',
                }}
              >
                <div className="d-flex align-items-center justify-content-between mb-3 pb-3 border-bottom" style={{ borderColor: EC.outline }}>
                  <div className="d-flex align-items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 d-flex align-items-center justify-content-center">
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>business</span>
                    </span>
                    <span className="sora fw-bold" style={{ fontSize: '.95rem', color: EC.navy }}>Espace Entreprise Dédié</span>
                  </div>
                  <span className="badge rounded-pill bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 font-bold">
                    Accès B2B
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="p-3 rounded-xl" style={{ backgroundColor: dark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${EC.outline}` }}>
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <span className="fw-bold" style={{ fontSize: '.85rem', color: EC.navy }}>Société Test SARL</span>
                      <span className="badge bg-orange-100 text-[#f95d00] font-bold text-[10px]">1234567/A/M/000</span>
                    </div>
                    <span className="text-xs text-muted">Interlocuteur : Direction Générale · Facturation centralisée B2B</span>
                  </div>

                  <div className="row g-2">
                    <div className="col-6">
                      <div className="p-3 rounded-xl text-center" style={{ backgroundColor: dark ? 'rgba(249,93,0,0.08)' : '#fff7ed', border: '1px solid rgba(249,93,0,0.2)' }}>
                        <div className="sora fw-bold" style={{ fontSize: '1.25rem', color: '#f95d00' }}>0 DT</div>
                        <div className="text-xs text-muted">Frais de plateforme</div>
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="p-3 rounded-xl text-center" style={{ backgroundColor: dark ? 'rgba(99,102,241,0.08)' : '#eef2ff', border: '1px solid rgba(99,102,241,0.2)' }}>
                        <div className="sora fw-bold" style={{ fontSize: '1.25rem', color: '#6366f1' }}>PDF</div>
                        <div className="text-xs text-muted">Factures &amp; Reçus</div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 text-center">
                    <span className="text-xs text-muted">
                      1 e-mail = 1 rôle Entreprise figé · Gestion de vos collaborateurs
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 6 — FORMATIONS (#formations)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="formations" className="py-5" style={{ backgroundColor: EC.bgLow, transition: 'background .3s ease', scrollMarginTop: '80px' }}>
        <div className="container py-4">
          <div className="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
            <div>
              <span className="sec-badge">{t('landing.formationsBadge')}</span>
              <h2 className="sora fw-bold mb-1" style={{ color: EC.navy, fontSize: 'clamp(1.7rem,2.8vw,2.2rem)' }}>
                {t('landing.formationsTitle')}
              </h2>
              <p style={{ color: EC.muted, margin: 0, maxWidth: 560 }}>
                {t('landing.formationsSubtitle')}
              </p>
            </div>
            <div className="d-flex align-items-center gap-3">
              {(searchFormationKeyword || searchFormationVille || searchFormationDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchFormationKeyword('');
                    setSearchFormationVille('');
                    setSearchFormationDate('');
                  }}
                  className="btn btn-sm"
                  style={{
                    backgroundColor: 'rgba(249,93,0,0.12)', color: '#f95d00',
                    border: '1px solid rgba(249,93,0,0.25)', borderRadius: 10,
                    fontWeight: 700, fontSize: '.78rem',
                  }}
                >
                  <span className="material-symbols-outlined align-middle" style={{ fontSize: 15 }}>restart_alt</span>
                  {' '}Réinitialiser les filtres
                </button>
              )}
              <Link to="/devenir-formateur" style={{ color: EC.cobalt, fontWeight: 700, textDecoration: 'none', fontSize: '.92rem' }}>
                {t('landing.proposeTraining')}
              </Link>
            </div>
          </div>

          {filteredPublicFormations.length === 0 ? (
            <div className="p-5 text-center" style={{ backgroundColor: EC.cardBg, borderRadius: 20, border: `1.5px solid ${EC.outline}` }}>
              <div className="w-12 h-12 rounded-2xl bg-orange-100 text-[#f95d00] d-inline-flex align-items-center justify-content-center mb-3">
                <span className="material-symbols-outlined" style={{ fontSize: 26 }}>school</span>
              </div>
              <h5 className="sora fw-bold mb-1" style={{ color: EC.navy }}>Aucune formation trouvée</h5>
              <p style={{ color: EC.muted, margin: 0, fontSize: '.9rem' }}>
                {searchFormationKeyword || searchFormationVille || searchFormationDate
                  ? 'Aucune session ne correspond à vos critères de recherche. Essayez d\'élargir vos filtres.'
                  : t('landing.noTrainings')}
              </p>
            </div>
          ) : (
            <div className="d-flex gap-3 pb-3" style={{ overflowX: 'auto', scrollSnapType: 'x mandatory' }}>
              {filteredPublicFormations.map((f) => (
                <div
                  key={f.id}
                  onClick={() => setSelectedFormationModal(f)}
                  style={{
                    minWidth: 300, maxWidth: 340, flex: '0 0 auto', scrollSnapAlign: 'start',
                    backgroundColor: EC.cardBg, borderRadius: 20, padding: '1.5rem',
                    border: `1.5px solid ${EC.outline}`, display: 'flex', flexDirection: 'column',
                    transition: 'transform .2s ease, box-shadow .2s ease',
                  }}
                  className="cursor-pointer group hover:shadow-lg hover:-translate-y-1"
                >
                  <div className="d-flex justify-content-between align-items-center mb-2 gap-2">
                    <span style={{ fontSize: '.7rem', fontWeight: 800, padding: '4px 10px', borderRadius: 999, background: EC.cobaltLight, color: dark ? '#ffb599' : '#100f0d' }}>
                      {f.ville || 'Tunisie'}
                    </span>
                    <span className="sora fw-bold" style={{ color: EC.cobalt, fontSize: '.95rem' }}>
                      {f.prix_inscription > 0 ? formatDT(f.prix_inscription) : t('landing.free')}
                    </span>
                  </div>
                  <h4 className="sora fw-bold mb-2 group-hover:text-[#f95d00] transition-colors" style={{ color: EC.navy, fontSize: '1.05rem' }}>{f.titre}</h4>
                  <p style={{ color: EC.muted, fontSize: '.82rem', marginBottom: '0.75rem', flex: 1 }}>
                    {f.etablissement ? `Centre : ${f.etablissement}` : 'Session de formation ouverte au public'}
                  </p>
                  <div style={{ fontSize: '.78rem', color: EC.muted, marginBottom: '1rem' }}>
                    <div>{formatDateTunis(f.date_debut)} · {formatTimeTunis(f.date_debut)}</div>
                    {f.places_restantes !== null && (
                      <div style={{ color: f.liste_attente ? '#b45309' : '#15803d', fontWeight: 600, marginTop: 2 }}>
                        {f.liste_attente ? t('landing.waitingList') : t('landing.spotsRemaining', { count: f.places_restantes })}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFormationModal(f);
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'center',
                      backgroundColor: EC.cobalt, color: '#fff', borderRadius: 12, padding: '10px 0',
                      fontWeight: 700, fontSize: '.86rem', border: 'none', cursor: 'pointer',
                    }}
                  >
                    {t('landing.discoverSession')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── MODALE DÉDIÉE FORMATION AVEC INSCRIPTION ── */}
      {selectedFormationModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setSelectedFormationModal(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-xl rounded-3xl p-6 sm:p-8 space-y-5 animate-scale-in"
            style={{ backgroundColor: dark ? '#1a1612' : '#ffffff', color: dark ? '#fbffff' : '#100f0d', maxWidth: 620, width: '100%', borderRadius: 24, padding: '2rem', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', border: `1px solid ${dark ? 'rgba(249,93,0,0.3)' : 'rgba(0,0,0,0.1)'}` }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* En-tête de la modale */}
            <div className="d-flex justify-content-between align-items-start gap-3">
              <div className="d-flex align-items-center gap-2">
                <span style={{ fontSize: '.75rem', fontWeight: 800, padding: '5px 12px', borderRadius: 999, background: 'rgba(249,93,0,0.14)', color: '#f95d00', border: '1px solid rgba(249,93,0,0.3)' }}>
                  {selectedFormationModal.ville || 'Tunisie'}
                </span>
                <span className="sora fw-bold" style={{ color: '#f95d00', fontSize: '1.1rem' }}>
                  {selectedFormationModal.prix_inscription > 0 ? formatDT(selectedFormationModal.prix_inscription) : 'Gratuit'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFormationModal(null)}
                style={{ background: 'transparent', border: 'none', color: dark ? '#94a3b8' : '#64748b', cursor: 'pointer', padding: 4 }}
                aria-label="Fermer"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 24 }}>close</span>
              </button>
            </div>

            {/* Titre & Établissement */}
            <div>
              <h3 className="sora fw-bold mb-2" style={{ fontSize: '1.45rem', color: dark ? '#ffffff' : '#100f0d' }}>
                {selectedFormationModal.titre}
              </h3>
              <div className="d-flex flex-wrap align-items-center gap-3 text-xs text-muted mb-1">
                {selectedFormationModal.etablissement && (
                  <span className="d-flex align-items-center gap-1 font-semibold" style={{ color: '#f95d00' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>apartment</span>
                    {selectedFormationModal.etablissement}
                  </span>
                )}
                {selectedFormationModal.formateur_nom && (
                  <span className="d-flex align-items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person</span>
                    Formateur : {selectedFormationModal.formateur_nom}
                  </span>
                )}
              </div>
            </div>

            {/* Date & Horaires & Places */}
            <div className="p-3 rounded-2xl" style={{ backgroundColor: dark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${EC.outline}` }}>
              <div className="row g-2">
                <div className="col-sm-6">
                  <div className="d-flex align-items-center gap-2">
                    <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>calendar_month</span>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-muted">Date &amp; Heure</div>
                      <div className="text-xs font-semibold">{formatDateTunis(selectedFormationModal.date_debut)} à {formatTimeTunis(selectedFormationModal.date_debut)}</div>
                    </div>
                  </div>
                </div>
                <div className="col-sm-6">
                  <div className="d-flex align-items-center gap-2">
                    <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 20 }}>group</span>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-muted">Disponibilité</div>
                      <div className="text-xs font-semibold" style={{ color: selectedFormationModal.liste_attente ? '#b45309' : '#15803d' }}>
                        {selectedFormationModal.places_restantes !== null
                          ? `${selectedFormationModal.places_restantes} place${selectedFormationModal.places_restantes > 1 ? 's' : ''} disponible${selectedFormationModal.places_restantes > 1 ? 's' : ''}`
                          : 'Inscriptions ouvertes'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Description & Programme */}
            <div className="space-y-3">
              {selectedFormationModal.description && (
                <div>
                  <h6 className="sora fw-bold text-xs uppercase tracking-wider text-muted mb-1">Présentation</h6>
                  <p style={{ fontSize: '.88rem', lineHeight: 1.6, color: dark ? '#cbd5e1' : '#475569', margin: 0 }}>
                    {selectedFormationModal.description}
                  </p>
                </div>
              )}
              {selectedFormationModal.programme && (
                <div>
                  <h6 className="sora fw-bold text-xs uppercase tracking-wider text-muted mb-1">Programme de la formation</h6>
                  <p style={{ fontSize: '.85rem', lineHeight: 1.5, color: dark ? '#cbd5e1' : '#475569', margin: 0, whiteSpace: 'pre-line' }}>
                    {selectedFormationModal.programme.replace(/\[SESSION_GRATUITE\]/g, '').trim()}
                  </p>
                </div>
              )}
            </div>

            {/* Actions d'inscription */}
            <div className="d-flex flex-wrap items-center justify-content-between gap-3 pt-3 border-top" style={{ borderColor: EC.outline }}>
              <button
                type="button"
                onClick={() => setSelectedFormationModal(null)}
                className="btn btn-sm"
                style={{
                  border: `1px solid ${EC.outline}`, color: dark ? '#cbd5e1' : '#475569',
                  borderRadius: 12, padding: '10px 18px', fontWeight: 600, fontSize: '.88rem',
                }}
              >
                Fermer
              </button>

              <Link
                to={session ? `/dashboard/formations?inscrire=${selectedFormationModal.id}` : `/register?formation=${selectedFormationModal.id}`}
                className="btn btn-sm d-inline-flex align-items-center gap-2"
                style={{
                  backgroundColor: '#f95d00', color: '#ffffff',
                  borderRadius: 12, padding: '10px 22px', fontWeight: 700, fontSize: '.9rem',
                  border: 'none', boxShadow: '0 4px 14px rgba(249,93,0,0.35)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>how_to_reg</span>
                <span>{session ? 'Confirmer mon inscription' : 'S\'inscrire à cette formation'}</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 7 — TÉMOIGNAGES (#temoignages)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="temoignages" className="py-5" style={{ backgroundColor: EC.bg, transition: 'background .3s ease' }}>
        <div className="container py-4">
          <div className="text-center mb-5">
            <span className="sec-badge">{t('landing.testimonialsBadge')}</span>
            <h2 className="sora fw-bold mb-3" style={{ color: EC.navy, fontSize: 'clamp(1.8rem,3vw,2.4rem)' }}>
              {t('landing.testimonialsTitle')}
            </h2>
            <p style={{ color: EC.muted, maxWidth: 540, margin: '0 auto', lineHeight: 1.8 }}>
              {t('landing.testimonialsSubtitle')}
            </p>
          </div>
          <div className="row g-4">
            {testimonials.map((tItem, i) => <TestiCard key={i} {...tItem} dark={dark} />)}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 8 — CONTACT & FOOTER (#contact)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="contact" className="py-5" style={{ backgroundColor: EC.bgLow, transition: 'background .3s ease' }}>
        <div className="container py-4">
          <div className="row g-5 align-items-start">
            <div className="col-lg-5">
              <span className="sec-badge">{t('landing.contactBadge')}</span>
              <h2 className="sora fw-bold mb-4" style={{ color: EC.navy, fontSize: 'clamp(1.8rem,3vw,2.2rem)' }}>
                {t('landing.contactTitle')}
              </h2>
              <p style={{ color: EC.muted, marginBottom: '2rem', lineHeight: 1.75 }}>
                {t('landing.contactSubtitle')}
              </p>
              <div className="d-flex flex-column gap-4">
                {[
                  { icon: 'location_on', label: 'Adresse', val: t('landing.contactAddress') },
                  { icon: 'phone', label: 'Téléphone', val: '+216 52 882 880' },
                  { icon: 'mail', label: 'Email', val: t('landing.contactEmail') },
                  { icon: 'schedule', label: 'Horaires', val: t('landing.contactHours') },
                ].map(({ icon, label, val }) => (
                  <div key={icon} className="d-flex gap-3 align-items-start">
                    <div style={{ width: 46, height: 46, borderRadius: 13, background: EC.cobaltLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="material-symbols-outlined" style={{ color: dark ? '#ff8a3d' : EC.cobalt, fontSize: 22 }}>{icon}</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '.72rem', fontWeight: 700, color: EC.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>{label}</div>
                      <div style={{ color: EC.navy, fontWeight: 500, whiteSpace: 'pre-line' }}>{val}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-lg-7">
              <div style={{ backgroundColor: EC.cardBg, borderRadius: 24, padding: '2.5rem', boxShadow: dark ? '0 8px 32px rgba(0,0,0,.4)' : '0 8px 32px rgba(0,13,35,.08)', border: `1.5px solid ${EC.outline}` }}>
                <h4 className="sora fw-bold mb-4" style={{ color: EC.navy }}>{t('landing.contactTitle')}</h4>
                <form onSubmit={handleContactSubmit}>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="fw-semibold mb-2 d-block" style={{ color: EC.navy, fontSize: '.875rem' }}>{t('landing.contactName')}</label>
                      <input type="text" required className="ec-input" placeholder={t('landing.contactName')} value={contactForm.nom} onChange={(e) => setContactForm((f) => ({ ...f, nom: e.target.value }))} />
                    </div>
                    <div className="col-md-6">
                      <label className="fw-semibold mb-2 d-block" style={{ color: EC.navy, fontSize: '.875rem' }}>{t('landing.contactEmailInput')}</label>
                      <input type="email" required className="ec-input" placeholder="votre@email.com" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="col-12">
                      <label className="fw-semibold mb-2 d-block" style={{ color: EC.navy, fontSize: '.875rem' }}>{t('landing.contactSubject')}</label>
                      <select required className="ec-input" value={contactForm.sujet} onChange={(e) => setContactForm((f) => ({ ...f, sujet: e.target.value }))}>
                        <option value="">{t('landing.contactSubject')}</option>
                        <option value="general">{t('landing.contactSubjectGeneral')}</option>
                        <option value="partner">{t('landing.contactSubjectPartner')}</option>
                        <option value="trainer">{t('landing.contactSubjectTrainer')}</option>
                        <option value="support">{t('landing.contactSubjectSupport')}</option>
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="fw-semibold mb-2 d-block" style={{ color: EC.navy, fontSize: '.875rem' }}>{t('landing.contactMessage')}</label>
                      <textarea required className="ec-input" rows={4} placeholder={t('landing.contactMessage')} style={{ resize: 'vertical' }} value={contactForm.message} onChange={(e) => setContactForm((f) => ({ ...f, message: e.target.value }))} />
                    </div>
                    <div className="col-12">
                      <button
                        type="submit"
                        disabled={contactLoading}
                        className="btn w-100 d-flex align-items-center justify-content-center gap-2"
                        style={{ backgroundColor: EC.cobalt, color: 'white', borderRadius: 12, padding: '14px', fontWeight: 700, border: 'none', fontSize: '1rem', transition: 'all .25s' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
                        {contactLoading ? t('landing.contactSending') : t('landing.contactSubmit')}
                      </button>
                      {contactStatus.text && (
                        <div className="mt-3" role="status" style={{ color: contactStatus.type === 'success' ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                          {contactStatus.text}
                        </div>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ FOOTER (Mode Clair / Sombre dynamique & contrasté) ══ */}
      <footer className="ec-footer pt-5 pb-4">
        <div className="container">
          <div className="row g-4 mb-5 align-items-start">
            <div className="col-lg-4 col-md-6">
              <div style={{ marginBottom: '1.25rem' }}>
                <BrandLogo height={46} light={dark} />
              </div>
              <p className="footer-desc">
                {t('landing.footerDesc')}
              </p>
              <div className="mt-4 d-flex gap-3">
                <a href="#contact" aria-label="Contact" className="soc-btn" title="Site officiel">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>public</span>
                </a>
                <a href="mailto:contact@deskywork.com" aria-label="Email" className="soc-btn" title="Nous contacter par e-mail">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>alternate_email</span>
                </a>
                <a href="#contact" aria-label="Messagerie" className="soc-btn" title="Messagerie & support">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chat</span>
                </a>
              </div>
            </div>

            <div className="col-lg-2 col-md-3 col-6">
              <h6 className="footer-col-title">
                {t('landing.footerNav')}
              </h6>
              <ul className="list-unstyled d-flex flex-column gap-2 mb-0">
                <li><a href="#search" className="footer-link">{t('navbar.findSpace')}</a></li>
                <li><a href="#about" className="footer-link">{t('navbar.about')}</a></li>
                <li><a href="#featured" className="footer-link">{t('navbar.featured')}</a></li>
                <li><a href="#tarifs" className="footer-link">{t('navbar.pricing')}</a></li>
              </ul>
            </div>

            <div className="col-lg-2 col-md-3 col-6">
              <h6 className="footer-col-title">
                {t('landing.footerPartners')}
              </h6>
              <ul className="list-unstyled d-flex flex-column gap-2 mb-0">
                <li><a href="#partenaires" className="footer-link">{t('navbar.partners')}</a></li>
                <li><a href="#formations" className="footer-link">{t('navbar.formations')}</a></li>
                <li><Link to="/devenir-formateur" className="footer-link">Devenir Formateur</Link></li>
                <li><a href="#contact" className="footer-link">{t('navbar.contact')}</a></li>
              </ul>
            </div>

            <div className="col-lg-2 col-md-3 col-6">
              <h6 className="footer-col-title">
                {t('landing.footerLegal')}
              </h6>
              <ul className="list-unstyled d-flex flex-column gap-2 mb-0">
                <li><Link to="/cgu" className="footer-link">{t('landing.footerCgu')}</Link></li>
                <li><Link to="/confidentialite" className="footer-link">{t('landing.footerPrivacy')}</Link></li>
                <li><a href="#top" className="footer-link">Haut de page ↑</a></li>
              </ul>
            </div>

            <div className="col-lg-2 col-md-3 col-6">
              <h6 className="footer-col-title">
                {t('navbar.contact')}
              </h6>
              <ul className="list-unstyled d-flex flex-column gap-2 mb-0">
                <li><a href="mailto:contact@deskywork.com" className="footer-link">contact@deskywork.com</a></li>
                <li><span className="footer-desc" style={{ fontSize: '.88rem' }}>Tunis, Tunisie</span></li>
              </ul>
            </div>
          </div>

          <hr className="footer-divider" />
          <div className="d-flex flex-column flex-md-row justify-content-between align-items-center pt-4 gap-2">
            <p className="mb-0 footer-bottom-text">
              © {new Date().getFullYear()} {t('landing.footerCopyright')}
            </p>
            <p className="mb-0 footer-bottom-text">
              Conçu avec <span style={{ color: '#f95d00' }}>♥</span> à Tunis
            </p>
          </div>
        </div>
      </footer>

      {/* Bouton retour en haut */}
      {/* Bouton retour en haut (visible uniquement après défilement) */}
      <button
        type="button"
        aria-label="Retour en haut"
        title="Retour en haut"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="back-to-top"
        style={{
          opacity: isAtTop ? 0 : 1,
          pointerEvents: isAtTop ? 'none' : 'auto',
          transform: isAtTop ? 'scale(0.8)' : 'scale(1)',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 28 }}>
          keyboard_arrow_up
        </span>
      </button>

      {/* ══ MODALE PROMOS ══ */}
      {promoTenant && (
        <PromoModal tenant={promoTenant} onClose={() => setPromoTenant(null)} dark={dark} />
      )}
    </>
  );
}
