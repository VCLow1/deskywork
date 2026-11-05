// controllers/kpisController.js — MODULE D : KPIs & Dashboard Admin
const { supabaseAdmin } = require('../config/supabase');
const { computeRemainingMinutes } = require('../models/helpers');

// ─── Fenêtres de période ─────────────────────────────────────────────────
function getPeriodWindow(period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  let fromJ, toJ, bucket;
  switch (period) {
    case 'jour':
      fromJ = new Date(y, m, now.getDate(), 0, 0, 0, 0);
      toJ   = new Date(y, m, now.getDate(), 23, 59, 59, 999);
      bucket = 'hour';
      break;
    case 'annee':
      fromJ = new Date(y, 0, 1, 0, 0, 0, 0);
      toJ   = new Date(y, 11, 31, 23, 59, 59, 999);
      bucket = 'month';
      break;
    case 'tout':
      fromJ = new Date(2020, 0, 1, 0, 0, 0, 0);
      toJ   = new Date(y, m, now.getDate(), 23, 59, 59, 999);
      bucket = 'year';
      break;
    case 'mois':
    default:
      fromJ = new Date(y, m, 1, 0, 0, 0, 0);
      toJ   = new Date(y, m + 1, 0, 23, 59, 59, 999);
      bucket = 'day';
      break;
  }
  return { period, from: fromJ.toISOString(), to: toJ.toISOString(), fromJ, toJ, ms: toJ.getTime() - fromJ.getTime(), bucket };
}

function previousWindow(win) {
  const dur = (win.toJ.getTime() - win.fromJ.getTime()) + 1;
  const toJ = new Date(win.fromJ.getTime() - 1);
  const fromJ = new Date(toJ.getTime() - dur + 1);
  return { from: fromJ.toISOString(), to: toJ.toISOString(), fromJ, toJ };
}

function pctChange(cur, prev) {
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100);
  return cur > 0 ? 100 : 0;
}

function sumMt(items) {
  return (items || []).reduce((s, p) => s + parseFloat(p.montant || 0), 0);
}

function buildBuckets(win) {
  const out = [];
  const start = win.fromJ;
  if (win.bucket === 'hour') {
    for (let h = 0; h < 24; h++) {
      out.push({
        label: `${String(h).padStart(2, '0')}h`,
        start: new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, 0, 0, 0),
        end:   new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, 59, 59, 999),
      });
    }
  } else if (win.bucket === 'day') {
    const y = start.getFullYear(), mo = start.getMonth();
    const last = new Date(y, mo + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      out.push({ label: String(d), start: new Date(y, mo, d, 0, 0, 0, 0), end: new Date(y, mo, d, 23, 59, 59, 999) });
    }
  } else if (win.bucket === 'month') {
    for (let i = 0; i < 12; i++) {
      out.push({
        label: new Date(start.getFullYear(), i, 1).toLocaleDateString('fr-FR', { month: 'short' }),
        start: new Date(start.getFullYear(), i, 1),
        end:   new Date(start.getFullYear(), i + 1, 0, 23, 59, 59, 999),
      });
    }
  } else {
    for (let yr = start.getFullYear(); yr <= win.toJ.getFullYear(); yr++) {
      out.push({ label: String(yr), start: new Date(yr, 0, 1), end: new Date(yr, 11, 31, 23, 59, 59, 999) });
    }
  }
  return out;
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
    const win      = getPeriodWindow(period, today);
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

    // ── Toutes les requêtes en parallèle ─────────────────────────────────
    const [
      { count: membresActifs },
      { count: nouveauxMoisActuel },
      { count: nouveauxMoisPrecedent },
      { count: nouveauxPeriode },
      { count: nouveauxPeriodePrec },
      { data: paieJour },
      { data: paieMois },
      { data: paieAnnee },
      { data: paiePeriode },
      { data: paiePeriodePrec },
      { data: paieMoisPrec },
      { data: espaces },
      { data: reservationsPeriodeArr },
      { data: sessionsActives },
      { data: paiementsEnAttente },
      { count: abonnementsExpirant },
      { count: reservationsDuJour },
      fdjResult,
      fpResult,
      { data: topPaiements },
      { data: calendrierDuJourArr },
      { data: prochainesReservationsArr },
      { data: formationsDuJourList },
      { data: actRes },
      { data: actPaie },
      { data: actSess },
    ] = await Promise.all([
      // membres actifs
      tq(supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('statut_compte', 'actif').eq('role', 'member'), tid),
      // nouveaux membres mois actuel
      tq(supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'member').gte('created_at', debutMois), tid),
      // nouveaux membres mois précédent
      tq(supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'member').gte('created_at', debutMoisPrecedent).lte('created_at', finMoisPrecedent), tid),
      // nouveaux membres période courante
      tq(supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'member').gte('created_at', win.from).lte('created_at', win.to), tid),
      // nouveaux membres période précédente
      tq(supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'member').gte('created_at', prev.from).lte('created_at', prev.to), tid),
      // CA jour
      tq(supabaseAdmin.from('paiements').select('montant').eq('statut', 'paid').gte('date_paiement', debutJourStr).lte('date_paiement', finJourStr), tid),
      // CA mois
      tq(supabaseAdmin.from('paiements').select('montant').eq('statut', 'paid').gte('date_paiement', debutMois), tid),
      // CA année
      tq(supabaseAdmin.from('paiements').select('montant').eq('statut', 'paid').gte('date_paiement', debutAnnee), tid),
      // CA période courante
      tq(supabaseAdmin.from('paiements').select('montant').eq('statut', 'paid').gte('date_paiement', win.from).lte('date_paiement', win.to), tid),
      // CA période précédente
      tq(supabaseAdmin.from('paiements').select('montant').eq('statut', 'paid').gte('date_paiement', prev.from).lte('date_paiement', prev.to), tid),
      // CA mois précédent
      tq(supabaseAdmin.from('paiements').select('montant').eq('statut', 'paid').gte('date_paiement', debutMoisPrecedent).lte('date_paiement', finMoisPrecedent), tid),
      // espaces
      tq(supabaseAdmin.from('espaces').select('id, nom, type'), tid),
      // réservations période
      tq(supabaseAdmin.from('reservations').select('espace_id, date_debut, date_fin, statut').in('statut', ['confirmed', 'pending']).gte('date_debut', win.from).lte('date_debut', win.to), tid),
      // sessions actives
      tq(supabaseAdmin.from('sessions').select('id, check_in, temps_restant, statut, reservations(date_debut, date_fin, espaces(nom, type), profiles(nom, prenom))').eq('statut', 'active'), tid),
      // paiements en attente période
      tq(supabaseAdmin.from('paiements').select('montant, created_at').eq('statut', 'pending').gte('created_at', win.from).lte('created_at', win.to), tid),
      // abonnements expirant J+7
      tq(supabaseAdmin.from('abonnements').select('*', { count: 'exact', head: true }).eq('statut', 'active').gte('date_fin', todayStr).lte('date_fin', dans7JoursStr), tid),
      // réservations du jour (count)
      tq(supabaseAdmin.from('reservations').select('*', { count: 'exact', head: true }).in('statut', ['confirmed', 'pending']).gte('date_debut', debutJourStr).lte('date_debut', finJourStr), tid),
      // formations du jour (count)
      tq(supabaseAdmin.from('formations').select('*', { count: 'exact', head: true }).in('statut', ['planifiee', 'en_cours']).gte('date_debut', debutJourStr).lte('date_debut', finJourStr), tid),
      // formations période (count)
      tq(supabaseAdmin.from('formations').select('*', { count: 'exact', head: true }).in('statut', ['planifiee', 'en_cours']).gte('date_debut', win.from).lte('date_debut', win.to), tid),
      // top paiements membres
      tq(supabaseAdmin.from('paiements').select('user_id, montant, profiles(nom, prenom, email)').eq('statut', 'paid').gte('date_paiement', win.from).lte('date_paiement', win.to), tid),
      // calendrier du jour
      tq(supabaseAdmin.from('reservations').select('id, date_debut, date_fin, statut, espaces(nom, type), profiles(nom, prenom)').in('statut', ['confirmed', 'pending']).gte('date_debut', debutJourStr).lte('date_debut', finJourStr).order('date_debut', { ascending: true }), tid),
      // prochaines réservations J+7
      tq(supabaseAdmin.from('reservations').select('id, date_debut, date_fin, statut, espaces(nom), profiles(nom, prenom)').in('statut', ['confirmed', 'pending']).gte('date_debut', new Date().toISOString()).lte('date_debut', dans7JoursFin.toISOString()).order('date_debut', { ascending: true }).limit(6), tid),
      // formations du jour (liste)
      tq(supabaseAdmin.from('formations').select('id, titre, date_debut, date_fin, nb_inscrits, capacite_max, statut, prix_inscription, espaces(nom), profiles(nom, prenom, specialite)').in('statut', ['planifiee', 'en_cours']).gte('date_debut', debutJourStr).lte('date_debut', finJourStr).order('date_debut', { ascending: true }), tid),
      // activité : réservations récentes
      tq(supabaseAdmin.from('reservations').select('id, created_at, statut, espaces(nom), profiles(nom, prenom)').in('statut', ['confirmed', 'pending']).order('created_at', { ascending: false }).limit(6), tid),
      // activité : paiements récents
      tq(supabaseAdmin.from('paiements').select('id, created_at, montant, profiles(nom, prenom)').eq('statut', 'paid').order('created_at', { ascending: false }).limit(6), tid),
      // activité : sessions récentes
      tq(supabaseAdmin.from('sessions').select('id, check_in, reservations(espaces(nom), profiles(nom, prenom))').not('check_in', 'is', null).order('check_in', { ascending: false }).limit(6), tid),
    ]);

    // ── Calculs ──────────────────────────────────────────────────────────
    const caJour        = sumMt(paieJour);
    const caMois        = sumMt(paieMois);
    const caAnnee       = sumMt(paieAnnee);
    const caPeriode     = sumMt(paiePeriode);
    const caPeriodePrec = sumMt(paiePeriodePrec);
    const caMoisPrecedent = Math.round(sumMt(paieMoisPrec) * 100) / 100;

    const periodMs = Math.max(1, win.ms);
    const tauxOccupation = (espaces || []).map((espace) => {
      const resEspace  = (reservationsPeriodeArr || []).filter(r => r.espace_id === espace.id);
      const reservedMs = resEspace.reduce((acc, r) => acc + (new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime()), 0);
      return { nom: espace.nom, type: espace.type, taux: reservedMs > 0 ? Math.min(100, Math.round((reservedMs / periodMs) * 100)) : 0 };
    });

    const occupationMoyen = (espaces || []).length > 0
      ? Math.round(tauxOccupation.reduce((s, e) => s + (e.taux || 0), 0) / (espaces || []).length)
      : 0;

    const sessionsEnCours = (sessionsActives || []).map(s => ({
      id: s.id,
      membre: s.reservations?.profiles ? `${s.reservations.profiles.prenom} ${s.reservations.profiles.nom}` : 'Inconnu',
      espace: s.reservations?.espaces?.nom || 'Inconnu',
      check_in: s.check_in,
      tempsRestant: computeRemainingMinutes(s.reservations?.date_fin),
      dateFin: s.reservations?.date_fin,
    }));

    const topMembresMap = {};
    (topPaiements || []).forEach(p => {
      if (!p.user_id) return;
      if (!topMembresMap[p.user_id]) topMembresMap[p.user_id] = { nom: p.profiles ? `${p.profiles.prenom} ${p.profiles.nom}` : 'Inconnu', email: p.profiles?.email || '', ca: 0 };
      topMembresMap[p.user_id].ca += parseFloat(p.montant || 0);
    });
    const topMembres = Object.values(topMembresMap).sort((a, b) => b.ca - a.ca).slice(0, 5);

    // Activité récente
    const feed = [];
    (actRes || []).forEach(r => {
      const who = r.profiles ? `${r.profiles.prenom} ${r.profiles.nom}` : 'Un membre';
      feed.push({ id: `r-${r.id}`, type: 'reservation', text: `${who} a réservé ${r.espaces?.nom || 'un espace'}`, time: r.created_at });
    });
    (actPaie || []).forEach(p => {
      const who = p.profiles ? `${p.profiles.prenom} ${p.profiles.nom}` : 'Un membre';
      feed.push({ id: `p-${p.id}`, type: 'paiement', text: `Paiement de ${parseFloat(p.montant || 0).toFixed(2)} DT reçu — ${who}`, time: p.created_at });
    });
    (actSess || []).forEach(s => {
      const who = s.reservations?.profiles ? `${s.reservations.profiles.prenom} ${s.reservations.profiles.nom}` : 'Un membre';
      feed.push({ id: `s-${s.id}`, type: 'session', text: `Check-in : ${who} (${s.reservations?.espaces?.nom || 'espace'})`, time: s.check_in });
    });
    const activiteRecente = feed.filter(e => e.time).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 8);

    res.json({
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
        jour: Math.round(caJour * 100) / 100,
        mois: Math.round(caMois * 100) / 100,
        annee: Math.round(caAnnee * 100) / 100,
        periode: Math.round(caPeriode * 100) / 100,
        periodePrecedente: Math.round(caPeriodePrec * 100) / 100,
        transactions: (paiePeriode || []).length,
        evolution: pctChange(caPeriode, caPeriodePrec),
      },
      tauxOccupation,
      occupationMoyen,
      sessionsEnCours,
      paiementsEnAttente: { count: (paiementsEnAttente || []).length, montantTotal: Math.round(sumMt(paiementsEnAttente) * 100) / 100 },
      abonnementsExpirant: abonnementsExpirant || 0,
      reservationsDuJour: reservationsDuJour || 0,
      reservationsPeriode: {
        count: (reservationsPeriodeArr || []).length,
        confirmed: (reservationsPeriodeArr || []).filter(r => r.statut === 'confirmed').length,
        pending: (reservationsPeriodeArr || []).filter(r => r.statut === 'pending').length,
      },
      formationsDuJour: fdjResult?.count || 0,
      formationsPeriode: fpResult?.count || 0,
      topMembres,
      caMoisPrecedent,
      calendrierDuJour: calendrierDuJourArr || [],
      prochainesReservations: prochainesReservationsArr || [],
      formationsDuJourList: formationsDuJourList || [],
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
    const win    = getPeriodWindow(period, now);
    const buckets = buildBuckets(win);
    const W_FROM  = buckets[0].start.toISOString();
    const W_TO    = buckets[buckets.length - 1].end.toISOString();

    // Paiements + réservations + espaces + formations en parallèle
    const [
      { data: paiements },
      { data: reservationsAll },
      { data: espaces },
      { data: formationsList },
    ] = await Promise.all([
      tq(supabaseAdmin.from('paiements').select('montant, date_paiement, reservations(espaces(nom))').eq('statut', 'paid').gte('date_paiement', W_FROM).lte('date_paiement', W_TO), tid),
      tq(supabaseAdmin.from('reservations').select('espace_id, date_debut, date_fin, statut, espaces(nom)').in('statut', ['confirmed', 'pending']).gte('date_debut', W_FROM).lte('date_debut', W_TO), tid),
      tq(supabaseAdmin.from('espaces').select('id, nom'), tid),
      tq(supabaseAdmin.from('formations').select('id, titre, date_debut, date_fin, nb_inscrits, capacite_max, statut, prix_inscription, espaces(nom), profiles(nom, prenom, specialite)').in('statut', ['planifiee', 'en_cours']).gte('date_debut', W_FROM).lte('date_debut', W_TO).order('date_debut', { ascending: true }), tid),
    ]);

    const revenueChart = buckets.map(b => {
      const arr = (paiements || []).filter(p => p.date_paiement && inBucket(new Date(p.date_paiement), b));
      return { mois: b.label, ca: Math.round(arr.reduce((s, p) => s + parseFloat(p.montant || 0), 0) * 100) / 100, transactions: arr.length };
    });

    const caMap = {};
    (paiements || []).forEach(p => {
      const key = p.reservations?.espaces?.nom || 'Espace général';
      caMap[key] = (caMap[key] || 0) + parseFloat(p.montant || 0);
    });
    const caParEspace = Object.entries(caMap).map(([nom, ca]) => ({ nom, ca: Math.round(ca * 100) / 100 })).sort((a, b) => b.ca - a.ca);

    const occupationChart = buckets.map(b => {
      const moisRes = (reservationsAll || []).filter(r => inBucket(new Date(r.date_debut), b));
      const bucketMs = Math.max(1, b.end.getTime() - b.start.getTime());
      const tauxMoyen = (espaces || []).length > 0
        ? Math.round((espaces || []).reduce((acc, esp) => {
            const ms = moisRes.filter(r => r.espace_id === esp.id).reduce((s, r) => s + Math.max(0, new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime()), 0);
            return acc + Math.min(100, (ms / bucketMs) * 100);
          }, 0) / (espaces || []).length)
        : 0;
      return { mois: b.label, taux: tauxMoyen };
    });

    const resSpaceMap = {};
    (reservationsAll || []).forEach(r => {
      const nom = r.espaces?.nom || 'Espace général';
      if (!resSpaceMap[nom]) resSpaceMap[nom] = { confirmed: 0, pending: 0 };
      if (r.statut === 'confirmed') resSpaceMap[nom].confirmed++;
      else resSpaceMap[nom].pending++;
    });

    res.json({
      revenueChart,
      occupationChart,
      caParEspace,
      reservationsParEspace: Object.entries(resSpaceMap).map(([nom, v]) => ({ nom, ...v })),
      formations: formationsList || [],
      periode: { key: win.period, from: win.from, to: win.to, bucket: win.bucket },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAdminKpis, getRevenueChart, getPeriodWindow, previousWindow, pctChange, sumMt, buildBuckets, inBucket };
