// pages/LegalPage.jsx — Pages légales (CGU, Politique de confidentialité, Cookies) — CDC v3.0
import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/layout/Navbar';

const LEGAL_CONTENT = {
  cgu: {
    badge: 'Cadre contractuel',
    title: "Conditions Générales d'Utilisation (CGU)",
    updated: 'Novembre 2026 — DeskyWork CDC v3.0',
    sections: [
      {
        h: '1. Objet de la plateforme',
        p: 'DeskyWork est une plateforme SaaS marketplace à deux étages : une marketplace publique de recherche et de réservation auprès de coworkings et centres de formation partenaires, et un logiciel de gestion multi-tenant dédié aux établissements.',
      },
      {
        h: '2. Modalités de réservation et règlement sur place',
        p: 'Conformément à la version en vigueur, aucune passerelle de paiement en ligne (carte bancaire, Stripe, Flouci) n’est activée. Tout règlement lié aux réservations, dépassements, abonnements membres ou sessions de formation s’effectue sur place (espèces, chèque ou virement bancaire) auprès de l’établissement concerné, contre remise d’un reçu PDF numéroté.',
      },
      {
        h: '3. Sessions de travail & libération des ressources',
        p: 'La durée réservée est calculée sur le fuseau horaire Africa/Tunis et exprimée en Dinars Tunisiens (DT, 3 décimales). Toute prolongation ou dépassement constaté avant la libération explicite de la ressource par l’accueil est facturé au barème de l’établissement.',
      },
      {
        h: '4. Validation des formateurs & établissements partenaires',
        p: 'Les candidatures formateurs (Devenir Formateur) et demandes d’établissements partenaires sont soumises au statut En attente (Pending) jusqu’à validation manuelle.',
      },
    ],
  },
  confidentialite: {
    badge: 'Protection des données',
    title: 'Politique de confidentialité',
    updated: 'Novembre 2026 — DeskyWork',
    sections: [
      {
        h: '1. Données collectées',
        p: 'Nous collectons uniquement les données nécessaires à l’authentification (nom, prénom, e-mail, téléphone), à la gestion des réservations, aux inscriptions aux sessions de formation et à la facturation sur place.',
      },
      {
        h: '2. Isolation multi-tenant & sécurité',
        p: 'Chaque établissement partenaire dispose d’un espace back-office isolé par identifiant d’organisation. Les données personnelles d’un membre ne sont partagées qu’avec l’établissement auprès duquel il effectue une réservation ou s’inscrit à une session de formation.',
      },
      {
        h: '3. Canaux de communication',
        p: 'En version v1, les notifications transactionnelles (confirmations, reçus PDF, rappels) sont transmises exclusivement par e-mail et au sein du portail (In-App).',
      },
      {
        h: '4. Droits d’accès et de suppression (RGPD)',
        p: 'Tout utilisateur connecté peut exporter ses données ou demander la suppression de son compte directement depuis son portail (/dashboard/rgpd) ou par e-mail à contact@vclow.com.',
      },
    ],
  },
  cookies: {
    badge: 'Traceurs & Session',
    title: 'Gestion des Cookies',
    updated: 'Novembre 2026 — DeskyWork',
    sections: [
      {
        h: '1. Cookies strictement nécessaires',
        p: 'DeskyWork utilise uniquement des cookies techniques et le stockage local du navigateur (Supabase Auth, préférences de thème clair/sombre, langue) indispensables au maintien sécurisé de votre session.',
      },
      {
        h: '2. Absence de traceurs publicitaires',
        p: 'Aucun cookie publicitaire tiers ou de suivi comportemental inter-sites n’est activé sur la plateforme.',
      },
    ],
  },
};

export default function LegalPage({ session, doc = 'cgu' }) {
  const data = LEGAL_CONTENT[doc] || LEGAL_CONTENT.cgu;

  return (
    <div className="min-h-screen bg-[#f8fafc] font-inter text-[#100f0d]">
      <Navbar session={session} />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-28 sm:px-6">
        <div className="mb-8">
          <span className="inline-block rounded-full bg-orange-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#f95d00]">
            {data.badge}
          </span>
          <h1 className="mt-3 font-sora text-3xl font-extrabold text-slate-900">{data.title}</h1>
          <p className="mt-1 text-xs text-slate-500">Dernière mise à jour : {data.updated}</p>
        </div>

        <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {data.sections.map((sec) => (
            <section key={sec.h}>
              <h2 className="font-sora text-lg font-bold text-slate-900">{sec.h}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600">{sec.p}</p>
            </section>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex flex-wrap gap-4">
            <Link to="/cgu" className="font-semibold hover:text-[#f95d00]">CGU</Link>
            <Link to="/confidentialite" className="font-semibold hover:text-[#f95d00]">Confidentialité</Link>
            <Link to="/cookies" className="font-semibold hover:text-[#f95d00]">Cookies</Link>
          </div>
          <Link to="/" className="font-semibold text-[#f95d00] hover:underline">← Retour à l'accueil</Link>
        </div>
      </main>
    </div>
  );
}

