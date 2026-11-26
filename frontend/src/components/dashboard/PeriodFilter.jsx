// components/dashboard/PeriodFilter.jsx — Filtre global de période animé, adaptatif Dark/Light & sans clipping (Portal)
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../context/ThemeContext';
import {
  PRESET_SHORTCUTS,
  windowLabel,
  parsePeriodKey,
  navigatePeriod,
} from '../../utils/dashboardPeriod';

const FILTER_KEYFRAMES = `
@keyframes pfPopIn {
  from { opacity: 0; transform: translateY(-6px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.pf-pop-enter {
  animation: pfPopIn 0.2s cubic-bezier(0.22, 1, 0.36, 1) both;
}
`;

const CORE_OPTIONS = [
  { key: 'jour', label: 'Jour', icon: 'today' },
  { key: 'semaine', label: 'Semaine', icon: 'date_range' },
  { key: 'mois', label: 'Mois', icon: 'calendar_month' },
  { key: 'annee', label: 'Année', icon: 'calendar_today' },
  { key: 'tout', label: 'Tout', icon: 'all_inclusive' },
];

function toYMD(d) {
  return d.toISOString().slice(0, 10);
}

export default function PeriodFilter({ value, onChange, className = '' }) {
  const { dark } = useTheme();
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return toYMD(d);
  });
  const [customEnd, setCustomEnd] = useState(() => toYMD(new Date()));
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0, visible: false });
  const [popPos, setPopPos] = useState({ top: 0, left: 12, maxWidth: 360 });

  const containerRef = useRef(null);
  const popoverRef = useRef(null);
  const segWrapRef = useRef(null);
  const btnRefs = useRef({});

  const { baseKey, offset } = parsePeriodKey(value);
  const activeSegKey = baseKey === 'trimestre' ? 'mois' : baseKey;

  // Glissière animée du sélecteur segmenté
  const syncPill = () => {
    const wrap = segWrapRef.current;
    const btn = btnRefs.current[activeSegKey];
    if (!wrap || !btn) {
      setPillStyle((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }
    setPillStyle({
      left: btn.offsetLeft,
      width: btn.offsetWidth,
      visible: true,
    });
  };

  useLayoutEffect(() => {
    syncPill();
  }, [activeSegKey, offset, value]);

  useEffect(() => {
    window.addEventListener('resize', syncPill);
    return () => window.removeEventListener('resize', syncPill);
  }, [activeSegKey]);

  // Positionnement Portal sans débordement du viewport
  const updatePopoverPosition = () => {
    const anchor = containerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popW = Math.min(368, vw - 24);
    const estHeight = 420;

    let left = rect.right - popW;
    if (left < 12) left = Math.max(12, rect.left);
    if (left + popW > vw - 12) left = Math.max(12, vw - popW - 12);

    const openAbove = rect.bottom + estHeight > vh - 14 && rect.top > estHeight + 14;
    const top = openAbove ? Math.max(12, rect.top - estHeight - 8) : rect.bottom + 8;

    setPopPos({ top, left, width: popW });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePopoverPosition();
    const onResizeOrScroll = () => updatePopoverPosition();
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, true);
    return () => {
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll, true);
    };
  }, [open]);

  // Fermeture clic extérieur + Escape
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e) => {
      const inBar = containerRef.current?.contains(e.target);
      const inPop = popoverRef.current?.contains(e.target);
      if (!inBar && !inPop) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectPreset = (key) => {
    onChange(key);
    setOpen(false);
  };

  const setQuickCustomDays = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setCustomStart(toYMD(start));
    setCustomEnd(toYMD(end));
  };

  const applyCustomRange = (e) => {
    e?.preventDefault();
    if (!customStart || !customEnd || customEnd < customStart) return;
    onChange(`custom:${customStart}:${customEnd}`);
    setOpen(false);
  };

  const customDaysCount = (() => {
    if (!customStart || !customEnd) return 0;
    const d1 = new Date(customStart);
    const d2 = new Date(customEnd);
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : 0;
  })();

  const rangeInvalid = Boolean(customStart && customEnd && customEnd < customStart);
  const isNavigable = baseKey !== 'tout' && baseKey !== 'custom';
  const showResetToday = offset !== 0 || baseKey === 'custom' || baseKey === 'trimestre';

  const barBg = dark
    ? 'bg-[#1b1a18]/90 border-white/12 text-[#fbffff]'
    : 'bg-white/95 border-slate-200/90 text-[#100f0d]';

  const segTrackBg = dark ? 'bg-[#12110f]' : 'bg-slate-100/90';

  return (
    <>
      <style>{FILTER_KEYFRAMES}</style>

      <div
        ref={containerRef}
        className={`inline-flex flex-wrap items-center gap-1.5 rounded-2xl border p-1.5 backdrop-blur-md transition-all max-w-full ${barBg} ${className}`}
        style={{
          boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.35)' : '0 6px 20px rgba(16,35,63,0.07)',
        }}
      >
        {/* ── Contrôle segmenté à glissière animée ── */}
        <div
          ref={segWrapRef}
          className={`relative inline-flex items-center rounded-xl p-0.5 ${segTrackBg}`}
        >
          {pillStyle.visible && (
            <span
              aria-hidden="true"
              className="absolute top-0.5 bottom-0.5 rounded-[10px] pointer-events-none transition-all duration-300"
              style={{
                left: pillStyle.left,
                width: pillStyle.width,
                background: 'linear-gradient(135deg, #f95d00 0%, #ff7d2e 100%)',
                boxShadow: '0 4px 12px rgba(249,93,0,0.30)',
                transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          )}

          {CORE_OPTIONS.map((o) => {
            const isActive = activeSegKey === o.key;
            return (
              <button
                key={o.key}
                ref={(el) => {
                  btnRefs.current[o.key] = el;
                }}
                type="button"
                onClick={() => onChange(o.key)}
                className={`relative z-10 inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-[10px] text-xs font-bold whitespace-nowrap transition-colors duration-200 ${
                  isActive
                    ? 'text-white'
                    : dark
                      ? 'text-[#cfcac3] hover:text-white'
                      : 'text-slate-600 hover:text-[#100f0d]'
                }`}
              >
                <span className="material-symbols-outlined hidden sm:inline" style={{ fontSize: 15 }}>
                  {o.icon}
                </span>
                <span>{o.label}</span>
              </button>
            );
          })}

          {baseKey === 'custom' && (
            <span
              ref={(el) => {
                btnRefs.current.custom = el;
              }}
              className="relative z-10 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-xs font-bold text-white whitespace-nowrap"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>date_range</span>
              Perso
            </span>
          )}
        </div>

        {/* ── Navigateur temporel + Déclencheur Popover ── */}
        <div
          className={`flex items-center gap-1 pl-1 border-l ${
            dark ? 'border-white/10' : 'border-slate-200'
          }`}
        >
          {isNavigable && (
            <button
              type="button"
              onClick={() => onChange(navigatePeriod(value, -1))}
              title="Période précédente"
              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-90 ${
                dark ? 'text-[#cfcac3] hover:text-white hover:bg-white/10' : 'text-slate-500 hover:text-[#100f0d] hover:bg-slate-100'
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>chevron_left</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title="Ouvrir les raccourcis et dates personnalisées"
            className={`group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
              open
                ? 'bg-[#f95d00]/12 text-[#f95d00] ring-1 ring-[#f95d00]/30'
                : dark
                  ? 'hover:bg-white/8 text-[#fbffff]'
                  : 'hover:bg-slate-100 text-[#100f0d]'
            }`}
          >
            <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 16 }}>
              calendar_month
            </span>
            <span className="capitalize whitespace-nowrap">{windowLabel(value)}</span>
            <span
              className={`material-symbols-outlined transition-transform duration-200 opacity-65 ${
                open ? 'rotate-180 text-[#f95d00] opacity-100' : ''
              }`}
              style={{ fontSize: 16 }}
            >
              expand_more
            </span>
          </button>

          {isNavigable && (
            <button
              type="button"
              onClick={() => onChange(navigatePeriod(value, 1))}
              title="Période suivante"
              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-90 ${
                dark ? 'text-[#cfcac3] hover:text-white hover:bg-white/10' : 'text-slate-500 hover:text-[#100f0d] hover:bg-slate-100'
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>chevron_right</span>
            </button>
          )}

          {showResetToday && (
            <button
              type="button"
              onClick={() => onChange('mois')}
              title="Revenir au mois en cours"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-[#f95d00] bg-[#f95d00]/10 hover:bg-[#f95d00]/18 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>restart_alt</span>
              <span className="hidden sm:inline">Présent</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Popover Portal (jamais coupé par les conteneurs parents) ── */}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            className={`pf-pop-enter fixed z-[9999] rounded-3xl border p-4 backdrop-blur-xl ${
              dark
                ? 'bg-[#1b1a18]/98 border-white/15 text-[#fbffff]'
                : 'bg-white/98 border-slate-200 text-[#100f0d]'
            }`}
            style={{
              top: popPos.top,
              left: popPos.left,
              width: popPos.width,
              boxShadow: dark
                ? '0 24px 60px rgba(0,0,0,0.65)'
                : '0 24px 60px rgba(15,23,42,0.18)',
            }}
          >
            {/* Header */}
            <div
              className={`flex items-center justify-between pb-3 mb-3 border-b ${
                dark ? 'border-white/10' : 'border-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-extrabold uppercase tracking-wider">
                  Période d&apos;analyse
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-colors ${
                  dark ? 'hover:bg-white/10 text-[#cfcac3]' : 'hover:bg-slate-100 text-slate-500'
                }`}
                aria-label="Fermer"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>

            {/* Raccourcis rapides */}
            <div className="mb-3.5">
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-2">
                Raccourcis intelligents
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESET_SHORTCUTS.map((p) => {
                  const isActive = value === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => selectPreset(p.key)}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold text-left transition-all duration-150 ${
                        isActive
                          ? 'text-white shadow-sm'
                          : dark
                            ? 'bg-white/5 text-[#cfcac3] hover:bg-white/10 hover:text-white'
                            : 'bg-slate-50 text-slate-700 hover:bg-orange-50/70 hover:text-[#100f0d]'
                      }`}
                      style={
                        isActive
                          ? {
                              background: 'linear-gradient(135deg, #f95d00 0%, #ff7d2e 100%)',
                              boxShadow: '0 4px 12px rgba(249,93,0,0.28)',
                            }
                          : undefined
                      }
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{p.icon}</span>
                        <span className="truncate">{p.label}</span>
                      </span>
                      {isActive ? (
                        <span className="material-symbols-outlined shrink-0" style={{ fontSize: 14 }}>check</span>
                      ) : (
                        <span className="text-[9px] font-bold opacity-55 shrink-0">{p.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Plage libre personnalisée */}
            <div className={`pt-3 border-t ${dark ? 'border-white/10' : 'border-slate-100'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                  Plage personnalisée
                </span>
                <div className="flex items-center gap-1">
                  {[15, 30, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setQuickCustomDays(d)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
                        dark
                          ? 'bg-white/8 text-[#cfcac3] hover:bg-[#f95d00]/25 hover:text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-orange-50 hover:text-[#f95d00]'
                      }`}
                    >
                      {d}j
                    </button>
                  ))}
                  {customDaysCount > 0 && (
                    <span className="ml-1 text-[10px] font-bold text-[#f95d00] bg-[#f95d00]/12 px-2 py-0.5 rounded-full">
                      {customDaysCount} j
                    </span>
                  )}
                </div>
              </div>

              <form onSubmit={applyCustomRange} className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold opacity-65 mb-1">Du</label>
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className={`w-full px-2.5 py-1.5 rounded-xl border text-xs outline-none transition-colors ${
                        dark
                          ? 'bg-[#12110f] border-white/15 text-white focus:border-[#f95d00]'
                          : 'bg-slate-50 border-slate-200 text-[#100f0d] focus:bg-white focus:border-[#f95d00]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold opacity-65 mb-1">Au</label>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className={`w-full px-2.5 py-1.5 rounded-xl border text-xs outline-none transition-colors ${
                        dark
                          ? 'bg-[#12110f] border-white/15 text-white focus:border-[#f95d00]'
                          : 'bg-slate-50 border-slate-200 text-[#100f0d] focus:bg-white focus:border-[#f95d00]'
                      }`}
                    />
                  </div>
                </div>

                {rangeInvalid && (
                  <p className="text-[11px] font-semibold text-red-500">
                    La date de fin doit être postérieure ou égale à la date de début.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!customStart || !customEnd || rangeInvalid}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-white transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-45"
                  style={{
                    background: 'linear-gradient(135deg, #f95d00 0%, #ff7a2f 100%)',
                    boxShadow: '0 6px 16px rgba(249,93,0,0.28)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>event_available</span>
                  Appliquer la plage personnalisée
                </button>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
