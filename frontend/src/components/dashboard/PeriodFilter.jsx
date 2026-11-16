// components/dashboard/PeriodFilter.jsx — Filtre global de période Pro & Compact (PowerBI & Stripe style)
import React, { useState, useEffect, useRef } from 'react';
import {
  PRESET_SHORTCUTS,
  windowLabel,
  parsePeriodKey,
  navigatePeriod,
} from '../../utils/dashboardPeriod';

export default function PeriodFilter({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const menuRef = useRef(null);

  const { baseKey, offset } = parsePeriodKey(value);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectPreset = (key) => {
    onChange(key);
    setOpen(false);
  };

  const applyCustomRange = (e) => {
    e?.preventDefault();
    if (!customStart || !customEnd) return;
    onChange(`custom:${customStart}:${customEnd}`);
    setOpen(false);
  };

  const handlePrev = () => {
    const nextKey = navigatePeriod(value, -1);
    onChange(nextKey);
  };

  const handleNext = () => {
    const nextKey = navigatePeriod(value, 1);
    onChange(nextKey);
  };

  const resetToPresent = () => {
    onChange(baseKey === 'custom' ? 'mois' : baseKey);
  };

  const customDaysCount = (() => {
    if (!customStart || !customEnd) return 0;
    const d1 = new Date(customStart);
    const d2 = new Date(customEnd);
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : 0;
  })();

  const isNavigable = baseKey !== 'tout' && baseKey !== 'custom';
  const isPast = offset < 0;
  const isFuture = offset > 0;

  // Options principales toujours visibles
  const coreOptions = [
    { key: 'jour', label: 'Jour', icon: 'today' },
    { key: 'mois', label: 'Mois', icon: 'calendar_month' },
    { key: 'annee', label: 'Année', icon: 'calendar_today' },
    { key: 'tout', label: 'Tout', icon: 'all_inclusive' },
  ];

  // Si l'utilisateur choisit 'semaine', 'trimestre' ou 'custom', on l'affiche comme onglet actif additionnel
  const isExtraActive = baseKey === 'semaine' || baseKey === 'trimestre' || baseKey === 'custom';
  const extraLabel = baseKey === 'semaine' ? 'Semaine' : baseKey === 'trimestre' ? 'Trimestre' : 'Personnalisé';
  const extraIcon = baseKey === 'semaine' ? 'date_range' : baseKey === 'trimestre' ? 'view_timeline' : 'tune';

  return (
    <div
      className={`inline-flex items-center gap-1 sm:gap-1.5 bg-white border border-slate-200/80 rounded-2xl p-1 sm:p-1.5 shadow-xs max-w-full overflow-visible shrink-0 ${className}`}
    >
      {/* ─── Bouton Menu Avancé & Raccourcis Pro ─── */}
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          title="Filtres avancés & Période personnalisée"
          aria-label="Filtres avancés"
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all ${
            open || isExtraActive
              ? 'bg-[#f95d00] text-white shadow-xs'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80'
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>tune</span>
        </button>

        {/* ─── Popover Déroulant Pro ─── */}
        {open && (
          <div
            className="absolute left-0 top-full mt-2 w-[310px] sm:w-[350px] bg-white rounded-3xl border border-slate-200 shadow-2xl p-3.5 sm:p-4 z-50 animate-in fade-in zoom-in-95 duration-150"
            style={{ boxShadow: '0 20px 50px rgba(15,23,42,0.18)' }}
          >
            {/* Header Popover */}
            <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-800">
                  Période d'analyse
                </span>
              </div>
              <span className="text-[10px] font-semibold text-slate-400">DeskyWork Analytics</span>
            </div>

            {/* Raccourcis Rapides (Grid) */}
            <div className="mb-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Raccourcis rapides
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {PRESET_SHORTCUTS.map((p) => {
                  const isActive = value === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => selectPreset(p.key)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold text-left transition-all ${
                        isActive
                          ? 'bg-[#f95d00] text-white shadow-xs'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{p.icon}</span>
                        <span className="truncate">{p.label}</span>
                      </div>
                      {isActive && (
                        <span className="material-symbols-outlined ml-1" style={{ fontSize: 13 }}>check</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section Plage Personnalisée */}
            <div className="pt-2.5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  Plage libre de dates
                </p>
                {customDaysCount > 0 && (
                  <span className="text-[9px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">
                    {customDaysCount} jour{customDaysCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <form onSubmit={applyCustomRange} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-0.5">Date début</label>
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="w-full px-2 py-1 rounded-xl border border-slate-200 text-xs text-slate-800 bg-slate-50 focus:bg-white focus:border-[#f95d00] focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-0.5">Date fin</label>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="w-full px-2 py-1 rounded-xl border border-slate-200 text-xs text-slate-800 bg-slate-50 focus:bg-white focus:border-[#f95d00] focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!customStart || !customEnd}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, #f95d00, #ff7a2f)',
                    boxShadow: '0 4px 12px rgba(249,93,0,0.25)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>calendar_month</span>
                  Appliquer la période personnalisée
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* ─── Segmented Primary Options ─── */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {coreOptions.map((o) => {
          const active = baseKey === o.key && offset === 0;
          return (
            <button
              type="button"
              key={o.key}
              onClick={() => onChange(o.key)}
              className={`flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 ${
                active
                  ? 'text-white shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
              }`}
              style={
                active
                  ? {
                      background: 'linear-gradient(135deg, #f95d00, #ff7a2f)',
                      boxShadow: '0 4px 12px rgba(249,93,0,0.28)',
                    }
                  : undefined
              }
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{o.icon}</span>
              <span>{o.label}</span>
            </button>
          );
        })}

        {/* Onglet actif supplémentaire si semaine, trimestre ou personnalisé */}
        {isExtraActive && (
          <button
            type="button"
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-extrabold text-white shadow-xs whitespace-nowrap"
            style={{
              background: 'linear-gradient(135deg, #f95d00, #ff7a2f)',
              boxShadow: '0 4px 12px rgba(249,93,0,0.28)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{extraIcon}</span>
            <span>{extraLabel}</span>
          </button>
        )}
      </div>

      {/* ─── Navigation Temporelle (Chevrons & Libellé) ─── */}
      <div className="flex items-center gap-0.5 sm:gap-1 pl-1 sm:pl-1.5 border-l border-slate-200 shrink-0">
        {isNavigable && (
          <button
            type="button"
            onClick={handlePrev}
            title="Période précédente"
            className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_left</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Cliquez pour changer de période"
          className="flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-slate-50 transition-colors text-left"
        >
          <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 14 }}>
            calendar_today
          </span>
          <span className="text-[11px] sm:text-xs font-bold text-slate-800 capitalize whitespace-nowrap">
            {windowLabel(value)}
          </span>
        </button>

        {isNavigable && (
          <button
            type="button"
            onClick={handleNext}
            title="Période suivante"
            className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
          </button>
        )}

        {/* Bouton de retour rapide vers aujourd'hui si décalé */}
        {(isPast || isFuture || baseKey === 'custom') && (
          <button
            type="button"
            onClick={resetToPresent}
            title="Revenir au présent"
            className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[9px] font-bold text-slate-500 hover:text-[#f95d00] hover:bg-orange-50 transition-colors border border-dashed border-slate-200"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 11 }}>restart_alt</span>
            Aujourd'hui
          </button>
        )}
      </div>
    </div>
  );
}
