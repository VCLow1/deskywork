// backend/cron/formationReminders.js
// Module G — Rappel des formations J-1

const cron = require('node-cron');
const { notifyRappelFormationJ1 } = require('../services/notificationService');

/**
 * Initialise la tâche cron des rappels de formations J-1.
 * @param {Object} supabaseAdmin - Client Supabase service_role
 */
function startFormationRemindersCron(supabaseAdmin) {
  
  // Exécution quotidienne à 18h30
  cron.schedule('30 18 * * *', async () => {
    console.log('⏰ [CRON] Rappel formations J-1 (18h30)...');

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const dayAfterTomorrow = new Date(tomorrow);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

      // 1. Récupérer les formations prévues pour demain
      const { data: formations, error: fErr } = await supabaseAdmin
        .from('formations')
        .select('*')
        .eq('statut', 'planifiee')
        .gte('date_debut', tomorrow.toISOString())
        .lt('date_debut', dayAfterTomorrow.toISOString());

      if (fErr) throw fErr;

      if (!formations || formations.length === 0) {
        console.log('✅ [CRON] Aucune formation prévue demain.');
        return;
      }

      let countEmails = 0;

      for (const form of formations) {
        // 2. Récupérer les inscrits confirmés pour cette formation
        const { data: inscriptions, error: iErr } = await supabaseAdmin
          .from('inscriptions_formations')
          .select('*, profiles!user_id(id, nom, prenom, email)')
          .eq('formation_id', form.id)
          .eq('statut', 'confirmee');

        if (iErr) {
          console.error(`❌ [CRON] Erreur récupération inscrits pour formation ${form.id}:`, iErr.message);
          continue;
        }

        // 3. Envoyer la notification J-1 à chaque inscrit
        for (const ins of inscriptions) {
          if (ins.profiles?.email) {
            try {
              await notifyRappelFormationJ1(supabaseAdmin, 
                { id: form.id, titre: form.titre, date_debut: form.date_debut, date_fin: form.date_fin },
                { id: ins.user_id, nom: ins.profiles.nom, prenom: ins.profiles.prenom, email: ins.profiles.email }
              );
              countEmails++;
            } catch (err) {
              console.error(`❌ [CRON] Échec envoi rappel J-1 à ${ins.profiles.email} pour formation ${form.id}:`, err.message);
            }
          }
        }
      }

      console.log(`✅ [CRON] Fin rappel formations J-1. Total rappels envoyés : ${countEmails}`);

    } catch (err) {
      console.error('❌ [CRON] Erreur générale dans le rappel formations J-1:', err.message);
    }
  });
}

module.exports = { startFormationRemindersCron };
