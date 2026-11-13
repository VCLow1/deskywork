// constants/saasPacks.js — Packs SaaS B2B (CDC v3.0 D6)
// Tarification de l'abonnement des ÉTABLISSEMENTS à DeskyWork (et non des membres aux espaces).
// Montants en DT HT / mois — affichage via formatDT() (3 décimales).

/** @type {{id:string,title:string,price:number,badge:string|null,highlighted:boolean,desc:string,features:string[]}[]} */
export const SAAS_PACKS = [
  {
    id: 'essentiel',
    title: 'Essentiel',
    price: 90,
    badge: null,
    highlighted: false,
    desc: 'Pour démarrer la gestion de votre établissement.',
    features: ['10 ressources', '50 membres', '1 staff', 'Réservations & sessions de travail', 'Encaissement sur place & reçus PDF'],
  },
  {
    id: 'standard',
    title: 'Standard',
    price: 150,
    badge: null,
    highlighted: false,
    desc: 'Pour les établissements en croissance.',
    features: ['30 ressources', '300 membres', '3 staffs', 'Tous types d’espaces', 'Réservations Guest (sans compte)'],
  },
  {
    id: 'premium',
    title: 'Premium',
    price: 220,
    badge: 'Mis en avant',
    highlighted: true,
    desc: 'Visibilité maximale sur la marketplace.',
    features: ['Ressources & membres illimités', '10 staffs', 'Badge « Mis en avant »', 'Priorité algorithmique tournante sur la marketplace', 'Tous les avantages Standard'],
  },
];

