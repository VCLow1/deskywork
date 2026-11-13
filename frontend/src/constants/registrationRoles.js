// constants/registrationRoles.js — Configuration des 5 rôles d'inscription DeskyWork (CDC v3.0)

export const REGISTRATION_ROLES = [
  {
    id: 'MEMBER',
    dbRole: 'member',
    title: 'Particulier (Membre)',
    shortTitle: 'Particulier',
    googleLabel: 'Créer mon compte Particulier avec Google',
    description: 'Réservez des espaces de travail et inscrivez-vous à des formations.',
    icon: 'person',
    badge: 'Accès immédiat',
    category: 'B2C',
  },
  {
    id: 'COMPANY',
    dbRole: 'member',
    title: 'Entreprise',
    shortTitle: 'Entreprise',
    googleLabel: 'Créer mon compte Entreprise avec Google',
    description: 'Réservez des espaces pour vos besoins professionnels avec facturation adaptée.',
    icon: 'business_center',
    badge: 'Accès immédiat',
    category: 'B2B_CLIENT',
  },
  {
    id: 'TRAINER',
    dbRole: 'formateur',
    title: 'Formateur',
    shortTitle: 'Formateur',
    googleLabel: 'Créer mon compte Formateur avec Google',
    description: 'Animez des ateliers et gérez vos sessions de formation dans les établissements partenaires.',
    icon: 'school',
    badge: 'Espace Formateur',
    category: 'TRAINER',
  },
  {
    id: 'COWORKING_ADMIN',
    dbRole: 'admin',
    title: 'Coworking Space',
    shortTitle: 'Coworking Space',
    googleLabel: 'Créer mon compte Coworking Space avec Google',
    description: 'Gérez votre espace de coworking, vos membres et vos réservations sur la marketplace.',
    icon: 'apartment',
    badge: 'Validation DeskyWork',
    category: 'B2B_ESTABLISHMENT',
  },
  {
    id: 'TRAINING_CENTER_ADMIN',
    dbRole: 'admin',
    title: 'Centre de formation',
    shortTitle: 'Centre de formation',
    googleLabel: 'Créer mon compte Centre de formation avec Google',
    description: 'Pilotez votre catalogue de formations, vos salles, apprenants et feuilles d\'émargement.',
    icon: 'cast_for_education',
    badge: 'Validation DeskyWork',
    category: 'B2B_ESTABLISHMENT',
  },
];

export const VALID_ROLE_IDS = REGISTRATION_ROLES.map((r) => r.id);

export function getRoleConfig(roleId) {
  return REGISTRATION_ROLES.find((r) => r.id === roleId) || null;
}

export function isEstablishmentRole(roleId) {
  return roleId === 'COWORKING_ADMIN' || roleId === 'TRAINING_CENTER_ADMIN';
}

// ── Générateur automatique de mot de passe fort (14 caractères par défaut) ────
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*-_=+?';
const ALL_CHARS = UPPER + LOWER + DIGITS + SPECIAL;

function randomIndex(max) {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    return arr[0] % max;
  }
  return Math.floor(Math.random() * max);
}

export function generateStrongPassword(length = 14) {
  const safeLen = Math.max(12, length);
  const chars = [
    UPPER[randomIndex(UPPER.length)],
    UPPER[randomIndex(UPPER.length)],
    LOWER[randomIndex(LOWER.length)],
    LOWER[randomIndex(LOWER.length)],
    DIGITS[randomIndex(DIGITS.length)],
    DIGITS[randomIndex(DIGITS.length)],
    SPECIAL[randomIndex(SPECIAL.length)],
    SPECIAL[randomIndex(SPECIAL.length)],
  ];
  while (chars.length < safeLen) {
    chars.push(ALL_CHARS[randomIndex(ALL_CHARS.length)]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function evaluatePasswordStrength(pwd = '') {
  const checks = {
    length: pwd.length >= 12,
    minLength: pwd.length >= 8,
    upper: /[A-Z]/.test(pwd),
    lower: /[a-z]/.test(pwd),
    digit: /\d/.test(pwd),
    special: /[^A-Za-z0-9]/.test(pwd),
  };
  const score = [checks.length, checks.upper, checks.lower, checks.digit, checks.special].filter(Boolean).length;
  return { checks, score, valid: checks.minLength && checks.upper && checks.lower && checks.digit };
}

// ── Persistance du rôle choisi pendant Google OAuth redirect ──────────────────
const OAUTH_ROLE_KEY = 'deskywork_pending_oauth_role';
const OAUTH_TTL_MS = 30 * 60 * 1000;

export function savePendingOAuthRole(roleId) {
  try {
    if (!VALID_ROLE_IDS.includes(roleId)) return;
    localStorage.setItem(OAUTH_ROLE_KEY, JSON.stringify({ role: roleId, ts: Date.now() }));
  } catch (_) {}
}

export function readPendingOAuthRole() {
  try {
    const raw = localStorage.getItem(OAUTH_ROLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.role || !VALID_ROLE_IDS.includes(parsed.role)) return null;
    if (parsed.ts && Date.now() - parsed.ts > OAUTH_TTL_MS) {
      localStorage.removeItem(OAUTH_ROLE_KEY);
      return null;
    }
    return parsed.role;
  } catch (_) {
    return null;
  }
}

export function clearPendingOAuthRole() {
  try {
    localStorage.removeItem(OAUTH_ROLE_KEY);
  } catch (_) {}
}

export function getPostVerificationRedirect(requestedRole) {
  if (requestedRole === 'COWORKING_ADMIN' || requestedRole === 'TRAINING_CENTER_ADMIN') {
    return '/register/pending-b2b';
  }
  if (requestedRole === 'TRAINER') {
    return '/trainer-dashboard';
  }
  return '/dashboard';
}

