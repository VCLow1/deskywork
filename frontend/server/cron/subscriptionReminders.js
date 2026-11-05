// backend/cron/subscriptionReminders.js
// Module F Dev 2 — Étape F3
// Tâche cron pour notifications automatiques liées aux abonnements

const cron = require('node-cron');
const {
  notifyAbonnementExpirantJ7,
  notifyAbonnementExpire
} = require('../services/notificationService');

/**
 * Initialise la tâche cron des rappels d'abonnements.
 * @param {Object} supabaseAdmin - Client Supabase service_role
 */
function startSubscriptionRemindersCron(supabaseAdmin) {
  
  // ====================================================================
  // CRON 1 : Rappel abonnement expirant J-7 (tous les jours à 10h00)
  // ====================================================================
  cron.schedule('0 10 * * *', async () => {
    console.log('⏰ [CRON] Rappel abonnements expirant J-7 (10h00)...');

    try {
      // Calculer la date dans 7 jours (à minuit)
      const in7Days = new Date();
      in7Days.setDate(in7Days.getDate() + 7);
      in7Days.setHours(0, 0, 0, 0);

      const in8Days = new Date(in7Days);
      in8Days.setDate(in8Days.getDate() + 1);

      // Récupérer les abonnements actifs expirant dans exactement 7 jours
      const { data: abonnements, error } = await supabaseAdmin
        .from('abonnements')
        .select(`
          *,
          profiles(id, nom, prenom, email)
        `)
        .eq('statut', 'active')
        .gte('date_fin', in7Days.toISOString())
        .lt('date_fin', in8Days.toISOString());

      if (error) throw error;

      if (!abonnements || abonnements.length === 0) {
        console.log('✅ [CRON] Aucun abonnement expirant dans 7 jours.');
        return;
      }

      let rappelsEnvoyes = 0;

      for (const abo of abonnements) {
        // Vérifier si un rappel J-7 n'a pas déjà été envoyé
        const { data: existingNotif } = await supabaseAdmin
          .from('notifications')
          .select('id')
          .eq('user_id', abo.user_id)
          .eq('type', 'abonnement_expirant_j7')
          .gte('created_at', new Date(Date.now() - 48 * 3600000).toISOString()); // Dernières 48h

        if (existingNotif && existingNotif.length > 0) {
          continue; // Rappel déjà envoyé
        }

        try {
          await notifyAbonnementExpirantJ7(supabaseAdmin,
            {
              id: abo.id,
              type: abo.type,
              date_fin: abo.date_fin
            },
            {
              id: abo.user_id,
              nom: abo.profiles.nom,
              prenom: abo.profiles.prenom,
              email: abo.profiles.email
            }
          );
          rappelsEnvoyes++;
        } catch (err) {
          console.error(`❌ [CRON] Échec rappel J-7 abonnement ${abo.id}:`, err.message);
        }
      }

      console.log(`✅ [CRON] ${rappelsEnvoyes} rappel(s) J-7 envoyé(s).`);

    } catch (err) {
      console.error('❌ [CRON] Erreur rappel abonnements J-7:', err);
    }
  });

  // ====================================================================
  // CRON 2 : Rappel abonnement expirant J-3 (tous les jours à 10h30)
  // ====================================================================
  cron.schedule('30 10 * * *', async () => {
    console.log('⏰ [CRON] Rappel abonnements expirant J-3 (10h30)...');

    try {
      // Calculer la date dans 3 jours (à minuit)
      const in3Days = new Date();
      in3Days.setDate(in3Days.getDate() + 3);
      in3Days.setHours(0, 0, 0, 0);

      const in4Days = new Date(in3Days);
      in4Days.setDate(in4Days.getDate() + 1);

      // Récupérer les abonnements actifs expirant dans exactement 3 jours
      const { data: abonnements, error } = await supabaseAdmin
        .from('abonnements')
        .select(`
          *,
          profiles(id, nom, prenom, email)
        `)
        .eq('statut', 'active')
        .gte('date_fin', in3Days.toISOString())
        .lt('date_fin', in4Days.toISOString());

      if (error) throw error;

      if (!abonnements || abonnements.length === 0) {
        console.log('✅ [CRON] Aucun abonnement expirant dans 3 jours.');
        return;
      }

      let rappelsEnvoyes = 0;

      for (const abo of abonnements) {
        // Vérifier si un rappel J-3 n'a pas déjà été envoyé
        const { data: existingNotif } = await supabaseAdmin
          .from('notifications')
          .select('id')
          .eq('user_id', abo.user_id)
          .eq('type', 'abonnement_expirant_j7') // On réutilise le même template
          .gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString()); // Dernières 24h

        if (existingNotif && existingNotif.length > 0) {
          continue; // Rappel déjà envoyé récemment
        }

        try {
          // On utilise la même fonction mais avec une note différente
          await notifyAbonnementExpirantJ7(supabaseAdmin,
            {
              id: abo.id,
              type: abo.type,
              date_fin: abo.date_fin
            },
            {
              id: abo.user_id,
              nom: abo.profiles.nom,
              prenom: abo.profiles.prenom,
              email: abo.profiles.email
            }
          );
          rappelsEnvoyes++;
        } catch (err) {
          console.error(`❌ [CRON] Échec rappel J-3 abonnement ${abo.id}:`, err.message);
        }
      }

      console.log(`✅ [CRON] ${rappelsEnvoyes} rappel(s) J-3 envoyé(s).`);

    } catch (err) {
      console.error('❌ [CRON] Erreur rappel abonnements J-3:', err);
    }
  });

  // ====================================================================
  // CRON 3 : Détection abonnements expirés (tous les jours à 08h00)
  // ====================================================================
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ [CRON] Détection abonnements expirés (08h00)...');

    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      // Récupérer les abonnements actifs dont la date de fin est dépassée
      const { data: expiredAbonnements, error } = await supabaseAdmin
        .from('abonnements')
        .select(`
          *,
          profiles(id, nom, prenom, email, statut_compte)
        `)
        .eq('statut', 'active')
        .lt('date_fin', now.toISOString());

      if (error) throw error;

      if (!expiredAbonnements || expiredAbonnements.length === 0) {
        console.log('✅ [CRON] Aucun abonnement expiré.');
        return;
      }

      let notificationsEnvoyees = 0;

      for (const abo of expiredAbonnements) {
        try {
          // 1. Mettre à jour le statut de l'abonnement
          const { error: updateAboErr } = await supabaseAdmin
            .from('abonnements')
            .update({ statut: 'expired' })
            .eq('id', abo.id);

          if (updateAboErr) throw updateAboErr;

          // 2. Vérifier si le membre a d'autres abonnements actifs
          const { data: otherActiveAbos, error: checkErr } = await supabaseAdmin
            .from('abonnements')
            .select('id')
            .eq('user_id', abo.user_id)
            .eq('statut', 'active')
            .gte('date_fin', now.toISOString());

          if (checkErr) throw checkErr;

          // 3. Si aucun autre abonnement actif, suspendre le compte
          if (!otherActiveAbos || otherActiveAbos.length === 0) {
            const { error: suspendErr } = await supabaseAdmin
              .from('profiles')
              .update({ statut_compte: 'suspended' })
              .eq('id', abo.user_id);

            if (suspendErr) throw suspendErr;

            console.log(`🚫 [CRON] Compte suspendu pour le membre ${abo.user_id} (abonnement expiré).`);
          }

          // 4. Envoyer la notification d'expiration
          await notifyAbonnementExpire(supabaseAdmin,
            {
              id: abo.id,
              type: abo.type,
              date_fin: abo.date_fin
            },
            {
              id: abo.user_id,
              nom: abo.profiles.nom,
              prenom: abo.profiles.prenom,
              email: abo.profiles.email
            }
          );

          notificationsEnvoyees++;

        } catch (err) {
          console.error(`❌ [CRON] Échec traitement abonnement expiré ${abo.id}:`, err.message);
        }
      }

      console.log(`✅ [CRON] ${notificationsEnvoyees} abonnement(s) expiré(s) traité(s).`);

    } catch (err) {
      console.error('❌ [CRON] Erreur détection abonnements expirés:', err);
    }
  });

  // ====================================================================
  // CRON 4 : Renouvellement automatique (tous les jours à 06h00)
  // ====================================================================
  cron.schedule('0 6 * * *', async () => {
    console.log('⏰ [CRON] Vérification renouvellements automatiques (06h00)...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Récupérer les abonnements actifs avec renouvellement_auto expirant aujourd'hui
      const { data: abonnements, error } = await supabaseAdmin
        .from('abonnements')
        .select(`
          *,
          profiles(id, nom, prenom, email)
        `)
        .eq('statut', 'active')
        .eq('renouvellement_auto', true)
        .gte('date_fin', today.toISOString())
        .lt('date_fin', tomorrow.toISOString());

      if (error) throw error;

      if (!abonnements || abonnements.length === 0) {
        console.log('✅ [CRON] Aucun renouvellement automatique aujourd\'hui.');
        return;
      }

      let renouvellements = 0;

      for (const abo of abonnements) {
        try {
          // Calculer la nouvelle date de fin selon le type
          const newDateDebut = new Date(abo.date_fin);
          let newDateFin = new Date(newDateDebut);

          switch (abo.type) {
            case 'day_pass':
              newDateFin.setDate(newDateFin.getDate() + 1);
              break;
            case 'week_pass':
              newDateFin.setDate(newDateFin.getDate() + 7);
              break;
            case 'mensuel':
              newDateFin.setMonth(newDateFin.getMonth() + 1);
              break;
            case 'trimestriel':
              newDateFin.setMonth(newDateFin.getMonth() + 3);
              break;
            case 'annuel':
              newDateFin.setFullYear(newDateFin.getFullYear() + 1);
              break;
          }

          // Créer le nouvel abonnement
          const { data: newAbo, error: insertErr } = await supabaseAdmin
            .from('abonnements')
            .insert({
              user_id: abo.user_id,
              type: abo.type,
              date_debut: newDateDebut.toISOString(),
              date_fin: newDateFin.toISOString(),
              statut: 'active',
              renouvellement_auto: true
            })
            .select()
            .single();

          if (insertErr) throw insertErr;

          // Marquer l'ancien abonnement comme expiré
          const { error: updateErr } = await supabaseAdmin
            .from('abonnements')
            .update({ statut: 'expired', renouvellement_auto: false })
            .eq('id', abo.id);

          if (updateErr) throw updateErr;

          // Créer un paiement pending pour le nouvel abonnement
          const montants = {
            'day_pass': 15.00,
            'week_pass': 80.00,
            'mensuel': 250.00,
            'trimestriel': 650.00,
            'annuel': 2200.00
          };

          const { error: paymentErr } = await supabaseAdmin
            .from('paiements')
            .insert({
              user_id: abo.user_id,
              abonnement_id: newAbo.id,
              montant: montants[abo.type] || 250.00,
              mode: 'auto_renew',
              statut: 'pending'
            });

          if (paymentErr) throw paymentErr;

          console.log(`✅ [CRON] Abonnement ${abo.type} renouvelé pour membre ${abo.user_id}.`);
          renouvellements++;

        } catch (err) {
          console.error(`❌ [CRON] Échec renouvellement abonnement ${abo.id}:`, err.message);
        }
      }

      console.log(`✅ [CRON] ${renouvellements} renouvellement(s) automatique(s) effectué(s).`);

    } catch (err) {
      console.error('❌ [CRON] Erreur renouvellements automatiques:', err);
    }
  });

  console.log('⏰ CRON Job "Rappels Abonnements" planifié :');
  console.log('   - Rappel J-7 : Tous les jours à 10h00');
  console.log('   - Rappel J-3 : Tous les jours à 10h30');
  console.log('   - Expiration : Tous les jours à 08h00');
  console.log('   - Renouvellement auto : Tous les jours à 06h00');
}

module.exports = { startSubscriptionRemindersCron };
