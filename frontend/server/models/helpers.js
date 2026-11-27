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

const DEFAULT_TARIFS = [
  { id: 'def-1', type_abonnement: 'day_pass', plan_tarifaire: 'standard', prix: 35.00, tva_pct: 19, actif: true },
  { id: 'def-2', type_abonnement: 'day_pass', plan_tarifaire: 'etudiant', prix: 25.00, tva_pct: 19, actif: true },
  { id: 'def-3', type_abonnement: 'day_pass', plan_tarifaire: 'entreprise', prix: 45.00, tva_pct: 19, actif: true },
  { id: 'def-4', type_abonnement: 'week_pass', plan_tarifaire: 'standard', prix: 180.00, tva_pct: 19, actif: true },
  { id: 'def-5', type_abonnement: 'week_pass', plan_tarifaire: 'etudiant', prix: 130.00, tva_pct: 19, actif: true },
  { id: 'def-6', type_abonnement: 'week_pass', plan_tarifaire: 'entreprise', prix: 220.00, tva_pct: 19, actif: true },
  { id: 'def-7', type_abonnement: 'mensuel', plan_tarifaire: 'standard', prix: 450.00, tva_pct: 19, actif: true },
  { id: 'def-8', type_abonnement: 'mensuel', plan_tarifaire: 'etudiant', prix: 320.00, tva_pct: 19, actif: true },
  { id: 'def-9', type_abonnement: 'mensuel', plan_tarifaire: 'entreprise', prix: 600.00, tva_pct: 19, actif: true },
  { id: 'def-10', type_abonnement: 'trimestriel', plan_tarifaire: 'standard', prix: 1200.00, tva_pct: 19, actif: true },
  { id: 'def-11', type_abonnement: 'trimestriel', plan_tarifaire: 'etudiant', prix: 850.00, tva_pct: 19, actif: true },
  { id: 'def-12', type_abonnement: 'trimestriel', plan_tarifaire: 'entreprise', prix: 1600.00, tva_pct: 19, actif: true },
  { id: 'def-13', type_abonnement: 'annuel', plan_tarifaire: 'standard', prix: 4200.00, tva_pct: 19, actif: true },
  { id: 'def-14', type_abonnement: 'annuel', plan_tarifaire: 'etudiant', prix: 3000.00, tva_pct: 19, actif: true },
  { id: 'def-15', type_abonnement: 'annuel', plan_tarifaire: 'entreprise', prix: 5500.00, tva_pct: 19, actif: true },
  { id: 'def-16', type_abonnement: 'bureau_prive', plan_tarifaire: 'standard', prix: 900.00, tva_pct: 19, actif: true },
  { id: 'def-17', type_abonnement: 'bureau_prive', plan_tarifaire: 'entreprise', prix: 1200.00, tva_pct: 19, actif: true },
];

async function findActiveTarif(typeAbonnement, planTarifaire, tenantId, typeEspace) {
  const today = todayISO();
  try {
    let q = supabaseAdmin
      .from('tarifs_abonnements')
      .select('*')
      .eq('type_abonnement', typeAbonnement)
      .eq('plan_tarifaire', planTarifaire)
      .eq('actif', true)
      .lte('date_debut', today);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data, error } = await q.order('date_debut', { ascending: false });
    if (!error && data && data.length > 0) {
      const active = data.filter((t) => !t.date_fin || t.date_fin >= today);
      if (active.length > 0) {
        if (typeEspace) {
          return (
            active.find((t) => t.type_espace === typeEspace)
            || active.find((t) => !t.type_espace)
            || null
          );
        }
        return active.find((t) => !t.type_espace) || active[0];
      }
    }
  } catch (err) {
    console.warn('findActiveTarif fallback due to error:', err.message);
  }
  return (
    DEFAULT_TARIFS.find((t) => t.type_abonnement === typeAbonnement && t.plan_tarifaire === planTarifaire)
    || DEFAULT_TARIFS.find((t) => t.type_abonnement === typeAbonnement)
    || null
  );
}

async function findValidPromoCode(code, tenantId) {
  if (!code) return null;
  const upper = String(code).trim().toUpperCase();
  const today = todayISO();
  try {
    let q = supabaseAdmin
      .from('codes_promo')
      .select('*')
      .eq('code', upper)
      .eq('actif', true);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data, error } = await q.single();
    if (!error && data) {
      if (!isDateInRange(today, data.date_debut, data.date_fin)) return null;
      if (data.utilisations_max != null && data.utilisations_count >= data.utilisations_max) return null;
      return data;
    }
  } catch (err) {
    console.warn('findValidPromoCode error:', err.message);
  }
  return null;
}

function sanitizeProfileForClient(profile, isStaff) {
  const copy = { ...profile };
  if (!isStaff) {
    delete copy.notes_admin;
  }
  return copy;
}

function buildDynamicCancellationMessage({
  delai_annulation_gratuite,
  delai_heures,
  penalite_pct = 0,
  annulation_membre_autorisee = true,
} = {}) {
  if (annulation_membre_autorisee === false) {
    return "Les annulations en ligne sont désactivées. Contactez l'accueil.";
  }
  const h = Math.max(0, Number(delai_annulation_gratuite ?? delai_heures ?? 24));
  const base = `Annulation gratuite jusqu'à ${h} heure${h > 1 ? 's' : ''} avant le début du créneau.`;
  const pen = Number(penalite_pct || 0);
  return pen > 0 ? `${base} Passé ce délai, pénalité de ${pen}%.` : base;
}

async function getCancellationPolicy(tenantId) {
  let q = supabaseAdmin.from('politique_annulation').select('*');
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();

  let tenantFreeHours = null;
  if (tenantId) {
    try {
      const { data: tRow } = await supabaseAdmin
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .maybeSingle();
      const raw = tRow?.settings?.delai_annulation_gratuite;
      if (raw !== undefined && raw !== null && raw !== '') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0) tenantFreeHours = parsed;
      }
    } catch (_) {}
  }

  const base = data || {
    delai_heures: 24,
    penalite_pct: 0,
    annulation_membre_autorisee: true,
    remboursement_auto: false,
    message_membre: '',
  };
  const delaiEffectif = tenantFreeHours != null ? tenantFreeHours : Number(base.delai_heures ?? 24);
  const dynamicMsg = buildDynamicCancellationMessage({
    delai_annulation_gratuite: delaiEffectif,
    penalite_pct: base.penalite_pct,
    annulation_membre_autorisee: base.annulation_membre_autorisee,
  });

  return {
    ...base,
    delai_heures: delaiEffectif,
    delai_annulation_gratuite: delaiEffectif,
    message_membre: (base.message_membre && String(base.message_membre).trim()) || dynamicMsg,
    dynamic_message: dynamicMsg,
  };
}

/**
 * Règle No-show :
 * Une réservation ayant reçu un paiement (partiel ou total) OU ayant un check-in validé
 * ne peut JAMAIS basculer en No-show (Absent).
 */
async function canMarkReservationNoShow(reservationId) {
  if (!reservationId) return { allowed: false, reason: 'Identifiant de réservation manquant.' };

  try {
    const [payRes, sesRes] = await Promise.all([
      supabaseAdmin
        .from('paiements')
        .select('id, statut, montant, montant_encaisse')
        .eq('reservation_id', reservationId),
      supabaseAdmin
        .from('sessions')
        .select('id, check_in, statut')
        .eq('reservation_id', reservationId)
        .not('check_in', 'is', null)
        .limit(1),
    ]);

    const hasPaidOrPartial = (payRes?.data || []).some((p) => {
      const st = String(p.statut || '').toLowerCase();
      return st === 'paid' || st === 'partial' || Number(p.montant_encaisse || 0) > 0;
    });
    if (hasPaidOrPartial) {
      return {
        allowed: false,
        reason: "Impossible de passer en No-show (Absent) : un paiement (partiel ou total) est déjà enregistré pour cette réservation.",
      };
    }

    if ((sesRes?.data || []).length > 0) {
      return {
        allowed: false,
        reason: "Impossible de passer en No-show (Absent) : un check-in a déjà été validé pour cette réservation.",
      };
    }
  } catch (err) {
    console.warn('⚠️ Vérification canMarkReservationNoShow:', err.message);
  }

  return { allowed: true };
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

const SHARED_SPACE_TYPES = ['open_space', 'hot_desk'];

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

  // CDC v3.0 : Open Space et Hot Desk = postes partagés (capacité max) ; les autres types sont exclusifs.
  const isOpenSpace = SHARED_SPACE_TYPES.includes(espace.type);
  const exclusive = options.exclusive === true || !isOpenSpace;
  const capacity = Math.max(1, parseInt(espace.capacite, 10) || 1);

  let overlappingCount = await countOverlappingBookings(espaceId, dateDebut, dateFin, excludeId);

  // Vérification ciblée d'un poste / salle sur le plan 2D (zéro conflit par floor_plan_item_id)
  if (options.floorPlanItemId) {
    let itemResQ = supabaseAdmin
      .from('reservations')
      .select('id, floor_plan_item_id, notes')
      .eq('espace_id', espaceId)
      .in('statut', ['confirmed', 'pending'])
      .lt('date_debut', dateFin)
      .gt('date_fin', dateDebut);
    if (excludeId) itemResQ = itemResQ.neq('id', excludeId);
    let { data: itemOverlaps, error: itemOvErr } = await itemResQ;
    if (itemOvErr) {
      let fbQ = supabaseAdmin
        .from('reservations')
        .select('id, notes')
        .eq('espace_id', espaceId)
        .in('statut', ['confirmed', 'pending'])
        .lt('date_debut', dateFin)
        .gt('date_fin', dateDebut);
      if (excludeId) fbQ = fbQ.neq('id', excludeId);
      const fbRes = await fbQ;
      itemOverlaps = fbRes.data || [];
    }
    const targetItemId = String(options.floorPlanItemId);
    const hasExactItemConflict = (itemOverlaps || []).some((row) => {
      if (row.floor_plan_item_id && String(row.floor_plan_item_id) === targetItemId) return true;
      if (row.notes) {
        try {
          const parsed = typeof row.notes === 'string' ? JSON.parse(row.notes) : row.notes;
          if (parsed?.floor_plan_item_id && String(parsed.floor_plan_item_id) === targetItemId) return true;
        } catch (_) {}
      }
      return false;
    });
    if (hasExactItemConflict) {
      return {
        isAvailable: false,
        shared: isOpenSpace && !exclusive,
        spaceType: espace.type,
        spaceName: espace.nom,
        capacity,
        overlappingCount: Math.max(1, overlappingCount),
        remaining: Math.max(0, capacity - overlappingCount),
        conflictMessage: 'Ce poste ou cette salle est déjà réservé sur ce créneau. Veuillez choisir un autre emplacement sur le plan.',
      };
    }
  }

  // CDC v3.0 D3 : vérifier si une session de travail en cours/en dépassement occupe
  // encore cet espace sans avoir été libérée manuellement (« C'est bon, libérée »).
  try {
    const reqStartMs = new Date(dateDebut).getTime();
    const nowMs = Date.now();
    // Si la réservation demandée commence aujourd'hui ou dans les 2h à venir
    if (reqStartMs <= nowMs + 2 * 3600 * 1000) {
      const { data: openRes } = await supabaseAdmin
        .from('reservations')
        .select('id, floor_plan_item_id, notes')
        .eq('espace_id', espaceId)
        .in('statut', ['confirmed', 'pending'])
        .lte('date_debut', dateFin);
      const resRows = (openRes || []).filter((r) => r.id !== excludeId);
      const resIds = resRows.map((r) => r.id);
      if (resIds.length > 0) {
        const { data: activeSessRows, count: activeSessCount } = await supabaseAdmin
          .from('sessions')
          .select('id, reservation_id', { count: 'exact' })
          .in('reservation_id', resIds)
          .in('statut', ['active', 'overtime'])
          .is('check_out', null);
        if ((activeSessCount || 0) > 0 && exclusive) {
          return {
            isAvailable: false,
            shared: false,
            spaceType: espace.type,
            spaceName: espace.nom,
            capacity,
            overlappingCount: Math.max(1, overlappingCount),
            remaining: 0,
            conflictMessage: "Ressource encore occupée : la session de travail en cours n'a pas encore été libérée manuellement par l'accueil.",
          };
        }
        if (options.floorPlanItemId && Array.isArray(activeSessRows) && activeSessRows.length > 0) {
          const activeResIdSet = new Set(activeSessRows.map((s) => s.reservation_id));
          const targetItemId = String(options.floorPlanItemId);
          const itemStillOccupied = resRows.some((r) => {
            if (!activeResIdSet.has(r.id)) return false;
            if (r.floor_plan_item_id && String(r.floor_plan_item_id) === targetItemId) return true;
            try {
              const parsed = typeof r.notes === 'string' ? JSON.parse(r.notes) : r.notes;
              return parsed?.floor_plan_item_id && String(parsed.floor_plan_item_id) === targetItemId;
            } catch {
              return false;
            }
          });
          if (itemStillOccupied) {
            return {
              isAvailable: false,
              shared: isOpenSpace && !exclusive,
              spaceType: espace.type,
              spaceName: espace.nom,
              capacity,
              overlappingCount: Math.max(1, overlappingCount),
              remaining: Math.max(0, capacity - overlappingCount),
              conflictMessage: "Ce poste est encore occupé : la session de travail en cours n'a pas encore été libérée.",
            };
          }
        }
      }
    }
  } catch (_) {}
  const overlappingFormations = await countOverlappingFormations(
    espaceId,
    dateDebut,
    dateFin,
    options.excludeFormationId || null
  );

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
    conflictMessage = isAvailable ? null : 'Cet espace est déjà réservé sur ce créneau. Veuillez choisir un autre horaire.';
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

async function createReservationWithPayment({ userId, espaceId, dateDebut, dateFin, tenantId, mode = 'on_site', totalHours = null }) {
  const { data: espData } = await supabaseAdmin
    .from('espaces')
    .select('tarif_horaire, tenant_id')
    .eq('id', espaceId)
    .single();

  const hours = totalHours && Number(totalHours) > 0
    ? Number(totalHours)
    : Math.max(1, (new Date(dateFin) - new Date(dateDebut)) / (1000 * 60 * 60));
  const tarif = parseFloat(espData?.tarif_horaire) || 0;
  const computedMontant = parseFloat((hours * tarif).toFixed(3));
  const bookingTenantId = tenantId || espData?.tenant_id || null;

  // CDC v3.0 D1 : règlement 100 % sur place — plus de mode « online ».
  let dbMode = 'on_site';
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
    const paymentMode = 'cash'; // règlement sur place (espèces, chèque ou virement saisi par le staff)
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


/**
 * Insertion tolérante au schéma (CDC v3.0 — résilience multi-déploiement).
 * Si PostgREST/Postgres signale une colonne inconnue (PGRST204 / 42703), la colonne
 * est retirée du payload (ou remplacée par son alias, ex. user_id → membre_id)
 * puis l'insertion est retentée (max 8 tentatives).
 *
 * @param {object} client   Client Supabase (admin ou utilisateur)
 * @param {string} table    Nom de la table
 * @param {object} payload  Ligne à insérer
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.aliases] colonne absente → colonne de remplacement
 * @param {string} [opts.select='*'] projection retournée
 * @returns {Promise<{data:any, error:any, dropped:string[]}>}
 */
async function insertWithColumnFallback(client, table, payload, opts = {}) {
  const { aliases = {}, select = '*' } = opts;
  const row = { ...payload };
  const dropped = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await client.from(table).insert(row).select(select).single();
    if (!error) return { data, error: null, dropped };
    const msg = String(error.message || '');
    const m = msg.match(/Could not find the '([^']+)' column/i)
      || msg.match(/column "?([a-z0-9_]+)"? (?:of relation "[^"]+" )?does not exist/i);
    if (!m || !(m[1] in row)) return { data: null, error, dropped };
    const col = m[1];
    const value = row[col];
    delete row[col];
    dropped.push(col);
    const alias = aliases[col];
    if (alias && !(alias in row)) row[alias] = value;
  }
  return { data: null, error: new Error('Insertion impossible : schéma incompatible.'), dropped };
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
  buildDynamicCancellationMessage,
  canMarkReservationNoShow,
  evaluateCancellation,
  getCancellationPolicyForEspace,
  buildCancellationInfo,
  hasActiveSubscription,
  ensureQrToken,
  computeRemainingMinutes,
  hasBookingOverlap,
  insertWithColumnFallback,
  getBookingAvailability,
  countOverlappingBookings,
  countOverlappingFormations,
  createReservationWithPayment,
  FORMATION_ROOM_UNAVAILABLE,
  addDays,
  DEFAULT_TARIFS,
};
