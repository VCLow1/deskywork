// controllers/reportController.js — MODULE : Rapport intelligent (moteur analytique embarqué)
// Génère un rapport dynamique basé sur les données réelles de la plateforme, selon une période sélectionnée.
// Analyse : indicateurs, revenus, occupation, membres, réservations, paiements en retard, formations,
// anomalies / points à surveiller et recommandations.
const { supabaseAdmin } = require('../config/supabase');
const {
  getPeriodWindow,
  previousWindow,
  pctChange,
  sumMt,
  buildBuckets,
  inBucket,
} = require('./kpisController');

// ─── Helpers de présentation ────────────────────────────────────────────────
function round2(n) {
  return Math.round(n * 100) / 100;
}

function fmtDT(n) {
  return `${round2(n).toLocaleString('fr-FR')} DT`;
}

function periodLabel(win) {
  if (win.period === 'tout') return 'la totalité de l\'historique de la plateforme';
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `la période du ${fmt(win.fromJ)} au ${fmt(win.toJ)}`;
}

function evolutionText(cur, prev, unit = '') {
  const evo = pctChange(cur, prev);
  if (cur > prev) return `▲ +${evo}% vs période précédente${unit}`;
  if (cur < prev) return `▼ ${evo}% vs période précédente${unit}`;
  return `→ Stable vs période précédente${unit}`;
}

function maxBy(arr, fn) {
  return arr.reduce((best, item) => (!best || fn(item) > fn(best) ? item : best), null);
}

function mean(arr, fn) {
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((s, a) => s + fn(a), 0) / arr.length);
}

function computeVerdict(anomalies) {
  const high = (anomalies || []).filter((a) => a.severite === 'high').length;
  const warning = (anomalies || []).filter((a) => a.severite === 'warning').length;
  if (high > 0) return { sentiment: 'danger', label: 'Situation à surveiller de près' };
  if (warning > 1 || anomalies.length > 0) return { sentiment: 'warning', label: 'Résultats globalement corrects, quelques points d\'attention' };
  return { sentiment: 'positive', label: 'Bonne dynamique sur la période' };
}

// ─── Anomalies : générateur partagé ──────────────────────────────────────────
function addAnomaly(list, severite, icone, titre, detail) {
  list.push({ severite, icone, titre, detail });
}

function addRec(list, priorite, categorie, action, justification) {
  list.push({ priorite, categorie, action, justification });
}

// ===========================================================================
//  RAPPORT ADMIN COWORKING
// ===========================================================================
async function getAdminReport(req, res) {
  try {
    const tid = req.tenantId;
    const period = String(req.query.period || 'mois');
    const win = getPeriodWindow(period);
    const prev = previousWindow(win);
    const label = periodLabel(win);
    const now = new Date();

    // ── Espaces ──────────────────────────────────────────────────────────
    let espQ = supabaseAdmin.from('espaces').select('id, nom, type');
    if (tid) espQ = espQ.eq('tenant_id', tid);
    const { data: espaces } = await espQ;
    const espList = espaces || [];

    // ── Réservations (période) ───────────────────────────────────────────
    let resQ = supabaseAdmin
      .from('reservations')
      .select('espace_id, date_debut, date_fin, statut')
      .in('statut', ['confirmed', 'pending'])
      .gte('date_debut', win.from)
      .lte('date_debut', win.to);
    if (tid) resQ = resQ.eq('tenant_id', tid);
    const { data: resPeriod } = await resQ;

    const periodMs = Math.max(1, win.ms);
    const occBySpace = espList.map((e) => {
      const rs = (resPeriod || []).filter((r) => r.espace_id === e.id);
      const ms = rs.reduce((s, r) => s + Math.max(0, new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime()), 0);
      return { key: e.id, nom: e.nom, type: e.type, taux: ms > 0 ? Math.min(100, Math.round((ms / periodMs) * 100)) : 0, nb: rs.length };
    });
    const occMoyen = espList.length > 0 ? mean(occBySpace, (o) => o.taux) : 0;
    const topOcc = maxBy(occBySpace, (o) => o.taux);
    const espacesVides = occBySpace.filter((o) => o.nb === 0);
    const espacesSatures = occBySpace.filter((o) => o.taux >= 95);

    const bookings = {
      count: (resPeriod || []).length,
      confirmed: (resPeriod || []).filter((r) => r.statut === 'confirmed').length,
      pending: (resPeriod || []).filter((r) => r.statut === 'pending').length,
    };

    // ── CA (période + précédente) + série ────────────────────────────────
    let paieQ = supabaseAdmin
      .from('paiements').select('montant, date_paiement')
      .eq('statut', 'paid')
      .gte('date_paiement', win.from).lte('date_paiement', win.to);
    if (tid) paieQ = paieQ.eq('tenant_id', tid);
    const { data: paiePeriod } = await paieQ;

    let paiePQ = supabaseAdmin
      .from('paiements').select('montant, date_paiement')
      .eq('statut', 'paid')
      .gte('date_paiement', prev.from).lte('date_paiement', prev.to);
    if (tid) paiePQ = paiePQ.eq('tenant_id', tid);
    const { data: paiePrev } = await paiePQ;

    const ca = round2(sumMt(paiePeriod));
    const caPrev = round2(sumMt(paiePrev));
    const caEvo = pctChange(ca, caPrev);
    const transactions = (paiePeriod || []).length;

    const buckets = buildBuckets(win);
    const serieRevenus = buckets.map((b) => {
      const arr = (paiePeriod || []).filter((p) => p.date_paiement && inBucket(new Date(p.date_paiement), b));
      return { label: b.label, ca: round2(arr.reduce((s, p) => s + parseFloat(p.montant || 0), 0)) };
    });

    // ── Membres (actifs + nouveaux) ──────────────────────────────────────
    let actQ = supabaseAdmin
      .from('profiles').select('*', { count: 'exact', head: true })
      .eq('role', 'member').eq('statut_compte', 'actif');
    if (tid) actQ = actQ.eq('tenant_id', tid);
    const { count: membresActifs } = await actQ;

    let nvQ = supabaseAdmin
      .from('profiles').select('*', { count: 'exact', head: true })
      .eq('role', 'member')
      .gte('created_at', win.from).lte('created_at', win.to);
    if (tid) nvQ = nvQ.eq('tenant_id', tid);
    const { count: nouveauxMembres } = await nvQ;

    let nvPQ = supabaseAdmin
      .from('profiles').select('*', { count: 'exact', head: true })
      .eq('role', 'member')
      .gte('created_at', prev.from).lte('created_at', prev.to);
    if (tid) nvPQ = nvPQ.eq('tenant_id', tid);
    const { count: nouveauxMembresPrev } = await nvPQ;
    const membresEvo = pctChange(nouveauxMembres, nouveauxMembresPrev);

    // ── Paiements en attente / en retard ─────────────────────────────────
    let pendQ = supabaseAdmin
      .from('paiements').select('montant, created_at')
      .in('statut', ['pending', 'failed'])
      .gte('created_at', win.from).lte('created_at', win.to);
    if (tid) pendQ = pendQ.eq('tenant_id', tid);
    const { data: pendPeriod } = await pendQ;

    const seuilRetard = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const enRetard = (pendPeriod || []).filter((p) => p.created_at && p.created_at < seuilRetard);
    const paiementsEnRetard = {
      count: (pendPeriod || []).length,
      montant: round2(sumMt(pendPeriod)),
      retardCount: enRetard.length,
      retardMontant: round2(sumMt(enRetard)),
    };

    // ── Abonnements expirant (J+7) ───────────────────────────────────────
    const todayStr = now.toISOString().split('T')[0];
    const j7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    let abQ = supabaseAdmin
      .from('abonnements').select('*', { count: 'exact', head: true })
      .eq('statut', 'active')
      .gte('date_fin', todayStr).lte('date_fin', j7);
    if (tid) abQ = abQ.eq('tenant_id', tid);
    const { count: abonnementsExpirant } = await abQ;

    // ── Formations (période) ─────────────────────────────────────────────
    let formQ = supabaseAdmin
      .from('formations')
      .select('id, titre, nb_inscrits, capacite_max, prix_inscription')
      .in('statut', ['planifiee', 'en_cours'])
      .gte('date_debut', win.from).lte('date_debut', win.to);
    if (tid) formQ = formQ.eq('tenant_id', tid);
    const { data: formations } = await formQ;
    const formList = formations || [];
    const participants = formList.reduce((s, f) => s + (parseInt(f.nb_inscrits) || 0), 0);
    const capaciteTotale = formList.reduce((s, f) => s + (parseInt(f.capacite_max) || 0), 0);
    const fillFormations = capaciteTotale > 0 ? Math.round((participants / capaciteTotale) * 100) : 0;
    const revenuFormations = round2(formList.reduce((s, f) => s + ((parseInt(f.nb_inscrits) || 0) * (parseFloat(f.prix_inscription) || 0)), 0));
    const topFormation = maxBy(formList, (f) => (f.nb_inscrits || 0));
    const sousRemplies = formList.filter((f) => f.capacite_max > 0 && (f.nb_inscrits || 0) / f.capacite_max < 0.4);

    // ── Sessions dépassées (live) ────────────────────────────────────────
    let sessQ = supabaseAdmin
      .from('sessions').select('id, reservations(date_fin)')
      .eq('statut', 'active');
    if (tid) sessQ = sessQ.eq('tenant_id', tid);
    const { data: activeSessions } = await sessQ;
    const sessionsDepassees = (activeSessions || []).filter((s) => {
      return s.reservations?.date_fin && new Date(s.reservations.date_fin).getTime() <= now.getTime();
    }).length;

    // ── Analyse : anomalies & points à surveiller ────────────────────────
    const anomalies = [];
    const recommandations = [];

    if (caEvo < -20) addAnomaly(anomalies, 'high', 'trending_down', 'Baisse marquée du chiffre d\'affaires',
      `Le CA est en recul de ${Math.abs(caEvo)}% par rapport à la période précédente (${fmtDT(ca)} contre ${fmtDT(caPrev)}).`);
    else if (caEvo < 0) addAnomaly(anomalies, 'warning', 'trending_down', 'Léger repli du chiffre d\'affaires',
      `Le CA baisse de ${Math.abs(caEvo)}% sur la période (${fmtDT(ca)}).`);

    if (paiementsEnRetard.retardCount > 0) addAnomaly(anomalies, 'high', 'error', 'Paiements en retard',
      `${paiementsEnRetard.retardCount} paiement(s) non réglé(s) depuis plus de 7 jours, soit ${fmtDT(paiementsEnRetard.retardMontant)} à encaisser.`);
    else if (paiementsEnRetard.count > 0) addAnomaly(anomalies, 'warning', 'pending_actions', 'Paiements en attente',
      `${paiementsEnRetard.count} paiement(s) en attente sur la période pour ${fmtDT(paiementsEnRetard.montant)}.`);

    if (abonnementsExpirant > 0) addAnomaly(anomalies, 'warning', 'alarm', 'Abonnements arrivant à expiration',
      `${abonnementsExpirant} abonnement(s) actif(s) expire(nt) dans les 7 prochains jours.`);

    if (espList.length > 0 && occMoyen < 40) addAnomaly(anomalies, 'warning', 'domain', 'Espaces sous-utilisés',
      `L'occupation moyenne est de ${occMoyen}% : la capacité est largement disponible sur la période.`);
    if (espList.length > 0 && occMoyen >= 90) addAnomaly(anomalies, 'warning', 'fire_truck', 'Capacité quasi saturée',
      `L'occupation moyenne atteint ${occMoyen}%, proche de la capacité maximale.`);
    espacesSatures.forEach((e) => {
      addAnomaly(anomalies, 'warning', 'event_busy', `Espace "${e.nom}" saturé`,
        `Il affiche un taux d'occupation de ${e.taux}% sur la période.`);
    });
    espacesVides.slice(0, 3).forEach((e) => {
      addAnomaly(anomalies, 'low', 'event_note', `Espace "${e.nom}" inutilisé`,
        `Aucune réservation enregistrée sur cet espace pendant la période.`);
    });

    if (formList.length > 0 && fillFormations < 40) addAnomaly(anomalies, 'warning', 'school', 'Formations sous-remplies',
      `Taux de remplissage moyen des formations : ${fillFormations}%.`);
    if (sousRemplies.length > 0 && fillFormations >= 40) addAnomaly(anomalies, 'low', 'group_off', 'Formations à promouvoir',
      `${sousRemplies.length} formation(s) affiche(nt) moins de 40% d'inscrits.`);

    if (membresEvo < 0) addAnomaly(anomalies, 'warning', 'person_off', 'Ralentissement des inscriptions',
      `${nouveauxMembres} nouveau(x) membre(s) sur la période (${membresEvo}% par rapport à la période précédente).`);
    if (sessionsDepassees > 0) addAnomaly(anomalies, 'warning', 'history_toggle_off', 'Sessions dépassées',
      `${sessionsDepassees} session(s) active(s) dépassent l'heure de fin prévue.`);

    // ── Recommandations basées sur les données ───────────────────────────
    if (caEvo < 0) {
      addRec(recommandations, 'haute', 'Revenus', 'Lancer une campagne de relance commerciale (promotions sur les espaces sous-utilisés, programme de fidélité)',
        'Le CA est en baisse sur la période, il faut stimuler la demande.');
    }
    espacesVides.slice(0, 3).forEach((e) => {
      addRec(recommandations, 'moyenne', 'Occupation', `Mettre en avant l'espace "${e.nom}" (mise en avant marketplace, tarif découverte)`,
        'Aucune réservation sur cet espace pendant la période analysée.');
    });
    if (occMoyen < 40) {
      addRec(recommandations, 'moyenne', 'Occupation', 'Ouvrir des créneaux réservés aux membres abonnés ou proposer des plans horaires',
        'La capacité est sous-exploitée.');
    }
    if (paiementsEnRetard.retardCount > 0) {
      addRec(recommandations, 'haute', 'Paiements', 'Relancer les paiements en retard (emails automatiques) et suspendre les accès en cas de non-régularisation',
        `${paiementsEnRetard.retardCount} paiement(s) dépassent le délai de 7 jours.`);
    } else if (paiementsEnRetard.count > 0) {
      addRec(recommandations, 'moyenne', 'Paiements', 'Accélérer l\'encaissement des paiements en attente via relance automatique',
        'Des paiements sont en attente sur la période.');
    }
    if (abonnementsExpirant > 0) {
      addRec(recommandations, 'moyenne', 'Fidélisation', 'Lancer une campagne d\'incitation au renouvellement (J-7 / J-3)',
        `${abonnementsExpirant} abonnement(s) expirent dans les 7 jours.`);
    }
    if (sousRemplies.length > 0) {
      addRec(recommandations, 'moyenne', 'Formations', 'Promouvoir les formations à faible remplissage (emailing ciblé, réseaux sociaux)',
        `${sousRemplies.length} formation(s) affiche(nt) un remplissage inférieur à 40%.`);
    }
    if (membresEvo < 0) {
      addRec(recommandations, 'moyenne', 'Acquisition', 'Relancer les prospects et simplifier l\'inscription pour inverser la tendance',
        'Le nombre de nouveaux membres recule sur la période.');
    }
    if (formList.length > 0 && fillFormations >= 60) {
      addRec(recommandations, 'basse', 'Formations', 'Conserver le portefeuille de formations actuel et ajuster les capacités',
        'Les formations affichent un bon taux de remplissage.');
    }
    if (recommandations.length === 0) {
      addRec(recommandations, 'basse', 'Global', 'Poursuivre la dynamique actuelle et fidéliser les meilleurs clients',
        'Aucune alerte majeure n\'est détectée sur la période.');
    }

    // ── Rédaction du rapport ─────────────────────────────────────────────
    const verdict = computeVerdict(anomalies);
    const intro = `Sur ${label}, le coworking a généré ${fmtDT(ca)} de chiffre d'affaires (${transactions} transaction(s), ${caEvo >= 0 ? '+' : ''}${caEvo}% vs période précédente) pour ${bookings.count} réservation(s) et un taux d'occupation moyen de ${occMoyen}%. ${nouveauxMembres} nouveau(x) membre(s) ont rejoint la plateforme${membresEvo < 0 ? ' (légère baisse)' : membresEvo > 0 ? ' (en croissance)' : ''}.`;
    let conclusion = '';
    const worst = anomalies.find((a) => a.severite === 'high');
    if (worst) {
      conclusion = `Le point critique de la période reste la gestion des paiements : ${paiementsEnRetard.retardMontant > 0 ? `${fmtDT(paiementsEnRetard.retardMontant)} sont en attente depuis plus de 7 jours` : 'des impayés doivent être régularisés'}. En parallèle, ${espList.length > 0 && occMoyen < 40 ? 'la capacité disponible pourrait être mieux valorisée' : 'les indicateurs d\'activité restent maîtrisés'}.`;
    } else if (anomalies.length > 0) {
      conclusion = 'Les indicateurs restent globalement sains mais quelques points méritent une attention particulière (relances, remplissage, occupation). Une action ciblée sur ces axes permettra de conforter la performance.';
    } else {
      conclusion = 'Aucune anomalie significative n\'a été détectée. Le coworking affiche une activité saine : maintien du CA, occupation raisonnable et acquisition régulière de membres.';
    }

    res.json({
      type: 'admin',
      periode: { key: win.period, from: win.from, to: win.to, label },
      generatedAt: now.toISOString(),
      verdict,
      titre: 'Rapport intelligent — Vitrine du coworking',
      intro,
      conclusion,
      indicateurs: [
        { label: 'Chiffre d\'affaires', value: fmtDT(ca), evolution: evolutionText(ca, caPrev) },
        { label: 'Occupation moyenne', value: `${occMoyen}%`, evolution: topOcc ? `Meilleur espace : ${topOcc.nom}` : null },
        { label: 'Nouveaux membres', value: String(nouveauxMembres), evolution: evolutionText(nouveauxMembres, nouveauxMembresPrev) },
        { label: 'Réservations', value: String(bookings.count), evolution: `${bookings.confirmed} confirmée(s) · ${bookings.pending} en attente` },
        { label: 'Paiements en retard', value: String(paiementsEnRetard.retardCount), evolution: fmtDT(paiementsEnRetard.retardMontant) },
        { label: 'Formations', value: String(formList.length), evolution: `${participants} participant(s) · ${fillFormations}% de remplissage` },
      ],
      sections: [
        {
          key: 'revenus', titre: 'Évolution des revenus', icone: 'trending_up', accent: '#2fbe8f',
          stats: {
            stat1: { label: 'CA', value: fmtDT(ca) },
            stat2: { label: 'Évolution', value: `${caEvo > 0 ? '+' : ''}${caEvo}%` },
            stat3: { label: 'Transactions', value: String(transactions) },
          },
          analyse: `CA de ${fmtDT(ca)} sur la période, contre ${fmtDT(caPrev)} la période précédente. Le panier moyen est de ${transactions > 0 ? fmtDT(round2(ca / transactions)) : '0 DT'} par transaction.`,
          serie: serieRevenus,
        },
        {
          key: 'occupation', titre: 'Taux d\u0027occupation', icone: 'domain', accent: '#0ea5e9',
          stats: {
            stat1: { label: 'Taux moyen', value: `${occMoyen}%` },
            stat2: { label: 'Espaces', value: String(espList.length) },
            stat3: { label: 'Meilleur espace', value: topOcc ? `${topOcc.nom} (${topOcc.taux}%)` : '—' },
          },
          analyse: `Occupation moyenne de ${occMoyen}% sur la capacité disponible. ${espacesVides.length > 0 ? `${espacesVides.length} espace(s) sans réservation sur la période.` : 'L\'ensemble des espaces a été utilisé au moins une fois.'}${espacesSatures.length > 0 ? ` ${espacesSatures.length} espace(s) proche(s) de la saturation.` : ''}`,
        },
        {
          key: 'membres', titre: 'Évolution du nombre de membres', icone: 'group', accent: '#f95d00',
          stats: {
            stat1: { label: 'Nouveaux', value: String(nouveauxMembres) },
            stat2: { label: 'Évolution', value: `${membresEvo > 0 ? '+' : ''}${membresEvo}%` },
            stat3: { label: 'Membres actifs', value: String(membresActifs) },
          },
          analyse: `${nouveauxMembres} inscription(s) de membre sur la période (${nouveauxMembresPrev} la période précédente). ${membresActifs} membre(s) actif(s) au total aujourd'hui.`,
        },
        {
          key: 'reservations', titre: 'Réservations', icone: 'event_available', accent: '#8b5cf6',
          stats: {
            stat1: { label: 'Réservations', value: String(bookings.count) },
            stat2: { label: 'Confirmées', value: String(bookings.confirmed) },
            stat3: { label: 'En attente', value: String(bookings.pending) },
          },
          analyse: `${bookings.count} réservation(s) enregistrée(s) sur la période, dont ${bookings.confirmed} confirmée(s) et ${bookings.pending} en attente de validation.`,
        },
        {
          key: 'paiements', titre: 'Paiements en retard', icone: 'pending_actions', accent: '#ba1a1a',
          stats: {
            stat1: { label: 'En attente', value: String(paiementsEnRetard.count) },
            stat2: { label: 'En retard (>7j)', value: String(paiementsEnRetard.retardCount) },
            stat3: { label: 'Montant en retard', value: fmtDT(paiementsEnRetard.retardMontant) },
          },
          analyse: `${paiementsEnRetard.count} paiement(s) en attente pour ${fmtDT(paiementsEnRetard.montant)}. ${paiementsEnRetard.retardCount > 0 ? `Parmi eux, ${paiementsEnRetard.retardCount} dépasse(nt) le délai de 7 jours (${fmtDT(paiementsEnRetard.retardMontant)}).` : 'Aucun paiement ne dépasse le délai de 7 jours.'}`,
        },
        {
          key: 'formations', titre: 'Formations', icone: 'school', accent: '#8b5cf6',
          stats: {
            stat1: { label: 'Formations', value: String(formList.length) },
            stat2: { label: 'Participants', value: String(participants) },
            stat3: { label: 'Remplissage', value: `${fillFormations}%` },
          },
          analyse: `${formList.length} formation(s) programmée(s) sur la période pour ${participants} participant(s)${topFormation ? ` — meilleure affluence : "${topFormation.titre}" (${topFormation.nb_inscrits}/${topFormation.capacite_max})` : ''}. Revenu formation estimé : ${fmtDT(revenuFormations)}.`,
        },
      ],
      anomalies,
      recommandations,
    });
  } catch (err) {
    console.error('Erreur rapport admin:', err);
    res.status(500).json({ error: err.message });
  }
}

// ===========================================================================
//  RAPPORT SUPER ADMIN (plateforme)
// ===========================================================================
async function getSuperAdminReport(req, res) {
  try {
    const period = String(req.query.period || 'mois');
    const win = getPeriodWindow(period);
    const prev = previousWindow(win);
    const label = periodLabel(win);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // ── Tenants (plateforme) ─────────────────────────────────────────────
    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, montant_mensuel, statut, plan, prochaine_echeance, created_at');

    const actifs = (tenants || []).filter((t) => t.statut === 'actif');
    const impayes = (tenants || []).filter((t) => t.statut !== 'actif' || (t.prochaine_echeance && t.prochaine_echeance < todayStr));
    const mrr = actifs.reduce((s, t) => s + (parseFloat(t.montant_mensuel) || 0), 0);
    const overdueAmount = impayes.reduce((s, t) => s + (parseFloat(t.montant_mensuel) || 0), 0);

    let newTQ = supabaseAdmin
      .from('tenants').select('*', { count: 'exact', head: true })
      .gte('created_at', win.from).lte('created_at', win.to);
    const { count: nouveauxTenants } = await newTQ;
    let newTPQ = supabaseAdmin
      .from('tenants').select('*', { count: 'exact', head: true })
      .gte('created_at', prev.from).lte('created_at', prev.to);
    const { count: nouveauxTenantsPrev } = await newTPQ;

    const planBreakdown = {};
    actifs.forEach((t) => { planBreakdown[t.plan] = (planBreakdown[t.plan] || 0) + 1; });

    // ── CA plateforme (paiements) ────────────────────────────────────────
    const { data: paiePeriod } = await supabaseAdmin
      .from('paiements').select('montant, date_paiement, tenant_id')
      .eq('statut', 'paid')
      .gte('date_paiement', win.from).lte('date_paiement', win.to);
    const { data: paiePrev } = await supabaseAdmin
      .from('paiements').select('montant')
      .eq('statut', 'paid')
      .gte('date_paiement', prev.from).lte('date_paiement', prev.to);

    const ca = round2(sumMt(paiePeriod));
    const caPrev = round2(sumMt(paiePrev));
    const caEvo = pctChange(ca, caPrev);

    // CA par tenant (concentration)
    const caTenantMap = {};
    (paiePeriod || []).forEach((p) => {
      if (!p.tenant_id) return;
      caTenantMap[p.tenant_id] = (caTenantMap[p.tenant_id] || 0) + parseFloat(p.montant || 0);
    });
    const tenantRows = (tenants || []).map((t) => ({
      ...t,
      ca: caTenantMap[t.id] || 0,
    })).filter((t) => t.ca > 0).sort((a, b) => b.ca - a.ca);
    const topTenantCA = tenantRows[0];
    const partTop = ca > 0 && topTenantCA ? Math.round((topTenantCA.ca / ca) * 100) : 0;

    const buckets = buildBuckets(win);
    const serieRevenus = buckets.map((b) => {
      const arr = (paiePeriod || []).filter((p) => p.date_paiement && inBucket(new Date(p.date_paiement), b));
      return { label: b.label, ca: round2(arr.reduce((s, p) => s + parseFloat(p.montant || 0), 0)) };
    });

    // ── Membres plateforme ───────────────────────────────────────────────
    const { count: membresCount } = await supabaseAdmin
      .from('profiles').select('*', { count: 'exact', head: true })
      .in('role', ['member', 'guest']);
    let nvMQ = supabaseAdmin
      .from('profiles').select('*', { count: 'exact', head: true })
      .in('role', ['member', 'guest'])
      .gte('created_at', win.from).lte('created_at', win.to);
    const { count: nouveauxMembres } = await nvMQ;
    let nvMPQ = supabaseAdmin
      .from('profiles').select('*', { count: 'exact', head: true })
      .in('role', ['member', 'guest'])
      .gte('created_at', prev.from).lte('created_at', prev.to);
    const { count: nouveauxMembresPrev } = await nvMPQ;
    const membresEvo = pctChange(nouveauxMembres, nouveauxMembresPrev);

    // ── Réservations plateforme ──────────────────────────────────────────
    const { count: reservationsCount } = await supabaseAdmin
      .from('reservations').select('*', { count: 'exact', head: true })
      .in('statut', ['confirmed', 'pending'])
      .gte('date_debut', win.from).lte('date_debut', win.to);
    const { count: reservationsConfirmed } = await supabaseAdmin
      .from('reservations').select('*', { count: 'exact', head: true })
      .eq('statut', 'confirmed')
      .gte('date_debut', win.from).lte('date_debut', win.to);

    // ── Occupation agrégée (across tenants) ──────────────────────────────
    const { data: espacesAll } = await supabaseAdmin.from('espaces').select('id, tenant_id');
    const { data: resAll } = await supabaseAdmin
      .from('reservations').select('espace_id, date_debut, date_fin')
      .in('statut', ['confirmed', 'pending'])
      .gte('date_debut', win.from).lte('date_debut', win.to);
    const espacesActifs = (() => {
      const ids = new Set(actifs.map((t) => t.id));
      return (espacesAll || []).filter((e) => ids.has(e.tenant_id));
    })();
    const periodMs = Math.max(1, win.ms);
    const occBySpace = espacesActifs.map((e) => {
      const rs = (resAll || []).filter((r) => r.espace_id === e.id);
      const ms = rs.reduce((s, r) => s + Math.max(0, new Date(r.date_fin).getTime() - new Date(r.date_debut).getTime()), 0);
      return { taux: ms > 0 ? Math.min(100, Math.round((ms / periodMs) * 100)) : 0, nb: rs.length };
    });
    const occPlateforme = occBySpace.length > 0 ? mean(occBySpace, (o) => o.taux) : 0;
    const espacesVides = occBySpace.filter((o) => o.nb === 0).length;

    // ── Formations plateforme ────────────────────────────────────────────
    const { data: formations } = await supabaseAdmin
      .from('formations')
      .select('nb_inscrits, capacite_max')
      .in('statut', ['planifiee', 'en_cours'])
      .gte('date_debut', win.from).lte('date_debut', win.to);
    const formList = formations || [];
    const participants = formList.reduce((s, f) => s + (parseInt(f.nb_inscrits) || 0), 0);
    const capaciteTotale = formList.reduce((s, f) => s + (parseInt(f.capacite_max) || 0), 0);
    const fillFormations = capaciteTotale > 0 ? Math.round((participants / capaciteTotale) * 100) : 0;

    // ── Paiements en attente / en retard (plateforme) ────────────────────
    const seuilRetard = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: pendAll } = await supabaseAdmin
      .from('paiements').select('montant, created_at')
      .in('statut', ['pending', 'failed'])
      .gte('created_at', win.from).lte('created_at', win.to);
    const enRetard = (pendAll || []).filter((p) => p.created_at && p.created_at < seuilRetard);
    const paiementsEnRetard = {
      count: (pendAll || []).length,
      montant: round2(sumMt(pendAll)),
      retardCount: enRetard.length,
      retardMontant: round2(sumMt(enRetard)),
    };

    // ── Analyse : anomalies & recommandations ────────────────────────────
    const anomalies = [];
    const recommandations = [];

    if (impayes.length > 0) addAnomaly(anomalies, 'high', 'error', 'Coworkings en impayé ou expirés',
      `${impayes.length} coworking(s) sont en impayé ou en expiration (${fmtDT(overdueAmount)} en attente de règlement).`);

    if (caEvo < -20) addAnomaly(anomalies, 'high', 'trending_down', 'Baisse du CA de la plateforme',
      `Le CA encaissé recule de ${Math.abs(caEvo)}% sur la période (${fmtDT(ca)} contre ${fmtDT(caPrev)}).`);
    else if (caEvo < 0) addAnomaly(anomalies, 'warning', 'trending_down', 'Léger repli du CA de la plateforme',
      `Le CA encaissé baisse de ${Math.abs(caEvo)}% sur la période.`);

    if (espacesActifs.length > 0 && occPlateforme < 40) addAnomaly(anomalies, 'warning', 'domain', 'Capacité globale sous-utilisée',
      `L'occupation moyenne agrégée est de ${occPlateforme}% sur les coworkings actifs.`);
    if (espacesVides > 0) addAnomaly(anomalies, 'low', 'event_note', 'Espaces sans réservation',
      `${espacesVides} espace(s) n'ont reçu aucune réservation sur la période.`);

    if (paiementsEnRetard.retardCount > 0) addAnomaly(anomalies, 'warning', 'pending_actions', 'Paiements en retard (plateforme)',
      `${paiementsEnRetard.retardCount} paiement(s) en attente depuis plus de 7 jours pour ${fmtDT(paiementsEnRetard.retardMontant)}.`);
    if (formList.length > 0 && fillFormations < 40) addAnomaly(anomalies, 'low', 'school', 'Formations sous-remplies',
      `Taux de remplissage moyen des formations : ${fillFormations}%.`);

    if (partTop >= 50) addAnomaly(anomalies, 'warning', 'pie_chart', 'Fort risque de concentration des revenus',
      `"${topTenantCA ? topTenantCA.nom : 'le premier coworking'}" représente ${partTop}% du CA encaissé sur la période.`);

    if (membresEvo < 0) addAnomaly(anomalies, 'warning', 'person_off', "Ralentissement de l'acquisition membres",
      `${nouveauxMembres} nouveau(x) membre(s) sur la période (${membresEvo}% vs période précédente).`);

    // Recommandations
    if (impayes.length > 0) {
      addRec(recommandations, 'haute', 'Facturation', 'Relancer les coworkings en impayé et activer la procédure de suspension',
        `${impayes.length} coworking(s) sont en impayé pour ${fmtDT(overdueAmount)}.`);
    }
    if (caEvo < 0) {
      addRec(recommandations, 'haute', 'Revenus', 'Travailler l\x27upsell des plans et accompagner les tenant menacés',
        'Le CA encaissé est en baisse sur la période.');
    }
    if (occPlateforme < 40) {
      addRec(recommandations, 'moyenne', 'Croissance', 'Accompagner les coworkings dans l\x27animation de leur marketplace',
        'La capacité globale est sous-exploitée.');
    }
    const planEntries = Object.entries(planBreakdown).sort((a, b) => b[1] - a[1]);
    if (planEntries.length > 0 && planEntries[0][0] === 'starter' && (planEntries[0][1] / actifs.length) >= 0.5) {
      addRec(recommandations, 'moyenne', 'Croissance', 'Proposer une migration vers les plans supérieurs aux coworkings Starter',
        `Plus de la moitié des coworkings actifs sont sur le plan Starter.`);
    }
    if (partTop >= 50) {
      addRec(recommandations, 'moyenne', 'Risque', 'Diversifier le portefeuille pour réduire la dépendance au premier coworking',
        'La concentration des revenus dépasse 50% sur un seul tenant.');
    }
    if (paiementsEnRetard.retardCount > 0) {
      addRec(recommandations, 'moyenne', 'Paiements', 'Déclencher les relances automatiques de paiement à l\x27échelle plateforme',
        `${paiementsEnRetard.retardCount} paiement(s) en attente depuis plus de 7 jours.`);
    }
    if (formList.length > 0 && fillFormations < 40) {
      addRec(recommandations, 'basse', 'Formations', 'Partager les meilleures pratiques de remplissage entre coworkings',
        `Le remplissage moyen des formations est de ${fillFormations}%.`);
    }
    if (recommandations.length === 0) {
      addRec(recommandations, 'basse', 'Global', 'Poursuivre la croissance et surveiller la régularité des encaissements',
        'Aucune alerte majeure détectée sur la période.');
    }

    // ── Rédaction du rapport ─────────────────────────────────────────────
    const verdict = computeVerdict(anomalies);
    const intro = `Sur ${label}, la plateforme a encaissé ${fmtDT(ca)} (${(paiePeriod || []).length} transaction(s), ${caEvo >= 0 ? '+' : ''}${caEvo}% vs période précédente) avec un MRR de ${fmtDT(mrr)} réparti sur ${actifs.length} coworking(s) actif(s). ${nouveauxMembres} nouveau(x) membre(s) ont rejoint la plateforme, et plus de ${reservationsConfirmed} réservation(s) ont été confirmées. L'occupation moyenne agrégée est de ${occPlateforme}%.`;
    let conclusion = '';
    if (impayes.length > 0) {
      conclusion = `Le principal enjeu de la période est la régularisation des ${impayes.length} coworking(s) en impayé (${fmtDT(overdueAmount)}). ${occPlateforme < 40 ? 'Par ailleurs, la capacité globale reste sous-exploitée et pourrait être dynamisée.' : ''}`;
    } else if (anomalies.length > 0) {
      conclusion = 'La plateforme reste globalement saine, mais des actions ciblées (accompagnement, diversification, relances) permettraient d\'amplifier la performance.';
    } else {
      conclusion = 'Aucune anomalie significative détectée. La plateforme affiche une dynamique saine : revenus stables ou en croissance, occupation raisonnable et acquisitions régulières.';
    }

    res.json({
      type: 'super_admin',
      periode: { key: win.period, from: win.from, to: win.to, label },
      generatedAt: now.toISOString(),
      verdict,
      titre: 'Rapport intelligent — Plateforme',
      intro,
      conclusion,
      indicateurs: [
        { label: 'CA encaissé', value: fmtDT(ca), evolution: evolutionText(ca, caPrev) },
        { label: 'MRR plateforme', value: fmtDT(mrr), evolution: `${actifs.length} coworking(s) actif(s)` },
        { label: 'Coworkings', value: String((tenants || []).length), evolution: `${nouveauxTenants} nouveau(x) sur la période` },
        { label: 'Membres', value: String(membresCount), evolution: `${nouveauxMembres} nouveau(x) · ${membresEvo >= 0 ? '+' : ''}${membresEvo}%` },
        { label: 'Réservations', value: String(reservationsCount || 0), evolution: `${reservationsConfirmed || 0} confirmée(s)` },
        { label: 'Occupation moyenne', value: `${occPlateforme}%`, evolution: null },
      ],
      sections: [
        {
          key: 'revenus', titre: 'Évolution des revenus', icone: 'trending_up', accent: '#8b5cf6',
          stats: {
            stat1: { label: 'CA encaissé', value: fmtDT(ca) },
            stat2: { label: 'Évolution', value: `${caEvo > 0 ? '+' : ''}${caEvo}%` },
            stat3: { label: 'MRR', value: fmtDT(mrr) },
          },
          analyse: `${fmtDT(ca)} encaissés sur la période contre ${fmtDT(caPrev)} la période précédente, dont ${partTop}% générés par "${topTenantCA ? topTenantCA.nom : 'le premier coworking'}". MRR global de ${fmtDT(mrr)}.`,
          serie: serieRevenus,
        },
        {
          key: 'occupation', titre: 'Taux d\u0027occupation global', icone: 'domain', accent: '#0ea5e9',
          stats: {
            stat1: { label: 'Occupation moyenne', value: `${occPlateforme}%` },
            stat2: { label: 'Espaces actifs', value: String(espacesActifs.length) },
            stat3: { label: 'Sans réservation', value: String(espacesVides) },
          },
          analyse: `Occupation agrégée de ${occPlateforme}% sur l'ensemble des espaces des coworkings actifs. ${espacesVides > 0 ? `${espacesVides} espace(s) restent sans réservation sur la période.` : 'La capacité est globalement valorisée.'}`,
        },
        {
          key: 'membres', titre: 'Évolution du nombre de membres', icone: 'group', accent: '#f95d00',
          stats: {
            stat1: { label: 'Total membres', value: String(membresCount) },
            stat2: { label: 'Nouveaux', value: String(nouveauxMembres) },
            stat3: { label: 'Évolution', value: `${membresEvo > 0 ? '+' : ''}${membresEvo}%` },
          },
          analyse: `${nouveauxMembres} nouveau(x) membre(s) sur la période (${nouveauxMembresPrev} la période précédente), soit une évolution de ${membresEvo >= 0 ? '+' : ''}${membresEvo}%.`,
        },
        {
          key: 'reservations', titre: 'Réservations', icone: 'event_available', accent: '#2fbe8f',
          stats: {
            stat1: { label: 'Réservations', value: String(reservationsCount || 0) },
            stat2: { label: 'Confirmées', value: String(reservationsConfirmed || 0) },
            stat3: { label: 'Coworkings actifs', value: String(actifs.length) },
          },
          analyse: `${reservationsCount || 0} réservation(s) sur la période à l'échelle de la plateforme, dont ${reservationsConfirmed || 0} confirmée(s).`,
        },
        {
          key: 'paiements', titre: 'Paiements en retard', icone: 'pending_actions', accent: '#ba1a1a',
          stats: {
            stat1: { label: 'Coworkings impayés', value: String(impayes.length) },
            stat2: { label: 'Montant impayé', value: fmtDT(overdueAmount) },
            stat3: { label: 'Paiements >7j', value: String(paiementsEnRetard.retardCount) },
          },
          analyse: `${impayes.length} coworking(s) en impayé ou en expiration d'abonnement pour ${fmtDT(overdueAmount)}. ${paiementsEnRetard.retardCount > 0 ? `${paiementsEnRetard.retardCount} paiement(s) membre(s) en attente depuis plus de 7 jours (${fmtDT(paiementsEnRetard.retardMontant)}).` : 'Aucun paiement membre en retard critique.'}`,
        },
        {
          key: 'formations', titre: 'Formations', icone: 'school', accent: '#8b5cf6',
          stats: {
            stat1: { label: 'Formations', value: String(formList.length) },
            stat2: { label: 'Participants', value: String(participants) },
            stat3: { label: 'Remplissage', value: `${fillFormations}%` },
          },
          analyse: `${formList.length} formation(s) programmée(s) à l'échelle plateforme pour ${participants} participant(s) cumulé(s), soit un remplissage moyen de ${fillFormations}%.`,
        },
      ],
      anomalies,
      recommandations,
    });
  } catch (err) {
    console.error('Erreur rapport super admin:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAdminReport, getSuperAdminReport };