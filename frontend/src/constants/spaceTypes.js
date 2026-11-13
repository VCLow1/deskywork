// constants/spaceTypes.js — Typologies officielles d'espaces physiques (CDC v3.0 — 7 types)

/**
 * @typedef {'exclusive'|'shared'|'quote'} BookingRule
 * exclusive : réservation exclusive de la ressource
 * shared    : poste partagé, limité par la capacité maximale
 * quote     : devis / validation manuelle par l'établissement
 */

/** @type {{value:string,label:string,labelEn:string,icon:string,rule:BookingRule,desc:string}[]} */
export const SPACE_TYPES = [
  { value: 'private_office', label: 'Bureau privé', labelEn: 'Private Office', icon: 'meeting_room', rule: 'exclusive', desc: 'Bureau fermé, réservation exclusive pour votre équipe.' },
  { value: 'open_space', label: 'Open Space', labelEn: 'Open Space', icon: 'groups', rule: 'shared', desc: 'Poste partagé dans un espace ouvert, jusqu’à la capacité maximale.' },
  { value: 'meeting_room', label: 'Salle de réunion', labelEn: 'Meeting Room', icon: 'co_present', rule: 'exclusive', desc: 'Salle équipée, réservée en exclusivité sur votre créneau.' },
  { value: 'training_room', label: 'Salle de formation', labelEn: 'Training Room', icon: 'school', rule: 'exclusive', desc: 'Salle dédiée aux sessions de formation, calendrier anti-conflit.' },
  { value: 'event_space', label: 'Espace événementiel', labelEn: 'Event Space', icon: 'celebration', rule: 'quote', desc: 'Grand espace sur devis, soumis à validation manuelle.' },
  { value: 'hot_desk', label: 'Poste nomade (Hot Desk)', labelEn: 'Hot Desk', icon: 'laptop_mac', rule: 'shared', desc: 'Poste nomade à la journée, selon la capacité disponible.' },
  { value: 'dedicated_desk', label: 'Poste fixe (Dedicated Desk)', labelEn: 'Dedicated Desk', icon: 'push_pin', rule: 'exclusive', desc: 'Poste fixe attitré sur abonnement, exclusif.' },
];

export const SPACE_TYPE_LABELS = Object.fromEntries(SPACE_TYPES.map((t) => [t.value, t.label]));

export function spaceTypeLabel(value) {
  return SPACE_TYPE_LABELS[value] || value || '—';
}

/** Équipements proposés dans le moteur de recherche. */
export const EQUIPMENTS = [
  'Wi-Fi', 'Projecteur', 'Visioconférence', 'Tableau blanc', 'Imprimante',
  'Climatisation', 'Café / Thé', 'Parking', 'Accès 24/7',
];

