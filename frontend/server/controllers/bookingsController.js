// controllers/bookingsController.js — MODULE B : Réservations & Contrôle Atomique (LOT 3)
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const {
  getBookingAvailability,
  getCancellationPolicy,
  getCancellationPolicyForEspace,
  buildCancellationInfo,
  canMarkReservationNoShow,
  findValidPromoCode,
  applyPromoDiscount,
  todayISO,
  insertWithColumnFallback,
} = require('../models/helpers');
const { applyTenantFilter } = require('../middleware/guards');
const { notifyConfirmationReservation, notifyAnnulationReservation } = require('../services/notificationService');
const { sendEmailUniversal } = require('../utils/sendEmail');
const { DEFAULT_TVA_PCT, roundMillime, computeTTC, computeHTFromTTC } = require('../models/pricingMath');
const { logActivity } = require('../models/activityLogger');
const {
  isManagerRole,
  assertManagerGuards,
  getTenantTamponMinutes,
  loadSpaceUnitsForTenant,
  checkAvailabilityWithBuffer,
  findAlternativeSlots,
  sweepExpiredConfirmations,
  tunisLocalYmdToUtcMs,
} = require('../models/bookingAvailability');

function normalizePhoneTN(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00216') && digits.length >= 13) return `+216${digits.slice(5, 13)}`;
  if (digits.startsWith('216') && digits.length >= 11) return `+216${digits.slice(3, 11)}`;
  if (digits.length === 8) return `+216${digits}`;
  return null;
}

function isRpcMissingErr(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || err.details || '');
  return code === '42883' || code === 'PGRST202' || /book_reservation_atomic|could not find the function|does not exist/i.test(msg);
}

async function getBookingsCalendar(req, res) {
  try {
    const { espace_id, from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'Paramètres from et to requis (ISO date).' });
    }

    const isSuperAdmin = req.profile.role === 'super_admin';
    const isStaff = ['admin', 'staff'].includes(req.profile.role);

    if (req.tenantId && isStaff) {
      await sweepExpiredConfirmations({ supabaseAdmin, tenantId: req.tenantId }).catch(() => {});
    }

    let query = supabaseAdmin
      .from('reservations')
      .select('id, espace_id, unite_id, user_id, guest_id, date_debut, date_fin, statut, mode, source, telephone_contact, confirmation_manuelle, confirmation_expires_at, notes, archived_at, tenant_id, espaces(nom, type, tenant_id), profiles!user_id(nom, prenom, email, telephone), guests(nom, prenom, email, telephone), paiements(id, statut, mode, montant, numero_recu)')
      .lt('date_debut', to)
      .gt('date_fin', from)
      .order('date_debut', { ascending: true });

    if (isSuperAdmin) {
      // Super admin voit tout
    } else if (isStaff) {
      // Admin/Staff ne voient QUE les réservations de leurs propres espaces
      if (req.tenantId) {
        const { data: tenantEspaces } = await supabaseAdmin
          .from('espaces')
          .select('id')
          .eq('tenant_id', req.tenantId);

        const espaceIds = (tenantEspaces || []).map((e) => e.id);

        if (espaceIds.length > 0) {
          query = query.in('espace_id', espaceIds);
        } else {
          return res.json({ reservations: [] });
        }
      } else {
        query = query.eq('user_id', req.user.id);
      }
    } else {
      query = query.eq('user_id', req.user.id);
    }

    if (espace_id) {
      query = query.eq('espace_id', espace_id);
    }

    let { data, error } = await query;
    if (error && (error.code === 'PGRST200' || /relationship|column/i.test(error.message))) {
      let fb = supabaseAdmin
        .from('reservations')
        .select('id, espace_id, date_debut, date_fin, statut, reference, tenant_id, espaces(nom, type, tenant_id)')
        .lt('date_debut', to)
        .gt('date_fin', from)
        .order('date_debut', { ascending: true });
      if (!isSuperAdmin) {
        fb = fb.or(`membre_id.eq.${req.user.id},user_id.eq.${req.user.id}`);
      }
      if (espace_id) fb = fb.eq('espace_id', espace_id);
      const fbRes = await fb;
      data = fbRes.data || [];
      error = fbRes.error;
    }
    if (error) {
      console.warn('⚠️ getBookingsCalendar warning:', error.message);
      return res.json({ reservations: [] });
    }

    // Récupération et synchronisation des formations pour l'agenda
    let reservationsList = (Array.isArray(data) ? data : []).filter((r) => !r.archived_at);
    const units = req.tenantId ? await loadSpaceUnitsForTenant(supabaseAdmin, req.tenantId) : [];
    const unitById = new Map(units.map((u) => [u.id, u]));
    reservationsList = reservationsList.map((r) => (r.unite_id && unitById.has(r.unite_id) ? { ...r, unite: unitById.get(r.unite_id) } : r));
    try {
      let formQ = supabaseAdmin
        .from('formations')
        .select('id, titre, description, formateur_id, espace_id, date_debut, date_fin, capacite_max, prix_inscription, statut, tenant_id, reservation_id, profiles!fk_formations_formateur_profiles(id, nom, prenom, email), espaces(id, nom, type)')
        .in('statut', ['planifiee', 'publiee', 'en_cours', 'terminee', 'validee'])
        .lt('date_debut', to)
        .gt('date_fin', from);

      if (isStaff && req.tenantId) {
        formQ = formQ.eq('tenant_id', req.tenantId);
      } else if (!isSuperAdmin && !isStaff) {
        formQ = formQ.eq('formateur_id', req.user.id);
      }
      if (espace_id) {
        formQ = formQ.eq('espace_id', espace_id);
      }

      const { data: formationsData } = await formQ;
      if (Array.isArray(formationsData)) {
        for (const f of formationsData) {
          // Chercher si une réservation existante correspond à cette formation
          let found = reservationsList.find(r => r.id === f.reservation_id || (r.espace_id === f.espace_id && r.date_debut === f.date_debut));
          if (found) {
            found.is_formation = true;
            found.formation_id = f.id;
            found.formation_titre = f.titre;
            found.capacite_max = f.capacite_max;
            found.prix_inscription = f.prix_inscription;
            if (!found.profiles && f.profiles) found.profiles = f.profiles;
          } else {
            // Ajouter la formation comme créneau réservé dans l'agenda
            reservationsList.push({
              id: f.reservation_id || `formation-${f.id}`,
              espace_id: f.espace_id,
              user_id: f.formateur_id,
              date_debut: f.date_debut,
              date_fin: f.date_fin,
              statut: f.statut === 'planifiee' ? (f.reservation_id ? 'pending' : 'confirmed') : f.statut,
              mode: 'on_site',
              tenant_id: f.tenant_id,
              espaces: f.espaces,
              profiles: f.profiles,
              is_formation: true,
              formation_id: f.id,
              formation_titre: f.titre,
              capacite_max: f.capacite_max,
              prix_inscription: f.prix_inscription,
            });
          }
        }
        reservationsList.sort((a, b) => new Date(a.date_debut) - new Date(b.date_debut));
      }
    } catch (formErr) {
      console.warn('⚠️ Synchronisation formations agenda:', formErr.message);
    }

    res.json({ reservations: reservationsList });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function findOrCreateAdminInvite({ tenantId, newInvite }) {
  if (!newInvite || !newInvite.nom) return null;
  const normalizedPhone = normalizePhoneTN(newInvite.telephone);
  if (!normalizedPhone) {
    const err = new Error('Le numéro de téléphone (+216 + 8 chiffres) est obligatoire pour créer un invité.');
    err.statusCode = 400;
    throw err;
  }

  // Recherche doublon téléphone sur guests / profiles / personnes
  const [{ data: gRows }, { data: pRows }, persRes] = await Promise.all([
    supabaseAdmin.from('guests').select('id, nom, prenom, email, telephone').eq('tenant_id', tenantId),
    supabaseAdmin.from('profiles').select('id, nom, prenom, email, telephone').eq('tenant_id', tenantId),
    Promise.resolve(supabaseAdmin.from('personnes').select('id, nom, prenom, email, telephone').eq('tenant_id', tenantId)).catch(() => ({ data: [] })),
  ]);

  const matchProfile = (pRows || []).find((p) => normalizePhoneTN(p.telephone) === normalizedPhone);
  if (matchProfile) {
    return { user_id: matchProfile.id, guest_id: null, phone: normalizedPhone, reused: true, personne: matchProfile };
  }
  const matchGuest = (gRows || []).find((g) => normalizePhoneTN(g.telephone) === normalizedPhone);
  if (matchGuest) {
    return { user_id: null, guest_id: matchGuest.id, phone: normalizedPhone, reused: true, personne: matchGuest };
  }
  const matchPers = (persRes?.data || []).find((pe) => normalizePhoneTN(pe.telephone) === normalizedPhone);
  if (matchPers) {
    return { user_id: matchPers.profile_id || null, guest_id: null, personne_id: matchPers.id, phone: normalizedPhone, reused: true, personne: matchPers };
  }

  const cleanEmail = String(newInvite.email || '').trim().toLowerCase() || `invite-${normalizedPhone.replace('+', '')}@deskywork.local`;
  const { data: createdGuest, error: gErr } = await insertWithColumnFallback(
    supabaseAdmin,
    'guests',
    {
      tenant_id: tenantId,
      nom: String(newInvite.nom).trim(),
      prenom: String(newInvite.prenom || '').trim(),
      email: cleanEmail,
      telephone: normalizedPhone,
    }
  );
  if (gErr) {
    // Essai via table personnes
    const { data: createdPers } = await supabaseAdmin
      .from('personnes')
      .insert({
        tenant_id: tenantId,
        type_personne: 'invite',
        nom: String(newInvite.nom).trim(),
        prenom: String(newInvite.prenom || '').trim(),
        email: cleanEmail,
        telephone: normalizedPhone,
      })
      .select()
      .maybeSingle();
    return {
      user_id: null,
      guest_id: null,
      personne_id: createdPers?.id || null,
      phone: normalizedPhone,
      reused: false,
      personne: { ...newInvite, telephone: normalizedPhone, id: createdPers?.id || crypto.randomUUID() },
    };
  }
  // Enregistrer également dans personnes si la table existe
  await supabaseAdmin
    .from('personnes')
    .insert({
      tenant_id: tenantId,
      type_personne: 'invite',
      nom: String(newInvite.nom).trim(),
      prenom: String(newInvite.prenom || '').trim(),
      email: cleanEmail,
      telephone: normalizedPhone,
    })
    .then(() => {})
    .catch(() => {});

  return { user_id: null, guest_id: createdGuest.id, phone: normalizedPhone, reused: false, personne: createdGuest };
}

async function createBooking(req, res) {
  try {
    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile?.role);
    const {
      espace_id,
      unite_id = null,
      date_debut,
      date_fin,
      mode,
      source = isStaff ? 'sur_place' : 'en_ligne',
      client_type,
      entreprise_info,
      floor_plan_item_id,
      floor_plan_item_label,
      user_id: bodyUserId = null,
      guest_id: bodyGuestId = null,
      personne_id: bodyPersonneId = null,
      new_invite = null,
      telephone_contact = null,
      services_additionnels = [],
      ressources = [],
      promo_code = null,
      code_promo = null,
      deduire_quota_abonnement = true,
      mode_paiement = 'cash',
      confirmation_manuelle = false,
      delai_confirmation_heures = 2,
      override_conflit = false,
      override_unpaid_block = false,
      motif_retroactif = '',
      notes: freeNotes = '',
    } = req.body;

    if (!espace_id || !date_debut || !date_fin) {
      return res.status(400).json({ error: 'espace_id, date_debut et date_fin sont requis.' });
    }

    if (new Date(date_debut) >= new Date(date_fin)) {
      return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
    }

    // Gardes Responsable (saisie rétroactive + dérogation conflit)
    assertManagerGuards({
      actorRole: req.profile?.role,
      dateDebut: date_debut,
      overrideConflit: Boolean(override_conflit),
      motifRetroactif: motif_retroactif,
    });

    // Calcul automatique du montant total selon le tarif horaire de l'espace (snapshot HT/TTC immuable LOT 2)
    let espDataRes = await req.db
      .from('espaces')
      .select('id, nom, tarif_horaire, tarif_horaire_ht, tarif_journalier, tarif_journalier_ht, tva_pct, horaires, tenant_id, type, capacite, actif')
      .eq('id', espace_id)
      .single();
    if (espDataRes.error && /column|does not exist|schema cache/i.test(espDataRes.error.message || '')) {
      espDataRes = await req.db.from('espaces').select('id, nom, tarif_horaire, tenant_id, type, capacite, actif').eq('id', espace_id).single();
    }
    const espData = espDataRes.data;
    if (!espData) return res.status(404).json({ error: 'Espace introuvable.' });

    const bookingTenantId = req.tenantId || espData.tenant_id || null;
    const tamponMinutes = await getTenantTamponMinutes(supabaseAdmin, bookingTenantId);

    // Résolution cible client (membre / invité / création invité avec dédoublonnage tél)
    let targetUserId = isStaff ? (bodyUserId || null) : req.user.id;
    let targetGuestId = isStaff ? (bodyGuestId || null) : null;
    let resolvedPhone = telephone_contact ? normalizePhoneTN(telephone_contact) : null;

    if (telephone_contact && !resolvedPhone) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide : format attendu +216 suivi de 8 chiffres.' });
    }

    if (isStaff && new_invite && new_invite.nom) {
      const inv = await findOrCreateAdminInvite({ tenantId: bookingTenantId, newInvite: new_invite });
      if (inv) {
        if (inv.user_id) targetUserId = inv.user_id;
        if (inv.guest_id) targetGuestId = inv.guest_id;
        if (!resolvedPhone && inv.phone) resolvedPhone = inv.phone;
      }
    } else if (isStaff && bodyPersonneId && !targetUserId && !targetGuestId) {
      const { data: persRow } = await supabaseAdmin.from('personnes').select('*').eq('id', bodyPersonneId).maybeSingle();
      if (persRow?.profile_id) targetUserId = persRow.profile_id;
      else if (persRow?.telephone && !resolvedPhone) resolvedPhone = normalizePhoneTN(persRow.telephone);
      if (!targetUserId && !targetGuestId) targetGuestId = bodyPersonneId;
    }

    if (isStaff && !targetUserId && !targetGuestId && !new_invite) {
      targetUserId = req.user.id;
    }

    const rawNbParticipants = req.body.nb_participants ?? entreprise_info?.nb_personnes;
    let parsedParticipants = 1;
    if (rawNbParticipants !== undefined && rawNbParticipants !== null && rawNbParticipants !== '') {
      parsedParticipants = parseInt(rawNbParticipants, 10) || 1;
    }
    if (espData.type === 'meeting_room') {
      const maxCap = Math.max(1, parseInt(espData.capacite, 10) || 1);
      if (!Number.isInteger(parsedParticipants) || parsedParticipants < 1 || parsedParticipants > maxCap) {
        return res.status(400).json({
          error: `Pour une salle de réunion, le nombre de participants est obligatoire et doit être compris entre 1 et ${maxCap}.`,
        });
      }
    }

    // Résolution unité si fournie
    const spaceUnits = bookingTenantId ? await loadSpaceUnitsForTenant(supabaseAdmin, bookingTenantId, espace_id) : [];
    const targetUnite = unite_id ? spaceUnits.find((u) => u.id === unite_id) : null;
    if (unite_id && !targetUnite) {
      return res.status(404).json({ error: 'Unité ou poste sélectionné introuvable.' });
    }
    const effectiveFpItemId = floor_plan_item_id || targetUnite?.floor_plan_item_id || null;

    // Vérification blocage pour impayé dépassant X jours (LOT 4, déblocable uniquement par Responsable)
    if (targetUserId && bookingTenantId) {
      const { getUnpaidBlockingConfig, computeAgingBucket } = require('../models/financeHelpers');
      const { data: tCfgRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', bookingTenantId).maybeSingle();
      const financeCfg = getUnpaidBlockingConfig(tCfgRow?.settings || {});
      if (financeCfg.block_booking_on_overdue) {
        const { data: overdueRows } = await supabaseAdmin
          .from('paiements')
          .select('*, reservations(date_fin)')
          .eq('tenant_id', bookingTenantId)
          .eq('user_id', targetUserId)
          .in('statut', ['pending', 'partial']);
        const blockedItem = (overdueRows || []).find((p) => {
          const aging = computeAgingBucket(p.due_date || p.reservations?.date_fin || p.created_at);
          return aging.daysOverdue >= financeCfg.overdue_block_days;
        });
        const canOverrideUnpaid = isManagerRole(req.profile?.role) && Boolean(override_unpaid_block);
        if (blockedItem && !canOverrideUnpaid) {
          const aging = computeAgingBucket(blockedItem.due_date || blockedItem.reservations?.date_fin || blockedItem.created_at);
          return res.status(403).json({
            error: `Nouvelle réservation bloquée : ce membre a un impayé en retard de ${aging.daysOverdue} jour(s) (seuil : ${financeCfg.overdue_block_days} jours). Seul un Responsable peut débloquer ou le solde doit être régularisé.`,
            code: 'UNPAID_BOOKING_BLOCKED',
            days_overdue: aging.daysOverdue,
            overdue_block_days: financeCfg.overdue_block_days,
          });
        }
      }
    }

    // Vérification restriction abonnement membre
    if (!isStaff && targetUserId) {
      const today = todayISO();
      const { data: activeSub } = await req.db
        .from('abonnements')
        .select('type_espace')
        .eq('user_id', targetUserId)
        .eq('statut', 'active')
        .lte('date_debut', today)
        .gte('date_fin', today)
        .order('date_fin', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeSub?.type_espace && espData.type && activeSub.type_espace !== espData.type) {
        const typeLabels = {
          open_space: 'Open space',
          private_office: 'Bureau privé',
          meeting_room: 'Salle de réunion',
          training_room: 'Salle de formation',
          event_space: 'Espace événementiel',
          hot_desk: 'Poste nomade',
          dedicated_desk: 'Poste fixe',
        };
        return res.status(400).json({
          error: `Votre formule d'abonnement est limitée aux espaces de type « ${typeLabels[activeSub.type_espace] || activeSub.type_espace} ».`,
        });
      }
    }

    // Calcul tarification HT / Services / Promo / Quota Abonnement / TVA / TTC
    const hours = Math.max(1, (new Date(date_fin) - new Date(date_debut)) / (1000 * 60 * 60));
    const tvaApplique = Number(espData.tva_pct ?? DEFAULT_TVA_PCT);
    const tarifTTC = roundMillime(espData.tarif_horaire || 0);
    const tarifHT = espData.tarif_horaire_ht !== undefined && espData.tarif_horaire_ht !== null
      ? roundMillime(espData.tarif_horaire_ht)
      : computeHTFromTTC(tarifTTC, tvaApplique);

    const spaceSubtotalHT = roundMillime(hours * tarifHT);
    const servicesArr = Array.isArray(services_additionnels) ? services_additionnels : [];
    const servicesSubtotalHT = roundMillime(
      servicesArr.reduce((acc, s) => acc + (Number(s.prix_ht ?? s.montant_ht ?? 0) * Math.max(1, Number(s.quantite || 1))), 0)
    );
    let computedMontantHT = roundMillime(spaceSubtotalHT + servicesSubtotalHT);

    // Code promo éventuel
    let promoApplied = null;
    if (code_promo) {
      const promo = await findValidPromoCode(code_promo, bookingTenantId);
      if (promo) {
        const disc = applyPromoDiscount(computedMontantHT, promo);
        computedMontantHT = roundMillime(disc.prixFinal);
        promoApplied = { code: promo.code, reduction_ht: roundMillime(disc.reduction) };
      }
    }

    // Déduction automatique du quota abonnement compatible (LOT 4) + recalcul du reste à payer
    let quotaDeduit = 0;
    let activeMemberSub = null;
    let activeSubMetaConsomme = 0;
    if (deduire_quota_abonnement !== false && targetUserId) {
      const today = todayISO();
      const { data: subRow } = await supabaseAdmin
        .from('abonnements')
        .select('*')
        .eq('user_id', targetUserId)
        .in('statut', ['active', 'actif', 'a_renouveler'])
        .lte('date_debut', today)
        .gte('date_fin', today)
        .order('date_fin', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subRow && (!subRow.type_espace || !espData.type || subRow.type_espace === espData.type)) {
        let subMeta = {};
        if (bookingTenantId) {
          const { data: tSub } = await supabaseAdmin.from('tenants').select('settings').eq('id', bookingTenantId).maybeSingle();
          subMeta = tSub?.settings?.subscription_meta?.[subRow.id] || {};
        }
        const quotaType = subRow.quota_type || subMeta.quota_type || 'illimite';
        const quotaTotal = subRow.quota_total != null ? Number(subRow.quota_total) : (subMeta.quota_total != null ? Number(subMeta.quota_total) : null);
        const quotaConsomme = Number(subRow.quota_consomme ?? subMeta.quota_consomme ?? 0) || 0;
        const legacyRemaining = subRow.heures_restantes ?? subRow.credits_restants ?? subRow.heures_incluses ?? null;
        const remainingQuota = quotaTotal != null
          ? Math.max(0, quotaTotal - quotaConsomme)
          : (legacyRemaining != null ? Math.max(0, Number(legacyRemaining)) : 0);

        if (quotaType === 'illimite' && subRow.unite_id && unite_id && subRow.unite_id === unite_id) {
          computedMontantHT = roundMillime(servicesSubtotalHT);
          activeMemberSub = subRow;
        } else if (remainingQuota > 0) {
          const unitQty = quotaType === 'jours' ? Math.max(1, Math.ceil(hours / 8)) : hours;
          quotaDeduit = Math.min(remainingQuota, unitQty);
          activeSubMetaConsomme = quotaConsomme + quotaDeduit;
          const ratioPaid = unitQty > 0 ? Math.max(0, (unitQty - quotaDeduit) / unitQty) : 1;
          computedMontantHT = roundMillime(spaceSubtotalHT * ratioPaid + servicesSubtotalHT);
          activeMemberSub = subRow;
        }
      }
    }

    const computedMontant = computeTTC(computedMontantHT, tvaApplique);

    const isEntreprise = (!isStaff && req.profile?.type_membre === 'entreprise') || client_type === 'entreprise';
    let notesObj = {};
    if (isEntreprise) {
      const info = entreprise_info || {};
      const missing = [];
      if (!String(info.raison_sociale || '').trim()) missing.push('Raison sociale');
      if (!String(info.contact_nom || '').trim()) missing.push('Personne de contact');
      if (!String(info.telephone_pro || '').trim()) missing.push('Téléphone professionnel');
      if (!String(info.email_facturation || '').trim()) missing.push('Email de facturation');
      if (!String(info.besoin_description || '').trim()) missing.push('Objet du besoin');
      if (missing.length > 0) {
        return res.status(400).json({
          error: `Champs Entreprise obligatoires manquants : ${missing.join(', ')}.`,
        });
      }
      notesObj = {
        type_client: 'entreprise',
        raison_sociale: info.raison_sociale.trim(),
        contact_nom: info.contact_nom.trim(),
        telephone_pro: info.telephone_pro.trim(),
        email_facturation: info.email_facturation.trim(),
        besoin_description: info.besoin_description.trim(),
      };
    }
    if (parsedParticipants) notesObj.nb_participants = parsedParticipants;
    if (effectiveFpItemId) notesObj.floor_plan_item_id = String(effectiveFpItemId);
    if (floor_plan_item_label || targetUnite?.code) {
      notesObj.floor_plan_item_label = String(floor_plan_item_label || targetUnite?.code).trim();
    }
    if (promoApplied) notesObj.code_promo = promoApplied;
    if (String(freeNotes || '').trim()) notesObj.note_libre = String(freeNotes).trim();
    const combinedNotes = Object.keys(notesObj).length > 0 ? JSON.stringify(notesObj) : null;

    const isPhonePending = Boolean(isStaff && confirmation_manuelle);
    const initialStatut = isPhonePending ? 'en_attente_confirmation' : 'pending';
    const expHours = Math.max(0.5, Math.min(48, Number(delai_confirmation_heures) || 2));
    const confirmationExpiresAt = isPhonePending ? new Date(Date.now() + expHours * 3600 * 1000).toISOString() : null;

    let dbMode = 'on_site';
    if (mode === 'phone' || source === 'telephone') dbMode = 'phone';

    const VALID_SOURCES = ['en_ligne', 'telephone', 'whatsapp', 'sur_place', 'autre'];
    const cleanSource = VALID_SOURCES.includes(source) ? source : (isStaff ? 'sur_place' : 'en_ligne');

    // Tentative 1 : RPC transactionnelle atomique PostgreSQL (pg_advisory_xact_lock + tampon + capacité)
    let createdReservationId = null;
    let usedRpc = false;

    if (bookingTenantId) {
      const rpcRes = await supabaseAdmin.rpc('book_reservation_atomic', {
        p_tenant_id: bookingTenantId,
        p_espace_id: espace_id,
        p_unite_id: unite_id || null,
        p_user_id: targetUserId || null,
        p_guest_id: targetGuestId || null,
        p_date_debut: date_debut,
        p_date_fin: date_fin,
        p_nb_participants: parsedParticipants,
        p_tampon_minutes: tamponMinutes,
        p_reservation_id: null,
        p_actor_role: req.profile?.role || 'member',
        p_override_conflit: Boolean(override_conflit),
        p_motif_retroactif: motif_retroactif || null,
        p_payload: {
          statut: initialStatut,
          mode: dbMode,
          source: cleanSource,
          telephone_contact: resolvedPhone,
          services_additionnels_json: servicesArr,
          ressources_json: Array.isArray(ressources) ? ressources : [],
          confirmation_manuelle: isPhonePending,
          confirmation_expires_at: confirmationExpiresAt,
          quota_abonnement_deduit: quotaDeduit,
          tarif_applique_ht: tarifHT,
          tva_pct_applique: tvaApplique,
          montant_ht: computedMontantHT,
          montant_ttc: computedMontant,
          montant_total: computedMontant,
          floor_plan_item_id: effectiveFpItemId,
          notes: combinedNotes,
        },
      });

      if (!rpcRes.error && rpcRes.data) {
        usedRpc = true;
        if (!rpcRes.data.ok) {
          const status = rpcRes.data.status || (rpcRes.data.conflict ? 409 : 400);
          let alternatives = { slots: [], units: [] };
          if (status === 409) {
            const availInfo = await checkAvailabilityWithBuffer({
              supabaseAdmin,
              tenantId: bookingTenantId,
              espace: espData,
              unite: targetUnite,
              dateDebut: date_debut,
              dateFin: date_fin,
              tamponMinutes,
              nbParticipants: parsedParticipants,
            }).catch(() => ({ alternatives: { slots: [], units: [] } }));
            alternatives = availInfo.alternatives || alternatives;
          }
          return res.status(status).json({
            error: rpcRes.data.reason || 'Créneau indisponible.',
            conflict: Boolean(rpcRes.data.conflict),
            alternatives,
          });
        }
        createdReservationId = rpcRes.data.reservation_id;
      } else if (rpcRes.error && !isRpcMissingErr(rpcRes.error)) {
        return res.status(400).json({ error: rpcRes.error.message });
      }
    }

    // Fallback JS si RPC absente pré-migration SQL
    let data = null;
    if (!usedRpc) {
      if (!override_conflit) {
        const bufferCheck = await checkAvailabilityWithBuffer({
          supabaseAdmin,
          tenantId: bookingTenantId,
          espace: espData,
          unite: targetUnite,
          dateDebut: date_debut,
          dateFin: date_fin,
          tamponMinutes,
          nbParticipants: parsedParticipants,
        });
        if (!bufferCheck.isAvailable) {
          return res.status(409).json({
            error: bufferCheck.reason,
            conflict: true,
            alternatives: bufferCheck.alternatives,
          });
        }
      }

      const fallbackCheck = await getBookingAvailability(espace_id, date_debut, date_fin, null, {
        floorPlanItemId: effectiveFpItemId,
      });
      if (!override_conflit && !fallbackCheck.isAvailable) {
        return res.status(409).json({
          error: fallbackCheck.conflictMessage,
          conflict: true,
          remaining: fallbackCheck.remaining,
          capacity: fallbackCheck.capacity,
          overlappingCount: fallbackCheck.overlappingCount,
          alternatives: { slots: [], units: [] },
        });
      }

      const insRes = await insertWithColumnFallback(
        supabaseAdmin,
        'reservations',
        {
          tenant_id: bookingTenantId,
          user_id: targetUserId,
          guest_id: targetGuestId,
          espace_id,
          unite_id: unite_id || null,
          date_debut,
          date_fin,
          statut: initialStatut === 'en_attente_confirmation' ? 'pending' : initialStatut,
          mode: dbMode,
          source: cleanSource,
          telephone_contact: resolvedPhone,
          services_additionnels_json: servicesArr,
          ressources_json: Array.isArray(ressources) ? ressources : [],
          confirmation_manuelle: isPhonePending,
          confirmation_expires_at: confirmationExpiresAt,
          motif_retroactif: motif_retroactif || null,
          override_conflit: Boolean(override_conflit),
          tampon_minutes: tamponMinutes,
          quota_abonnement_deduit: quotaDeduit,
          tarif_applique_ht: tarifHT,
          tva_pct_applique: tvaApplique,
          montant_ht: computedMontantHT,
          montant_ttc: computedMontant,
          montant_total: computedMontant,
          ...(effectiveFpItemId ? { floor_plan_item_id: effectiveFpItemId } : {}),
          ...(combinedNotes ? { notes: combinedNotes } : {}),
        },
        { aliases: { user_id: 'membre_id' }, select: '*, espaces(nom, type, tarif_horaire)' }
      );
      if (insRes.error) return res.status(400).json({ error: insRes.error.message });
      data = insRes.data;
    } else if (createdReservationId) {
      const { data: fetched } = await supabaseAdmin
        .from('reservations')
        .select('*, espaces(nom, type, tarif_horaire)')
        .eq('id', createdReservationId)
        .single();
      data = fetched;
    }

    // Déduire le quota d'abonnement si applicable + journaliser la consommation
    if (activeMemberSub && quotaDeduit > 0) {
      const patchSub = {};
      if (activeMemberSub.quota_total != null || activeMemberSub.quota_consomme != null) {
        patchSub.quota_consomme = activeSubMetaConsomme;
      }
      if (activeMemberSub.heures_restantes != null) {
        patchSub.heures_restantes = Math.max(0, Number(activeMemberSub.heures_restantes) - quotaDeduit);
      } else if (activeMemberSub.credits_restants != null) {
        patchSub.credits_restants = Math.max(0, Number(activeMemberSub.credits_restants) - quotaDeduit);
      }
      if (Object.keys(patchSub).length > 0) {
        await supabaseAdmin.from('abonnements').update(patchSub).eq('id', activeMemberSub.id).catch(() => {});
      }
      if (bookingTenantId) {
        try {
          const { data: tRow } = await supabaseAdmin.from('tenants').select('settings').eq('id', bookingTenantId).maybeSingle();
          const curS = (tRow?.settings && typeof tRow.settings === 'object') ? tRow.settings : {};
          const subMeta = { ...(curS.subscription_meta || {}) };
          if (subMeta[activeMemberSub.id]) {
            subMeta[activeMemberSub.id] = {
              ...subMeta[activeMemberSub.id],
              quota_consomme: activeSubMetaConsomme,
            };
          }
          const consoItem = {
            id: `conso-${Date.now()}`,
            tenant_id: bookingTenantId,
            abonnement_id: activeMemberSub.id,
            reservation_id: data?.id || null,
            quota_delta: quotaDeduit,
            quota_type: activeMemberSub.quota_type || 'heures',
            montant_economise_ttc: computeTTC(spaceSubtotalHT, tvaApplique) - computedMontant,
            description: `Réservation ${espData.nom}`,
            created_at: new Date().toISOString(),
          };
          const { error: consoErr } = await supabaseAdmin.from('abonnement_consommations').insert({
            tenant_id: bookingTenantId,
            abonnement_id: activeMemberSub.id,
            reservation_id: data?.id || null,
            quota_delta: quotaDeduit,
            quota_type: activeMemberSub.quota_type || 'heures',
            montant_economise_ttc: Math.max(0, computeTTC(spaceSubtotalHT, tvaApplique) - computedMontant),
            description: `Réservation ${espData.nom}`,
            created_by: req.user?.id || null,
          });
          const nextSettings = { ...curS, subscription_meta: subMeta };
          if (consoErr) {
            const list = Array.isArray(curS.abonnement_consommations) ? curS.abonnement_consommations : [];
            nextSettings.abonnement_consommations = [consoItem, ...list].slice(0, 200);
          }
          await supabaseAdmin.from('tenants').update({ settings: nextSettings }).eq('id', bookingTenantId);
        } catch (_) {}
      }
    }

    await logActivity({
      tenantId: bookingTenantId,
      req,
      action: 'creation',
      entityType: 'reservation',
      entityId: data?.id,
      entityLabel: `${espData.nom} (${computedMontant.toFixed(3)} DT TTC)`,
      afterData: {
        espace_id,
        unite_id,
        date_debut,
        date_fin,
        source: cleanSource,
        montant_ht: computedMontantHT,
        montant_ttc: computedMontant,
        tva_pct_applique: tvaApplique,
      },
    });

    let payment = null;
    if (computedMontant > 0 && mode_paiement !== 'quota_abonnement') {
      const validPayModes = ['cash', 'check', 'bank_transfer', 'card'];
      const paymentMode = validPayModes.includes(mode_paiement) ? mode_paiement : 'cash';
      const { data: paymentRow, error: payErr } = await supabaseAdmin
        .from('paiements')
        .insert({
          user_id: targetUserId || req.user.id,
          reservation_id: data.id,
          montant: computedMontant,
          mode: paymentMode,
          statut: 'pending',
          tenant_id: bookingTenantId,
        })
        .select('*')
        .single();

      if (payErr) {
        console.error('⚠️ Création du paiement à la réservation:', payErr.message);
      } else {
        payment = paymentRow;
      }
    }

    // CDC v3.0 §4.2 : Notifications In-App + E-mail (Manager & Client) à la création de la réservation
    try {
      const targetTenantId = bookingTenantId || req.tenantId;
      let adminsQuery = supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email')
        .in('role', ['admin', 'staff']);

      if (targetTenantId) {
        adminsQuery = adminsQuery.eq('tenant_id', targetTenantId);
      }

      const { data: admins } = await adminsQuery;
      const memberProfile = req.profile;
      const clientEmail = req.user.email || memberProfile?.email;
      const espaceNom = data.espaces?.nom || espData?.nom || 'un espace';
      const dateDebutStr = new Date(date_debut).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' }) + ' à ' + new Date(date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' });
      const clientName = `${memberProfile?.prenom || ''} ${memberProfile?.nom || ''}`.trim() || 'Client';

      // 1) Alerte Manager / Staff (In-App + Email)
      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: admin.id,
            type: 'nouvelle_demande_reservation',
            canal: 'Dashboard',
            message: `📋 Nouvelle réservation reçue de ${clientName} pour ${espaceNom} (${dateDebutStr}) — Règlement sur place.`,
          });

          if (admin.email) {
            sendEmailUniversal({
              to: admin.email,
              subject: `Nouvelle réservation reçue — ${espaceNom}`,
              text: `Bonjour ${admin.prenom || ''},\n\nUne nouvelle réservation a été reçue de ${clientName} pour ${espaceNom} le ${dateDebutStr}.\nStatut : ${initialStatut === 'confirmed' ? 'Confirmée automatiquement' : 'En attente de validation'}.\nRèglement prévu sur place.\n`,
              html: `<p>Bonjour <strong>${admin.prenom || ''}</strong>,</p><p>Une nouvelle réservation a été enregistrée :</p><ul><li><strong>Client :</strong> ${clientName}</li><li><strong>Espace :</strong> ${espaceNom}</li><li><strong>Date :</strong> ${dateDebutStr}</li><li><strong>Statut :</strong> ${initialStatut === 'confirmed' ? 'Confirmée automatiquement' : 'En attente de validation'}</li><li><strong>Règlement :</strong> Sur place à l'accueil</li></ul>`,
            }).catch(() => {});
          }
        }
      }

      // 2) Confirmation au Client (In-App + Email)
      await supabaseAdmin.from('notifications').insert({
        user_id: req.user.id,
        type: 'confirmation_demande_reservation',
        canal: 'Dashboard',
        message: `📋 Votre demande de réservation pour ${espaceNom} (${dateDebutStr}) a bien été enregistrée.`,
      });

      if (clientEmail) {
        sendEmailUniversal({
          to: clientEmail,
          subject: `Confirmation de votre demande de réservation — ${espaceNom}`,
          text: `Bonjour ${memberProfile?.prenom || ''},\n\nVotre réservation pour ${espaceNom} le ${dateDebutStr} a bien été enregistrée.\nStatut : ${initialStatut === 'confirmed' ? 'Confirmée' : 'En attente de validation'}.\nLe règlement se fera sur place à votre arrivée.\n`,
          html: `<p>Bonjour <strong>${memberProfile?.prenom || ''}</strong>,</p><p>Votre réservation pour l'espace <strong>${espaceNom}</strong> le <strong>${dateDebutStr}</strong> a bien été enregistrée.</p><p>Statut : <strong>${initialStatut === 'confirmed' ? 'Confirmée' : 'En attente de validation'}</strong>.</p><p>Le règlement s'effectuera sur place à votre arrivée.</p>`,
        }).catch(() => {});
      }
    } catch (notifErr) {
      console.error('⚠️ Notification admin/client nouvelle réservation:', notifErr.message);
    }

    res.status(201).json({ reservation: data, payment });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function cancelInfoBooking(req, res) {
  const { id } = req.params;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  try {
    const { data: reservation, error: fetchErr } = await supabaseAdmin
      .from('reservations')
      .select('*, espaces(nom, type), paiements(id, montant, statut, montant_rembourse)')
      .eq('id', id)
      .single();

    if (fetchErr || !reservation) {
      return res.status(404).json({ error: 'Réservation introuvable.' });
    }

    if (!isStaff && reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez consulter que vos propres réservations.' });
    }

    const tenantId = reservation.tenant_id || req.tenantId;
    const policy = await getCancellationPolicy(tenantId);
    const espacePolicy = await getCancellationPolicyForEspace(tenantId, reservation.espaces?.type);
    const paiement = (reservation.paiements || [])[0];
    const info = buildCancellationInfo(reservation, policy, espacePolicy, isStaff, paiement?.montant);

    res.json({
      info,
      policy: {
        delai_heures: policy.delai_heures,
        penalite_pct: policy.penalite_pct,
        annulation_membre_autorisee: policy.annulation_membre_autorisee,
        remboursement_auto: policy.remboursement_auto,
        message_membre: policy.message_membre,
        type_espace: espacePolicy ? reservation.espaces?.type : null,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function deleteBooking(req, res) {
  const { id } = req.params;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  try {
    const { data: reservation, error: fetchErr } = await supabaseAdmin
      .from('reservations')
      .select('*, espaces(nom, type), paiements(id, montant, statut, montant_rembourse)')
      .eq('id', id)
      .single();

    if (fetchErr || !reservation) {
      return res.status(404).json({ error: 'Réservation introuvable.' });
    }

    if (!isStaff && reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez annuler que vos propres réservations.' });
    }

    // Tâche 6 — Politique d'annulation : vérifier les conditions, déterminer
    // si un remboursement ou un crédit est applicable, puis les appliquer.
    const tenantId = reservation.tenant_id || req.tenantId;
    const policy = await getCancellationPolicy(tenantId);
    const espacePolicy = await getCancellationPolicyForEspace(tenantId, reservation.espaces?.type);
    const paiement = (reservation.paiements || [])[0];
    const info = buildCancellationInfo(reservation, policy, espacePolicy, isStaff, paiement?.montant);

    if (!info.allowed) {
      return res.status(403).json({
        error: info.reason || 'Annulation non autorisée.',
        policy,
        hoursUntilStart: info.hoursUntilStart,
      });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('reservations')
      .update({ statut: 'cancelled', penalite_pct: info.penalite_pct })
      .eq('id', id);

    if (updateErr) {
      return res.status(400).json({ error: updateErr.message });
    }

    let refund = { montant_rembourse: 0, montant_credit: 0, paiement_updated: false };

    if (paiement) {
      // Remboursement (cash) si la règle le prévoit
      if (info.montantRembourse > 0) {
        const { error: refundErr } = await supabaseAdmin.from('paiements').update({
          montant_rembourse: info.montantRembourse,
          statut: 'refunded',
        }).eq('id', paiement.id);
        if (refundErr) {
          console.error('⚠️ Échec enregistrement remboursement paiement:', refundErr.message);
        } else {
          refund.montant_rembourse = info.montantRembourse;
          refund.paiement_updated = true;
        }
      }

      // Crédit portefeuille (formule avec credit_portefeuille_auto)
      if (info.montantCredit > 0) {
        const { error: creditErr } = await supabaseAdmin.from('credits_membres').insert({
          tenant_id: reservation.tenant_id || tenantId,
          user_id: reservation.user_id,
          montant: info.montantCredit,
          motif: `Annulation réservation — crédit portefeuille (${reservation.espaces?.nom || 'espace'})`,
          reservation_id: reservation.id,
        });
        if (creditErr) {
          console.error('⚠️ Échec inscription crédit portefeuille:', creditErr.message);
        } else {
          const { error: statusErr } = await supabaseAdmin.from('paiements').update({
            statut: 'refunded',
          }).eq('id', paiement.id);
          if (statusErr) console.error('⚠️ Échec mise à jour statut paiement (crédit):', statusErr.message);
          refund.montant_credit = info.montantCredit;
          refund.paiement_updated = true;
        }
      }
    }

    try {
      // 1) Email + notification in-app d'annulation pour le membre
      await notifyAnnulationReservation(
        supabaseAdmin,
        {
          id: reservation.id,
          date_debut: reservation.date_debut,
          date_fin: reservation.date_fin,
          espaces: reservation.espaces
        },
        {
          id: reservation.user_id,
          nom: req.profile.nom,
          prenom: req.profile.prenom,
          email: req.user.email
        }
      );

      // 2) Notification in-app pour le membre (portail / dashboard)
      await supabaseAdmin.from('notifications').insert({
        user_id: reservation.user_id,
        type: 'annulation_reservation',
        canal: 'Dashboard',
        message: `❌ Votre réservation pour ${reservation.espaces?.nom || 'un espace'} a été annulée.`,
      });

      // 3) Notification in-app + Email pour les admins du tenant (avec résolution fiable du tenantId)
      const targetTenantId = reservation.tenant_id || req.tenantId;
      let adminsQuery = supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email')
        .in('role', ['admin', 'staff']);

      if (targetTenantId) {
        adminsQuery = adminsQuery.eq('tenant_id', targetTenantId);
      }

      const { data: admins } = await adminsQuery;
      const clientName = `${req.profile?.prenom || ''} ${req.profile?.nom || ''}`.trim() || 'Un client';

      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await supabaseAdmin.from('notifications').insert({
            user_id: admin.id,
            type: 'annulation_reservation',
            canal: 'Dashboard',
            message: `🚫 ${clientName} a annulé sa réservation pour ${reservation.espaces?.nom || 'un espace'}.`,
          });

          if (admin.email) {
            sendEmailUniversal({
              to: admin.email,
              subject: `Annulation de réservation — ${reservation.espaces?.nom || 'Espace'}`,
              text: `Bonjour ${admin.prenom || ''},\n\n${clientName} a annulé sa réservation pour ${reservation.espaces?.nom || 'un espace'}.\n`,
              html: `<p>Bonjour <strong>${admin.prenom || ''}</strong>,</p><p>Le client <strong>${clientName}</strong> a annulé sa réservation pour l'espace <strong>${reservation.espaces?.nom || 'un espace'}</strong>.</p>`,
            }).catch(() => {});
          }
        }
      }
    } catch (notifErr) {
      console.error('⚠️ Échec notification annulation réservation:', notifErr.message);
    }

    res.json({
      message: 'Réservation annulée avec succès.',
      reservation,
      penalite_pct: info.penalite_pct || 0,
      montant_rembourse: refund.montant_rembourse,
      montant_credit: refund.montant_credit,
      mode: info.mode,
    });
  } catch (err) {
    console.error('Erreur annulation réservation:', err);
    res.status(500).json({ error: err.message });
  }
}

async function checkAvailability(req, res) {
  const { espace_id, date_debut, date_fin, exclude_reservation_id, floor_plan_item_id } = req.body;

  if (!espace_id || !date_debut || !date_fin) {
    return res.status(400).json({ error: 'espace_id, date_debut et date_fin sont requis.' });
  }

  if (new Date(date_debut) >= new Date(date_fin)) {
    return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
  }

  try {
    const availability = await getBookingAvailability(espace_id, date_debut, date_fin, exclude_reservation_id, {
      exclusive: req.body.exclusive === true || req.body.exclusive === 'true',
      floorPlanItemId: floor_plan_item_id || null,
    });
    res.json({
      isAvailable: availability.isAvailable,
      overlapsCount: availability.overlappingCount,
      remaining: availability.remaining,
      capacity: availability.capacity,
      shared: availability.shared,
      spaceType: availability.spaceType,
      message: availability.isAvailable
        ? (availability.shared
          ? `${availability.remaining} place${availability.remaining > 1 ? 's' : ''} restante${availability.remaining > 1 ? 's' : ''} sur ${availability.capacity} (open space partagé).`
          : 'Ce créneau est disponible.')
        : availability.conflictMessage,
    });
  } catch (err) {
    console.error('Erreur disponibilité:', err);
    res.status(500).json({ error: err.message });
  }
}

async function listBookings(req, res) {
  const isSuperAdmin = req.profile.role === 'super_admin';
  const isStaff = ['admin', 'staff'].includes(req.profile.role);
  const { statut, espace_id, from, to, include_archived } = req.query;
  const withArchived = include_archived === 'true' || include_archived === '1';

  try {
    if (req.tenantId && isStaff) {
      await sweepExpiredConfirmations({ supabaseAdmin, tenantId: req.tenantId }).catch(() => {});
    }

    let query = supabaseAdmin
      .from('reservations')
      .select('*, espaces(nom, type, tarif_horaire, tenant_id), profiles!user_id(nom, prenom, email, telephone, role), guests(nom, prenom, email, telephone), paiements(id, statut, mode, montant), sessions(id, statut, check_in, check_out, started_at)')
      .order('created_at', { ascending: false });

    if (isSuperAdmin) {
      // Super admin a accès à toutes les réservations
    } else if (isStaff) {
      // Admin et Staff ne voient QUE les réservations de leurs propres espaces
      if (req.tenantId) {
        const { data: tenantEspaces } = await supabaseAdmin
          .from('espaces')
          .select('id')
          .eq('tenant_id', req.tenantId);

        const espaceIds = (tenantEspaces || []).map((e) => e.id);

        if (espaceIds.length > 0) {
          query = query.in('espace_id', espaceIds);
        } else {
          return res.json({ reservations: [] });
        }
      } else {
        query = query.eq('user_id', req.user.id);
      }
    } else {
      // Membre régulier ne voit que ses propres réservations
      query = query.eq('user_id', req.user.id);
    }

    if (statut) query = query.eq('statut', statut);
    if (espace_id) query = query.eq('espace_id', espace_id);
    if (from) query = query.gte('date_debut', from);
    if (to) query = query.lte('date_debut', to);

    let { data, error } = await query;
    if (error && (error.code === 'PGRST200' || /relationship|column/i.test(error.message))) {
      let fb = supabaseAdmin
        .from('reservations')
        .select('*, espaces(nom, type, tarif_horaire, tenant_id)')
        .order('created_at', { ascending: false });
      if (!isSuperAdmin) {
        fb = fb.or(`membre_id.eq.${req.user.id},user_id.eq.${req.user.id}`);
      }
      if (statut) fb = fb.eq('statut', statut);
      if (espace_id) fb = fb.eq('espace_id', espace_id);
      if (from) fb = fb.gte('date_debut', from);
      if (to) fb = fb.lte('date_debut', to);
      const fbRes = await fb;
      data = fbRes.data || [];
      error = fbRes.error;

      if (error) {
        const fbRes2 = await supabaseAdmin.from('reservations').select('*').eq('membre_id', req.user.id);
        data = fbRes2.data || [];
        error = fbRes2.error;
      }
    }
    if (error) {
      console.warn('⚠️ listBookings warning:', error.message);
      return res.json({ reservations: [] });
    }

    const rawRows = withArchived ? (data || []) : (data || []).filter((b) => !b.archived_at);
    const tenantUnits = req.tenantId ? await loadSpaceUnitsForTenant(supabaseAdmin, req.tenantId) : [];
    const unitById = new Map(tenantUnits.map((u) => [u.id, u]));

    const reservations = rawRows.map((b) => {
      const hours = Math.max(0, (new Date(b.date_fin) - new Date(b.date_debut)) / (1000 * 60 * 60));
      const tarif = parseFloat(b.espaces?.tarif_horaire) || 0;
      const computedMontant = b.montant_ttc ?? b.montant_total ?? parseFloat((hours * tarif).toFixed(3));
      return {
        ...b,
        montant_total: Number(computedMontant),
        ...(b.unite_id && unitById.has(b.unite_id) ? { unite: unitById.get(b.unite_id) } : {}),
      };
    });

    res.json({ reservations });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function getBookingsOccupation(req, res) {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Paramètres from et to requis (ISO date).' });
  }

  const isSuperAdmin = req.profile.role === 'super_admin';

  try {
    let espQuery = supabaseAdmin.from('espaces').select('id, nom, type, capacite');
    if (!isSuperAdmin && req.tenantId) {
      espQuery = espQuery.eq('tenant_id', req.tenantId);
    }
    const { data: espaces, error: espErr } = await espQuery;
    if (espErr) return res.status(500).json({ error: espErr.message });

    const espaceIds = (espaces || []).map((e) => e.id);

    let resQuery = supabaseAdmin
      .from('reservations')
      .select('id, espace_id, date_debut, date_fin, statut')
      .in('statut', ['confirmed', 'pending'])
      .gte('date_debut', from)
      .lte('date_debut', to);

    if (!isSuperAdmin && req.tenantId && espaceIds.length > 0) {
      resQuery = resQuery.in('espace_id', espaceIds);
    }

    const { data: reservations, error: resErr } = await resQuery;
    if (resErr) return res.status(500).json({ error: resErr.message });

    const periodMs = new Date(to).getTime() - new Date(from).getTime();
    const report = (espaces || []).map((espace) => {
      const espaceReservations = (reservations || []).filter((r) => r.espace_id === espace.id);
      const reservedMs = espaceReservations.reduce((acc, r) => {
        return acc + (new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime());
      }, 0);
      const taux = periodMs > 0 ? Math.min(100, (reservedMs / periodMs) * 100) : 0;

      return {
        espace_id: espace.id,
        nom: espace.nom,
        type: espace.type,
        capacite: espace.capacite,
        reservations_count: espaceReservations.length,
        taux_occupation_pct: Number(taux.toFixed(1)),
      };
    });

    res.json({ from, to, report });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function updateBooking(req, res) {
  const { id } = req.params;
  const { date_debut, date_fin, statut, motif_annulation, motif_retroactif, override_conflit } = req.body;
  const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile.role);

  try {
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Réservation introuvable.' });
    }

    if (!isStaff && existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Modification non autorisée.' });
    }

    const [{ data: payRows }, { data: sesRows }] = await Promise.all([
      supabaseAdmin.from('paiements').select('id, statut, montant_encaisse').eq('reservation_id', id),
      supabaseAdmin.from('sessions').select('id, check_in').eq('reservation_id', id).not('check_in', 'is', null).limit(1),
    ]);
    const existingPaid = (payRows || []).some((p) =>
      ['paid', 'succeeded', 'partial'].includes(String(p.statut || '').toLowerCase()) || Number(p.montant_encaisse || 0) > 0
    );
    const existingCheckedIn = (sesRows || []).length > 0;

    if (isStaff && (date_debut || date_fin || override_conflit || existingPaid || existingCheckedIn)) {
      assertManagerGuards({
        actorRole: req.profile.role,
        dateDebut: date_debut || existing.date_debut,
        existingBooking: existing,
        existingPaid,
        existingCheckedIn,
        overrideConflit: Boolean(override_conflit),
        motifRetroactif: motif_retroactif,
      });
    }

    const newDebut = date_debut || existing.date_debut;
    const newFin = date_fin || existing.date_fin;

    if (new Date(newDebut) >= new Date(newFin)) {
      return res.status(400).json({ error: 'date_fin doit être postérieure à date_debut.' });
    }

    if ((date_debut || date_fin) && !override_conflit) {
      const { data: espace } = await supabaseAdmin.from('espaces').select('*').eq('id', existing.espace_id).single();
      const tid = existing.tenant_id || req.tenantId;
      const tamponMinutes = await getTenantTamponMinutes(supabaseAdmin, tid);
      const units = tid ? await loadSpaceUnitsForTenant(supabaseAdmin, tid, existing.espace_id) : [];
      const targetUnite = existing.unite_id ? units.find((u) => u.id === existing.unite_id) : null;
      const bufCheck = await checkAvailabilityWithBuffer({
        supabaseAdmin,
        tenantId: tid,
        espace: espace || { id: existing.espace_id, type: 'open_space', capacite: 1, nom: 'Espace' },
        unite: targetUnite,
        dateDebut: newDebut,
        dateFin: newFin,
        tamponMinutes,
        excludeReservationId: id,
      });
      if (!bufCheck.isAvailable) {
        return res.status(409).json({
          error: bufCheck.reason,
          conflict: true,
          alternatives: bufCheck.alternatives,
        });
      }
    }

    const updates = {};
    if (date_debut) updates.date_debut = date_debut;
    if (date_fin) updates.date_fin = date_fin;
    if (motif_annulation !== undefined) updates.motif_annulation = String(motif_annulation || '').trim() || null;
    if (motif_retroactif) updates.motif_retroactif = String(motif_retroactif).trim();
    if (statut && isStaff) {
      const VALID_BOOKING_STATUSES = [
        'pending',
        'en_attente_confirmation',
        'confirmed',
        'refused',
        'cancelled',
        'completed',
        'no_show',
        'waitlisted',
      ];
      if (!VALID_BOOKING_STATUSES.includes(statut)) {
        return res.status(400).json({ error: 'statut invalide.' });
      }
      if (statut === 'confirmed' && existing.statut === 'en_attente_confirmation') {
        updates.confirmation_expires_at = null;
      }
      if (statut === 'no_show') {
        const noShowCheck = await canMarkReservationNoShow(id);
        if (!noShowCheck.allowed) {
          return res.status(400).json({ error: noShowCheck.reason });
        }
        updates.no_show = true;
      }
      updates.statut = statut;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Aucune mise à jour fournie.' });
    }

    let { data, error } = await supabaseAdmin
      .from('reservations')
      .update(updates)
      .eq('id', id)
      .select('*, espaces(nom, type)')
      .single();
    if (error && /column|does not exist/i.test(error.message || '')) {
      const cleanUpd = { ...updates };
      delete cleanUpd.motif_annulation;
      delete cleanUpd.motif_retroactif;
      delete cleanUpd.confirmation_expires_at;
      ({ data, error } = await supabaseAdmin
        .from('reservations')
        .update(cleanUpd)
        .eq('id', id)
        .select('*, espaces(nom, type)')
        .single());
    }

    if (error) return res.status(400).json({ error: error.message });

    // Si l'admin confirme la réservation → notifier le membre par email + in-app
    if (updates.statut === 'confirmed') {
      try {
        const { data: memberProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, nom, prenom, email')
          .eq('id', data.user_id)
          .single();

        let memberEmail = memberProfile?.email;
        if (!memberEmail) {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
          memberEmail = authUser?.user?.email;
        }

        if (memberProfile && memberEmail) {
          const modeLabel = 'sur place à l\'accueil (espèces, chèque ou virement)';

          // 1) Email de confirmation (enregistre aussi la notification en base avec canal: 'Email')
          await notifyConfirmationReservation(
            supabaseAdmin,
            {
              id: data.id,
              date_debut: data.date_debut,
              date_fin: data.date_fin,
              espaces: data.espaces,
              mode: data.mode,
            },
            { ...memberProfile, email: memberEmail }
          );

          // 2) Notification in-app pour le dashboard du membre
          await supabaseAdmin.from('notifications').insert({
            user_id: data.user_id,
            type: 'confirmation_reservation',
            canal: 'Dashboard',
            message: `✅ Votre réservation pour ${data.espaces?.nom || 'l\'espace'} a été acceptée ! Paiement : ${modeLabel}.`,
          });
        }
      } catch (notifErr) {
        console.error('⚠️ Échec notification confirmation réservation:', notifErr.message);
      }
    }

    // Si l'admin annule la réservation → notifier le membre
    if (updates.statut === 'cancelled') {
      try {
        const { data: memberProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, nom, prenom, email')
          .eq('id', data.user_id)
          .single();

        let memberEmail = memberProfile?.email;
        if (!memberEmail) {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
          memberEmail = authUser?.user?.email;
        }

        if (memberProfile && memberEmail) {
          // 1) Email d'annulation
          await notifyAnnulationReservation(
            supabaseAdmin,
            {
              id: data.id,
              date_debut: data.date_debut,
              date_fin: data.date_fin,
              espaces: data.espaces,
            },
            { ...memberProfile, email: memberEmail }
          );

          // 2) Notification in-app
          await supabaseAdmin.from('notifications').insert({
            user_id: data.user_id,
            type: 'annulation_reservation',
            canal: 'Dashboard',
            message: `❌ Votre réservation pour ${data.espaces?.nom || 'l\'espace'} a été annulée par l'administrateur.`,
          });
        }
      } catch (notifErr) {
        console.error('⚠️ Échec notification annulation réservation (admin):', notifErr.message);
      }
    }

    // Si l'admin refuse la réservation → notifier le membre in-app + Email (CDC v3.0)
    if (updates.statut === 'refused' && data.user_id) {
      try {
        await supabaseAdmin.from('notifications').insert({
          user_id: data.user_id,
          type: 'refus_reservation',
          canal: 'Dashboard',
          message: `❌ Votre demande de réservation pour ${data.espaces?.nom || 'l\'espace'} a été refusée par l'établissement.`,
        });

        const { data: memberProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, nom, prenom, email')
          .eq('id', data.user_id)
          .single();

        let memberEmail = memberProfile?.email;
        if (!memberEmail) {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
          memberEmail = authUser?.user?.email;
        }

        if (memberEmail) {
          sendEmailUniversal({
            to: memberEmail,
            subject: `Information sur votre demande de réservation — ${data.espaces?.nom || 'Espace'}`,
            text: `Bonjour ${memberProfile?.prenom || ''},\n\nVotre demande de réservation pour l'espace ${data.espaces?.nom || 'un espace'} n'a malheureusement pas pu être acceptée par l'établissement.\n`,
            html: `<p>Bonjour <strong>${memberProfile?.prenom || ''}</strong>,</p><p>Votre demande de réservation pour l'espace <strong>${data.espaces?.nom || 'un espace'}</strong> n'a pas pu être acceptée par l'établissement.</p><p>Nous vous invitons à consulter les disponibilités pour un autre créneau ou un autre espace.</p>`,
          }).catch(() => {});
        }
      } catch (notifErr) {
        console.error('⚠️ Échec notification refus réservation:', notifErr.message);
      }
    }

    await logActivity({
      tenantId: data?.tenant_id || req.tenantId,
      req,
      action: updates.statut ? 'changement_statut' : 'modification',
      entityType: 'reservation',
      entityId: id,
      entityLabel: `${data?.espaces?.nom || 'Réservation'} (${updates.statut || 'horaires'})`,
      beforeData: { statut: existing.statut, date_debut: existing.date_debut, date_fin: existing.date_fin },
      afterData: updates,
    });

    res.json({ reservation: data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

// POST /api/bookings/check-slots — Créneaux disponibles selon horaires d'ouverture & tampon
async function checkSlots(req, res) {
  try {
    const { espace_id, unite_id = null, date, duration_minutes = 60, nb_participants = 1 } = req.body || {};
    if (!espace_id || !date) {
      return res.status(400).json({ error: 'espace_id et date (YYYY-MM-DD) sont requis.' });
    }

    let espRes = await supabaseAdmin
      .from('espaces')
      .select('id, tenant_id, nom, type, capacite, horaires, tarif_horaire, tarif_horaire_ht, tva_pct, actif')
      .eq('id', espace_id)
      .maybeSingle();
    if (espRes.error && /column/i.test(espRes.error.message || '')) {
      espRes = await supabaseAdmin.from('espaces').select('id, tenant_id, nom, type, capacite, tarif_horaire, actif').eq('id', espace_id).maybeSingle();
    }
    const espace = espRes.data;
    if (!espace) return res.status(404).json({ error: 'Espace introuvable.' });

    const tenantId = espace.tenant_id || req.tenantId;
    const tamponMinutes = await getTenantTamponMinutes(supabaseAdmin, tenantId);
    const units = tenantId ? await loadSpaceUnitsForTenant(supabaseAdmin, tenantId, espace_id) : [];

    const dayStartIso = new Date(tunisLocalYmdToUtcMs(date, 0, 0)).toISOString();
    const dayEndIso = new Date(tunisLocalYmdToUtcMs(date, 23, 59)).toISOString();
    const { data: dayRows } = await supabaseAdmin
      .from('reservations')
      .select('id, unite_id, date_debut, date_fin, statut')
      .eq('espace_id', espace_id)
      .in('statut', ['pending', 'confirmed', 'en_attente_confirmation'])
      .lt('date_debut', dayEndIso)
      .gt('date_fin', dayStartIso);

    const busy = (dayRows || []).filter((r) => (!unite_id ? true : (!r.unite_id || r.unite_id === unite_id)));
    const slots = findAlternativeSlots({
      dateYmd: date,
      durationMinutes: Number(duration_minutes) || 60,
      horaires: espace.horaires || '08:00 - 20:00',
      busyIntervals: busy,
      bufferMinutes: tamponMinutes,
      maxResults: 24,
      stepMinutes: 30,
      skipPast: false,
    });

    res.json({
      espace,
      date,
      horaires: espace.horaires || '08:00 - 20:00',
      tampon_minutes: tamponMinutes,
      available_slots: slots,
      units_status: units.map((u) => ({
        id: u.id,
        code: u.code,
        nom: u.nom,
        type_unite: u.type_unite,
        capacite: u.capacite,
        statut: u.statut,
        date_retour_auto: u.date_retour_auto || null,
      })),
      nb_participants: Number(nb_participants) || 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/bookings/:id/move — Déplacement atomique d'une réservation
async function moveBooking(req, res) {
  try {
    const { id } = req.params;
    const { date_debut, date_fin, unite_id, espace_id, override_conflit = false, motif_retroactif = '' } = req.body || {};

    const { data: existing, error: fetchErr } = await supabaseAdmin.from('reservations').select('*').eq('id', id).single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Réservation introuvable.' });

    const [{ data: payRows }, { data: sesRows }] = await Promise.all([
      supabaseAdmin.from('paiements').select('id, statut, montant_encaisse').eq('reservation_id', id),
      supabaseAdmin.from('sessions').select('id, check_in').eq('reservation_id', id).not('check_in', 'is', null).limit(1),
    ]);
    const existingPaid = (payRows || []).some((p) =>
      ['paid', 'succeeded', 'partial'].includes(String(p.statut || '').toLowerCase()) || Number(p.montant_encaisse || 0) > 0
    );
    const existingCheckedIn = (sesRows || []).length > 0;

    const nextDebut = date_debut || existing.date_debut;
    const nextFin = date_fin || existing.date_fin;
    const nextEspaceId = espace_id || existing.espace_id;
    const nextUniteId = unite_id !== undefined ? (unite_id || null) : existing.unite_id;

    assertManagerGuards({
      actorRole: req.profile?.role,
      dateDebut: nextDebut,
      existingBooking: existing,
      existingPaid,
      existingCheckedIn,
      overrideConflit: Boolean(override_conflit),
      motifRetroactif: motif_retroactif,
    });

    const { data: espace } = await supabaseAdmin.from('espaces').select('*').eq('id', nextEspaceId).single();
    if (!espace) return res.status(404).json({ error: 'Espace cible introuvable.' });

    const tid = existing.tenant_id || req.tenantId || espace.tenant_id;
    const tamponMinutes = await getTenantTamponMinutes(supabaseAdmin, tid);
    const units = tid ? await loadSpaceUnitsForTenant(supabaseAdmin, tid, nextEspaceId) : [];
    const targetUnite = nextUniteId ? units.find((u) => u.id === nextUniteId) : null;

    if (!override_conflit) {
      const check = await checkAvailabilityWithBuffer({
        supabaseAdmin,
        tenantId: tid,
        espace,
        unite: targetUnite,
        dateDebut: nextDebut,
        dateFin: nextFin,
        tamponMinutes,
        excludeReservationId: id,
      });
      if (!check.isAvailable) {
        return res.status(409).json({
          error: check.reason,
          conflict: true,
          alternatives: check.alternatives,
        });
      }
    }

    const patch = {
      espace_id: nextEspaceId,
      unite_id: nextUniteId,
      date_debut: nextDebut,
      date_fin: nextFin,
      ...(targetUnite?.floor_plan_item_id ? { floor_plan_item_id: targetUnite.floor_plan_item_id } : {}),
    };
    let { data: updated, error: updErr } = await supabaseAdmin
      .from('reservations')
      .update(patch)
      .eq('id', id)
      .select('*, espaces(nom, type)')
      .single();
    if (updErr && /column|does not exist/i.test(updErr.message || '')) {
      ({ data: updated, error: updErr } = await supabaseAdmin
        .from('reservations')
        .update({ espace_id: nextEspaceId, date_debut: nextDebut, date_fin: nextFin })
        .eq('id', id)
        .select('*, espaces(nom, type)')
        .single());
    }
    if (updErr) return res.status(400).json({ error: updErr.message });

    await logActivity({
      tenantId: tid,
      req,
      action: 'deplacement',
      entityType: 'reservation',
      entityId: id,
      entityLabel: `${espace.nom}${targetUnite ? ` (${targetUnite.code})` : ''}`,
      beforeData: { espace_id: existing.espace_id, unite_id: existing.unite_id, date_debut: existing.date_debut, date_fin: existing.date_fin },
      afterData: patch,
    });

    res.json({ reservation: updated, message: 'Réservation déplacée avec succès.' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

// POST /api/bookings/:id/extend — Prolongation facturable en ligne / admin si créneau suivant libre
async function extendBooking(req, res) {
  try {
    const { id } = req.params;
    const minutes = Math.max(15, Math.min(480, parseInt(req.body?.minutes, 10) || 60));

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('reservations')
      .select('*, espaces(id, nom, type, capacite, horaires, tarif_horaire, tarif_horaire_ht, tva_pct, tenant_id)')
      .eq('id', id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Réservation introuvable.' });

    const isStaff = ['super_admin', 'admin', 'staff'].includes(req.profile?.role);
    if (!isStaff && existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Prolongation non autorisée.' });
    }

    const oldEndMs = new Date(existing.date_fin).getTime();
    const newEndIso = new Date(oldEndMs + minutes * 60 * 1000).toISOString();
    const tid = existing.tenant_id || req.tenantId || existing.espaces?.tenant_id;
    const tamponMinutes = await getTenantTamponMinutes(supabaseAdmin, tid);
    const units = tid ? await loadSpaceUnitsForTenant(supabaseAdmin, tid, existing.espace_id) : [];
    const targetUnite = existing.unite_id ? units.find((u) => u.id === existing.unite_id) : null;

    const avail = await checkAvailabilityWithBuffer({
      supabaseAdmin,
      tenantId: tid,
      espace: existing.espaces || { id: existing.espace_id, type: 'open_space', capacite: 1, nom: 'Espace' },
      unite: targetUnite,
      dateDebut: existing.date_fin,
      dateFin: newEndIso,
      tamponMinutes,
      excludeReservationId: id,
    });
    if (!avail.isAvailable) {
      return res.status(409).json({
        error: avail.reason || 'Le créneau suivant est déjà occupé.',
        conflict: true,
        alternatives: avail.alternatives,
      });
    }

    const tva = Number(existing.tva_pct_applique ?? existing.espaces?.tva_pct ?? DEFAULT_TVA_PCT);
    const tarifTTC = roundMillime(existing.espaces?.tarif_horaire || 0);
    const tarifHT = existing.tarif_applique_ht != null
      ? roundMillime(existing.tarif_applique_ht)
      : (existing.espaces?.tarif_horaire_ht != null ? roundMillime(existing.espaces.tarif_horaire_ht) : computeHTFromTTC(tarifTTC, tva));

    const extraHT = roundMillime((minutes / 60) * tarifHT);
    const extraTTC = computeTTC(extraHT, tva);
    const nextHT = roundMillime(Number(existing.montant_ht || 0) + extraHT);
    const nextTTC = roundMillime(Number(existing.montant_ttc ?? existing.montant_total ?? 0) + extraTTC);

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('reservations')
      .update({
        date_fin: newEndIso,
        montant_ht: nextHT,
        montant_ttc: nextTTC,
        montant_total: nextTTC,
      })
      .eq('id', id)
      .select('*, espaces(nom, type)')
      .single();

    if (updErr && /column|does not exist/i.test(updErr.message || '')) {
      const { data: fbUpd, error: fbErr } = await supabaseAdmin
        .from('reservations')
        .update({ date_fin: newEndIso, montant_total: nextTTC })
        .eq('id', id)
        .select('*, espaces(nom, type)')
        .single();
      if (fbErr) return res.status(400).json({ error: fbErr.message });
      Object.assign(existing, fbUpd);
    } else if (updErr) {
      return res.status(400).json({ error: updErr.message });
    }

    let supplementPayment = null;
    if (extraTTC > 0 && existing.user_id) {
      const { data: payRow } = await supabaseAdmin
        .from('paiements')
        .insert({
          user_id: existing.user_id,
          reservation_id: id,
          montant: extraTTC,
          mode: 'cash',
          statut: 'pending',
          tenant_id: tid,
          reference_externe: `PROLONGATION-${minutes}MIN`,
        })
        .select('*')
        .maybeSingle();
      supplementPayment = payRow || null;
    }

    await logActivity({
      tenantId: tid,
      req,
      action: 'prolongation',
      entityType: 'reservation',
      entityId: id,
      entityLabel: `+${minutes} min (${extraTTC.toFixed(3)} DT TTC)`,
      beforeData: { date_fin: existing.date_fin },
      afterData: { date_fin: newEndIso, supplement_ht: extraHT, supplement_ttc: extraTTC },
    });

    res.json({
      reservation: updated || { ...existing, date_fin: newEndIso },
      supplement_ht: extraHT,
      supplement_ttc: extraTTC,
      payment: supplementPayment,
      message: `Réservation prolongée de ${minutes} min (+${extraTTC.toFixed(3)} DT TTC).`,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

// POST /api/bookings/:id/archive — Soft-archive uniquement
async function archiveBooking(req, res) {
  try {
    const { id } = req.params;
    if (!isManagerRole(req.profile?.role)) {
      return res.status(403).json({ error: 'Seul un Responsable peut archiver une réservation.' });
    }
    const { data: existing, error: fetchErr } = await supabaseAdmin.from('reservations').select('*').eq('id', id).single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Réservation introuvable.' });

    const isFutureConfirmed = existing.statut === 'confirmed' && new Date(existing.date_fin).getTime() > Date.now();
    if (isFutureConfirmed) {
      return res.status(409).json({
        error: 'Impossible d\'archiver une réservation confirmée à venir. Annulez-la d\'abord avec un motif.',
      });
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from('reservations')
      .update({ archived_at: nowIso, archived_by: req.user?.id || null })
      .eq('id', id);

    if (updErr && /column|does not exist/i.test(updErr.message || '')) {
      return res.json({ archived: false, message: 'Colonne archived_at absente avant migration SQL.' });
    }
    if (updErr) return res.status(400).json({ error: updErr.message });

    await logActivity({
      tenantId: existing.tenant_id || req.tenantId,
      req,
      action: 'archivage',
      entityType: 'reservation',
      entityId: id,
      entityLabel: `Réservation ${id.slice(0, 8)}`,
    });

    res.json({ archived: true, archived_at: nowIso, message: 'Réservation archivée.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getBookingsCalendar,
  createBooking,
  deleteBooking,
  cancelInfoBooking,
  checkAvailability,
  checkSlots,
  listBookings,
  getBookingsOccupation,
  updateBooking,
  moveBooking,
  extendBooking,
  archiveBooking,
};
