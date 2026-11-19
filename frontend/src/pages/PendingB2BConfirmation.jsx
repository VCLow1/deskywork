// pages/PendingB2BConfirmation.jsx — Confirmation d'inscription B2B (Coworking Space / Centre de formation)
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import BrandLogo from '../components/layout/BrandLogo';

export default function PendingB2BConfirmation() {
  const location = useLocation();
  const email = location.state?.email || '';
  const requestedRole = location.state?.requestedRole;
  const isCentre = requestedRole === 'TRAINING_CENTER_ADMIN';

  return (
    <div className="min-h-screen page-gradient flex flex-col font-inter text-on-surface bg-[#f8fafc]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200/70 bg-white/70 backdrop-blur-sm">
        <BrandLogo to="/" height={38} />
        <Link to="/login" className="text-xs sm:text-sm font-semibold text-[#f95d00] hover:underline">
          Se connecter
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg glass-card rounded-3xl shadow-elevated p-8 bg-white border border-slate-200/80 text-center space-y-6 animate-fade-up">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-100 flex items-center justify-center text-amber-700">
            <span className="material-symbols-outlined text-[34px]">hourglass_top</span>
          </div>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-800">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              Adresse e-mail confirmée
            </span>

            <h1 className="font-sora text-2xl font-extrabold text-[#100f0d]">
              {isCentre ? 'Demande de Centre de formation enregistrée' : 'Demande d\'ouverture d\'établissement enregistrée'}
            </h1>

            <p className="text-sm text-slate-600 leading-relaxed">
              Votre demande d&apos;ouverture d&apos;établissement est enregistrée et en cours de validation par l&apos;équipe DeskyWork.
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-left text-xs text-amber-950 space-y-2">
            <div className="font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-amber-700">info</span>
              Prochaines étapes
            </div>
            <ul className="space-y-1.5 list-disc list-inside text-amber-900">
              <li>Vérification de votre dossier par un administrateur DeskyWork (généralement sous 24h).</li>
              <li>
                Notification envoyée par e-mail{email ? ` à ${email}` : ''} dès l&apos;activation de votre établissement.
              </li>
              <li>Accès complet à votre back-office dédié et publication sur la marketplace.</li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              to="/"
              className="btn-primary flex-1 py-3 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">explore</span>
              Découvrir la marketplace
            </Link>
            <Link
              to="/login"
              className="flex-1 py-3 px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:border-[#f95d00] hover:text-[#f95d00] flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">login</span>
              Page de connexion
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

