/**
 * Automatisations P1 LOT 4 — idempotentes et compatibles serverless & cron :
 * 1. Passage automatique des abonnements actifs à J-7 en statut `a_renouveler`
 * 2. Passage automatique des abonnements dépassés en statut `expired`
 *    (RÈGLE STRICTE LOT 4 : ne JAMAIS passer un abonnement en `suspended` automatiquement)
 * 3. Expiration automatique des réservations "En attente de confirmation" dépassant 2h (paramétrable)
 * 4. Proposition de No-show (Absent) 15 min après le début UNIQUEMENT si aucun paiement partiel/total et aucun check-in
 * 5. Alerte de clôture des sessions encore ouvertes à l'heure de fermeture
 *
 * Chaque événement crée des notifications dédupliquées avec `target_url` vers la vue admin correspondante.
 */

const cron = require('node-cron');
const { canMarkReservationNoShow } = require('../models/helpers');
const { getUnpaidBlockingConfig } = require('../models/financeHelpers');
const { sweepPastConfirmedReservations } = require('../models/bookingAvailability');

const lastSweepByTenant = new Map();
const THROTTLE_MS = 60 * 1000;

async function createDedupAdminNotifications(supabaseAdmin, {
  tenantId,
  titre,
  message,
  type = 'warning',
  targetUrl = '/admin/dashboard',
  dedupKey,
  metadata = {},
}) {
  if (!tenantId || !dedupKey) return 0;

  const { data: staffUsers } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('tenant_id', tenantId)
    .in('role', ['super_admin', 'admin', 'staff']);

  const recipients = staffUsers || [];
  if (recipients.length === 0) return 0;

  let created = 0;
  for (const u of recipients) {
    // Vérifier doublon via metadata/dedup_key ou titre+message sur les dernières 24h (pré-migration inclus)
    const { data: existing } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', u.id)
      .gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString())
      .limit(40);

    const msgSnippet = String(message || '').slice(0, 40);
    const alreadyExists = (existing || []).some(
      (n) =>
        n.dedup_key === dedupKey ||
        n.metadata?.dedup_key === dedupKey ||
        (n.titre === titre && msgSnippet && String(n.message || '').includes(msgSnippet))
    );
    if (alreadyExists) continue;

    const payloadFull = {
      user_id: u.id,
      tenant_id: tenantId,
      titre,
      message,
      type,
      lu: false,
      target_url: targetUrl,
      dedup_key: dedupKey,
      metadata: { ...metadata, dedup_key: dedupKey, target_url: targetUrl },
    };

    let { error } = await supabaseAdmin.from('notifications').insert(payloadFull);
    if (error && /column|does not exist|schema cache/i.test(error.message || '')) {
      await supabaseAdmin.from('notifications').insert({
        user_id: u.id,
        titre,
        message: targetUrl ? `${message} [Lien: ${targetUrl}]` : message,
        type,
        lu: false,
      });
    }
    created += 1;
  }

  return created;
}

/**
 * Exécute les règles P1 LOT 4 sur un établissement (appelé manuellement, par cron ou en déclenchement opportuniste).
 */
async function runLot4AutomationsForTenant(supabaseAdmin, tenantId, options = {}) {
  if (!tenantId) return { skipped: true };

  if (!options.force) {
    const last = lastSweepByTenant.get(tenantId) || 0;
    if (Date.now() - last < THROTTLE_MS) {
      return { skipped: true, reason: 'throttled' };
    }
  }
  lastSweepByTenant.set(tenantId, Date.now());

  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  const in7DaysIso = new Date(now.getTime() + 7 * 86400000).toISOString();

  const summary = {
    subscriptions_to_renew: 0,
    subscriptions_expired: 0,
    unconfirmed_bookings_expired: 0,
    noshow_proposals: 0,
    closing_sessions_alerted: 0,
    notifications_created: 0,
  };

  const { data: tenantRow } = await supabaseAdmin
    .from('tenants')
    .select('id, nom, settings, horaires_ouverture')
    .eq('id', tenantId)
    .maybeSingle();

  const rules = getUnpaidBlockingConfig(tenantRow?.settings || {});
  const archivedSubs = new Set(Array.isArray(tenantRow?.settings?.archived_subscriptions) ? tenantRow.settings.archived_subscriptions : []);

  // 1 & 2. Abonnements : J-7 -> a_renouveler, dépassé -> expired (JAMAIS suspended automatiquement)
  const { data: subs } = await supabaseAdmin
    .from('abonnements')
    .select('*, profiles(nom, prenom)')
    .eq('tenant_id', tenantId)
    .in('statut', ['active', 'actif', 'a_renouveler']);

  for (const sub of subs || []) {
    if (sub.archived_at || archivedSubs.has(sub.id) || !sub.date_fin) continue;
    const endDate = new Date(sub.date_fin);
    if (Number.isNaN(endDate.getTime())) continue;

    const subLabel = sub.type || sub.type_abonnement || 'Contrat';
    const memberName = sub.profiles ? `${sub.profiles.prenom || ''} ${sub.profiles.nom || ''}`.trim() : 'Membre';
    if (endDate < now) {
      await supabaseAdmin.from('abonnements').update({ statut: 'expired' }).eq('id', sub.id);
      summary.subscriptions_expired += 1;
      summary.notifications_created += await createDedupAdminNotifications(supabaseAdmin, {
        tenantId,
        titre: 'Abonnement expiré',
        message: `L'abonnement de ${memberName} (${subLabel}) est arrivé à échéance.`,
        type: 'warning',
        targetUrl: '/admin/subscriptions?tab=expired',
        dedupKey: `lot4_sub_expired_${sub.id}`,
        metadata: { subscription_id: sub.id },
      });
    } else if (endDate <= new Date(in7DaysIso) && sub.statut !== 'a_renouveler') {
      await supabaseAdmin.from('abonnements').update({ statut: 'a_renouveler' }).eq('id', sub.id);
      summary.subscriptions_to_renew += 1;
      summary.notifications_created += await createDedupAdminNotifications(supabaseAdmin, {
        tenantId,
        titre: 'Abonnement à renouveler (J-7)',
        message: `L'abonnement de ${memberName} expire dans moins de 7 jours.`,
        type: 'info',
        targetUrl: '/admin/subscriptions?tab=a_renouveler',
        dedupKey: `lot4_sub_j7_${sub.id}`,
        metadata: { subscription_id: sub.id },
      });
    }
  }

  // 3. Expiration des réservations « En attente de confirmation » > X heures (défaut 2h)
  const { data: pendingBookings } = await supabaseAdmin
    .from('reservations')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('statut', ['pending', 'en_attente_confirmation']);

  for (const b of pendingBookings || []) {
    const expiryMs = b.confirmation_expires_at
      ? new Date(b.confirmation_expires_at).getTime()
      : new Date(b.created_at).getTime() + rules.unconfirmed_booking_expiry_hours * 3600000;
    if (Number.isFinite(expiryMs) && now.getTime() > expiryMs && b.statut === 'en_attente_confirmation') {
      await supabaseAdmin
        .from('reservations')
        .update({
          statut: 'cancelled',
          motif_annulation: 'Expiration automatique du délai de confirmation téléphonique.',
        })
        .eq('id', b.id);
      summary.unconfirmed_bookings_expired += 1;
      summary.notifications_created += await createDedupAdminNotifications(supabaseAdmin, {
        tenantId,
        titre: 'Réservation expirée (non confirmée)',
        message: `Une réservation en attente de confirmation par téléphone a expiré et son créneau a été libéré.`,
        type: 'info',
        targetUrl: '/admin/bookings',
        dedupKey: `lot4_booking_unconfirmed_expired_${b.id}`,
        metadata: { reservation_id: b.id },
      });
    }
  }

  // 3b. Transitions automatiques des réservations passées (jamais rester "confirmed" après date_fin)
  await sweepPastConfirmedReservations(supabaseAdmin, { tenantId, force: true }).catch(() => {});

  // 4. Proposition de No-show 15 min après le début (uniquement si 0 paiement et 0 check-in)
  const noshowCutoffIso = new Date(now.getTime() - rules.auto_proposal_noshow_minutes * 60000).toISOString();
  const { data: lateBookings } = await supabaseAdmin
    .from('reservations')
    .select('id, date_debut, statut, espaces(nom), profiles!user_id(nom, prenom)')
    .eq('tenant_id', tenantId)
    .eq('statut', 'confirmed')
    .lte('date_debut', noshowCutoffIso)
    .gte('date_debut', new Date(now.getTime() - 24 * 3600000).toISOString())
    .limit(25);

  for (const b of lateBookings || []) {
    const guard = await canMarkReservationNoShow(b.id);
    if (!guard.allowed) continue; // Règle métier stricte : jamais de No-show si paiement ou check-in existant

    summary.noshow_proposals += 1;
    const clientLabel = b.profiles ? `${b.profiles.prenom || ''} ${b.profiles.nom || ''}`.trim() : 'Client';
    summary.notifications_created += await createDedupAdminNotifications(supabaseAdmin, {
      tenantId,
      titre: 'Proposition No-show (Absent)',
      message: `${clientLabel} ne s'est pas présenté(e) pour ${b.espaces?.nom || 'sa réservation'} (+${rules.auto_proposal_noshow_minutes} min). Action requise.`,
      type: 'warning',
      targetUrl: '/admin/bookings',
      dedupKey: `lot4_noshow_prop_${b.id}`,
      metadata: { reservation_id: b.id, proposal: 'no_show' },
    });
  }

  // 5. Clôture / alerte sessions ouvertes en dépassement ou à l'heure de fermeture
  const { data: openSessions } = await supabaseAdmin
    .from('sessions')
    .select('*, reservations(date_fin, espaces(nom)), profiles!user_id(nom, prenom)')
    .eq('tenant_id', tenantId)
    .is('check_out', null)
    .limit(30);

  for (const s of openSessions || []) {
    const plannedEnd = s.reservations?.date_fin ? new Date(s.reservations.date_fin) : null;
    if (plannedEnd && now.getTime() > plannedEnd.getTime() + 15 * 60000) {
      summary.closing_sessions_alerted += 1;
      const clientLabel = s.profiles ? `${s.profiles.prenom || ''} ${s.profiles.nom || ''}`.trim() : 'Client';
      summary.notifications_created += await createDedupAdminNotifications(supabaseAdmin, {
        tenantId,
        titre: 'Session encore ouverte après l’heure prévue',
        message: `La session de ${clientLabel} (${s.reservations?.espaces?.nom || 'Espace'}) dépasse son horaire prévu — pensez à effectuer le check-out.`,
        type: 'warning',
        targetUrl: '/admin/bookings',
        dedupKey: `lot4_session_closing_${s.id}`,
        metadata: { session_id: s.id, executed_at: nowIso },
      });
    }
  }

  return summary;
}

function startLot4AutomationsCron(supabaseAdmin) {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { data: tenants } = await supabaseAdmin.from('tenants').select('id').eq('actif', true);
      for (const t of tenants || []) {
        await runLot4AutomationsForTenant(supabaseAdmin, t.id, { force: true });
      }
    } catch (err) {
      console.error('❌ [CRON LOT 4]', err.message);
    }
  });
}

module.exports = {
  runLot4AutomationsForTenant,
  startLot4AutomationsCron,
  createDedupAdminNotifications,
};
