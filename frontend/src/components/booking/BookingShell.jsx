// components/booking/BookingShell.jsx — Enveloppe animée Dark/Light avec Stepper 3 étapes & horloge Tunis live
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import BrandLogo from '../layout/BrandLogo';

const STEPS = [
  { num: 1, title: 'Coworking', short: 'Établissement', icon: 'apartment' },
  { num: 2, title: 'Espace & Plan 2D', short: 'Espace', icon: 'grid_view' },
  { num: 3, title: 'Confirmation', short: 'Validation', icon: 'verified' },
];

export default function BookingShell({
  activeStep = 1,
  nav = { home: '/dashboard', bookings: '/dashboard/bookings' },
  onStepClick = null,
  onExit = null,
  subtitle = null,
  children,
}) {
  const { dark, toggle } = useTheme();
  const [tunisTime, setTunisTime] = useState(() =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Tunis',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date())
  );

  useEffect(() => {
    const id = setInterval(() => {
      setTunisTime(
        new Intl.DateTimeFormat('fr-FR', {
          timeZone: 'Africa/Tunis',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(new Date())
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const surfaceBg = dark ? '#100f0d' : '#f6f4f1';
  const navBg = dark ? 'rgba(21, 20, 18, 0.88)' : 'rgba(255, 255, 255, 0.90)';
  const navBorder = dark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(16, 15, 13, 0.08)';
  const textMain = dark ? '#fbffff' : '#100f0d';
  const textMuted = dark ? '#cfcac3' : '#5e5a55';

  return (
    <div
      className="min-h-screen relative overflow-x-hidden transition-colors duration-300"
      style={{ backgroundColor: surfaceBg, color: textMain, fontFamily: 'Inter, sans-serif' }}
    >
      {/* Halos d'arrière-plan subtils */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div
          className="absolute -top-36 -left-32 w-[420px] h-[420px] rounded-full blur-3xl opacity-25"
          style={{ background: 'radial-gradient(circle, rgba(249,93,0,0.28) 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-1/3 -right-32 w-[380px] h-[380px] rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.22) 0%, transparent 70%)' }}
        />
      </div>

      {/* Header fixe glassmorphique */}
      <header
        className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl transition-colors"
        style={{ backgroundColor: navBg, borderBottom: `1px solid ${navBorder}` }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo to={nav.home} />
            {subtitle && (
              <span
                className="hidden xl:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold truncate max-w-[220px]"
                style={{
                  backgroundColor: dark ? 'rgba(255,255,255,0.06)' : '#f0eee9',
                  color: textMuted,
                }}
              >
                {subtitle}
              </span>
            )}
          </div>

          {/* Stepper Desktop */}
          <nav aria-label="Étapes de réservation" className="hidden md:flex items-center gap-2">
            {STEPS.map((st, idx) => {
              const isCompleted = activeStep > st.num;
              const isActive = activeStep === st.num;
              const clickable = isCompleted && typeof onStepClick === 'function';
              return (
                <React.Fragment key={st.num}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && onStepClick(st.num)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${
                      clickable ? 'cursor-pointer hover:scale-[1.03]' : 'cursor-default'
                    }`}
                    style={{
                      backgroundColor: isActive
                        ? '#f95d00'
                        : isCompleted
                        ? (dark ? 'rgba(16,185,129,0.16)' : '#ecfdf5')
                        : (dark ? 'rgba(255,255,255,0.05)' : '#f0eee9'),
                      color: isActive
                        ? '#ffffff'
                        : isCompleted
                        ? (dark ? '#6ee7b7' : '#047857')
                        : textMuted,
                      border: isActive
                        ? '1px solid #f95d00'
                        : isCompleted
                        ? `1px solid ${dark ? 'rgba(16,185,129,0.35)' : '#a7f3d0'}`
                        : `1px solid ${navBorder}`,
                      boxShadow: isActive ? '0 6px 18px rgba(249,93,0,0.28)' : 'none',
                    }}
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-extrabold"
                      style={{
                        backgroundColor: isActive
                          ? 'rgba(255,255,255,0.22)'
                          : isCompleted
                          ? '#10b981'
                          : (dark ? 'rgba(255,255,255,0.1)' : 'rgba(16,15,13,0.08)'),
                        color: isActive || isCompleted ? '#ffffff' : textMuted,
                      }}
                    >
                      {isCompleted ? (
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>check</span>
                      ) : (
                        st.num
                      )}
                    </span>
                    <span>{st.title}</span>
                  </button>

                  {idx < STEPS.length - 1 && (
                    <div
                      className="w-6 lg:w-10 h-[2px] rounded-full transition-colors duration-300"
                      style={{
                        backgroundColor: activeStep > st.num ? '#10b981' : navBorder,
                      }}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </nav>

          {/* Contrôles droite : horloge live, thème, quitter */}
          <div className="flex items-center gap-2">
            <div
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold"
              style={{
                backgroundColor: dark ? 'rgba(16,185,129,0.12)' : '#ecfdf5',
                color: dark ? '#6ee7b7' : '#065f46',
                border: `1px solid ${dark ? 'rgba(16,185,129,0.28)' : '#a7f3d0'}`,
              }}
              title="Heure serveur temps réel (Africa/Tunis)"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{tunisTime}</span>
              <span className="opacity-70 font-semibold hidden lg:inline">Tunis</span>
            </div>

            <button
              type="button"
              onClick={toggle}
              aria-label={dark ? 'Activer le mode clair' : 'Activer le mode sombre'}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105 cursor-pointer"
              style={{
                backgroundColor: dark ? 'rgba(255,255,255,0.07)' : '#f0eee9',
                color: dark ? '#fbbf24' : '#100f0d',
                border: `1px solid ${navBorder}`,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {dark ? 'light_mode' : 'dark_mode'}
              </span>
            </button>

            <Link
              to={nav.home}
              onClick={() => onExit?.()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:opacity-90"
              style={{
                backgroundColor: dark ? 'rgba(255,255,255,0.07)' : '#ffffff',
                color: textMain,
                border: `1px solid ${navBorder}`,
                textDecoration: 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
              <span>Quitter</span>
            </Link>
          </div>
        </div>

        {/* Stepper Mobile */}
        <div
          className="md:hidden px-4 pb-2.5 pt-1 flex items-center gap-1.5"
          style={{ borderTop: `1px solid ${navBorder}` }}
        >
          {STEPS.map((st) => {
            const isCompleted = activeStep > st.num;
            const isActive = activeStep === st.num;
            const clickable = isCompleted && typeof onStepClick === 'function';
            return (
              <button
                key={st.num}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStepClick(st.num)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all"
                style={{
                  backgroundColor: isActive
                    ? '#f95d00'
                    : isCompleted
                    ? (dark ? 'rgba(16,185,129,0.16)' : '#ecfdf5')
                    : (dark ? 'rgba(255,255,255,0.04)' : '#f0eee9'),
                  color: isActive ? '#ffffff' : isCompleted ? (dark ? '#6ee7b7' : '#047857') : textMuted,
                  border: 'none',
                }}
              >
                <span>{isCompleted ? '✓' : `${st.num}.`}</span>
                <span className="truncate">{st.short}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Contenu principal */}
      <main className="relative z-10 pt-28 md:pt-24 pb-16 max-w-7xl mx-auto px-4 sm:px-6">
        {children}
      </main>
    </div>
  );
}

