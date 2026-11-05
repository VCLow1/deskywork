// backend/cron/reservationReminders.js
// Module F Dev 2 — Étape F3
// Tâche cron pour notifications automatiques liées aux réservations

const cron = require('node-cron');
const {
  notifyRappelReservationJ1,
  notifyAlerte15MinAvantFin,
  notifyFinSession,
  notifyDepassementSession
} = require('../services/notificationService');

/**
 * Initialise la tâche cron des rappels de réservations.
 * @param {Object} supabaseAdmin - Client Supabase service_role
 */
function startReservationRemindersCron(supabaseAdmin) {
  
  // ====================================================================
  // CRON 1 : Rappel réservation J-1 (à 18h00 la veille)
  // ====================================================================
  cron.schedule('0 18 * * *', async () => {
    console.log('⏰ [CRON] Rappel réservations J-1 (18h00)...');

    try {
      // Récupérer les réservations confirmées prévues pour demain
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const dayAfterTomorrow = new Date(tomorrow);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

      const { data: reservations, error } = await supabaseAdmin
        .from('reservations')
        .select(`
          *,
          profiles(id, nom, prenom, email),
          espaces(nom, type)
        `)
        .eq('statut', 'confirmed')
        .gte('date_debut', tomorrow.toISOString())
        .lt('date_debut', dayAfterTomorrow.toISOString());

      if (error) throw error;

      if (!reservations || reservations.length === 0) {
        console.log('✅ [CRON] Aucune réservation demain.');
        return;
      }

      let rappelsEnvoyes = 0;

      for (const resa of reservations) {
        try {
          await notifyRappelReservationJ1(supabaseAdmin, 
            {
              id: resa.id,
              date_debut: resa.date_debut,
              date_fin: resa.date_fin,
              espaces: resa.espaces
            },
            {
              id: resa.user_id,
              nom: resa.profiles.nom,
              prenom: resa.profiles.prenom,
              email: resa.profiles.email
            }
          );
          rappelsEnvoyes++;
        } catch (err) {
          console.error(`❌ [CRON] Échec rappel J-1 réservation ${resa.id}:`, err.message);
        }
      }

      console.log(`✅ [CRON] ${rappelsEnvoyes} rappel(s) J-1 envoyé(s).`);

    } catch (err) {
      console.error('❌ [CRON] Erreur rappel réservations J-1:', err);
    }
  });

  // ====================================================================
  // CRON 2 : Alerte 15 minutes avant la fin (toutes les 5 minutes)
  // ====================================================================
  cron.schedule('*/5 * * * *', async () => {
    // console.log('⏰ [CRON] Vérification alertes 15 min avant fin...');

    try {
      const now = new Date();
      const in15Min = new Date(now.getTime() + 15 * 60000);
      const in20Min = new Date(now.getTime() + 20 * 60000);

      // Sessions actives dont la fin approche dans 15-20 minutes
      const { data: sessions, error } = await supabaseAdmin
        .from('sessions')
        .select(`
          *,
          reservations(
            id,
            user_id,
            date_fin,
            espaces(nom, type),
            profiles(nom, prenom, email)
          )
        `)
        .eq('statut', 'active')
        .gte('reservations.date_fin', in15Min.toISOString())
        .lt('reservations.date_fin', in20Min.toISOString());

      if (error) throw error;

      if (!sessions || sessions.length === 0) {
        return; // Pas de log pour ne pas polluer
      }

      let alertesEnvoyees = 0;

      for (const session of sessions) {
        // Vérifier si l'alerte n'a pas déjà été envoyée
        const { data: existingNotif } = await supabaseAdmin
          .from('notifications')
          .select('id')
          .eq('user_id', session.reservations.user_id)
          .eq('type', 'alerte_15min_avant_fin')
          .eq('message', `Votre session se termine dans 15 minutes`)
          .gte('created_at', new Date(now.getTime() - 30 * 60000).toISOString()); // Dernières 30 min

        if (existingNotif && existingNotif.length > 0) {
          continue; // Alerte déjà envoyée
        }

        try {
          await notifyAlerte15MinAvantFin(supabaseAdmin,
            {
              id: session.id,
              heure_fin: session.reservations?.date_fin,
              espaces: session.reservations.espaces
            },
            {
              id: session.reservations.user_id,
              nom: session.reservations.profiles.nom,
              prenom: session.reservations.profiles.prenom,
              email: session.reservations.profiles.email
            }
          );
          alertesEnvoyees++;
        } catch (err) {
          console.error(`❌ [CRON] Échec alerte 15 min session ${session.id}:`, err.message);
        }
      }

      if (alertesEnvoyees > 0) {
        console.log(`✅ [CRON] ${alertesEnvoyees} alerte(s) 15 min envoyée(s).`);
      }

    } catch (err) {
      console.error('❌ [CRON] Erreur alerte 15 min:', err);
    }
  });

  // ====================================================================
  // CRON 3 : Notification fin de session (toutes les 2 minutes)
  // ====================================================================
  cron.schedule('*/2 * * * *', async () => {
    // console.log('⏰ [CRON] Vérification fins de sessions...');

    try {
      const now = new Date();

      // Sessions actives dont l'heure de fin est passée (dans les 5 dernières minutes)
      const fiveMinAgo = new Date(now.getTime() - 5 * 60000);

      const { data: sessions, error } = await supabaseAdmin
        .from('sessions')
        .select(`
          *,
          reservations(
            id,
            user_id,
            date_debut,
            date_fin,
            espaces(nom),
            profiles(nom, prenom, email)
          )
        `)
        .eq('statut', 'active')
        .lte('reservations.date_fin', now.toISOString())
        .gte('reservations.date_fin', fiveMinAgo.toISOString());

      if (error) throw error;

      if (!sessions || sessions.length === 0) {
        return;
      }

      let notificationsEnvoyees = 0;

      for (const session of sessions) {
        try {
          // Mettre à jour le statut de la session
          const { error: updateErr } = await supabaseAdmin
            .from('sessions')
            .update({ statut: 'completed' })
            .eq('id', session.id);

          if (updateErr) throw updateErr;

          // Envoyer la notification
          await notifyFinSession(supabaseAdmin,
            {
              id: session.id,
              heure_debut: session.reservations?.date_debut,
              heure_fin: session.reservations?.date_fin,
              espaces: session.reservations.espaces
            },
            {
              id: session.reservations.user_id,
              nom: session.reservations.profiles.nom,
              prenom: session.reservations.profiles.prenom,
              email: session.reservations.profiles.email
            }
          );

          notificationsEnvoyees++;
        } catch (err) {
          console.error(`❌ [CRON] Échec notification fin session ${session.id}:`, err.message);
        }
      }

      if (notificationsEnvoyees > 0) {
        console.log(`✅ [CRON] ${notificationsEnvoyees} notification(s) fin de session envoyée(s).`);
      }

    } catch (err) {
      console.error('❌ [CRON] Erreur fin de session:', err);
    }
  });

  // ====================================================================
  // CRON 4 : Détection dépassement horaire (toutes les 5 minutes)
  // ====================================================================
  cron.schedule('*/5 * * * *', async () => {
    // console.log('⏰ [CRON] Vérification dépassements horaires...');

    try {
      const now = new Date();
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60000);

      // Sessions actives dont l'heure de fin est dépassée de plus de 5 minutes
      const fiveMinAgo = new Date(now.getTime() - 5 * 60000);

      const { data: sessions, error } = await supabaseAdmin
        .from('sessions')
        .select(`
          *,
          reservations(
            id,
            user_id,
            date_fin,
            espaces(nom),
            profiles(nom, prenom, email)
          )
        `)
        .eq('statut', 'active')
        .lt('reservations.date_fin', fiveMinAgo.toISOString());

      if (error) throw error;

      if (!sessions || sessions.length === 0) {
        return;
      }

      let alertesEnvoyees = 0;

      for (const session of sessions) {
        const heureFin = new Date(session.reservations?.date_fin);
        const minutesDepassement = Math.floor((now - heureFin) / 60000);

        // Vérifier si une alerte n'a pas déjà été envoyée récemment
        const { data: existingNotif } = await supabaseAdmin
          .from('notifications')
          .select('id')
          .eq('user_id', session.reservations.user_id)
          .eq('type', 'depassement_session')
          .gte('created_at', thirtyMinAgo.toISOString());

        if (existingNotif && existingNotif.length > 0) {
          continue; // Alerte déjà envoyée
        }

        try {
          await notifyDepassementSession(supabaseAdmin,
            {
              id: session.id,
              heure_fin: session.reservations?.date_fin,
              espaces: session.reservations.espaces
            },
            {
              id: session.reservations.user_id,
              nom: session.reservations.profiles.nom,
              prenom: session.reservations.profiles.prenom,
              email: session.reservations.profiles.email
            },
            minutesDepassement
          );

          alertesEnvoyees++;
        } catch (err) {
          console.error(`❌ [CRON] Échec alerte dépassement session ${session.id}:`, err.message);
        }
      }

      if (alertesEnvoyees > 0) {
        console.log(`✅ [CRON] ${alertesEnvoyees} alerte(s) dépassement envoyée(s).`);
      }

    } catch (err) {
      console.error('❌ [CRON] Erreur dépassement horaire:', err);
    }
  });

  console.log('⏰ CRON Job "Rappels Réservations" planifié :');
  console.log('   - Rappel J-1 : Tous les jours à 18h00');
  console.log('   - Alerte 15 min : Toutes les 5 minutes');
  console.log('   - Fin de session : Toutes les 2 minutes');
  console.log('   - Dépassement : Toutes les 5 minutes');
}

module.exports = { startReservationRemindersCron };
