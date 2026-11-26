// pages/BookingStep1.jsx — Étapes 1 & 2 : Choix du Coworking (Proximité, Recommandés, Partenaires) -> Choix d'Espace (Images & Plan 2D Temps Réel)
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { useTheme } from '../context/ThemeContext';
import { guestApi, floorPlansApi, memberPortalApi } from '../services/api';
import { getBookerNav } from '../utils/roles';
import { formatDT } from '../utils/format';
import { spaceTypeLabel } from '../constants/spaceTypes';
import { getDefaultTunisSlot, getTodayTunisDate } from '../components/floorplan/floorPlanConstants';
import BookingShell from '../components/booking/BookingShell';
import SpacePhotoGalleryModal from '../components/booking/SpacePhotoGalleryModal';
import FloorPlanBookingView from '../components/floorplan/FloorPlanBookingView';

const START_HOURS = Array.from({ length: 14 }, (_, i) => `${String(7 + i).padStart(2, '0')}:00`);
const END_HOURS = Array.from({ length: 15 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);

// Coordonnées de repli pour villes/quartiers tunisiens lorsque latitude/longitude ne sont pas encore renseignées sur le coworking
const TUNISIA_CITY_COORDS = {
  tunis: { lat: 36.8065, lng: 10.1815 },
  ennasr: { lat: 36.8548, lng: 10.1592 },
  ariana: { lat: 36.8665, lng: 10.1647 },
  lac: { lat: 36.8354, lng: 10.2389 },
  montplaisir: { lat: 36.8172, lng: 10.1869 },
  marsa: { lat: 36.8782, lng: 10.3247 },
  carthage: { lat: 36.8529, lng: 10.3233 },
  menzah: { lat: 36.8427, lng: 10.1674 },
  manouba: { lat: 36.808, lng: 10.0972 },
  'ben arous': { lat: 36.7531, lng: 10.2189 },
  sousse: { lat: 35.8256, lng: 10.6084 },
  sfax: { lat: 34.7406, lng: 10.7603 },
  nabeul: { lat: 36.4561, lng: 10.7376 },
  hammamet: { lat: 36.4, lng: 10.6167 },
  monastir: { lat: 35.7643, lng: 10.8113 },
  bizerte: { lat: 37.2746, lng: 9.8739 },
  gabes: { lat: 33.8815, lng: 10.0982 },
  kairouan: { lat: 35.6781, lng: 10.0963 },
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resolveFallbackCoords(coworking) {
  if (coworking?.latitude != null && coworking?.longitude != null) {
    return { lat: Number(coworking.latitude), lng: Number(coworking.longitude), approx: false };
  }
  const haystack = `${coworking?.adresse || ''} ${coworking?.ville || ''} ${coworking?.nom || ''}`.toLowerCase();
  for (const [key, coords] of Object.entries(TUNISIA_CITY_COORDS)) {
    if (haystack.includes(key)) {
      return { ...coords, approx: true };
    }
  }
  return null;
}

function getSpaceFallbackImage(space, coworking) {
  return (
    space?.photo_url ||
    space?.photos?.[0] ||
    coworking?.cover_url ||
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&h=550&fit=crop'
  );
}

function CoworkingAvatar({ coworking, size = 44 }) {
  const [imgErr, setImgErr] = useState(false);
  const initials = String(coworking?.nom || 'CW')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  if (coworking?.logo_url && !imgErr) {
    return (
      <img
        src={coworking.logo_url}
        alt={coworking.nom}
        onError={() => setImgErr(true)}
        style={{ width: size, height: size, borderRadius: 12, objectFit: 'cover', flexShrink: 0, backgroundColor: '#ffffff' }}
        className="border border-black/10 shadow-sm"
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        background: 'linear-gradient(135deg, #f95d00 0%, #ff8234 100%)',
        color: '#ffffff',
        fontWeight: 800,
        fontSize: Math.round(size * 0.36),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      className="font-sora shadow-sm"
    >
      {initials || 'DW'}
    </div>
  );
}

export default function BookingStep1({ session }) {
  const { metadata, userId } = useSessionUser(session);
  const { dark } = useTheme();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedTenantId = searchParams.get('tenantId') || '';
  const initialModeParam = searchParams.get('view'); // 'images' | 'plan'

  const [userRole, setUserRole] = useState(() => metadata?.role || '');
  const [showTrainerContextModal, setShowTrainerContextModal] = useState(false);
  const isTrainer =
    userRole === 'formateur' ||
    userRole === 'trainer' ||
    metadata?.role === 'formateur' ||
    metadata?.role === 'trainer';
  const [nav] = useState(() => getBookerNav(metadata.role || 'member'));

  // ── Phase 1 : Coworkings + Recommandations + Géolocalisation ──
  const [coworkings, setCoworkings] = useState([]);
  const [recs, setRecs] = useState({
    home_tenant_id: null,
    user_city: null,
    frequent_tenants: {},
    recent_tenant_ids: [],
    favorite_space_types: [],
  });
  const [loadingCoworkings, setLoadingCoworkings] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [cityFilter, setCityFilter] = useState('all');
  const [activeCategory, setActiveCategory] = useState('priority'); // 'priority' | 'nearby' | 'recommended' | 'partners' | 'all'
  const [onlyFloorPlan, setOnlyFloorPlan] = useState(false);
  const [onlyFreeNow, setOnlyFreeNow] = useState(false);
  const [userCoords, setUserCoords] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');

  // ── Phase 2 : Espaces & Plan 2D en Temps Réel pour le coworking choisi ──
  const defSlot = useMemo(() => getDefaultTunisSlot(), []);
  const minDate = useMemo(() => getTodayTunisDate(), []);
  const [slotMode, setSlotMode] = useState('now'); // 'now' | 'custom'
  const [slotDate, setSlotDate] = useState(defSlot.date);
  const [slotStart, setSlotStart] = useState(defSlot.start);
  const [slotEnd, setSlotEnd] = useState(defSlot.end);
  const [liveData, setLiveData] = useState(null);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [spacesError, setSpacesError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState('');
  const [spaceViewMode, setSpaceViewMode] = useState(initialModeParam === 'plan' ? 'plan' : 'images'); // 'images' | 'plan'
  const [spaceTypeFilter, setSpaceTypeFilter] = useState('all');
  const [onlyAvailableSpaces, setOnlyAvailableSpaces] = useState(false);
  const [gallerySpace, setGallerySpace] = useState(null);

  // Détection rôle formateur
  useEffect(() => {
    if (metadata?.role) {
      setUserRole(metadata.role);
    } else if (userId) {
      supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()
        .then(({ data }) => {
          if (data?.role) setUserRole(data.role);
        })
        .catch(() => {});
    }
  }, [userId, metadata?.role]);

  useEffect(() => {
    if (isTrainer) {
      const alreadyChosen = sessionStorage.getItem('trainer_booking_context_chosen');
      if (!alreadyChosen) {
        setShowTrainerContextModal(true);
      }
    }
  }, [isTrainer]);

  // Charger coworkings & recommandations en parallèle
  useEffect(() => {
    let active = true;
    setLoadingCoworkings(true);
    Promise.all([
      guestApi.getCoworkings().catch(() => ({ coworkings: [] })),
      memberPortalApi.getBookingRecommendations().catch(() => ({})),
    ])
      .then(([cwRes, recRes]) => {
        if (!active) return;
        setCoworkings(Array.isArray(cwRes?.coworkings) ? cwRes.coworkings : []);
        if (recRes && typeof recRes === 'object') {
          setRecs({
            home_tenant_id: recRes.home_tenant_id || null,
            user_city: recRes.user_city || null,
            frequent_tenants: recRes.frequent_tenants || {},
            recent_tenant_ids: Array.isArray(recRes.recent_tenant_ids) ? recRes.recent_tenant_ids : [],
            favorite_space_types: Array.isArray(recRes.favorite_space_types) ? recRes.favorite_space_types : [],
          });
        }
      })
      .finally(() => {
        if (active) setLoadingCoworkings(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRequestGeolocation = () => {
    if (!navigator?.geolocation) {
      setGeoError("La géolocalisation n'est pas prise en charge par ce navigateur.");
      return;
    }
    setGeoLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
      },
      () => {
        setGeoError('Position refusée ou indisponible. Vous pouvez filtrer par ville ci-dessous.');
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }
    );
  };

  // Calcul enrichi des coworkings (distance, score recommandation, statut partenaire)
  const enrichedCoworkings = useMemo(() => {
    const userCityNorm = String(recs.user_city || '').trim().toLowerCase();
    return coworkings.map((c) => {
      const coords = resolveFallbackCoords(c);
      let distanceKm = null;
      let isApproxDistance = false;
      if (userCoords && coords) {
        distanceKm = Number(haversineKm(userCoords.lat, userCoords.lng, coords.lat, coords.lng).toFixed(1));
        isApproxDistance = coords.approx;
      }

      const cityMatch =
        userCityNorm &&
        `${c.ville || ''} ${c.adresse || ''}`.toLowerCase().includes(userCityNorm);

      const visitCount = recs.frequent_tenants?.[c.id] || 0;
      const isHomeTenant = recs.home_tenant_id === c.id;
      const isVisited = visitCount > 0;
      const isRecommended = isVisited || isHomeTenant || Boolean(c.has_floor_plan && (c.live_spaces_free || 0) > 0);
      const isPartnerOrFeatured = Boolean(c.is_featured || c.is_partner);
      const isNearby = distanceKm != null ? distanceKm <= 35 : Boolean(cityMatch);

      return {
        ...c,
        distanceKm,
        isApproxDistance,
        cityMatch,
        visitCount,
        isHomeTenant,
        isVisited,
        isRecommended,
        isPartnerOrFeatured,
        isNearby,
      };
    });
  }, [coworkings, recs, userCoords]);

  const cities = useMemo(() => {
    const set = new Set();
    enrichedCoworkings.forEach((c) => {
      if (c.ville) set.add(c.ville.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [enrichedCoworkings]);

  // Filtrage recherche / ville / badges
  const filteredCoworkings = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return enrichedCoworkings.filter((c) => {
      if (cityFilter !== 'all' && String(c.ville || '').trim().toLowerCase() !== cityFilter.toLowerCase()) {
        return false;
      }
      if (onlyFloorPlan && !c.has_floor_plan) return false;
      if (onlyFreeNow && (c.live_spaces_free || 0) <= 0) return false;
      if (q) {
        const hay = `${c.nom || ''} ${c.ville || ''} ${c.adresse || ''} ${c.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedCoworkings, searchTerm, cityFilter, onlyFloorPlan, onlyFreeNow]);

  // Catégories structurées (sans doublons en vue "Par priorité")
  const categorizedSections = useMemo(() => {
    const list = [...filteredCoworkings];

    const nearbyList = list
      .filter((c) => (userCoords ? c.distanceKm != null : c.cityMatch || c.distanceKm != null))
      .sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));

    const recommendedList = list
      .filter((c) => c.isVisited || c.isHomeTenant || (c.has_floor_plan && (c.live_spaces_free || 0) > 0))
      .sort((a, b) => {
        if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
        if (Boolean(b.isHomeTenant) !== Boolean(a.isHomeTenant)) return b.isHomeTenant ? 1 : -1;
        return (b.live_spaces_free || 0) - (a.live_spaces_free || 0);
      });

    const partnersList = list
      .filter((c) => c.is_featured || c.is_partner)
      .sort((a, b) => {
        if (Boolean(b.is_featured) !== Boolean(a.is_featured)) return b.is_featured ? 1 : -1;
        return (b.live_spaces_free || 0) - (a.live_spaces_free || 0);
      });

    // En vue "Par priorité", dédupliquer de section en section pour un affichage net et ordonné
    const seen = new Set();
    const takeUnique = (arr) =>
      arr.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

    const nearbyUnique = takeUnique(nearbyList);
    const recommendedUnique = takeUnique(recommendedList);
    const partnersUnique = takeUnique(partnersList);
    const othersUnique = list.filter((c) => !seen.has(c.id));

    return {
      nearbyList,
      recommendedList,
      partnersList,
      allList: list,
      nearbyUnique,
      recommendedUnique,
      partnersUnique,
      othersUnique,
    };
  }, [filteredCoworkings, userCoords]);

  // ── Phase 2 : Chargement temps réel des espaces + Plan 2D du coworking sélectionné ──
  const slotInvalid = slotMode === 'custom' && slotStart >= slotEnd;

  const fetchLiveSpaces = useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedTenantId || slotInvalid) return;
      try {
        if (!silent) setLoadingSpaces(true);
        setSpacesError('');
        const params =
          slotMode === 'now'
            ? { mode: 'now' }
            : { date: slotDate, start: slotStart, end: slotEnd };
        const res = await floorPlansApi.getPublicSpacesLive(selectedTenantId, params);
        setLiveData(res);
        setLastSyncedAt(res?.tunis_time || new Date().toLocaleTimeString('fr-FR', { hour12: false }));

        if (initialModeParam === 'plan' && (res?.floor_plans?.length || 0) > 0) {
          setSpaceViewMode('plan');
        }
      } catch (e) {
        if (!silent) setSpacesError(e.message || 'Impossible de charger les espaces de ce coworking.');
      } finally {
        if (!silent) setLoadingSpaces(false);
      }
    },
    [selectedTenantId, slotMode, slotDate, slotStart, slotEnd, slotInvalid, initialModeParam]
  );

  useEffect(() => {
    if (!selectedTenantId) {
      setLiveData(null);
      return;
    }
    fetchLiveSpaces();
  }, [selectedTenantId, fetchLiveSpaces]);

  // Abonnement Supabase Realtime + poll 15 s sur l'établissement sélectionné
  useEffect(() => {
    if (!selectedTenantId) return undefined;
    const channel = supabase
      .channel(`booking-spaces-live-${selectedTenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `tenant_id=eq.${selectedTenantId}` },
        () => fetchLiveSpaces({ silent: true })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions', filter: `tenant_id=eq.${selectedTenantId}` },
        () => fetchLiveSpaces({ silent: true })
      )
      .subscribe();

    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchLiveSpaces({ silent: true });
      }
    }, 15000);

    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [selectedTenantId, fetchLiveSpaces]);

  const handleSelectCoworking = (cw) => {
    setSpaceTypeFilter('all');
    setOnlyAvailableSpaces(false);
    setSpaceViewMode('images');
    setSearchParams({ tenantId: cw.id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToCoworkings = () => {
    setLiveData(null);
    setSearchParams({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleQuickDuration = (hours) => {
    const startH = parseInt(slotStart.split(':')[0], 10) || 9;
    const endH = Math.min(22, startH + hours);
    setSlotMode('custom');
    setSlotEnd(`${String(endH).padStart(2, '0')}:00`);
  };

  const activeSlot = liveData?.slot || {
    date: slotDate,
    start: slotStart,
    end: slotEnd,
    is_now: slotMode === 'now',
  };

  const durationHours = useMemo(() => {
    const s = new Date(`${activeSlot.date}T${activeSlot.start}:00+01:00`).getTime();
    const e = new Date(`${activeSlot.date}T${activeSlot.end}:00+01:00`).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 2;
    return Math.max(0.5, Number(((e - s) / 3600000).toFixed(2)));
  }, [activeSlot.date, activeSlot.start, activeSlot.end]);

  const handleBookDirect = (space, itemId = '', itemLabel = '') => {
    const qs = new URLSearchParams({
      espaceId: space.id || space.space_id,
      date: activeSlot.date,
      start: activeSlot.start,
      end: activeSlot.end,
      ...(itemId ? { itemId } : {}),
      ...(itemLabel ? { itemLabel } : {}),
    }).toString();
    navigate(`/book/step3?${qs}`);
  };

  const selectedCoworking =
    liveData?.tenant || enrichedCoworkings.find((c) => c.id === selectedTenantId || c.slug === selectedTenantId) || null;

  const filteredSpaces = useMemo(() => {
    const list = liveData?.spaces || [];
    return list.filter((sp) => {
      if (spaceTypeFilter !== 'all' && sp.type !== spaceTypeFilter) return false;
      if (onlyAvailableSpaces && sp.live_status !== 'free' && sp.live_status !== 'limited') return false;
      return true;
    });
  }, [liveData?.spaces, spaceTypeFilter, onlyAvailableSpaces]);

  const availableSpaceTypes = useMemo(() => {
    const types = new Set((liveData?.spaces || []).map((s) => s.type).filter(Boolean));
    return Array.from(types);
  }, [liveData?.spaces]);

  // Styles thématiques réutilisables
  const cardBg = dark ? '#181715' : '#ffffff';
  const cardBorder = dark ? 'rgba(255,255,255,0.09)' : 'rgba(16,15,13,0.08)';
  const subtleBg = dark ? '#1f1d1a' : '#f8f6f2';
  const textMain = dark ? '#fbffff' : '#100f0d';
  const textMuted = dark ? '#cfcac3' : '#5e5a55';

  // Rendu d'une carte Coworking
  const renderCoworkingCard = (c, highlightBadge = null) => {
    const coverImg =
      c.cover_url ||
      c.gallery_preview?.[0] ||
      'https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&h=480&fit=crop';
    const hasFreeNow = (c.live_spaces_free || 0) > 0;

    return (
      <div
        key={c.id}
        onClick={() => handleSelectCoworking(c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelectCoworking(c);
          }
        }}
        className="group rounded-3xl overflow-hidden flex flex-col justify-between cursor-pointer transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl"
        style={{
          backgroundColor: cardBg,
          border: `1px solid ${c.is_featured ? 'rgba(249,93,0,0.45)' : cardBorder}`,
          boxShadow: dark ? '0 10px 30px rgba(0,0,0,0.35)' : '0 8px 24px rgba(16,15,13,0.05)',
        }}
      >
        <div>
          {/* Photo de couverture + Badges non chevauchants */}
          <div className="relative h-44 overflow-hidden bg-neutral-900">
            <img
              src={coverImg}
              alt={c.nom}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(180deg, rgba(16,15,13,0.42) 0%, rgba(16,15,13,0.08) 45%, rgba(16,15,13,0.78) 100%)' }}
            />

            {/* Rangée supérieure : Statuts partenaire / distance */}
            <div className="absolute top-3 inset-x-3 flex items-start justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {c.is_featured && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide shadow"
                    style={{ backgroundColor: '#f95d00', color: '#ffffff' }}
                  >
                    ★ Mis en avant
                  </span>
                )}
                {!c.is_featured && c.is_partner && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide shadow"
                    style={{ backgroundColor: '#100f0d', color: '#fbffff', border: '1px solid rgba(255,255,255,0.2)' }}
                  >
                    ✓ Partenaire
                  </span>
                )}
                {highlightBadge && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold shadow"
                    style={{ backgroundColor: 'rgba(16,185,129,0.92)', color: '#ffffff' }}
                  >
                    {highlightBadge}
                  </span>
                )}
              </div>

              {c.distanceKm != null ? (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md shrink-0"
                  style={{ backgroundColor: 'rgba(16,15,13,0.72)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.18)' }}
                >
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 13 }}>near_me</span>
                  {c.isApproxDistance ? `~${c.distanceKm}` : c.distanceKm} km
                </span>
              ) : c.ville ? (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md shrink-0"
                  style={{ backgroundColor: 'rgba(16,15,13,0.72)', color: '#ffffff' }}
                >
                  {c.ville}
                </span>
              ) : null}
            </div>

            {/* Rangée inférieure : Pastille temps réel & Plan 2D */}
            <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md"
                style={{
                  backgroundColor: hasFreeNow ? 'rgba(6,95,70,0.88)' : 'rgba(153,27,27,0.88)',
                  color: '#ffffff',
                }}
              >
                <span className={`w-2 h-2 rounded-full ${hasFreeNow ? 'bg-emerald-300 animate-pulse' : 'bg-red-300'}`} />
                {c.live_spaces_total > 0
                  ? `${c.live_spaces_free}/${c.live_spaces_total} libre${c.live_spaces_free > 1 ? 's' : ''} maintenant`
                  : 'Disponible sur créneau'}
              </span>

              {c.has_floor_plan && (
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md"
                  style={{ backgroundColor: 'rgba(255,255,255,0.94)', color: '#100f0d' }}
                >
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 14 }}>map</span>
                  Plan 2D
                </span>
              )}
            </div>
          </div>

          {/* Contenu texte */}
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-3">
              <CoworkingAvatar coworking={c} size={44} />
              <div className="min-w-0 flex-1">
                <h3 className="font-sora font-bold text-base sm:text-lg truncate m-0" style={{ color: textMain }}>
                  {c.nom}
                </h3>
                <p className="text-xs truncate m-0 flex items-center gap-1" style={{ color: textMuted }}>
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 14 }}>location_on</span>
                  <span>{[c.adresse, c.ville].filter(Boolean).join(', ') || 'Tunisie'}</span>
                </p>
              </div>
            </div>

            {c.description && (
              <p className="text-xs leading-relaxed line-clamp-2 m-0" style={{ color: textMuted }}>
                {c.description}
              </p>
            )}

            {/* Types d'espaces & badges */}
            <div className="flex flex-wrap gap-1.5">
              {c.visitCount > 0 && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: dark ? 'rgba(249,93,0,0.2)' : '#fff7ed', color: '#f95d00' }}
                >
                  Déjà réservé {c.visitCount}×
                </span>
              )}
              {c.has_promo && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: dark ? 'rgba(245,158,11,0.2)' : '#fef3c7', color: dark ? '#fcd34d' : '#b45309' }}
                >
                  Code promo actif
                </span>
              )}
              {(c.space_types || []).slice(0, 3).map((tp) => (
                <span
                  key={tp}
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{ backgroundColor: subtleBg, color: textMuted, border: `1px solid ${cardBorder}` }}
                >
                  {spaceTypeLabel(tp)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Pied de carte */}
        <div
          className="px-5 py-3.5 flex items-center justify-between gap-3"
          style={{ backgroundColor: subtleBg, borderTop: `1px solid ${cardBorder}` }}
        >
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide block" style={{ color: textMuted }}>
              {c.min_tarif_horaire != null ? 'À partir de' : 'Tarification'}
            </span>
            <span className="font-sora font-extrabold text-base text-[#f95d00]">
              {c.min_tarif_horaire != null ? `${formatDT(c.min_tarif_horaire)}/h` : 'Sur créneau'}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectCoworking(c);
            }}
            className="px-4 py-2 rounded-xl text-xs font-extrabold transition-all group-hover:scale-[1.03] cursor-pointer"
            style={{
              backgroundColor: '#f95d00',
              color: '#ffffff',
              border: 'none',
              boxShadow: '0 6px 16px rgba(249,93,0,0.25)',
            }}
          >
            Choisir cet établissement →
          </button>
        </div>
      </div>
    );
  };

  return (
    <BookingShell
      activeStep={selectedTenantId ? 2 : 1}
      nav={nav}
      backTo={selectedTenantId ? undefined : nav.home}
      backLabel={selectedTenantId ? 'Quitter' : 'Annuler'}
      subtitle={selectedCoworking?.nom || null}
      onStepClick={(st) => {
        if (st === 1 && selectedTenantId) handleBackToCoworkings();
      }}
    >
      {/* Modal obligatoire de sélection de contexte pour le rôle TRAINER */}
      {isTrainer && showTrainerContextModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(8px)' }}
        >
          <div
            className="max-w-xl w-full rounded-3xl p-7 shadow-2xl"
            style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}`, color: textMain }}
          >
            <div className="flex items-center gap-3.5 mb-4">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: dark ? 'rgba(249,93,0,0.18)' : '#fff7ed', color: '#f95d00', border: '1px solid rgba(249,93,0,0.35)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 28 }}>school</span>
              </div>
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#f95d00]">
                  Compte Formateur Partenaire
                </span>
                <h2 className="font-sora font-extrabold text-xl m-0" style={{ color: textMain }}>
                  Sélectionnez l&apos;objet de votre réservation
                </h2>
              </div>
            </div>

            <p className="text-sm leading-relaxed mb-5" style={{ color: textMuted }}>
              En tant que formateur, vous disposez d&apos;un double statut sur DeskyWork. Veuillez indiquer la finalité de cette démarche :
            </p>

            <div className="space-y-3 mb-5">
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem('trainer_booking_context_chosen', 'member');
                  setShowTrainerContextModal(false);
                }}
                className="w-full text-left p-4 rounded-2xl flex items-start gap-3.5 cursor-pointer transition-all hover:scale-[1.01]"
                style={{ backgroundColor: subtleBg, border: `2px solid ${cardBorder}`, color: textMain }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: dark ? 'rgba(255,255,255,0.08)' : '#e2e8f0', color: textMain }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>person</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-sora font-bold text-sm" style={{ color: textMain }}>
                      Option 1 : Réserver pour moi (en tant que membre)
                    </span>
                    <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 18 }}>arrow_forward</span>
                  </div>
                  <p className="text-xs mt-1 mb-0" style={{ color: textMuted }}>
                    Pour travailler en open space, réserver un bureau privé ou une salle pour vos besoins personnels.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate('/trainer/formations?create=1')}
                className="w-full text-left p-4 rounded-2xl flex items-start gap-3.5 cursor-pointer transition-all hover:scale-[1.01]"
                style={{
                  backgroundColor: dark ? 'rgba(249,93,0,0.14)' : '#fff7ed',
                  border: '2px solid rgba(249,93,0,0.45)',
                  color: textMain,
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[#f95d00] text-white">
                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>school</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-sora font-bold text-sm text-[#f95d00]">
                      Option 2 : Organiser / Animer une formation
                    </span>
                    <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 18 }}>arrow_forward</span>
                  </div>
                  <p className="text-xs mt-1 mb-0" style={{ color: textMuted }}>
                    Créer une session de formation officielle avec assignation d&apos;une salle compatible chez un partenaire.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bannière double contexte formateur */}
      {isTrainer && (
        <div
          className="mb-6 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3"
          style={{
            backgroundColor: dark ? 'rgba(249,93,0,0.12)' : '#fff7ed',
            border: '1px solid rgba(249,93,0,0.3)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#f95d00] text-white flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>school</span>
            </div>
            <div>
              <p className="font-sora font-bold text-sm m-0" style={{ color: textMain }}>
                Compte Formateur — Mode : Réserver pour moi
              </p>
              <p className="text-xs m-0" style={{ color: textMuted }}>
                Vous réservez un poste ou une salle pour votre usage personnel.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowTrainerContextModal(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
              style={{ backgroundColor: cardBg, color: textMain, border: `1px solid ${cardBorder}` }}
            >
              Changer de contexte
            </button>
            <Link
              to="/trainer/formations?create=1"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold"
              style={{ backgroundColor: '#f95d00', color: '#ffffff', textDecoration: 'none' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>add_circle</span>
              Animer une formation
            </Link>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          PHASE 1 : CHOIX DU COWORKING (PROXIMITÉ, RECOMMANDÉS, PARTENAIRES)
         ════════════════════════════════════════════════════════════════════════ */}
      {!selectedTenantId ? (
        <div className="space-y-8 animate-fadeIn">
          {/* Hero Recherche & Géolocalisation */}
          <div
            className="rounded-3xl p-6 sm:p-8 relative overflow-hidden"
            style={{
              backgroundColor: cardBg,
              border: `1px solid ${cardBorder}`,
              boxShadow: dark ? '0 16px 40px rgba(0,0,0,0.4)' : '0 12px 32px rgba(16,15,13,0.06)',
            }}
          >
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
              <div>
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider mb-3"
                  style={{ backgroundColor: dark ? 'rgba(249,93,0,0.18)' : '#ffedd8', color: '#f95d00' }}
                >
                  <span className="w-2 h-2 rounded-full bg-[#f95d00] animate-pulse" />
                  Étape 1 sur 3 · Réservation en temps réel
                </span>
                <h1 className="font-sora font-extrabold text-2xl sm:text-4xl tracking-tight m-0" style={{ color: textMain }}>
                  Choisissez votre espace de coworking
                </h1>
                <p className="text-sm sm:text-base mt-2 mb-0 max-w-2xl" style={{ color: textMuted }}>
                  Trouvez d&apos;abord l&apos;établissement idéal selon votre position, vos habitudes ou nos partenaires vérifiés, puis consultez ses salles par images ou sur Plan 2D en direct.
                </p>
              </div>

              <button
                type="button"
                onClick={handleRequestGeolocation}
                disabled={geoLoading}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-xs sm:text-sm font-extrabold shrink-0 cursor-pointer transition-all hover:scale-[1.02]"
                style={{
                  backgroundColor: userCoords ? '#10b981' : '#f95d00',
                  color: '#ffffff',
                  border: 'none',
                  boxShadow: userCoords ? '0 8px 20px rgba(16,185,129,0.28)' : '0 8px 20px rgba(249,93,0,0.28)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {geoLoading ? 'hourglass_top' : userCoords ? 'my_location' : 'near_me'}
                </span>
                <span>
                  {geoLoading
                    ? 'Localisation...'
                    : userCoords
                    ? 'Position active · Trier par distance'
                    : 'Autour de moi (GPS)'}
                </span>
              </button>
            </div>

            {geoError && (
              <p className="text-xs font-semibold mb-4 text-amber-600 dark:text-amber-400">{geoError}</p>
            )}

            {/* Barre recherche + filtres rapides */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <div className="md:col-span-5 relative">
                <span
                  className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ fontSize: 20, color: textMuted }}
                >
                  search
                </span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Rechercher un coworking, quartier, ville..."
                  className="w-full pl-11 pr-4 py-3 rounded-2xl text-sm font-medium outline-none transition-all"
                  style={{
                    backgroundColor: subtleBg,
                    color: textMain,
                    border: `1px solid ${cardBorder}`,
                  }}
                />
              </div>

              <div className="md:col-span-3">
                <select
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-2xl text-sm font-semibold outline-none cursor-pointer"
                  style={{
                    backgroundColor: subtleBg,
                    color: textMain,
                    border: `1px solid ${cardBorder}`,
                  }}
                >
                  <option value="all">Toutes les villes</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOnlyFloorPlan((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-bold cursor-pointer transition-all"
                  style={{
                    backgroundColor: onlyFloorPlan ? '#f95d00' : subtleBg,
                    color: onlyFloorPlan ? '#ffffff' : textMain,
                    border: `1px solid ${onlyFloorPlan ? '#f95d00' : cardBorder}`,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>map</span>
                  Plan 2D
                </button>

                <button
                  type="button"
                  onClick={() => setOnlyFreeNow((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-bold cursor-pointer transition-all"
                  style={{
                    backgroundColor: onlyFreeNow ? '#10b981' : subtleBg,
                    color: onlyFreeNow ? '#ffffff' : textMain,
                    border: `1px solid ${onlyFreeNow ? '#10b981' : cardBorder}`,
                  }}
                >
                  <span className="w-2 h-2 rounded-full bg-current" />
                  Libre maintenant
                </button>
              </div>
            </div>

            {/* Onglets de catégories */}
            <div className="flex flex-wrap items-center gap-2 mt-5 pt-4" style={{ borderTop: `1px solid ${cardBorder}` }}>
              {[
                { id: 'priority', label: '✨ Par priorité', count: categorizedSections.allList.length },
                { id: 'nearby', label: '📍 Plus proches', count: categorizedSections.nearbyList.length },
                { id: 'recommended', label: '🎯 Recommandés', count: categorizedSections.recommendedList.length },
                { id: 'partners', label: '⭐ Mis en avant & Partenaires', count: categorizedSections.partnersList.length },
                { id: 'all', label: '🏢 Tous', count: categorizedSections.allList.length },
              ].map((tab) => {
                const active = activeCategory === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveCategory(tab.id)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold cursor-pointer transition-all"
                    style={{
                      backgroundColor: active ? '#100f0d' : subtleBg,
                      color: active ? '#ffffff' : textMuted,
                      border: `1px solid ${active ? '#f95d00' : cardBorder}`,
                      boxShadow: active ? '0 4px 14px rgba(16,15,13,0.18)' : 'none',
                    }}
                  >
                    <span>{tab.label}</span>
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[10px]"
                      style={{
                        backgroundColor: active ? 'rgba(249,93,0,0.9)' : (dark ? 'rgba(255,255,255,0.08)' : 'rgba(16,15,13,0.07)'),
                        color: active ? '#ffffff' : textMain,
                      }}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {loadingCoworkings ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-96 rounded-3xl animate-pulse"
                  style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
                />
              ))}
            </div>
          ) : filteredCoworkings.length === 0 ? (
            <div
              className="rounded-3xl p-12 text-center"
              style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
            >
              <span className="material-symbols-outlined text-[#f95d00] mb-2" style={{ fontSize: 44 }}>search_off</span>
              <h3 className="font-sora font-bold text-lg m-0" style={{ color: textMain }}>
                Aucun coworking ne correspond à vos filtres
              </h3>
              <p className="text-sm mt-1 mb-4" style={{ color: textMuted }}>
                Essayez d&apos;élargir votre recherche ou de réinitialiser les filtres.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setCityFilter('all');
                  setOnlyFloorPlan(false);
                  setOnlyFreeNow(false);
                  setActiveCategory('priority');
                }}
                className="px-5 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
                style={{ backgroundColor: '#f95d00', color: '#ffffff', border: 'none' }}
              >
                Réinitialiser les filtres
              </button>
            </div>
          ) : activeCategory === 'priority' ? (
            <div className="space-y-10">
              {/* 1. Plus proches */}
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-sora font-extrabold text-xl m-0 flex items-center gap-2" style={{ color: textMain }}>
                      <span className="material-symbols-outlined text-[#f95d00]">near_me</span>
                      Plus proches de vous
                    </h2>
                    <p className="text-xs mt-0.5 mb-0" style={{ color: textMuted }}>
                      {userCoords
                        ? 'Triés selon votre position GPS actuelle.'
                        : recs.user_city
                        ? `Établissements situés à ${recs.user_city}. Activez le GPS pour les distances exactes.`
                        : 'Activez votre géolocalisation pour trouver instantanément le coworking le plus proche.'}
                    </p>
                  </div>
                </div>

                {categorizedSections.nearbyUnique.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {categorizedSections.nearbyUnique.map((c) =>
                      renderCoworkingCard(c, c.distanceKm != null ? `${c.distanceKm} km` : 'Proche')
                    )}
                  </div>
                ) : (
                  <div
                    className="rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4"
                    style={{ backgroundColor: cardBg, border: `1px dashed rgba(249,93,0,0.4)` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#f95d00]/15 text-[#f95d00]">
                        <span className="material-symbols-outlined">location_searching</span>
                      </div>
                      <div>
                        <p className="font-sora font-bold text-sm m-0" style={{ color: textMain }}>
                          Localiser les coworkings autour de moi
                        </p>
                        <p className="text-xs m-0" style={{ color: textMuted }}>
                          Autorisez votre navigateur une seconde pour calculer la distance en kilomètres.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRequestGeolocation}
                      className="px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
                      style={{ backgroundColor: '#f95d00', color: '#ffffff', border: 'none' }}
                    >
                      Activer la géolocalisation
                    </button>
                  </div>
                )}
              </section>

              {/* 2. Recommandés pour vous */}
              {categorizedSections.recommendedUnique.length > 0 && (
                <section className="space-y-4">
                  <div>
                    <h2 className="font-sora font-extrabold text-xl m-0 flex items-center gap-2" style={{ color: textMain }}>
                      <span className="material-symbols-outlined text-[#f95d00]">auto_awesome</span>
                      Recommandés pour vous
                    </h2>
                    <p className="text-xs mt-0.5 mb-0" style={{ color: textMuted }}>
                      Basés sur vos réservations passées, vos préférences et la disponibilité Plan 2D en direct.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {categorizedSections.recommendedUnique.map((c) =>
                      renderCoworkingCard(c, c.isVisited ? 'Favori' : 'Recommandé')
                    )}
                  </div>
                </section>
              )}

              {/* 3. Partenaires & Mis en avant */}
              {categorizedSections.partnersUnique.length > 0 && (
                <section className="space-y-4">
                  <div>
                    <h2 className="font-sora font-extrabold text-xl m-0 flex items-center gap-2" style={{ color: textMain }}>
                      <span className="material-symbols-outlined text-[#f95d00]">workspace_premium</span>
                      Partenaires & Mis en avant
                    </h2>
                    <p className="text-xs mt-0.5 mb-0" style={{ color: textMuted }}>
                      Établissements partenaires officiels sélectionnés par DeskyWork.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {categorizedSections.partnersUnique.map((c) => renderCoworkingCard(c))}
                  </div>
                </section>
              )}

              {/* 4. Autres coworkings */}
              {categorizedSections.othersUnique.length > 0 && (
                <section className="space-y-4">
                  <div>
                    <h2 className="font-sora font-extrabold text-xl m-0 flex items-center gap-2" style={{ color: textMain }}>
                      <span className="material-symbols-outlined text-[#f95d00]">apartment</span>
                      Autres coworkings de la plateforme
                    </h2>
                    <p className="text-xs mt-0.5 mb-0" style={{ color: textMuted }}>
                      Découvrez tous nos autres espaces partenaires prêts à vous accueillir.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {categorizedSections.othersUnique.map((c) => renderCoworkingCard(c))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(activeCategory === 'nearby'
                ? categorizedSections.nearbyList
                : activeCategory === 'recommended'
                ? categorizedSections.recommendedList
                : activeCategory === 'partners'
                ? categorizedSections.partnersList
                : categorizedSections.allList
              ).map((c) => renderCoworkingCard(c))}
            </div>
          )}
        </div>
      ) : (
        /* ════════════════════════════════════════════════════════════════════════
           PHASE 2 : ESPACES DU COWORKING SÉLECTIONNÉ (IMAGES + PLAN 2D TEMPS RÉEL)
           ════════════════════════════════════════════════════════════════════════ */
        <div className="space-y-6 animate-fadeIn">
          {/* En-tête Coworking sélectionné */}
          <div
            className="rounded-3xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5"
            style={{
              backgroundColor: cardBg,
              border: `1px solid ${cardBorder}`,
              boxShadow: dark ? '0 14px 36px rgba(0,0,0,0.4)' : '0 10px 28px rgba(16,15,13,0.06)',
            }}
          >
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              <CoworkingAvatar coworking={selectedCoworking} size={60} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBackToCoworkings}
                    className="inline-flex items-center gap-1 text-xs font-extrabold cursor-pointer px-2.5 py-1 rounded-full transition-colors"
                    style={{ backgroundColor: subtleBg, color: '#f95d00', border: `1px solid ${cardBorder}` }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_back</span>
                    Changer d&apos;établissement
                  </button>
                  {selectedCoworking?.is_featured && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-[#f95d00] text-white">
                      ★ Mis en avant
                    </span>
                  )}
                  {selectedCoworking?.is_partner && !selectedCoworking?.is_featured && (
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase"
                      style={{ backgroundColor: dark ? '#2e2c29' : '#100f0d', color: '#ffffff' }}
                    >
                      Partenaire
                    </span>
                  )}
                </div>

                <h1 className="font-sora font-extrabold text-xl sm:text-2xl truncate m-0" style={{ color: textMain }}>
                  {selectedCoworking?.nom || 'Établissement'}
                </h1>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: textMuted }}>
                  {(selectedCoworking?.adresse || selectedCoworking?.ville) && (
                    <span className="inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 15 }}>location_on</span>
                      {[selectedCoworking.adresse, selectedCoworking.ville].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {selectedCoworking?.latitude != null && selectedCoworking?.longitude != null && (
                    <a
                      href={`https://www.google.com/maps?q=${selectedCoworking.latitude},${selectedCoworking.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-bold"
                      style={{ color: '#f95d00', textDecoration: 'none' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>map</span>
                      Google Maps
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Indicateurs live du coworking */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <div
                className="px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-2"
                style={{ backgroundColor: dark ? 'rgba(16,185,129,0.14)' : '#ecfdf5', color: dark ? '#6ee7b7' : '#047857' }}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  {liveData?.summary
                    ? `${liveData.summary.free_spaces}/${liveData.summary.total_spaces} espace${liveData.summary.free_spaces > 1 ? 's' : ''} libre${liveData.summary.free_spaces > 1 ? 's' : ''}`
                    : 'Synchronisation...'}
                </span>
              </div>

              {lastSyncedAt && (
                <button
                  type="button"
                  onClick={() => fetchLiveSpaces()}
                  title="Actualiser la disponibilité en temps réel"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-[11px] font-semibold cursor-pointer"
                  style={{ backgroundColor: subtleBg, color: textMuted, border: `1px solid ${cardBorder}` }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
                  <span>{lastSyncedAt}</span>
                </button>
              )}
            </div>
          </div>

          {/* Barre de Créneau Temps Réel + Bascule Images / Plan 2D */}
          <div
            className="rounded-3xl p-4 sm:p-5 space-y-4"
            style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
          >
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              {/* Mode Temps Réel vs Créneau Planifié */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSlotMode('now')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold cursor-pointer transition-all"
                  style={{
                    backgroundColor: slotMode === 'now' ? '#10b981' : subtleBg,
                    color: slotMode === 'now' ? '#ffffff' : textMain,
                    border: `1px solid ${slotMode === 'now' ? '#10b981' : cardBorder}`,
                    boxShadow: slotMode === 'now' ? '0 6px 16px rgba(16,185,129,0.28)' : 'none',
                  }}
                >
                  <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                  ⚡ Maintenant (Temps réel)
                </button>

                <button
                  type="button"
                  onClick={() => setSlotMode('custom')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold cursor-pointer transition-all"
                  style={{
                    backgroundColor: slotMode === 'custom' ? '#f95d00' : subtleBg,
                    color: slotMode === 'custom' ? '#ffffff' : textMain,
                    border: `1px solid ${slotMode === 'custom' ? '#f95d00' : cardBorder}`,
                    boxShadow: slotMode === 'custom' ? '0 6px 16px rgba(249,93,0,0.28)' : 'none',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>event</span>
                  Planifier un créneau
                </button>
              </div>

              {/* Sélecteur Vue Images | Plan 2D */}
              <div
                className="inline-flex p-1.5 rounded-2xl self-start xl:self-auto gap-1"
                style={{ backgroundColor: subtleBg, border: `1px solid ${cardBorder}` }}
              >
                <button
                  type="button"
                  onClick={() => setSpaceViewMode('images')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold cursor-pointer transition-all"
                  style={{
                    backgroundColor: spaceViewMode === 'images' ? '#f95d00' : 'transparent',
                    color: spaceViewMode === 'images' ? '#ffffff' : textMain,
                    border: 'none',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>photo_library</span>
                  <span>Par Images ({liveData?.spaces?.length ?? 0})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (liveData?.summary?.has_floor_plan) setSpaceViewMode('plan');
                  }}
                  disabled={!liveData?.summary?.has_floor_plan}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition-all"
                  style={{
                    backgroundColor: spaceViewMode === 'plan' ? '#f95d00' : 'transparent',
                    color: spaceViewMode === 'plan' ? '#ffffff' : liveData?.summary?.has_floor_plan ? textMain : textMuted,
                    opacity: liveData?.summary?.has_floor_plan ? 1 : 0.55,
                    cursor: liveData?.summary?.has_floor_plan ? 'pointer' : 'not-allowed',
                    border: 'none',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>map</span>
                  <span>
                    {liveData?.summary?.has_floor_plan
                      ? `Plan 2D Temps Réel (${liveData.summary.free_plan_items || 0} libre${(liveData.summary.free_plan_items || 0) > 1 ? 's' : ''})`
                      : 'Plan 2D non configuré'}
                  </span>
                </button>
              </div>
            </div>

            {/* Champs créneau si mode planifié */}
            {slotMode === 'custom' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2" style={{ borderTop: `1px solid ${cardBorder}` }}>
                <div>
                  <label className="block text-[11px] font-bold uppercase opacity-70 mb-1">Date (Tunis)</label>
                  <input
                    type="date"
                    min={minDate}
                    value={slotDate}
                    onChange={(e) => setSlotDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm font-semibold outline-none"
                    style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase opacity-70 mb-1">Début</label>
                  <select
                    value={slotStart}
                    onChange={(e) => setSlotStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm font-semibold outline-none"
                    style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                  >
                    {START_HOURS.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase opacity-70 mb-1">Fin</label>
                  <select
                    value={slotEnd}
                    onChange={(e) => setSlotEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm font-semibold outline-none"
                    style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                  >
                    {END_HOURS.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 flex flex-wrap items-end gap-1.5">
                  {[
                    { label: '+1h', h: 1 },
                    { label: '+2h', h: 2 },
                    { label: '+4h', h: 4 },
                    { label: 'Journée (8h)', h: 8 },
                  ].map((d) => (
                    <button
                      key={d.label}
                      type="button"
                      onClick={() => handleQuickDuration(d.h)}
                      className="px-3 py-2 rounded-xl text-xs font-bold cursor-pointer"
                      style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2" style={{ borderTop: `1px solid ${cardBorder}`, color: textMuted }}>
                <span>
                  Disponibilité calculée en direct pour la fenêtre immédiate{' '}
                  <strong style={{ color: textMain }}>
                    {activeSlot.date} · {activeSlot.start} → {activeSlot.end}
                  </strong>{' '}
                  (heure Africa/Tunis).
                </span>
                <span className="font-semibold text-[#f95d00]">Règlement 100 % sur place</span>
              </div>
            )}

            {slotInvalid && (
              <p className="text-xs font-bold text-red-500 m-0">
                L&apos;heure de fin doit être postérieure à l&apos;heure de début.
              </p>
            )}
          </div>

          {spacesError && (
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-500 text-sm font-semibold">
              {spacesError}
            </div>
          )}

          {/* Contenu selon Vue Images ou Vue Plan 2D */}
          {loadingSpaces && !liveData ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-96 rounded-3xl animate-pulse"
                  style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
                />
              ))}
            </div>
          ) : spaceViewMode === 'plan' && (liveData?.floor_plans?.length || 0) > 0 ? (
            <FloorPlanBookingView
              tenantId={selectedTenantId}
              externalPlans={liveData.floor_plans}
              controlledDate={activeSlot.date}
              controlledStart={activeSlot.start}
              controlledEnd={activeSlot.end}
              hideSlotBar={true}
              onReserve={({ espaceId, itemId, itemLabel, date, start, end }) => {
                const qs = new URLSearchParams({
                  espaceId,
                  date,
                  start,
                  end,
                  itemId: itemId || '',
                  itemLabel: itemLabel || '',
                }).toString();
                navigate(`/book/step3?${qs}`);
              }}
            />
          ) : (
            <div className="space-y-5">
              {/* Filtres de types d'espaces */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSpaceTypeFilter('all')}
                    className="px-4 py-2 rounded-full text-xs font-bold cursor-pointer transition-all"
                    style={{
                      backgroundColor: spaceTypeFilter === 'all' ? '#f95d00' : cardBg,
                      color: spaceTypeFilter === 'all' ? '#ffffff' : textMain,
                      border: `1px solid ${spaceTypeFilter === 'all' ? '#f95d00' : cardBorder}`,
                    }}
                  >
                    Tous ({liveData?.spaces?.length || 0})
                  </button>
                  {availableSpaceTypes.map((tp) => (
                    <button
                      key={tp}
                      type="button"
                      onClick={() => setSpaceTypeFilter(tp)}
                      className="px-4 py-2 rounded-full text-xs font-bold cursor-pointer transition-all"
                      style={{
                        backgroundColor: spaceTypeFilter === tp ? '#f95d00' : cardBg,
                        color: spaceTypeFilter === tp ? '#ffffff' : textMain,
                        border: `1px solid ${spaceTypeFilter === tp ? '#f95d00' : cardBorder}`,
                      }}
                    >
                      {spaceTypeLabel(tp)}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setOnlyAvailableSpaces((v) => !v)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold cursor-pointer"
                  style={{
                    backgroundColor: onlyAvailableSpaces ? '#10b981' : cardBg,
                    color: onlyAvailableSpaces ? '#ffffff' : textMain,
                    border: `1px solid ${onlyAvailableSpaces ? '#10b981' : cardBorder}`,
                  }}
                >
                  <span className="w-2 h-2 rounded-full bg-current" />
                  Disponibles uniquement
                </button>
              </div>

              {filteredSpaces.length === 0 ? (
                <div className="rounded-3xl p-10 text-center" style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}>
                  <p className="font-sora font-bold text-base m-0" style={{ color: textMain }}>
                    Aucun espace disponible avec ces filtres sur ce créneau.
                  </p>
                  <p className="text-xs mt-1 mb-0" style={{ color: textMuted }}>
                    Essayez de modifier l&apos;horaire ci-dessus ou d&apos;afficher tous les types d&apos;espaces.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredSpaces.map((space) => {
                    const isFree = space.live_status === 'free' || space.live_status === 'limited';
                    const isLimited = space.live_status === 'limited';
                    const mainImg = getSpaceFallbackImage(space, selectedCoworking);
                    const photoCount = space.photos?.length || 1;
                    const occPercent = space.capacity > 0 ? Math.min(100, Math.round((space.occupied_count / space.capacity) * 100)) : 0;

                    return (
                      <div
                        key={space.id}
                        className="group rounded-3xl overflow-hidden flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                        style={{
                          backgroundColor: cardBg,
                          border: `1px solid ${isFree ? cardBorder : 'rgba(239,68,68,0.28)'}`,
                          opacity: space.live_status === 'maintenance' ? 0.72 : 1,
                        }}
                      >
                        <div>
                          {/* Photo cliquable vers Galerie HD */}
                          <div
                            onClick={() => setGallerySpace(space)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && setGallerySpace(space)}
                            className="relative h-48 overflow-hidden cursor-pointer bg-neutral-900"
                          >
                            <img
                              src={mainImg}
                              alt={space.nom}
                              loading="lazy"
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            <div
                              className="absolute inset-0"
                              style={{ background: 'linear-gradient(180deg, rgba(16,15,13,0.4) 0%, rgba(16,15,13,0) 45%, rgba(16,15,13,0.75) 100%)' }}
                            />

                            {/* Badges haut */}
                            <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2">
                              <span
                                className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide"
                                style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: '#100f0d' }}
                              >
                                {spaceTypeLabel(space.type)}
                              </span>

                              <span
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold"
                                style={{
                                  backgroundColor: isLimited
                                    ? 'rgba(217,119,6,0.92)'
                                    : isFree
                                    ? 'rgba(5,150,105,0.92)'
                                    : 'rgba(220,38,38,0.92)',
                                  color: '#ffffff',
                                }}
                              >
                                <span className={`w-2 h-2 rounded-full bg-white ${isFree ? 'animate-pulse' : ''}`} />
                                {space.status_label}
                              </span>
                            </div>

                            {/* Bouton Galerie bas */}
                            <div className="absolute bottom-3 inset-x-3 flex items-center justify-between">
                              <span
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md"
                                style={{ backgroundColor: 'rgba(16,15,13,0.75)', color: '#ffffff' }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>photo_camera</span>
                                {photoCount > 1 ? `${photoCount} photos` : 'Agrandir'}
                              </span>

                              {space.floor_plan_items_count > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSpaceViewMode('plan');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer"
                                  style={{ backgroundColor: '#f95d00', color: '#ffffff', border: 'none' }}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>map</span>
                                  Plan 2D ({space.floor_plan_free_items_count}/{space.floor_plan_items_count})
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Infos espace */}
                          <div className="p-5 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-sora font-bold text-lg m-0 leading-snug" style={{ color: textMain }}>
                                {space.nom}
                              </h3>
                              <div className="text-right shrink-0">
                                <span className="font-sora font-extrabold text-lg text-[#f95d00] block leading-none">
                                  {formatDT(space.tarif_horaire)}
                                </span>
                                <span className="text-[11px]" style={{ color: textMuted }}>/ heure</span>
                              </div>
                            </div>

                            <p className="text-xs leading-relaxed m-0" style={{ color: textMuted }}>
                              {space.description ||
                                `Capacité : jusqu'à ${space.capacity} personne${space.capacity > 1 ? 's' : ''}. ${
                                  space.is_shared
                                    ? 'Espace partagé avec suivi des places en temps réel.'
                                    : 'Salle privative réservée exclusivement pour vous.'
                                }`}
                            </p>

                            {/* Jauge d'occupation temps réel pour espaces partagés */}
                            {space.is_shared && (
                              <div className="p-2.5 rounded-xl space-y-1.5" style={{ backgroundColor: subtleBg }}>
                                <div className="flex justify-between text-[11px] font-bold">
                                  <span style={{ color: textMuted }}>Occupation temps réel</span>
                                  <span className={isFree ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
                                    {space.remaining_spots} / {space.capacity} libre{space.remaining_spots > 1 ? 's' : ''}
                                  </span>
                                </div>
                                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: cardBorder }}>
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${occPercent}%`,
                                      backgroundColor: isFree ? (isLimited ? '#f59e0b' : '#10b981') : '#ef4444',
                                    }}
                                  />
                                </div>
                              </div>
                            )}

                            {!isFree && space.conflict_reason && (
                              <p className="text-[11px] font-semibold text-red-500 m-0">
                                {space.conflict_reason}
                                {space.next_free_time
                                  ? ` · Libre vers ${new Date(space.next_free_time).toLocaleTimeString('fr-FR', {
                                      timeZone: 'Africa/Tunis',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}`
                                  : ''}
                              </p>
                            )}

                            {Array.isArray(space.equipements) && space.equipements.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {space.equipements.slice(0, 4).map((eq, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                    style={{ backgroundColor: subtleBg, color: textMain, border: `1px solid ${cardBorder}` }}
                                  >
                                    ✓ {eq}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions bas de carte */}
                        <div
                          className="px-5 py-4 flex items-center justify-between gap-2"
                          style={{ backgroundColor: subtleBg, borderTop: `1px solid ${cardBorder}` }}
                        >
                          <button
                            type="button"
                            onClick={() => navigate(`/book/step2?espaceId=${space.id}`)}
                            className="px-3 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                            style={{ backgroundColor: cardBg, color: textMain, border: `1px solid ${cardBorder}` }}
                          >
                            Autre horaire
                          </button>

                          {isFree ? (
                            <button
                              type="button"
                              onClick={() => handleBookDirect(space)}
                              className="flex-1 px-4 py-2.5 rounded-xl text-xs font-extrabold cursor-pointer transition-transform hover:scale-[1.02]"
                              style={{
                                background: 'linear-gradient(135deg, #f95d00 0%, #ff8234 100%)',
                                color: '#ffffff',
                                border: 'none',
                                boxShadow: '0 6px 16px rgba(249,93,0,0.28)',
                              }}
                            >
                              Réserver ({formatDT((space.tarif_horaire || 0) * durationHours)}) →
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => navigate(`/book/step2?espaceId=${space.id}`)}
                              className="flex-1 px-4 py-2.5 rounded-xl text-xs font-extrabold cursor-pointer"
                              style={{ backgroundColor: '#100f0d', color: '#ffffff', border: 'none' }}
                            >
                              Choisir un autre créneau →
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modale Galerie Photo HD */}
      <SpacePhotoGalleryModal
        space={gallerySpace}
        coworkingName={selectedCoworking?.nom || ''}
        slotLabel={`${activeSlot.date} · ${activeSlot.start} → ${activeSlot.end}`}
        durationHours={durationHours}
        onClose={() => setGallerySpace(null)}
        onReserve={(sp) => {
          setGallerySpace(null);
          handleBookDirect(sp);
        }}
        onSelectOtherSlot={(sp) => {
          setGallerySpace(null);
          navigate(`/book/step2?espaceId=${sp.id}`);
        }}
      />
    </BookingShell>
  );
}
