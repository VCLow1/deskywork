// components/booking/SpacePhotoGalleryModal.jsx — Galerie photo HD interactive (Portal) avec réservation directe
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../context/ThemeContext';
import { formatDT } from '../../utils/format';
import { spaceTypeLabel } from '../../constants/spaceTypes';

export default function SpacePhotoGalleryModal({
  space,
  coworkingName = '',
  slotLabel = '',
  durationHours = 2,
  onClose,
  onReserve,
  onSelectOtherSlot,
}) {
  const { dark } = useTheme();
  const photos = (space?.photos && space.photos.length > 0
    ? space.photos
    : [space?.photo_url || 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=750&fit=crop']
  ).filter(Boolean);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [space?.id]);

  useEffect(() => {
    if (!space) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % photos.length);
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [space, photos.length, onClose]);

  if (!space || typeof document === 'undefined') return null;

  const isFree = space.live_status === 'free' || space.live_status === 'limited';
  const cardBg = dark ? '#181715' : '#ffffff';
  const cardBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(16,15,13,0.1)';
  const textMain = dark ? '#fbffff' : '#100f0d';
  const textMuted = dark ? '#cfcac3' : '#5e5a55';

  const statusColors =
    space.live_status === 'free'
      ? { bg: dark ? 'rgba(16,185,129,0.18)' : '#ecfdf5', text: dark ? '#6ee7b7' : '#047857', dot: '#10b981' }
      : space.live_status === 'limited'
      ? { bg: dark ? 'rgba(245,158,11,0.18)' : '#fffbeb', text: dark ? '#fcd34d' : '#b45309', dot: '#f59e0b' }
      : { bg: dark ? 'rgba(239,68,68,0.18)' : '#fef2f2', text: dark ? '#fca5a5' : '#b91c1c', dot: '#ef4444' };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6"
      style={{ backgroundColor: 'rgba(10, 9, 8, 0.78)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl transition-all animate-fadeIn"
        style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}`, color: textMain, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${cardBorder}` }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span
                className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase"
                style={{ backgroundColor: dark ? 'rgba(249,93,0,0.18)' : '#ffedd8', color: '#f95d00' }}
              >
                {spaceTypeLabel(space.type)}
              </span>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                style={{ backgroundColor: statusColors.bg, color: statusColors.text }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColors.dot }} />
                {space.status_label || (isFree ? 'Disponible' : 'Occupé')}
              </span>
              {coworkingName && (
                <span className="text-xs font-semibold truncate" style={{ color: textMuted }}>
                  · {coworkingName}
                </span>
              )}
            </div>
            <h3 className="font-sora font-bold text-lg sm:text-xl truncate" style={{ color: textMain, margin: 0 }}>
              {space.nom}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la galerie"
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-transform hover:scale-105"
            style={{
              backgroundColor: dark ? 'rgba(255,255,255,0.08)' : '#f0eee9',
              color: textMain,
              border: 'none',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        {/* Zone Photo principale */}
        <div className="relative bg-black/90 flex items-center justify-center overflow-hidden" style={{ height: 'clamp(240px, 46vh, 430px)' }}>
          <img
            src={photos[index]}
            alt={`${space.nom} — photo ${index + 1}`}
            className="w-full h-full object-cover transition-all duration-300"
          />

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
                style={{ backgroundColor: 'rgba(16,15,13,0.75)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)' }}
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                onClick={() => setIndex((i) => (i + 1) % photos.length)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
                style={{ backgroundColor: 'rgba(16,15,13,0.75)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)' }}
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              <div
                className="absolute bottom-3 right-3 px-3 py-1 rounded-full text-xs font-bold"
                style={{ backgroundColor: 'rgba(16,15,13,0.78)', color: '#ffffff' }}
              >
                {index + 1} / {photos.length}
              </div>
            </>
          )}
        </div>

        {/* Miniatures + Infos + CTA */}
        <div className="p-5 overflow-y-auto space-y-4">
          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((url, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setIndex(idx)}
                  className="shrink-0 w-20 h-14 rounded-xl overflow-hidden cursor-pointer transition-all"
                  style={{
                    border: idx === index ? '2px solid #f95d00' : `1px solid ${cardBorder}`,
                    opacity: idx === index ? 1 : 0.65,
                    padding: 0,
                  }}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2 flex-1">
              {space.description && (
                <p className="text-sm leading-relaxed m-0" style={{ color: textMuted }}>
                  {space.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold" style={{ color: textMuted }}>
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 16 }}>groups</span>
                  Capacité : {space.capacity || space.capacite} pers.
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 16 }}>schedule</span>
                  {slotLabel || 'Créneau en cours'}
                </span>
                {space.is_shared && (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chair_alt</span>
                    {space.remaining_spots} / {space.capacity} places libres
                  </span>
                )}
              </div>

              {Array.isArray(space.equipements) && space.equipements.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {space.equipements.map((eq, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{
                        backgroundColor: dark ? 'rgba(255,255,255,0.06)' : '#f0eee9',
                        color: textMain,
                      }}
                    >
                      ✓ {eq}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 shrink-0 pt-2 md:pt-0">
              <div className="text-left md:text-right">
                <p className="text-[11px] font-semibold m-0" style={{ color: textMuted }}>
                  {formatDT(space.tarif_horaire)} / heure
                </p>
                <p className="font-sora font-extrabold text-xl m-0 text-[#f95d00]">
                  {formatDT((space.tarif_horaire || 0) * Math.max(1, durationHours))}
                </p>
                <p className="text-[10px] m-0 opacity-70">Règlement 100 % sur place</p>
              </div>

              {isFree ? (
                <button
                  type="button"
                  onClick={() => onReserve?.(space)}
                  className="px-5 py-3 rounded-xl font-bold text-sm cursor-pointer transition-transform hover:scale-[1.02]"
                  style={{
                    background: 'linear-gradient(135deg, #f95d00 0%, #ff8234 100%)',
                    color: '#ffffff',
                    border: 'none',
                    boxShadow: '0 10px 24px rgba(249,93,0,0.32)',
                  }}
                >
                  Réserver cet espace →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectOtherSlot?.(space)}
                  className="px-5 py-3 rounded-xl font-bold text-sm cursor-pointer"
                  style={{
                    backgroundColor: dark ? '#2e2c29' : '#100f0d',
                    color: '#ffffff',
                    border: 'none',
                  }}
                >
                  Choisir un autre créneau →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
