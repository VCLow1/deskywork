import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { memberApi } from '../services/api';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import Money from '../components/common/Money';
import { QRCodeSVG } from 'qrcode.react';

export default function QrCodeView({ session }) {
  const navigate = useNavigate();
  const { userId, email, metadata } = useSessionUser(session);
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'member', ...metadata } : null
  );
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [driftMs, setDriftMs] = useState(0);

  const loadQr = useCallback(async ({ silent = false } = {}) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError('');

      const [meRes, qrRes] = await Promise.allSettled([
        memberApi.getMe(),
        memberApi.getQr(),
      ]);

      if (meRes.status === 'fulfilled') {
        setProfile(meRes.value?.profile || meRes.value);
      }
      if (qrRes.status === 'fulfilled') {
        const q = qrRes.value;
        setQrData(q);
        if (q?.server_now) {
          const sMs = new Date(q.server_now).getTime();
          if (Number.isFinite(sMs)) setDriftMs(sMs - Date.now());
        }
      } else {
        setError(qrRes.reason?.message || 'Impossible de charger votre code d’accès.');
      }
    } catch (e) {
      setError(e.message || 'Impossible de charger votre code d’accès.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadQr();
  }, [loadQr]);

  // Horloge synchronisée sur l'heure serveur (1s)
  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now() + driftMs);
    }, 1000);
    return () => clearInterval(id);
  }, [driftMs]);

  const ttlSeconds = qrData?.ttl_seconds || 300;
  const expiresMs = qrData?.expires_at ? new Date(qrData.expires_at).getTime() : 0;
  const secondsLeft = useMemo(() => {
    if (!expiresMs || qrData?.status === 'blocked') return 0;
    return Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
  }, [expiresMs, nowMs, qrData?.status]);

  // Régénération automatique dès expiration d'un code actif
  useEffect(() => {
    if (loading || refreshing) return undefined;
    if (qrData?.status === 'active' && expiresMs > 0 && secondsLeft === 0) {
      const t = setTimeout(() => {
        loadQr({ silent: true });
      }, 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [loading, refreshing, qrData?.status, expiresMs, secondsLeft, loadQr]);

  const effectiveStatus = useMemo(() => {
    if (!qrData) return 'expired';
    if (qrData.status === 'blocked') return 'blocked';
    if (qrData.status === 'expired') return 'expired';
    if (qrData.status === 'active' && (!expiresMs || secondsLeft <= 0)) return 'expired';
    return 'active';
  }, [qrData, expiresMs, secondsLeft]);

  const countdownLabel = useMemo(() => {
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [secondsLeft]);

  const progressPct = Math.min(100, Math.max(0, Math.round((secondsLeft / ttlSeconds) * 100)));

  const handleCopyShortCode = async () => {
    if (!qrData?.short_code) return;
    try {
      await navigator.clipboard.writeText(qrData.short_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleDownloadQr = () => {
    if (effectiveStatus !== 'active') return;
    const svg = document.getElementById('member-qr-svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 640, 640);
      ctx.drawImage(img, 40, 40, 560, 560);
      const a = document.createElement('a');
      a.download = 'deskywork-acces-qr.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const fullName = `${profile?.prenom || ''} ${profile?.nom || ''}`.trim() || 'Membre';
  const initials = `${profile?.prenom?.[0] || ''}${profile?.nom?.[0] || ''}`.toUpperCase() || 'M';

  return (
    <PortalLayout profile={profile} onLogout={handleLogout}>
      <div className="max-w-lg mx-auto py-2 sm:py-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-sora font-bold text-2xl text-primary dark:text-white">Mon accès</h1>
            <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5">
              QR code dynamique renouvelé toutes les 5 minutes + code de secours.
            </p>
          </div>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-outline-variant/25 text-primary dark:text-white hover:bg-black/5 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
            Accueil
          </Link>
        </div>

        {error && (
          <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => loadQr()} className="underline font-bold cursor-pointer">
              Réessayer
            </button>
          </div>
        )}

        <div
          className="rounded-3xl overflow-hidden shadow-2xl border border-white/10"
          style={{ background: 'linear-gradient(145deg, #100f0d 0%, #1d1b18 65%, #2a211b 100%)' }}
        >
          {/* Bandeau supérieur */}
          <div className="px-6 pt-6 pb-4 flex items-center justify-between gap-3 border-b border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center font-sora font-bold text-sm text-white shrink-0"
                style={{ backgroundColor: '#f95d00' }}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p className="font-sora font-bold text-white text-sm truncate">{fullName}</p>
                <p className="text-xs text-[#a3a09b] truncate">{profile?.email || ''}</p>
              </div>
            </div>

            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shrink-0 ${
                effectiveStatus === 'active'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : effectiveStatus === 'blocked'
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  effectiveStatus === 'active'
                    ? 'bg-emerald-400 animate-pulse'
                    : effectiveStatus === 'blocked'
                    ? 'bg-red-400'
                    : 'bg-amber-400'
                }`}
              />
              {effectiveStatus === 'active' ? 'Actif' : effectiveStatus === 'blocked' ? 'Bloqué' : 'Expiré'}
            </span>
          </div>

          <div className="p-6 text-center space-y-5">
            {loading ? (
              <div className="py-16 flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#f95d00] border-t-transparent" />
                <p className="text-xs text-[#a3a09b]">Génération de votre code sécurisé…</p>
              </div>
            ) : effectiveStatus === 'blocked' ? (
              /* État Bloqué (impayé ou compte suspendu) */
              <div className="py-6 px-4 rounded-2xl bg-red-500/10 border border-red-500/30 space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-red-500/20 text-red-300 flex items-center justify-center mx-auto">
                  <span className="material-symbols-outlined" style={{ fontSize: 34 }}>lock</span>
                </div>
                <div className="space-y-2">
                  <h2 className="font-sora font-bold text-lg text-white">Accès temporairement bloqué</h2>
                  <p className="text-xs text-red-200 leading-relaxed">
                    {qrData?.reason || 'Votre accès est bloqué suite à un impayé dépassant le seuil autorisé.'}
                  </p>
                  {Number(qrData?.overdue_amount || 0) > 0 && (
                    <p className="text-sm font-extrabold text-white">
                      Solde à régulariser : <Money amount={qrData.overdue_amount} />
                    </p>
                  )}
                </div>
                <Link
                  to="/member/payments"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white"
                  style={{ backgroundColor: '#f95d00', textDecoration: 'none' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>receipt_long</span>
                  Voir mes paiements et régulariser
                </Link>
              </div>
            ) : (
              /* État Actif ou Expiré */
              <>
                <div className="relative bg-white p-5 rounded-2xl inline-flex items-center justify-center shadow-lg">
                  <div className={effectiveStatus === 'expired' ? 'opacity-20 blur-[2px] transition-all' : ''}>
                    <QRCodeSVG
                      id="member-qr-svg"
                      value={qrData?.payload || qrData?.qr_token || 'deskywork-expire'}
                      size={220}
                      bgColor="#ffffff"
                      fgColor="#100f0d"
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  {effectiveStatus === 'expired' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/65 rounded-2xl p-4 text-white">
                      <span className="material-symbols-outlined text-amber-400 mb-1" style={{ fontSize: 36 }}>timer_off</span>
                      <p className="font-sora font-bold text-sm">Code expiré</p>
                      <button
                        type="button"
                        onClick={() => loadQr({ silent: true })}
                        disabled={refreshing}
                        className="mt-3 px-4 py-2 rounded-xl text-xs font-bold text-white cursor-pointer"
                        style={{ backgroundColor: '#f95d00' }}
                      >
                        {refreshing ? 'Actualisation…' : 'Générer un nouveau code'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Compte à rebours validité 5 min */}
                <div className="space-y-2 text-left bg-white/5 rounded-2xl p-4 border border-white/10">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#a3a09b] font-medium">Validité restante</span>
                    <span className="font-sora font-bold text-white tabular-nums">
                      {effectiveStatus === 'active' ? countdownLabel : '00:00'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progressPct}%`,
                        backgroundColor: secondsLeft <= 45 ? '#ef4444' : '#f95d00',
                      }}
                    />
                  </div>
                  <p className="text-xs text-[#a3a09b]">
                    Présentez ce QR code à l&apos;accueil à votre arrivée. Renouvellement automatique toutes les 5 minutes.
                  </p>
                </div>

                {/* Code court alphanumérique de secours */}
                {qrData?.short_code && (
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-3">
                    <div className="text-left">
                      <p className="text-xs font-semibold text-[#a3a09b] uppercase tracking-wider">
                        Code de secours
                      </p>
                      <p className="font-sora font-extrabold text-xl tracking-[0.18em] text-white mt-0.5 tabular-nums">
                        {qrData.short_code}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyShortCode}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-white/10 hover:bg-white/20 cursor-pointer transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        {copied ? 'check' : 'content_copy'}
                      </span>
                      {copied ? 'Copié' : 'Copier'}
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => loadQr({ silent: true })}
                    disabled={refreshing}
                    className="py-2.5 px-3 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#f95d00' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 17 }}>refresh</span>
                    {refreshing ? 'Actualisation…' : 'Actualiser'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadQr}
                    disabled={effectiveStatus !== 'active'}
                    className="py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 17 }}>download</span>
                    Télécharger
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            to="/dashboard/bookings"
            className="flex-1 min-w-[160px] text-center py-3 px-4 rounded-2xl bg-white dark:bg-[#1a1917] border border-outline-variant/20 text-primary dark:text-white text-xs font-bold hover:border-[#f95d00]/40 transition-colors"
          >
            Mes réservations
          </Link>
          <Link
            to="/book/step1"
            className="flex-1 min-w-[160px] text-center py-3 px-4 rounded-2xl text-white text-xs font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#f95d00' }}
          >
            + Réserver un espace
          </Link>
        </div>
      </div>
    </PortalLayout>
  );
}
