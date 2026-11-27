// controllers/kpisController.js — MODULE D : KPIs & Dashboard Admin (LOT 2 unifié)
const { supabaseAdmin } = require('../config/supabase');
const { computeRemainingMinutes } = require('../models/helpers');
const { roundMillime } = require('../models/pricingMath');
const {
  isStaffRole,
  isValidOfficialBooking,
  computeNetCollectedCA,
  parseOpeningHoursPerDay,
  computeAvailableOpenHours,
  computeOfficialActiveMembers,
  computeOfficialTopMembers,
} = require('../models/kpisCalculator');

async function safeSelectPaymentsRefunded(tid) {
  let q = supabaseAdmin
    .from('paiements')
    .select('id, user_id, montant, montant_rembourse, refunded_at, date_paiement, updated_at, reservations(espace_id)')
    .eq('statut', 'refunded');
  if (tid) q = q.eq('tenant_id', tid);
  const res = await q;
  if (!res.error) return res.data || [];
  let fallback = supabaseAdmin
    .from('paiements')
    .select('id, user_id, montant, date_paiement, updated_at, reservations(espace_id)')
    .eq('statut', 'refunded');
  if (tid) fallback = fallback.eq('tenant_id', tid);
  const fbRes = await fallback;
  return fbRes.data || [];
}

function inIsoRange(row, fromIso, toIso) {
  const ts = row?.refunded_at || row?.updated_at || row?.date_paiement;
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return t >= new Date(fromIso).getTime() && t <= new Date(toIso).getTime();
}

function resolveModuleFormationsActif(tenantRow) {
  const explicit = tenantRow?.settings?.module_formations_actif;
  if (explicit !== undefined && explicit !== null) return Boolean(explicit);
  if (tenantRow?.activite === 'coworking') return true;
  return true;
}

// ─── Fenêtres de période enrichies (Pro Analytics) ───────────────────────
function getPeriodWindow(period, now = new Date(), reqQuery = {}) {
  const customFrom = reqQuery.from;
  const customTo = reqQuery.to;

  // 1. Plage personnalisée explicite via query params
  if (customFrom && customTo) {
    const fromJ = new Date(customFrom);
    const toJ = new Date(customTo);
    if (!isNaN(fromJ) && !isNaN(toJ)) {
      fromJ.setHours(0, 0, 0, 0);
      toJ.setHours(23, 59, 59, 999);
      const ms = Math.max(1, toJ.getTime() - fromJ.getTime());
      const days = ms / (1000 * 60 * 60 * 24);
      let bucket = 'day';
      if (days <= 2) bucket = 'hour';
      else if (days <= 62) bucket = 'day';
      else if (days <= 730) bucket = 'month';
      else bucket = 'year';
      return { period: 'custom', from: fromJ.toISOString(), to: toJ.toISOString(), fromJ, toJ, ms, bucket };
    }
  }

  // 2. Format personnalisé string: 'custom:YYYY-MM-DD:YYYY-MM-DD'
  if (typeof period === 'string' && period.startsWith('custom:')) {
    const parts = period.split(':');
    const f = parts[1];
    const t = parts[2];
    if (f && t) {
      const fromJ = new Date(f + (f.length === 10 ? 'T00:00:00.000Z' : ''));
      const toJ = new Date(t + (t.length === 10 ? 'T23:59:59.999Z' : ''));
      if (!isNaN(fromJ) && !isNaN(toJ)) {
        const ms = Math.max(1, toJ.getTime() - fromJ.getTime());
        const days = ms / (1000 * 60 * 60 * 24);
        let bucket = 'day';
        if (days <= 2) bucket = 'hour';
        else if (days <= 62) bucket = 'day';
        else if (days <= 730) bucket = 'month';
        else bucket = 'year';
        return { period: 'custom', from: fromJ.toISOString(), to: toJ.toISOString(), fromJ, toJ, ms, bucket };
      }
    }
  }

  // 3. Décalage / Offset : ex. 'mois:-1' (mois dernier), 'jour:-1' (hier), 'semaine:-1'
  let offset = 0;
  let baseKey = period || 'mois';
  if (typeof period === 'string' && period.includes(':')) {
    const parts = period.split(':');
    baseKey = parts[0];
    offset = parseInt(parts[1], 10) || 0;
  }

  const targetDate = new Date(now);
  if (baseKey === 'jour' || baseKey === 'aujourdhui') {
    targetDate.setDate(targetDate.getDate() + offset);
  } else if (baseKey === 'semaine' || baseKey === '7j') {
    targetDate.setDate(targetDate.getDate() + (offset * 7));
  } else if (baseKey === 'mois') {
    targetDate.setMonth(targetDate.getMonth() + offset);
  } else if (baseKey === 'trimestre') {
    targetDate.setMonth(targetDate.getMonth() + (offset * 3));
  } else if (baseKey === 'annee') {
    targetDate.setFullYear(targetDate.getFullYear() + offset);
  }

  const y = targetDate.getFullYear();
  const m = targetDate.getMonth();
  const d = targetDate.getDate();

  let fromJ, toJ, bucket;
  switch (baseKey) {
    case 'jour':
    case 'aujourdhui':
      fromJ = new Date(y, m, d, 0, 0, 0, 0);
      toJ   = new Date(y, m, d, 23, 59, 59, 999);
      bucket = 'hour';
      break;
    case 'hier':
      fromJ = new Date(y, m, d - 1, 0, 0, 0, 0);
      toJ   = new Date(y, m, d - 1, 23, 59, 59, 999);
      bucket = 'hour';
      break;
    case 'semaine':
    case '7j':
      fromJ = new Date(y, m, d - 6, 0, 0, 0, 0);
      toJ   = new Date(y, m, d, 23, 59, 59, 999);
      bucket = 'day';
      break;
    case 'mois_precedent':
    case 'mois_dernier':
      fromJ = new Date(y, m - 1, 1, 0, 0, 0, 0);
      toJ   = new Date(y, m, 0, 23, 59, 59, 999);
      bucket = 'day';
      break;
    case 'trimestre':
      const qStartMonth = Math.floor(m / 3) * 3;
      fromJ = new Date(y, qStartMonth, 1, 0, 0, 0, 0);
      toJ   = new Date(y, qStartMonth + 3, 0, 23, 59, 59, 999);
      bucket = 'month';
      break;
    case 'annee':
      fromJ = new Date(y, 0, 1, 0, 0, 0, 0);
      toJ   = new Date(y, 11, 31, 23, 59, 59, 999);
      bucket = 'month';
      break;
    case 'tout':
      fromJ = new Date(2020, 0, 1, 0, 0, 0, 0);
      toJ   = new Date(y, m, d, 23, 59, 59, 999);
      bucket = 'year';
      break;
    case 'mois':
    default:
      fromJ = new Date(y, m, 1, 0, 0, 0, 0);
      toJ   = new Date(y, m + 1, 0, 23, 59, 59, 999);
      bucket = 'day';
      break;
  }
  return {
    period: baseKey,
    offset,
    from: fromJ.toISOString(),
    to: toJ.toISOString(),
    fromJ,
    toJ,
    ms: Math.max(1, toJ.getTime() - fromJ.getTime()),
    bucket,
  };
}

function previousWindow(win) {
  const dur = (win.toJ.getTime() - win.fromJ.getTime()) + 1;
  const toJ = new Date(win.fromJ.getTime() - 1);
  const fromJ = new Date(toJ.getTime() - dur + 1);
  return { from: fromJ.toISOString(), to: toJ.toISOString(), fromJ, toJ };
}

function pctChange(cur, prev) {
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100);
  return null;
}

function sumMt(items) {
  return (items || []).reduce((s, p) => s + parseFloat(p.montant || 0), 0);
}

function buildBuckets(win) {
  const out = [];
  if (win.bucket === 'hour') {
    const start = win.fromJ;
    for (let h = 0; h < 24; h++) {
      out.push({
        label: `${String(h).padStart(2, '0')}h`,
        start: new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, 0, 0, 0),
        end:   new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, 59, 59, 999),
      });
    }
  } else if (win.bucket === 'day') {
    const cur = new Date(win.fromJ);
    cur.setHours(0, 0, 0, 0);
    let count = 0;
    while (cur <= win.toJ && count < 100) {
      const dStart = new Date(cur);
      const dEnd = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 23, 59, 59, 999);
      const label = cur.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      out.push({ label, start: dStart, end: dEnd });
      cur.setDate(cur.getDate() + 1);
      count++;
    }
  } else if (win.bucket === 'month') {
    const cur = new Date(win.fromJ.getFullYear(), win.fromJ.getMonth(), 1);
    let count = 0;
    while (cur <= win.toJ && count < 48) {
      const mStart = new Date(cur);
      const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999);
      const label = cur.toLocaleDateString('fr-FR', { month: 'short', year: win.toJ.getFullYear() !== win.fromJ.getFullYear() ? '2-digit' : undefined });
      out.push({ label, start: mStart, end: mEnd });
      cur.setMonth(cur.getMonth() + 1);
      count++;
    }
  } else {
    for (let yr = win.fromJ.getFullYear(); yr <= win.toJ.getFullYear(); yr++) {
      out.push({ label: String(yr), start: new Date(yr, 0, 1), end: new Date(yr, 11, 31, 23, 59, 59, 999) });
    }
  }
  return out.length > 0 ? out : [{ label: 'Période', start: win.fromJ, end: win.toJ }];
}

function inBucket(date, b) { return date >= b.start && date <= b.end; }

// Helper : applique tenant_id si présent
function tq(query, tid) { return tid ? query.eq('tenant_id', tid) : query; }

// ─── GET /api/admin/kpis ─────────────────────────────────────────────────
async function getAdminKpis(req, res) {
  try {
    const today    = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const tid      = req.tenantId;
    const period   = String(req.query.period || 'mois');
    const win      = getPeriodWindow(period, today, req.query);
    const prev     = previousWindow(win);

    const debutMois         = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    const debutMoisPrecedent= new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString();
    const finMoisPrecedent  = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59).toISOString();
    const debutAnnee        = new Date(today.getFullYear(), 0, 1).toISOString();
    const debutJourStr      = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0).toISOString();
    const finJourStr        = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();
    const dans7Jours        = new Date(); dans7Jours.setDate(dans7Jours.getDate() + 7);
    const dans7JoursStr     = dans7Jours.toISOString().split('T')[0];
    const dans7JoursFin     = new Date(); dans7JoursFin.setDate(dans7JoursFin.getDate() + 7);

    // ── Toutes les requêtes en parallèle (LOT 2 : formules officielles unifiées) ─
    const [
      tenantRes,
      profilesRes,
      abonnementsRes,
      { data: paieJour },
      { data: paieMois },
      { data: paieAnnee },
      { data: paiePeriode },
      { data: paiePeriodePrec },
      { data: paieMoisPrec },
      refundedAll,
      espacesRes,
      { data: reservationsPeriodeAll },
      { data: sessionsActives },
      { data: paiementsEnAttente },
      { count: abonnementsExpirant },
      { data: reservationsJourAll },
      fdjResult,
      fpResult,
      { data: topPaiements },
      { data: calendrierDuJourAll },
      { data: prochainesReservationsArr },
      { data: formationsDuJourList },
      { data: actRes },
      { data: actPaie },
      { data: actSess },
    ] = await Promise.all([
      tid
        ? supabaseAdmin.from('tenants').select('id, settings, activite').eq('id', tid).maybeSingle()
        : Promise.resolve({ data: null }),
      tq(supabaseAdmin.from('profiles').select('id, role, statut_compte, created_at'), tid),
      tq(supabaseAdmin.from('abonnements').select('id, user_id, statut, date_fin'), tid),
      // CA jour
      tq(supabaseAdmin.from('paiements').select('montant, date_paiement').eq('statut', 'paid').gte('date_paiement', debutJourStr).lte('date_paiement', finJourStr), tid),
      // CA mois
      tq(supabaseAdmin.from('paiements').select('montant, date_paiement').eq('statut', 'paid').gte('date_paiement', debutMois), tid),
      // CA année
      tq(supabaseAdmin.from('paiements').select('montant, date_paiement').eq('statut', 'paid').gte('date_paiement', debutAnnee), tid),
      // CA période courante
      tq(supabaseAdmin.from('paiements').select('montant, date_paiement').eq('statut', 'paid').gte('date_paiement', win.from).lte('date_paiement', win.to), tid),
      // CA période précédente
      tq(supabaseAdmin.from('paiements').select('montant, date_paiement').eq('statut', 'paid').gte('date_paiement', prev.from).lte('date_paiement', prev.to), tid),
      // CA mois précédent
      tq(supabaseAdmin.from('paiements').select('montant, date_paiement').eq('statut', 'paid').gte('date_paiement', debutMoisPrecedent).lte('date_paiement', finMoisPrecedent), tid),
      // Remboursements (déduits du CA net encaissé)
      safeSelectPaymentsRefunded(tid),
      // espaces (avec horaires pour heures ouvrées disponibles)
      tq(supabaseAdmin.from('espaces').select('id, nom, type, horaires, statut'), tid),
      // réservations période (tous statuts sauf annulé/refusé/expiré)
      tq(supabaseAdmin.from('reservations').select('espace_id, date_debut, date_fin, statut').gte('date_debut', win.from).lte('date_debut', win.to), tid),
      // sessions actives
      tq(supabaseAdmin.from('sessions').select('id, reservation_id, check_in, check_out, temps_restant, statut, reservations(date_debut, date_fin, espaces(nom, type, tarif_horaire), profiles!user_id(nom, prenom))').in('statut', ['active', 'overtime']).is('check_out', null), tid),
      // paiements en attente période
      tq(supabaseAdmin.from('paiements').select('montant, created_at').eq('statut', 'pending').gte('created_at', win.from).lte('created_at', win.to), tid),
      // abonnements expirant J+7
      tq(supabaseAdmin.from('abonnements').select('*', { count: 'exact', head: true }).in('statut', ['active', 'a_renouveler']).gte('date_fin', todayStr).lte('date_fin', dans7JoursStr), tid),
      // réservations du jour
      tq(supabaseAdmin.from('reservations').select('id, statut').gte('date_debut', debutJourStr).lte('date_debut', finJourStr), tid),
      // formations du jour (count)
      tq(supabaseAdmin.from('formations').select('*', { count: 'exact', head: true }).in('statut', ['planifiee', 'en_cours']).gte('date_debut', debutJourStr).lte('date_debut', finJourStr), tid),
      // formations période (count)
      tq(supabaseAdmin.from('formations').select('*', { count: 'exact', head: true }).in('statut', ['planifiee', 'en_cours']).gte('date_debut', win.from).lte('date_debut', win.to), tid),
      // top paiements membres (avec role pour exclure le staff)
      tq(supabaseAdmin.from('paiements').select('user_id, montant, profiles(nom, prenom, email, role)').eq('statut', 'paid').gte('date_paiement', win.from).lte('date_paiement', win.to), tid),
      // calendrier du jour
      tq(supabaseAdmin.from('reservations').select('id, date_debut, date_fin, statut, espaces(nom, type), profiles!user_id(nom, prenom)').gte('date_debut', debutJourStr).lte('date_debut', finJourStr).order('date_debut', { ascending: true }), tid),
      // prochaines réservations J+7
      tq(supabaseAdmin.from('reservations').select('id, date_debut, date_fin, statut, espaces(nom), profiles!user_id(nom, prenom)').in('statut', ['confirmed', 'pending']).gte('date_debut', new Date().toISOString()).lte('date_debut', dans7JoursFin.toISOString()).order('date_debut', { ascending: true }).limit(6), tid),
      // formations du jour (liste)
      tq(supabaseAdmin.from('formations').select('id, titre, date_debut, date_fin, capacite_max, statut, prix_inscription, espaces(nom), profiles!fk_formations_formateur_profiles(nom, prenom, specialite)').in('statut', ['planifiee', 'en_cours']).gte('date_debut', debutJourStr).lte('date_debut', finJourStr).order('date_debut', { ascending: true }), tid),
      // activité : réservations récentes
      tq(supabaseAdmin.from('reservations').select('id, created_at, statut, espaces(nom), profiles!user_id(nom, prenom)').in('statut', ['confirmed', 'pending']).order('created_at', { ascending: false }).limit(6), tid),
      // activité : paiements récents
      tq(supabaseAdmin.from('paiements').select('id, created_at, montant, profiles(nom, prenom)').eq('statut', 'paid').order('created_at', { ascending: false }).limit(6), tid),
      // activité : sessions récentes
      tq(supabaseAdmin.from('sessions').select('id, check_in, reservations(espaces(nom), profiles!user_id(nom, prenom))').not('check_in', 'is', null).order('check_in', { ascending: false }).limit(6), tid),
    ]);

    const tenantRow = tenantRes?.data || null;
    const moduleFormationsActif = resolveModuleFormationsActif(tenantRow);
    const archivedSpaceIds = new Set(Array.isArray(tenantRow?.settings?.archived_espaces) ? tenantRow.settings.archived_espaces : []);
    const espaces = (espacesRes?.data || []).filter((e) => !e.archived_at && !archivedSpaceIds.has(e.id));

    const profilesAll = profilesRes?.data || [];
    const nonStaffProfiles = profilesAll.filter((p) => !isStaffRole(p.role) && !p.archived_at);
    const abonnementsAll = abonnementsRes?.data || [];

    const membresActifs = computeOfficialActiveMembers({ abonnements: abonnementsAll, profiles: profilesAll });
    const inCreatedRange = (p, fromIso, toIso) => {
      if (!p?.created_at) return false;
      const t = new Date(p.created_at).getTime();
      return t >= new Date(fromIso).getTime() && t <= new Date(toIso).getTime();
    };
    const nouveauxMoisActuel = nonStaffProfiles.filter((p) => inCreatedRange(p, debutMois, new Date().toISOString())).length;
    const nouveauxMoisPrecedent = nonStaffProfiles.filter((p) => inCreatedRange(p, debutMoisPrecedent, finMoisPrecedent)).length;
    const nouveauxPeriode = nonStaffProfiles.filter((p) => inCreatedRange(p, win.from, win.to)).length;
    const nouveauxPeriodePrec = nonStaffProfiles.filter((p) => inCreatedRange(p, prev.from, prev.to)).length;

    const reservationsPeriodeArr = (reservationsPeriodeAll || []).filter(isValidOfficialBooking);
    const reservationsDuJour = (reservationsJourAll || []).filter(isValidOfficialBooking).length;
    const calendrierDuJourArr = (calendrierDuJourAll || []).filter(isValidOfficialBooking);

    // ── Calculs unifiés (CA net = paiements encaissés - remboursements) ──
    const nowIso = new Date().toISOString();
    const caJour        = computeNetCollectedCA(paieJour, (refundedAll || []).filter((r) => inIsoRange(r, debutJourStr, finJourStr)));
    const caMois        = computeNetCollectedCA(paieMois, (refundedAll || []).filter((r) => inIsoRange(r, debutMois, nowIso)));
    const caAnnee       = computeNetCollectedCA(paieAnnee, (refundedAll || []).filter((r) => inIsoRange(r, debutAnnee, nowIso)));
    const refundedPeriode = (refundedAll || []).filter((r) => inIsoRange(r, win.from, win.to));
    const caPeriode     = computeNetCollectedCA(paiePeriode, refundedPeriode);
    const caPeriodePrec = computeNetCollectedCA(paiePeriodePrec, (refundedAll || []).filter((r) => inIsoRange(r, prev.from, prev.to)));
    const caMoisPrecedent = computeNetCollectedCA(paieMoisPrec, (refundedAll || []).filter((r) => inIsoRange(r, debutMoisPrecedent, finMoisPrecedent)));

    // ── Taux d'occupation officiel = heures réservées / heures ouvrées disponibles ─
    const periodDays = Math.max(1, Math.ceil(Math.max(1, win.ms) / 86400000));
    let totalBookedHours = 0;
    const tauxOccupation = (espaces || []).map((espace) => {
      const resEspace = reservationsPeriodeArr.filter((r) => r.espace_id === espace.id);
      const bookedHours = resEspace.reduce((acc, r) => acc + Math.max(0, (new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime()) / 3600000), 0);
      totalBookedHours += bookedHours;
      const availableHours = parseOpeningHoursPerDay(espace.horaires) * periodDays;
      return {
        nom: espace.nom,
        type: espace.type,
        heures_reservees: roundMillime(bookedHours),
        taux: availableHours > 0 ? Math.min(100, Math.round((bookedHours / availableHours) * 100)) : 0,
      };
    });

    const totalOpenHours = computeAvailableOpenHours(espaces, win);
    const occupationMoyen = totalOpenHours > 0
      ? Math.min(100, Math.round((totalBookedHours / totalOpenHours) * 100))
      : 0;

    const sessionsEnCours = (sessionsActives || []).map(s => {
      const fin = s.reservations?.date_fin;
      const diffMin = fin ? Math.floor((new Date(fin).getTime() - Date.now()) / 60000) : 0;
      const overtimeMin = diffMin < 0 ? Math.abs(diffMin) : 0;
      const rate = Number(s.reservations?.espaces?.tarif_horaire || 0);
      return {
        id: s.id,
        reservation_id: s.reservation_id,
        membre: s.reservations?.profiles ? `${s.reservations.profiles.prenom} ${s.reservations.profiles.nom}` : 'Inconnu',
        espace: s.reservations?.espaces?.nom || 'Inconnu',
        tarif_horaire: rate,
        check_in: s.check_in,
        tempsRestant: Math.max(0, diffMin),
        overtimeMinutes: overtimeMin,
        overtimeAmount: overtimeMin > 0 && rate > 0 ? Number(((overtimeMin / 60) * rate).toFixed(3)) : 0,
        dateDebut: s.reservations?.date_debut,
        dateFin: fin,
        statut: diffMin < 0 ? 'en_depassement' : (diffMin <= 15 ? 'bientot_terminee' : 'en_cours'),
      };
    });

    const topMembres = computeOfficialTopMembers(topPaiements || [], refundedPeriode || []);

    // Activité récente
    const feed = [];
    (actRes || []).forEach(r => {
      const who = r.profiles ? `${r.profiles.prenom} ${r.profiles.nom}` : 'Un membre';
      feed.push({ id: `r-${r.id}`, type: 'reservation', text: `${who} a réservé ${r.espaces?.nom || 'un espace'}`, time: r.created_at });
    });
    (actPaie || []).forEach(p => {
      const who = p.profiles ? `${p.profiles.prenom} ${p.profiles.nom}` : 'Un membre';
      feed.push({ id: `p-${p.id}`, type: 'paiement', text: `Paiement de ${parseFloat(p.montant || 0).toFixed(3)} DT reçu — ${who}`, time: p.created_at });
    });
    (actSess || []).forEach(s => {
      const who = s.reservations?.profiles ? `${s.reservations.profiles.prenom} ${s.reservations.profiles.nom}` : 'Un membre';
      feed.push({ id: `s-${s.id}`, type: 'session', text: `Check-in : ${who} (${s.reservations?.espaces?.nom || 'espace'})`, time: s.check_in });
    });
    const activiteRecente = feed.filter(e => e.time).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 8);

    res.json({
      module_formations_actif: moduleFormationsActif,
      membresActifs: membresActifs || 0,
      nouveauxMembres: {
        moisActuel: nouveauxMoisActuel || 0,
        moisPrecedent: nouveauxMoisPrecedent || 0,
        evolution: pctChange(nouveauxMoisActuel, nouveauxMoisPrecedent),
        periode: nouveauxPeriode || 0,
        periodePrecedente: nouveauxPeriodePrec || 0,
        evolutionPeriode: pctChange(nouveauxPeriode, nouveauxPeriodePrec),
      },
      chiffreAffaires: {
        jour: roundMillime(caJour),
        mois: roundMillime(caMois),
        annee: roundMillime(caAnnee),
        periode: roundMillime(caPeriode),
        periodePrecedente: roundMillime(caPeriodePrec),
        transactions: (paiePeriode || []).length,
        remboursements: refundedPeriode.length,
        evolution: pctChange(caPeriode, caPeriodePrec),
      },
      tauxOccupation,
      occupationMoyen,
      sessionsEnCours,
      paiementsEnAttente: { count: (paiementsEnAttente || []).length, montantTotal: roundMillime(sumMt(paiementsEnAttente)) },
      abonnementsExpirant: abonnementsExpirant || 0,
      reservationsDuJour: reservationsDuJour || 0,
      reservationsPeriode: {
        count: (reservationsPeriodeArr || []).length,
        confirmed: (reservationsPeriodeArr || []).filter(r => r.statut === 'confirmed').length,
        pending: (reservationsPeriodeArr || []).filter(r => r.statut === 'pending').length,
      },
      formationsDuJour: moduleFormationsActif ? (fdjResult?.count || 0) : 0,
      formationsPeriode: moduleFormationsActif ? (fpResult?.count || 0) : 0,
      topMembres,
      caMoisPrecedent: roundMillime(caMoisPrecedent),
      calendrierDuJour: calendrierDuJourArr || [],
      prochainesReservations: prochainesReservationsArr || [],
      formationsDuJourList: moduleFormationsActif ? (formationsDuJourList || []) : [],
      activiteRecente,
      periode: { key: period, from: win.from, to: win.to, bucket: win.bucket },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/admin/kpis/revenue-chart ───────────────────────────────────
async function getRevenueChart(req, res) {
  try {
    const now    = new Date();
    const tid    = req.tenantId;
    const period = String(req.query.period || 'mois');
    const win    = getPeriodWindow(period, now, req.query);
    const buckets = buildBuckets(win);
    const W_FROM  = buckets[0].start.toISOString();
    const W_TO    = buckets[buckets.length - 1].end.toISOString();

    // Paiements + remboursements + réservations + espaces + formations en parallèle
    const [
      tenantRes,
      { data: paiements },
      refundedAll,
      { data: reservationsRaw },
      { data: espacesRaw },
      { data: formationsList },
    ] = await Promise.all([
      tid ? supabaseAdmin.from('tenants').select('id, settings, activite').eq('id', tid).maybeSingle() : Promise.resolve({ data: null }),
      tq(supabaseAdmin.from('paiements').select('montant, date_paiement, reservations(espaces(nom))').eq('statut', 'paid').gte('date_paiement', W_FROM).lte('date_paiement', W_TO), tid),
      safeSelectPaymentsRefunded(tid),
      tq(supabaseAdmin.from('reservations').select('espace_id, date_debut, date_fin, statut, espaces(nom)').gte('date_debut', W_FROM).lte('date_debut', W_TO), tid),
      tq(supabaseAdmin.from('espaces').select('id, nom, horaires, statut'), tid),
      tq(supabaseAdmin.from('formations').select('id, titre, date_debut, date_fin, capacite_max, statut, prix_inscription, espaces(nom), profiles!fk_formations_formateur_profiles(nom, prenom, specialite)').in('statut', ['planifiee', 'en_cours']).gte('date_debut', W_FROM).lte('date_debut', W_TO).order('date_debut', { ascending: true }), tid),
    ]);

    const tenantRow = tenantRes?.data || null;
    const moduleFormationsActif = resolveModuleFormationsActif(tenantRow);
    const archivedSpaceIds = new Set(Array.isArray(tenantRow?.settings?.archived_espaces) ? tenantRow.settings.archived_espaces : []);
    const espaces = (espacesRaw || []).filter((e) => !e.archived_at && !archivedSpaceIds.has(e.id));
    const reservationsAll = (reservationsRaw || []).filter(isValidOfficialBooking);
    const refundedWin = (refundedAll || []).filter((r) => inIsoRange(r, W_FROM, W_TO));

    const revenueChart = buckets.map(b => {
      const arr = (paiements || []).filter(p => p.date_paiement && inBucket(new Date(p.date_paiement), b));
      const refArr = refundedWin.filter(r => inIsoRange(r, b.start.toISOString(), b.end.toISOString()));
      return { mois: b.label, ca: computeNetCollectedCA(arr, refArr), transactions: arr.length };
    });

    const caMap = {};
    (paiements || []).forEach(p => {
      const key = p.reservations?.espaces?.nom || 'Espace général';
      caMap[key] = (caMap[key] || 0) + parseFloat(p.montant || 0);
    });
    const caParEspace = Object.entries(caMap).map(([nom, ca]) => ({ nom, ca: roundMillime(ca) })).sort((a, b) => b.ca - a.ca);

    const occupationChart = buckets.map(b => {
      const moisRes = reservationsAll.filter(r => inBucket(new Date(r.date_debut), b));
      const bucketWin = { ms: Math.max(1, b.end.getTime() - b.start.getTime()) };
      const openHours = computeAvailableOpenHours(espaces, bucketWin);
      const bookedHours = moisRes.reduce((s, r) => s + Math.max(0, (new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime()) / 3600000), 0);
      const tauxMoyen = openHours > 0 ? Math.min(100, Math.round((bookedHours / openHours) * 100)) : 0;
      return { mois: b.label, taux: tauxMoyen };
    });

    const resSpaceMap = {};
    reservationsAll.forEach(r => {
      const nom = r.espaces?.nom || 'Espace général';
      if (!resSpaceMap[nom]) resSpaceMap[nom] = { confirmed: 0, pending: 0 };
      if (r.statut === 'confirmed') resSpaceMap[nom].confirmed++;
      else resSpaceMap[nom].pending++;
    });

    res.json({
      module_formations_actif: moduleFormationsActif,
      revenueChart,
      occupationChart,
      caParEspace,
      reservationsParEspace: Object.entries(resSpaceMap).map(([nom, v]) => ({ nom, ...v })),
      formations: moduleFormationsActif ? (formationsList || []) : [],
      periode: { key: win.period, from: win.from, to: win.to, bucket: win.bucket },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAdminKpis, getRevenueChart, getPeriodWindow, previousWindow, pctChange, sumMt, buildBuckets, inBucket };
