import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../supabaseClient';
import { memberApi, subscriptionApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';

const formatDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return d;
  }
};

export default function QrCodeView({ session }) {
  const [profile, setProfile] = useState(null);
  const [qrData, setQrData] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, [session]);

  const loadData = async () => {
    try {
      const [prof, qr, sub] = await Promise.allSettled([
        supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single(),
        memberApi.getQr(),
        subscriptionApi.getActive().catch(() => ({ subscription: null })),
      ]);

      if (prof.status === 'fulfilled') setProfile(prof.value.data);
      if (qr.status === 'fulfilled') setQrData(qr.value);
      if (sub.status === 'fulfilled') {
        const actualSub = sub.value?.subscription || (sub.value && sub.value.id ? sub.value : null);
        setSubscription(actualSub);
      }
    } catch (err) {
      setError(err.message || 'Erreur de chargement du QR code.');
    } finally {
      setLoading(false);
    }
  };

  const handleMouseMove = useCallback((e) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setTilt({
      x: ((y - cy) / cy) * -5,
      y: ((x - cx) / cx) * 5,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ x: 0, y: 0 });
  }, []);

  const handleDownload = useCallback(() => {
    const svg = document.querySelector('#qr-svg-container svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = 1024;
      canvas.height = 1024;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1024, 1024);
      ctx.drawImage(img, 64, 64, 896, 896);
      const a = document.createElement('a');
      a.download = 'mamespace-qr-access.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, []);

  const handleShare = useCallback(async () => {
    if (navigator.share && qrData?.payload) {
      try {
        await navigator.share({
          title: 'Mon Pass d\'Accès DeskyWork',
          text: 'Voici mon QR code d\'accès pour les espaces DeskyWork.',
          url: window.location.href,
        });
      } catch { /* cancelled */ }
    } else {
      const subject = encodeURIComponent('Mon Pass d\'Accès DeskyWork');
      const body = encodeURIComponent(
        `Bonjour,\n\nVoici le lien vers mon QR code d'accès :\n${window.location.href}\n\nMerci de le présenter à l'accueil.`
      );
      window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
    }
  }, [qrData]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const hasAccess = Boolean(subscription && (subscription.id || subscription.type || subscription.plan_name));
  const subName = hasAccess
    ? (subscription?.plan_name || subscription?.name || subscription?.type || 'Abonnement actif')
    : 'Sans abonnement';
  const subExpiry = hasAccess
    ? (subscription?.end_date || subscription?.expires_at || subscription?.period_end)
    : null;
  const qrPayload = qrData?.payload || qrData?.qr_token || qrData?.token || profile?.qr_token;

  if (loading) {
    return (
      <PortalLayout profile={null} onLogout={handleLogout}>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-secondary/20 border-t-secondary rounded-full animate-spin" />
            <p className="text-on-surface-variant text-sm">Chargement de votre pass d&apos;accès...</p>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="flex-1 p-4 sm:p-6 md:p-8 max-w-[1280px] mx-auto w-full pb-24 md:pb-8">

        {/* ── Header ── */}
        <div className="mb-6 md:mb-8">
          <h2
            className="text-2xl sm:text-[28px]/[36px] md:text-[32px]/[40px] tracking-[-0.01em] font-semibold text-primary"
            style={{ fontFamily: 'Sora, sans-serif' }}
          >
            Votre Pass d&apos;Accès
          </h2>
          <p className="text-on-surface-variant text-base leading-6 mt-1">
            Scannez ce code aux bornes d&apos;entrée de nos espaces DeskyWork pour déverrouiller vos privilèges.
          </p>
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div className="mb-6 p-3 bg-[#ffdad6] text-[#93000a] text-sm rounded-xl flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">warning</span>
            {error}
          </div>
        )}

        {/* ── Centered Access Card ── */}
        <div className="flex justify-center items-center py-2">
          <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="w-full max-w-[480px] rounded-3xl overflow-hidden relative transition-transform duration-300 ease-out"
            style={{
              background: 'linear-gradient(135deg, #10233f 0%, #0d1a30 50%, #0a1525 100%)',
              boxShadow: '0 25px 60px -12px rgba(0,13,35,0.45), 0 8px 24px -8px rgba(0,0,0,0.3)',
              transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale3d(1,1,1)`,
              transition: tilt.x === 0 && tilt.y === 0
                ? 'transform 0.5s cubic-bezier(0.23,1,0.32,1)'
                : 'transform 0.1s ease-out',
            }}
          >
            {/* Atmospheric Glow Effect */}
            <div
              className="absolute -top-24 -right-24 w-64 h-64 rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle, rgba(0,84,203,0.25) 0%, rgba(0,84,203,0.08) 40%, transparent 70%)',
                filter: 'blur(80px)',
              }}
            />
            <div
              className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle, rgba(0,84,203,0.12) 0%, transparent 60%)',
                filter: 'blur(60px)',
              }}
            />

            <div className="p-6 md:p-8 relative z-10 flex flex-col items-center">

              {/* ── Status Badge ── */}
              {hasAccess ? (
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6"
                  style={{ background: 'rgba(47,190,143,0.1)' }}
                >
                  <span className="w-2 h-2 rounded-full bg-[#2fbe8f] shadow-[0_0_8px_rgba(47,190,143,0.6)]" />
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#2fbe8f]">
                    Abonnement actif
                  </span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6"
                  style={{ background: 'rgba(245,158,11,0.1)' }}
                >
                  <span className="w-2 h-2 rounded-full bg-[#f59e0b] shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#b45309]">
                    Sans abonnement actif
                  </span>
                </div>
              )}

              {/* ── QR Code Area ── */}
              <div
                className="relative p-5 bg-white rounded-xl mb-6 shadow-xl cursor-pointer transition-transform duration-500 hover:scale-[1.02]"
                id="qr-svg-container"
              >
                <div className="w-56 h-56 flex items-center justify-center bg-white relative">
                  {qrPayload ? (
                    <QRCodeSVG
                      value={qrPayload}
                      size={192}
                      level="H"
                      fgColor="#0a1525"
                      bgColor="#ffffff"
                      imageSettings={{
                        src: '',
                        height: 0,
                        width: 0,
                        excavate: false,
                      }}
                    />
                  ) : (
                    <div className="w-48 h-48 bg-[#f5f3f6] rounded-lg flex items-center justify-center">
                      <span className="material-symbols-outlined text-5xl text-on-surface-variant">qr_code_2</span>
                    </div>
                  )}

                  {/* Corner Frame Accents */}
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-secondary rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-secondary rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-secondary rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-secondary rounded-br-lg" />
                </div>
              </div>

              {/* ── Subscription Info Grid ── */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6 py-4 px-2 mb-6"
                style={{ borderTop: '1px solid rgba(181,199,235,0.1)', borderBottom: '1px solid rgba(181,199,235,0.1)' }}
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.08em] mb-1"
                    style={{ color: 'rgba(181,199,235,0.5)', fontFamily: 'Inter, sans-serif' }}
                  >
                    Abonnement
                  </p>
                  <p className="text-xl font-semibold text-white" style={{ fontFamily: 'Sora, sans-serif' }}>
                    {subName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.08em] mb-1"
                    style={{ color: 'rgba(181,199,235,0.5)', fontFamily: 'Inter, sans-serif' }}
                  >
                    Expire le
                  </p>
                  <p className="text-xl font-semibold text-white" style={{ fontFamily: 'Sora, sans-serif' }}>
                    {formatDate(subExpiry)}
                  </p>
                </div>
              </div>

              {/* ── Action Buttons ── */}
              <div className="w-full flex flex-col gap-3">
                <button
                  onClick={handleDownload}
                  className="w-full text-white font-semibold text-sm py-4 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.97]"
                  style={{
                    background: 'linear-gradient(135deg, #f95d00 0%, #ff7a28 100%)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>download</span>
                  Télécharger le QR Code
                </button>
                <button
                  onClick={handleShare}
                  className="w-full font-semibold text-sm py-4 rounded-lg flex items-center justify-center gap-2 transition-all"
                  style={{
                    color: 'rgba(181,199,235,0.8)',
                    border: '1px solid rgba(181,199,235,0.2)',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(181,199,235,0.05)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>ios_share</span>
                  Partager par email
                </button>
              </div>

              {/* ── Footer Note ── */}
              <p className="mt-6 text-center text-xs leading-relaxed px-4"
                style={{ color: 'rgba(181,199,235,0.4)', fontFamily: 'Inter, sans-serif' }}
              >
                Ce code est lié à votre abonnement actif et se régénère automatiquement à chaque renouvellement.
              </p>
            </div>
          </div>
        </div>

        {/* ── Help Links Grid ── */}
        <div className="mt-8 md:mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
          <Link
            to="/portal/support"
            className="p-4 bg-white rounded-xl flex items-start gap-4 hover:shadow-md transition-all duration-200 group"
            style={{
              boxShadow: '0 1px 3px rgba(16,35,63,0.04)',
              border: '1px solid rgba(197,198,206,0.3)',
            }}
          >
            <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200"
              style={{ background: 'rgba(181,199,235,0.2)' }}
            >
              <span className="material-symbols-outlined text-secondary">help_center</span>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-primary mb-1 group-hover:text-secondary transition-colors"
                style={{ fontFamily: 'Sora, sans-serif' }}
              >
                Support
              </h4>
              <p className="text-sm text-on-surface-variant leading-snug">Besoin d&apos;aide pour l&apos;accès ?</p>
            </div>
          </Link>

          <Link
            to="/portal/spaces"
            className="p-4 bg-white rounded-xl flex items-start gap-4 hover:shadow-md transition-all duration-200 group"
            style={{
              boxShadow: '0 1px 3px rgba(16,35,63,0.04)',
              border: '1px solid rgba(197,198,206,0.3)',
            }}
          >
            <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200"
              style={{ background: 'rgba(181,199,235,0.2)' }}
            >
              <span className="material-symbols-outlined text-secondary">location_on</span>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-primary mb-1 group-hover:text-secondary transition-colors"
                style={{ fontFamily: 'Sora, sans-serif' }}
              >
                Espaces
              </h4>
              <p className="text-sm text-on-surface-variant leading-snug">Voir les accès autorisés</p>
            </div>
          </Link>

          <Link
            to="/portal/history"
            className="p-4 bg-white rounded-xl flex items-start gap-4 hover:shadow-md transition-all duration-200 group"
            style={{
              boxShadow: '0 1px 3px rgba(16,35,63,0.04)',
              border: '1px solid rgba(197,198,206,0.3)',
            }}
          >
            <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200"
              style={{ background: 'rgba(181,199,235,0.2)' }}
            >
              <span className="material-symbols-outlined text-secondary">history</span>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-primary mb-1 group-hover:text-secondary transition-colors"
                style={{ fontFamily: 'Sora, sans-serif' }}
              >
                Historique
              </h4>
              <p className="text-sm text-on-surface-variant leading-snug">Consulter vos passages</p>
            </div>
          </Link>
        </div>
      </div>

      {/* ── Mobile Bottom Nav (hidden on md+) ── */}
      <div className="md:hidden fixed bottom-0 left-0 w-full bg-white px-4 py-2 flex justify-around items-center z-50"
        style={{
          boxShadow: '0 -2px 10px rgba(0,0,0,0.05)',
          borderTop: '1px solid rgba(197,198,206,0.1)',
        }}
      >
        <Link to="/portal" className="flex flex-col items-center p-2 text-on-surface-variant">
          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>dashboard</span>
          <span className="text-[10px] font-medium mt-0.5">Dashboard</span>
        </Link>
        <Link to="/portal/access" className="flex flex-col items-center p-2 text-secondary font-bold">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 24, fontVariationSettings: "'FILL' 1" }}
          >
            qr_code_2
          </span>
          <span className="text-[10px] mt-0.5">Accès</span>
        </Link>
        <Link to="/portal/bookings" className="flex flex-col items-center p-2 text-on-surface-variant">
          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>calendar_month</span>
          <span className="text-[10px] font-medium mt-0.5">Book</span>
        </Link>
        <Link to="/portal/profile" className="flex flex-col items-center p-2 text-on-surface-variant">
          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>person</span>
          <span className="text-[10px] font-medium mt-0.5">Profil</span>
        </Link>
      </div>
    </PortalLayout>
  );
}
