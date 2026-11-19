import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { guestApi } from '../services/api';
import BrandLogo from '../components/layout/BrandLogo';
import { getBookerNav } from '../utils/roles';

export default function BookingStep1({ session }) {
  const { metadata } = useSessionUser(session);
  const isTrainer = metadata?.role === 'formateur' || metadata?.role === 'trainer';
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [coworking, setCoworking] = useState(null);
  // Initialisation synchrone depuis le JWT — 0 appel DB
  const [nav, setNav] = useState(() => getBookerNav(metadata.role || 'member'));
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // nav déjà initialisé depuis le JWT ci-dessus, plus d'appel DB nécessaire

  useEffect(() => {
    const tenantId = searchParams.get('tenantId');
    if (tenantId) {
      setSelectedTenant(tenantId);
      guestApi.getCoworking(tenantId)
        .then(res => { if (res.coworking) setCoworking(res.coworking); })
        .catch(() => {});
    }
    fetchSpaces();
  }, [searchParams]);

  const fetchSpaces = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('espaces')
        .select(`
          id,
          nom,
          type,
          capacite,
          tarif_horaire,
          photo_url,
          photos_urls,
          tenant_id,
          tenants!tenant_id(
            id,
            nom,
            ville,
            adresse,
            pays,
            cover_url,
            logo_url,
            latitude,
            longitude
          )
        `);

      if (selectedTenant) {
        query = query.eq('tenant_id', selectedTenant);
      }

      const { data, error } = await query.order('tarif_horaire', { ascending: true });
      if (error) throw error;

      const spacesData = data || [];
      const tenantIds = [...new Set(spacesData.map((s) => s.tenant_id).filter(Boolean))];

      let tenantMap = {};
      if (tenantIds.length > 0) {
        const { data: tenantsData, error: tenantsError } = await supabase
          .from('tenants')
          .select('id, nom, ville, adresse, pays, cover_url, logo_url, latitude, longitude')
          .in('id', tenantIds);

        if (tenantsError) throw tenantsError;

        tenantMap = Object.fromEntries((tenantsData || []).map((tenant) => [tenant.id, tenant]));
      }

      const enrichedSpaces = spacesData.map((space) => {
        const directTenant = Array.isArray(space.tenants) ? space.tenants[0] : space.tenants;
        return {
          ...space,
          tenant: directTenant || tenantMap[space.tenant_id] || null,
        };
      });

      setSpaces(enrichedSpaces);
    } catch (e) {
      console.error('Error fetching spaces:', e.message);
    } finally {
      setLoading(false);
    }
  };

  const getSpaceImage = (space) => {
    const photoList = Array.isArray(space.photos_urls) ? space.photos_urls : [];
    return space.photo_url || photoList[0] || space.tenant?.cover_url || space.tenant?.logo_url || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=400&fit=crop';
  };

  const getCoworkingName = (space) => {
    const tenant = space?.tenant || (Array.isArray(space?.tenants) ? space.tenants[0] : space?.tenants) || null;
    if (tenant?.nom) return tenant.nom;
    if (space?.tenant_id) {
      const fallback = spaces.find((s) => s.tenant_id === space.tenant_id)?.tenant?.nom;
      if (fallback) return fallback;
    }
    return 'Coworking';
  };

  const getCoworkingLabel = (space) => {
    const tenant = space.tenant || (Array.isArray(space?.tenants) ? space.tenants[0] : space?.tenants) || null;
    if (!tenant) return 'Coworking';
    return [tenant.nom, tenant.ville || tenant.pays || 'Tunisie'].filter(Boolean).join(' · ');
  };

  const handleSelectSpace = (spaceId) => {
    navigate(`/book/step2?espaceId=${spaceId}`);
  };

  const filteredSpaces = filterType === 'all' 
    ? spaces 
    : spaces.filter(s => s.type === filterType);

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F6F9' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '4px solid #f95d00', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
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
              Étape 1 sur 3
            </span>
            <Link 
              to={nav.home} 
              style={{ padding: '5px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: '1px solid #c5c6ce', color: '#100f0d', textDecoration: 'none', backgroundColor: '#fff', whiteSpace: 'nowrap' }}
            >
              Annuler
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main style={{ paddingTop: '88px', maxWidth: '1240px', margin: '0 auto', paddingLeft: '16px', paddingRight: '16px' }}>
        
        {/* Double contexte pour formateur (CDC v3.0) */}
        {isTrainer && (
          <div style={{ marginBottom: '24px', padding: '16px 20px', borderRadius: '16px', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px', boxShadow: '0 2px 8px rgba(249,93,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: '#f95d00', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>school</span>
              </div>
              <div>
                <p style={{ fontFamily: 'Sora, sans-serif', fontWeight: 700, fontSize: '14px', color: '#100f0d', margin: 0 }}>
                  Compte Formateur — Quel est l'objet de votre réservation ?
                </p>
                <p style={{ fontSize: '12px', color: '#7c2d12', margin: '2px 0 0 0' }}>
                  Vous pouvez réserver un bureau pour votre travail personnel ou animer une session de formation officielle.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ padding: '8px 14px', borderRadius: '10px', backgroundColor: '#ffffff', border: '2px solid #f95d00', color: '#f95d00', fontSize: '12px', fontWeight: 700, cursor: 'default' }}>
                ✓ Réserver en tant que membre
              </span>
              <Link
                to="/trainer/formations?create=1"
                style={{ padding: '8px 16px', borderRadius: '10px', backgroundColor: '#f95d00', color: '#ffffff', fontSize: '12px', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 8px rgba(249,93,0,0.25)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add_circle</span>
                Créer / Animer une formation
              </Link>
            </div>
          </div>
        )}

        {/* Header Section */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1 style={{ fontFamily: 'Sora, sans-serif', fontSize: 'clamp(22px, 5vw, 32px)', fontWeight: 700, color: '#100f0d', marginBottom: '10px' }}>
            Choisissez votre espace
          </h1>
          <p style={{ fontSize: '15px', color: '#4e4a46', maxWidth: '600px', width: '100%', margin: '0 auto', textAlign: 'center', lineHeight: '1.5' }}>
            Sélectionnez la salle ou le poste qui correspond à vos besoins de travail.
          </p>
        </div>

        {/* Carte du coworking (image + coordonnées) */}
        {coworking && (
          <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', overflow: 'hidden', marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '20px 24px', flexWrap: 'wrap' }}>
              <img
                src={coworking.cover_url || coworking.logo_url || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=400&fit=crop'}
                alt={coworking.nom}
                style={{ width: '100%', maxWidth: 280, height: 140, objectFit: 'cover', borderRadius: 14, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <h2 style={{ fontFamily: 'Sora, sans-serif', fontSize: '20px', fontWeight: 700, color: '#100f0d', margin: 0 }}>{coworking.nom}</h2>
                  <span style={{ background: '#ffedd8', color: '#f95d00', padding: '3px 10px', borderRadius: 99, fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' }}>
                    {(coworking.ville || coworking.pays || 'Tunisie')}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '13px', color: '#4e4a46' }}>
                  {coworking.adresse && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#f95d00' }}>location_on</span>
                      {coworking.adresse}{coworking.ville ? `, ${coworking.ville}` : ''}
                    </span>
                  )}
                  {coworking.telephone && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#f95d00' }}>phone</span>
                      {coworking.telephone}
                    </span>
                  )}
                  {coworking.latitude && coworking.longitude && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#f95d00' }}>place</span>
                      GPS : {coworking.latitude}, {coworking.longitude}
                      <a
                        href={`https://www.google.com/maps?q=${coworking.latitude},${coworking.longitude}`}
                        target="_blank" rel="noreferrer"
                        style={{ color: '#f95d00', fontWeight: 600, textDecoration: 'none' }}
                      >Voir sur la carte</a>
                    </span>
                  )}
                  {coworking.description && (
                    <span style={{ lineHeight: 1.6, marginTop: 4 }}>{coworking.description}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter Badges — Clean Bootstrap-style Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginBottom: '40px' }}>
          {[
            { id: 'all', label: 'Tous les espaces' },
            { id: 'open_space', label: 'Open Space' },
            { id: 'private_office', label: 'Bureau Privé' },
            { id: 'meeting_room', label: 'Salle de Réunion' },
            { id: 'training_room', label: 'Salle de Formation' },
            { id: 'event_space', label: 'Événement' },
            { id: 'hot_desk', label: 'Hot Desk' },
            { id: 'dedicated_desk', label: 'Dedicated Desk' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilterType(id)}
              style={{
                padding: '8px 20px',
                borderRadius: '99px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                border: filterType === id ? 'none' : '1px solid #d0d7de',
                backgroundColor: filterType === id ? '#f95d00' : '#ffffff',
                color: filterType === id ? '#ffffff' : '#334155',
                boxShadow: filterType === id ? '0 4px 12px rgba(249,93,0,0.25)' : '0 1px 3px rgba(0,0,0,0.05)',
                transition: 'all 0.2s ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Grid List */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '20px' }}>
          {filteredSpaces.map((space) => (
            <div
              key={space.id}
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '20px',
                border: '1px solid rgba(0,0,0,0.08)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
            >
              <div>
                <img
                  src={getSpaceImage(space)}
                  alt={space.nom}
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', height: '180px', objectFit: 'cover', display: 'block', backgroundColor: '#e2e8f0' }}
                />

                <div style={{ padding: '20px 20px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ backgroundColor: '#dae2ff', color: '#001847', padding: '4px 12px', borderRadius: '99px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {space.type ? space.type.replace('_', ' ') : 'Espace'}
                    </span>
                    <span style={{ fontFamily: 'Sora, sans-serif', fontSize: '20px', fontWeight: 800, color: '#f95d00' }}>
                      {parseFloat(space.tarif_horaire).toFixed(3)} DT <span style={{ fontSize: '12px', fontWeight: 400, color: '#6b7280' }}>/ h</span>
                    </span>
                  </div>

                  <div>
                    <h3 style={{ fontFamily: 'Sora, sans-serif', fontSize: '18px', fontWeight: 700, color: '#000d23', marginBottom: '6px' }}>
                      {space.nom}
                    </h3>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '28px',
                        height: '28px',
                        borderRadius: '8px',
                        background: '#e0ebff',
                        color: '#2347a8',
                        fontSize: '16px',
                        lineHeight: 1,
                      }} aria-label="Bâtiment"
                        className="material-symbols-outlined"
                      >
                        apartment
                      </span>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                        {getCoworkingName(space) || 'Ala Coworking'}
                      </span>
                    </div>

                    <p style={{ fontSize: '13px', color: '#6b7280', margin: 0, lineHeight: 1.6 }}>
                      Capacité : jusqu&apos;à <strong style={{ color: '#000d23' }}>{space.capacite}</strong> personnes.
                      {space.type === 'open_space'
                        ? ' Places partagées : plusieurs réservations au même horaire.'
                        : ' Réservation exclusive : un seul client par créneau.'}
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ padding: '16px 20px', backgroundColor: '#f8fafc', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                  Disponible aujourd&apos;hui
                </span>
                <button
                  onClick={() => handleSelectSpace(space.id)}
                  style={{
                    backgroundColor: '#f95d00',
                    color: '#ffffff',
                    padding: '8px 18px',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,84,203,0.2)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Sélectionner
                </button>
              </div>
            </div>
          ))}
        </div>

      </main>
    </div>
  );
}
