import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { bookingApi } from '../services/api';
import BrandLogo from '../components/layout/BrandLogo';
import { getBookerNav } from '../utils/roles';

export default function BookingStep2({ session }) {
  const { metadata } = useSessionUser(session);
  const [searchParams] = useSearchParams();
  const espaceId = searchParams.get('espaceId');
  const navigate = useNavigate();
  // Initialisation synchrone depuis le JWT — 0 appel DB
  const [nav, setNav] = useState(() => getBookerNav(metadata.role || 'member'));

  const [space, setSpace] = useState(null);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [checking, setChecking] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [isAvailable, setIsAvailable] = useState(false);
  const [occupancy, setOccupancy] = useState(null);

  // nav déjà initialisé depuis le JWT ci-dessus, plus d'appel DB nécessaire

  useEffect(() => {
    if (!espaceId) {
      navigate('/book/step1');
      return;
    }
    fetchSpace();

    // Default to tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(tomorrow.toISOString().split('T')[0]);
  }, [espaceId]);

  const fetchSpace = async () => {
    const { data, error } = await supabase
      .from('espaces')
      .select('*')
      .eq('id', espaceId)
      .single();

    if (!error && data) {
      setSpace(data);
    }
  };

  const handleCheckAvailability = async (e) => {
    e.preventDefault();
    setChecking(true);
    setAvailabilityMessage('');
    setIsAvailable(false);
    setOccupancy(null);

    const startDateTime = new Date(`${date}T${startTime}:00`).toISOString();
    const endDateTime = new Date(`${date}T${endTime}:00`).toISOString();

    if (new Date(startDateTime) >= new Date(endDateTime)) {
      setAvailabilityMessage('L\'heure de fin doit être postérieure à l\'heure de début.');
      setChecking(false);
      return;
    }

    try {
      const result = await bookingApi.checkAvailability({
        espace_id: espaceId,
        date_debut: startDateTime,
        date_fin: endDateTime,
      });

      if (result.shared) {
        setOccupancy({
          remaining: result.remaining ?? 0,
          capacity: result.capacity ?? space?.capacite ?? 0,
          occupied: result.overlapsCount ?? 0,
        });
      } else {
        setOccupancy(null);
      }

      if (result.isAvailable) {
        setIsAvailable(true);
        setAvailabilityMessage(result.message || 'Ce créneau est disponible. Vous pouvez continuer vers la confirmation.');
      } else {
        setIsAvailable(false);
        setAvailabilityMessage(result.message || 'Ce créneau est déjà réservé. Choisissez un autre horaire.');
      }
    } catch (err) {
      setAvailabilityMessage(err.message || 'Impossible de vérifier la disponibilité.');
    } finally {
      setChecking(false);
    }
  };

  const handleProceed = () => {
    navigate(`/book/step3?espaceId=${espaceId}&date=${date}&start=${startTime}&end=${endTime}`);
  };

  if (!space) {
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
              Étape 2 sur 3
            </span>
            <Link 
              to="/book/step1" 
              style={{ padding: '5px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: '1px solid #c5c6ce', color: '#100f0d', textDecoration: 'none', backgroundColor: '#fff', whiteSpace: 'nowrap' }}
            >
              Retour
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main style={{ paddingTop: '88px', maxWidth: '600px', margin: '0 auto', paddingLeft: '16px', paddingRight: '16px' }}>
        
        {/* Card Form */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '24px', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 8px 30px rgba(0,0,0,0.05)', padding: 'clamp(20px, 5vw, 32px)' }}>
          
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontFamily: 'Sora, sans-serif', fontSize: '24px', fontWeight: 700, color: '#100f0d', marginBottom: '6px' }}>
              Configurez votre créneau
            </h1>
            <p style={{ fontSize: '14px', color: '#5a6a8a', margin: 0 }}>
              Espace sélectionné : <strong style={{ color: '#f95d00' }}>{space.nom}</strong> ({parseFloat(space.tarif_horaire).toFixed(3)} DT / h)
            </p>
            {(space.type === 'open_space' || space.type === 'hot_desk') ? (
              <p style={{ fontSize: '13px', color: '#059669', margin: '8px 0 0 0', fontWeight: 600 }}>
                Espace partagé — plusieurs personnes peuvent réserver le même créneau, jusqu’à {space.capacite} places.
              </p>
            ) : (
              <p style={{ fontSize: '13px', color: '#64748b', margin: '8px 0 0 0' }}>
                Salle exclusive — un seul client peut réserver ce créneau.
              </p>
            )}
          </div>

          <form onSubmit={handleCheckAvailability} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label htmlFor="date" style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#000d23', marginBottom: '8px' }}>
                Date de réservation
              </label>
              <input
                id="date"
                type="date"
                required
                value={date}
                onChange={(e) => { setDate(e.target.value); setIsAvailable(false); setAvailabilityMessage(''); setOccupancy(null); }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  border: '1px solid #d0d7de',
                  backgroundColor: '#f8fafc',
                  fontSize: '14px',
                  color: '#000d23',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px' }}>
              <div>
                <label htmlFor="start" style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#000d23', marginBottom: '8px' }}>
                  Heure de début
                </label>
                <input
                  id="start"
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); setIsAvailable(false); setAvailabilityMessage(''); setOccupancy(null); }}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: '1px solid #d0d7de',
                    backgroundColor: '#f8fafc',
                    fontSize: '14px',
                    color: '#000d23',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label htmlFor="end" style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#000d23', marginBottom: '8px' }}>
                  Heure de fin
                </label>
                <input
                  id="end"
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => { setEndTime(e.target.value); setIsAvailable(false); setAvailabilityMessage(''); setOccupancy(null); }}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: '1px solid #d0d7de',
                    backgroundColor: '#f8fafc',
                    fontSize: '14px',
                    color: '#000d23',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={checking}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                backgroundColor: '#f95d00',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '14px',
                border: 'none',
                cursor: checking ? 'not-allowed' : 'pointer',
                opacity: checking ? 0.7 : 1,
                boxShadow: '0 4px 14px rgba(0,84,203,0.3)',
                transition: 'all 0.15s ease',
              }}
            >
              {checking ? 'Vérification...' : 'Vérifier la disponibilité'}
            </button>
          </form>

          {occupancy && (
            <div
              style={{
                marginTop: '20px',
                padding: '16px 18px',
                borderRadius: '14px',
                backgroundColor: occupancy.remaining > 0 ? '#ecfdf5' : '#fef2f2',
                border: occupancy.remaining > 0 ? '1px solid #a7f3d0' : '1px solid #fecaca',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: occupancy.remaining > 0 ? '#065f46' : '#991b1b' }}>
                  Places restantes
                </span>
                <span style={{ fontFamily: 'Sora, sans-serif', fontSize: '22px', fontWeight: 800, color: occupancy.remaining > 0 ? '#059669' : '#dc2626' }}>
                  {occupancy.remaining}
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}> / {occupancy.capacity}</span>
                </span>
              </div>
              <div style={{ height: '8px', borderRadius: '99px', backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${occupancy.capacity > 0 ? Math.min(100, (occupancy.occupied / occupancy.capacity) * 100) : 0}%`,
                    backgroundColor: occupancy.remaining > 0 ? '#10b981' : '#ef4444',
                    borderRadius: '99px',
                  }}
                />
              </div>
              <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                {occupancy.occupied} place{occupancy.occupied > 1 ? 's' : ''} déjà réservée{occupancy.occupied > 1 ? 's' : ''} sur ce créneau
                {occupancy.remaining === 0 ? ' — complet, choisissez un autre horaire.' : '.'}
              </p>
            </div>
          )}

          {availabilityMessage && !occupancy && (
            <div 
              style={{
                marginTop: '20px',
                padding: '14px 18px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: isAvailable ? '#d1fae5' : '#fee2e2',
                color: isAvailable ? '#065f46' : '#991b1b',
                border: isAvailable ? '1px solid #a7f3d0' : '1px solid #fca5a5',
              }}
            >
              {availabilityMessage}
            </div>
          )}

          {isAvailable && (
            <button
              onClick={handleProceed}
              style={{
                marginTop: '16px',
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                backgroundColor: '#f95d00',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '14px',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,84,203,0.3)',
                transition: 'all 0.15s ease',
              }}
            >
              Continuer vers la confirmation →
            </button>
          )}

        </div>
      </main>
    </div>
  );
}
