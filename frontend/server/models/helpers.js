// models/helpers.js — Fonctions utilitaires partagées entre tous les controllers
const { supabaseAdmin } = require('../config/supabase');

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function isDateInRange(dateStr, startStr, endStr) {
  const d = dateStr || todayISO();
  if (startStr && d < startStr) return false;
  if (endStr && d > endStr) return false;
  return true;
}

function applyPromoDiscount(prix, promo) {
  if (!promo) return { prixFinal: prix, reduction: 0 };
  let reduction = promo.type_reduction === 'percent'
    ? (prix * promo.valeur) / 100
    : promo.valeur;
  reduction = Math.min(reduction, prix);
  return { prixFinal: Math.max(0, prix - reduction), reduction };
}

async function findActiveTarif(typeAbonnement, planTarifaire, tenantId, typeEspace) {
  const today = todayISO();
  let q = supabaseAdmin
    .from('tarifs_abonnements')
    .select('*')
    .eq('type_abonnement', typeAbonnement)
    .eq('plan_tarifaire', planTarifaire)
    .eq('actif', true)
    .lte('date_debut', today);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q.order('date_debut', { ascending: false });
  if (error) throw error;
  const active = (data || []).filter((t) => !t.date_fin || t.date_fin >= today);
  if (active.length === 0) return null;
  if (typeEspace) {
    return (
      active.find((t) => t.type_espace === typeEspace)
      || active.find((t) => !t.type_espace)
      || null
    );
  }
  return active.find((t) => !t.type_espace) || active[0];
}

async function findValidPromoCode(code, tenantId) {
  const today = todayISO();
  let q = supabaseAdmin
    .from('codes_promo')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('actif', true);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q.single();
  if (error || !data) return null;
  if (!isDateInRange(today, data.date_debut, data.date_fin)) return null;
  if (data.utilisations_max != null && data.utilisations_count >= data.utilisations_max) return null;
  return data;
}

function sanitizeProfileForClient(profile, isStaff) {
  const copy = { ...profile };
  if (!isStaff) {
    delete copy.notes_admin;
  }
  return copy;
}

async function getCancellationPolicy(tenantId) {
  let q = supabaseAdmin.from('politique_annulation').select('*');
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return data || {
    delai_heures: 24,
    penalite_pct: 0,
    annulation_membre_autorisee: true,
    remboursement_auto: false,
    message_membre: "Annulation gratuite jusqu'à 24 h avant le début du créneau.",
  };
}

function evaluateCancellation(reservation, policy, isStaff) {
  if (isStaff) return { allowed: true, penalite_pct: 0 };
  if (!policy.annulation_membre_autorisee) {
    return { allowed: false, reason: "Les annulations en ligne sont désactivées. Contactez l'accueil." };
  }
  const hoursUntilStart = (new Date(reservation.date_debut).getTime() - Date.now()) / 3600000;
  if (hoursUntilStart < policy.delai_heures) {
    return {
      allowed: false,
      reason: `Annulation impossible moins de ${policy.delai_heures} h avant le début.`,
      hoursUntilStart: Number(hoursUntilStart.toFixed(1)),
    };
  }
  return { allowed: true, penalite_pct: Number(policy.penalite_pct || 0) };
}

// Règle spécifique à un type d'espace (politique_annulation_espaces) si elle existe
async function getCancellationPolicyForEspace(tenantId, espaceType) {
  if (!espaceType) return null;
  let q = supabaseAdmin
    .from('politique_annulation_espaces')
    .select('*')
    .eq('type_espace', espaceType);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q.maybeSingle();
  if (error) return null;
  return data || null;
}

// Calcule les conditions d'annulation d'une réservation :
// pénalité, montant retenu, montant remboursé (cash) ou converti en crédit.
function buildCancellationInfo(reservation, policy, espacePolicy, isStaff, montantPaye) {
  const hoursUntilStart = (new Date(reservation.date_debut).getTime() - Date.now()) / 3600000;
  const montant = Math.round((Number(montantPaye || 0)) * 100) / 100;

  const base = { montantPaye: montant, montantRembourse: 0, montantCredit: 0, montantRetenu: 0, mode: 'aucun', hoursUntilStart: Number(hoursUntilStart.toFixed(1)) };

  if (isStaff) {
    return { ...base, allowed: true, penalite_pct: 0, montantRembourse: montant, mode: montant > 0 ? 'remboursement' : 'aucun' };
  }

  if (!policy.annulation_membre_autorisee) {
    return { ...base, allowed: false, reason: "Les annulations en ligne sont désactivées. Contactez l'accueil." };
  }

  let penalite = Number(policy.penalite_pct || 0);
  if (!espacePolicy) {
    if (hoursUntilStart < policy.delai_heures) {
      return {
        ...base,
        allowed: false,
        reason: `Annulation impossible moins de ${policy.delai_heures} h avant le début.`,
      };
    }
  } else {
    const libre = Number(espacePolicy.tranche_libre_heures ?? 24);
    const tardive = Number(espacePolicy.tranche_tardive_heures ?? 12);
    if (hoursUntilStart >= libre) penalite = 0;
    else if (hoursUntilStart >= tardive) penalite = Number(espacePolicy.penalite_tardive_pct ?? 50);
    else penalite = Number(espacePolicy.penalite_tres_tardive_pct ?? 100);
  }

  const montantRetenu = Math.round(montant * penalite / 100 * 100) / 100;
  const remboursable = Math.max(0, Math.round((montant - montantRetenu) * 100) / 100);

  let mode = 'aucun';
  let montantRembourse = 0;
  let montantCredit = 0;
  if (remboursable > 0) {
    if (espacePolicy?.credit_portefeuille_auto) {
      mode = 'credit';
      montantCredit = remboursable;
    } else if (policy.remboursement_auto) {
      mode = 'remboursement';
      montantRembourse = remboursable;
    }
  }

  return {
    ...base,
    allowed: true,
    penalite_pct: penalite,
    montantRetenu,
    montantRembourse,
    montantCredit,
    mode,
  };
}

async function hasActiveSubscription(userId) {
  const today = todayISO();
  const { data, error } = await supabaseAdmin
    .from('abonnements')
    .select('id')
    .eq('user_id', userId)
    .eq('statut', 'active')
    .lte('date_debut', today)
    .gte('date_fin', today)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

async function ensureQrToken(userId) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('qr_token')
    .eq('id', userId)
    .single();
  if (profile?.qr_token) return profile.qr_token;
  const crypto = require('crypto');
  const token = crypto.randomUUID();
  await supabaseAdmin.from('profiles').update({ qr_token: token }).eq('id', userId);
  return token;
}

function computeRemainingMinutes(dateFin) {
  return Math.max(0, Math.round((new Date(dateFin).getTime() - Date.now()) / 60000));
}

async function countOverlappingBookings(espaceId, dateDebut, dateFin, excludeId = null) {
  let query = supabaseAdmin
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('espace_id', espaceId)
    .in('statut', ['confirmed', 'pending'])
    .lt('date_debut', dateFin)
    .gt('date_fin', dateDebut);
  if (excludeId) query = query.neq('id', excludeId);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function countOverlappingFormations(espaceId, dateDebut, dateFin, excludeFormationId = null) {
  let query = supabaseAdmin
    .from('formations')
    .select('id', { count: 'exact', head: true })
    .eq('espace_id', espaceId)
    .in('statut', ['planifiee', 'en_cours'])
    .lt('date_debut', dateFin)
    .gt('date_fin', dateDebut);
  if (excludeFormationId) query = query.neq('id', excludeFormationId);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

const FORMATION_ROOM_UNAVAILABLE =
  "Cette salle n'est pas disponible à cette date. Changez la date de la formation ou choisissez une autre salle.";

async function getBookingAvailability(espaceId, dateDebut, dateFin, excludeId = null, options = {}) {
  const { data: espace, error: espErr } = await supabaseAdmin
    .from('espaces')
    .select('id, type, capacite, nom')
    .eq('id', espaceId)
    .single();

  if (espErr || !espace) {
    throw new Error('Espace introuvable.');
  }

  const overlappingCount = await countOverlappingBookings(espaceId, dateDebut, dateFin, excludeId);
  const overlappingFormations = await countOverlappingFormations(
    espaceId,
    dateDebut,
    dateFin,
    options.excludeFormationId || null
  );
  const isOpenSpace = espace.type === 'open_space';
  const exclusive = options.exclusive === true || !isOpenSpace;
  const capacity = Math.max(1, parseInt(espace.capacite, 10) || 1);

  let isAvailable;
  let remaining;
  let conflictMessage;

  if (overlappingFormations > 0) {
    isAvailable = false;
    remaining = 0;
    conflictMessage = FORMATION_ROOM_UNAVAILABLE;
  } else if (exclusive) {
    remaining = overlappingCount > 0 ? 0 : 1;
    isAvailable = overlappingCount === 0;
    conflictMessage = isAvailable ? null : FORMATION_ROOM_UNAVAILABLE;
  } else {
    remaining = Math.max(0, capacity - overlappingCount);
    isAvailable = overlappingCount < capacity;
    conflictMessage = isAvailable
      ? null
      : `Capacité de l'open space atteinte (${overlappingCount}/${capacity} places occupées) sur ce créneau.`;
  }

  return {
    isAvailable,
    shared: isOpenSpace && !exclusive,
    spaceType: espace.type,
    spaceName: espace.nom,
    capacity,
    overlappingCount,
    remaining,
    conflictMessage,
  };
}

async function createReservationWithPayment({ userId, espaceId, dateDebut, dateFin, tenantId, mode = 'online' }) {
  const { data: espData } = await supabaseAdmin
    .from('espaces')
    .select('tarif_horaire, tenant_id')
    .eq('id', espaceId)
    .single();

  const hours = Math.max(1, (new Date(dateFin) - new Date(dateDebut)) / (1000 * 60 * 60));
  const tarif = parseFloat(espData?.tarif_horaire) || 0;
  const computedMontant = parseFloat((hours * tarif).toFixed(2));
  const bookingTenantId = tenantId || espData?.tenant_id || null;

  let dbMode = 'online';
  if (mode === 'sur_place' || mode === 'on_site') dbMode = 'on_site';
  else if (mode === 'phone') dbMode = 'phone';

  const { data: reservation, error } = await supabaseAdmin
    .from('reservations')
    .insert({
      tenant_id: bookingTenantId,
      user_id: userId,
      espace_id: espaceId,
      date_debut: dateDebut,
      date_fin: dateFin,
      statut: 'pending',
      mode: dbMode,
    })
    .select('*, espaces(nom, type, tarif_horaire)')
    .single();

  if (error) throw error;

  let payment = null;
  if (computedMontant > 0) {
    const paymentMode = dbMode === 'online' ? 'online' : 'cash';
    const { data: paymentRow, error: payErr } = await supabaseAdmin
      .from('paiements')
      .insert({
        user_id: userId,
        reservation_id: reservation.id,
        montant: computedMontant,
        mode: paymentMode,
        statut: 'pending',
        tenant_id: bookingTenantId,
      })
      .select('*')
      .single();
    if (!payErr) payment = paymentRow;
  }

  return { reservation, payment, tenantId: bookingTenantId };
}

async function hasBookingOverlap(espaceId, dateDebut, dateFin, excludeId = null) {
  const availability = await getBookingAvailability(espaceId, dateDebut, dateFin, excludeId);
  return !availability.isAvailable;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

module.exports = {
  todayISO,
  isDateInRange,
  applyPromoDiscount,
  findActiveTarif,
  findValidPromoCode,
  sanitizeProfileForClient,
  getCancellationPolicy,
  evaluateCancellation,
  getCancellationPolicyForEspace,
  buildCancellationInfo,
  hasActiveSubscription,
  ensureQrToken,
  computeRemainingMinutes,
  hasBookingOverlap,
  getBookingAvailability,
  countOverlappingBookings,
  countOverlappingFormations,
  createReservationWithPayment,
  FORMATION_ROOM_UNAVAILABLE,
  addDays,
};
