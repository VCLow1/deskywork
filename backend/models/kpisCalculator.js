// models/kpisCalculator.js — Formules KPI officielles unifiées entre "Aujourd'hui" et "Analyses"
const { roundMillime } = require('./pricingMath');

const EXCLUDED_BOOKING_STATUSES = new Set(['cancelled', 'refused', 'expired']);
const STAFF_ROLES = new Set(['admin', 'staff', 'super_admin']);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'actif', 'a_renouveler']);

function isStaffRole(role) {
  return STAFF_ROLES.has(String(role || '').toLowerCase());
}

function isValidOfficialBooking(resRow) {
  const st = String(resRow?.statut || '').toLowerCase();
  return !EXCLUDED_BOOKING_STATUSES.has(st);
}

/**
 * Calcule le CA net encaissé officiel sur une période :
 * CA encaissé = paiements encaissés - remboursements de la période.
 */
function computeNetCollectedCA(paidPayments = [], refundedPayments = []) {
  const collected = (paidPayments || []).reduce((s, p) => s + Number(p?.montant || 0), 0);
  const refunded = (refundedPayments || []).reduce((s, p) => {
    const refAmt = Number(p?.montant_rembourse ?? p?.montant ?? 0);
    return s + (Number.isFinite(refAmt) ? refAmt : 0);
  }, 0);
  return roundMillime(Math.max(0, collected - refunded));
}

/**
 * Parse une plage d'horaires ("08:00 - 20:00" ou "08h30 - 19h00") -> nombre d'heures ouvrées/jour.
 */
function parseOpeningHoursPerDay(horairesStr) {
  const m = String(horairesStr || '').match(/(\d{1,2})\s*[:h]\s*(\d{2})\s*[-–àa]\s*(\d{1,2})\s*[:h]\s*(\d{2})/i);
  if (!m) return 10;
  const start = Number(m[1]) + Number(m[2]) / 60;
  const end = Number(m[3]) + Number(m[4]) / 60;
  const diff = end - start;
  return diff > 0 && diff <= 24 ? diff : 10;
}

/**
 * Heures ouvrées disponibles sur une fenêtre pour les espaces actifs (non archivés).
 */
function computeAvailableOpenHours(espaces = [], win = null) {
  const activeSpaces = (espaces || []).filter((e) => !e.archived_at && e.actif !== false && e.statut !== 'inactif');
  if (activeSpaces.length === 0) return 0;
  const days = win && win.ms ? Math.max(1, Math.ceil(win.ms / 86400000)) : 1;
  return activeSpaces.reduce((sum, esp) => sum + parseOpeningHoursPerDay(esp.horaires) * days, 0);
}

/**
 * Membres actifs officiels = détenteurs distincts d'abonnements Actifs ou À renouveler (strictement hors staff/admin).
 */
function computeOfficialActiveMembers({ abonnements = [], profiles = [] } = {}) {
  const staffIds = new Set(
    (profiles || []).filter((p) => isStaffRole(p.role)).map((p) => p.id)
  );
  const activeHolderIds = new Set();
  for (const abo of abonnements || []) {
    if (abo.archived_at) continue;
    const st = String(abo.statut || '').toLowerCase();
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(st)) continue;
    if (abo.user_id && !staffIds.has(abo.user_id)) {
      activeHolderIds.add(abo.user_id);
    }
  }
  return activeHolderIds.size;
}

/**
 * Top membres par CA net (strictement hors staff/admin/super_admin).
 */
function computeOfficialTopMembers(paidPayments = [], refundedPayments = []) {
  const map = {};
  for (const p of paidPayments || []) {
    if (!p.user_id) continue;
    if (p.profiles && isStaffRole(p.profiles.role)) continue;
    if (!map[p.user_id]) {
      map[p.user_id] = {
        user_id: p.user_id,
        nom: p.profiles ? `${p.profiles.prenom || ''} ${p.profiles.nom || ''}`.trim() || p.profiles.email : 'Membre',
        email: p.profiles?.email || '',
        ca: 0,
      };
    }
    map[p.user_id].ca += Number(p.montant || 0);
  }
  for (const r of refundedPayments || []) {
    if (!r.user_id || !map[r.user_id]) continue;
    map[r.user_id].ca = Math.max(0, map[r.user_id].ca - Number(r.montant_rembourse ?? r.montant ?? 0));
  }
  return Object.values(map)
    .map((m) => ({ ...m, ca: roundMillime(m.ca) }))
    .filter((m) => m.ca > 0)
    .sort((a, b) => b.ca - a.ca)
    .slice(0, 5);
}

module.exports = {
  EXCLUDED_BOOKING_STATUSES,
  STAFF_ROLES,
  ACTIVE_SUBSCRIPTION_STATUSES,
  isStaffRole,
  isValidOfficialBooking,
  computeNetCollectedCA,
  parseOpeningHoursPerDay,
  computeAvailableOpenHours,
  computeOfficialActiveMembers,
  computeOfficialTopMembers,
};
