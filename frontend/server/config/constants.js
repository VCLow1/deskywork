// config/constants.js — Constantes partagées de l'application
const SUBSCRIPTION_DURATIONS = {
  day_pass: 1,
  week_pass: 7,
  mensuel: 30,
  trimestriel: 90,
  annuel: 365,
};

const MEMBER_TYPE_TO_PLAN = {
  individuel: 'standard',
  etudiant: 'etudiant',
  entreprise: 'entreprise',
};

const SUBSCRIPTION_LABELS = {
  day_pass: 'Day Pass',
  week_pass: 'Week Pass',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  annuel: 'Annuel',
  bureau_prive: 'Bureau privé',
};

module.exports = { SUBSCRIPTION_DURATIONS, MEMBER_TYPE_TO_PLAN, SUBSCRIPTION_LABELS };
