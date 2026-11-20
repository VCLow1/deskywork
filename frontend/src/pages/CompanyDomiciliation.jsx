import React, { useState } from 'react';
import PortalLayout from '../components/layout/PortalLayout';
import { useSessionUser } from '../hooks/useSessionUser';
import { supabase } from '../supabaseClient';
import { formatDT } from '../utils/currency';

const OFFERS = [
  {
    id: 'dom-nero',
    partnerName: 'Nero Coworking Space',
    partnerSlug: 'nero-coworking',
    partnerId: 'a1111111-1111-4111-8111-111111111111',
    address: 'Avenue Hédi Nouira, Ennasr 2, Tunis',
    packName: 'Pack Domiciliation Fiscale & Juridique',
    price: 75,
    features: [
      'Siège social & immatriculation au Registre National des Entreprises (RNE)',
      'Réception, tri et notification immédiate du courrier',
      'Scan des courriers officiels sur demande',
      '4h de salle de réunion offertes chaque mois',
      'Accès aux espaces communs et événements réseau Nero',
    ],
    email: 'contact@nerocoworking.tn',
    phone: '+216 71 888 999',
    badge: 'Populaire à Ennasr 2',
  },
  {
    id: 'dom-thirty-three',
    partnerName: 'Thirty Three Space',
    partnerSlug: 'thirty-three-space',
    partnerId: 'a3333333-3333-4333-8333-333333333333',
    address: 'Rue du Lac Biwa, Les Berges du Lac 2, Tunis',
    packName: 'Pack Domiciliation Prestige Lac 2',
    price: 85,
    features: [
      'Adresse de grand standing aux Berges du Lac 2',
      'Domiciliation commerciale, fiscale et administrative',
      'Accueil physique de vos partenaires et clients à la réception',
      'Gestion et réexpédition de courriers recommandés',
      'Tarifs préférentiels sur la location de bureaux privatifs et salles VIP',
    ],
    email: 'contact@thirtythreespace.tn',
    phone: '+216 71 333 444',
    badge: 'Standing Prestige',
  },
];

export default function CompanyDomiciliation({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const profile = userId
    ? { id: userId, email, role: 'company', type_membre: 'entreprise', prenom: metadata.prenom || '', nom: metadata.nom || '', ...metadata }
    : null;

  const [selectedOffer, setSelectedOffer] = useState(null);
  const [requestSent, setRequestSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleRequest = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    // Simuler l'envoi de la demande de domiciliation au partenaire
    setTimeout(() => {
      setSubmitting(false);
      setRequestSent(true);
    }, 600);
  };

  return (
    <PortalLayout profile={profile} onLogout={() => supabase.auth.signOut()}>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-sora font-bold text-2xl text-slate-900">Offres de Domiciliation d'Entreprise</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider">
              Partenaires Officiels
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Établissez le siège social de votre société dans les quartiers d'affaires les plus prisés de Tunis grâce à nos partenaires de référence.
          </p>
        </div>

        {/* Grille des offres partenaires */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {OFFERS.map((off) => (
            <div
              key={off.id}
              className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#f95d00]/40 transition-all group"
            >
              <div>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <span className="px-2.5 py-1 rounded-full bg-orange-50 text-[#f95d00] text-xs font-bold uppercase tracking-wider">
                      {off.badge}
                    </span>
                    <h2 className="font-sora font-bold text-xl text-slate-900 mt-2">
                      {off.partnerName}
                    </h2>
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                      <span className="material-symbols-outlined text-[15px] text-slate-400">location_on</span>
                      {off.address}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-sora font-bold text-2xl text-[#f95d00]">
                      {formatDT(off.price)}
                    </div>
                    <div className="text-[11px] text-slate-400 font-semibold uppercase">HT / mois</div>
                  </div>
                </div>

                <div className="border-t border-slate-100 my-4" />

                <h3 className="font-semibold text-xs text-slate-700 uppercase tracking-wider mb-3">
                  {off.packName} :
                </h3>
                <ul className="space-y-2.5 text-xs text-slate-600 mb-6">
                  {off.features.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="material-symbols-outlined text-emerald-600 text-base shrink-0 mt-0.5">check_circle</span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOffer(off);
                    setRequestSent(false);
                  }}
                  className="flex-1 py-3 px-4 rounded-xl bg-[#f95d00] hover:bg-[#e05300] text-white font-bold text-xs text-center shadow-md shadow-orange-500/15 transition-all"
                >
                  Souscrire / Demander un devis
                </button>
                <a
                  href={`mailto:${off.email}?subject=Demande de domiciliation - ${encodeURIComponent(off.partnerName)}&body=Bonjour, nous souhaitons souscrire à votre offre de domiciliation d'entreprise via DeskyWork.`}
                  className="p-3 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                  title="Envoyer un e-mail direct"
                >
                  <span className="material-symbols-outlined text-[18px]">mail</span>
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Modal de souscription / contact */}
        {selectedOffer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
              <button
                type="button"
                onClick={() => setSelectedOffer(null)}
                className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 rounded-full p-1.5"
              >
                <span className="material-symbols-outlined">close</span>
              </button>

              {requestSent ? (
                <div className="text-center py-6 space-y-3">
                  <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
                    <span className="material-symbols-outlined text-3xl">check</span>
                  </div>
                  <h3 className="font-sora font-bold text-lg text-slate-900">Demande transmise avec succès !</h3>
                  <p className="text-xs text-slate-600 max-w-sm mx-auto">
                    L'équipe de <strong>{selectedOffer.partnerName}</strong> a bien reçu votre demande de domiciliation et prendra contact avec votre représentant sous 24h ouvrées.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelectedOffer(null)}
                    className="mt-4 px-6 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs"
                  >
                    Fermer
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRequest} className="space-y-4">
                  <div>
                    <span className="px-2 py-0.5 rounded-full bg-orange-100 text-[#f95d00] text-[10px] font-bold uppercase">
                      Demande Directe Partenaire
                    </span>
                    <h3 className="font-sora font-bold text-lg text-slate-900 mt-1">
                      {selectedOffer.partnerName}
                    </h3>
                    <p className="text-xs text-slate-500">{selectedOffer.packName} · {formatDT(selectedOffer.price)} HT / mois</p>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Raison sociale</label>
                      <input
                        type="text"
                        defaultValue="Société Test SARL"
                        required
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Matricule fiscal / TVA</label>
                      <input
                        type="text"
                        defaultValue="1234567/A/M/000"
                        required
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 font-mono"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Téléphone pro</label>
                        <input
                          type="tel"
                          defaultValue="+216 71 123 456"
                          required
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-200"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Date souhaitée</label>
                        <input
                          type="date"
                          defaultValue={new Date().toISOString().slice(0, 10)}
                          required
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-200"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-amber-50 rounded-xl text-[11px] text-amber-900 border border-amber-200">
                    <strong>Paiement & Contrat :</strong> Le contrat de domiciliation et le règlement (sur place ou virement) s'effectuent directement avec l'établissement partenaire.
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedOffer(null)}
                      className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 py-2.5 rounded-xl bg-[#f95d00] hover:bg-[#e05300] font-bold text-xs text-white shadow-md shadow-orange-500/20 disabled:opacity-50"
                    >
                      {submitting ? 'Envoi en cours…' : 'Envoyer la demande'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

