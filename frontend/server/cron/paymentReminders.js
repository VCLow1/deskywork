// backend/cron/paymentReminders.js
// Module C Dev 2 — Étape 5
// Tâche cron pour relancer les paiements impayés (J+3, J+7, J+15)

const cron = require('node-cron');
const { sendReminderEmail, isEmailConfigured } = require('../utils/sendEmail');

/**
 * Initialise la tâche cron de relances de paiements.
 * @param {Object} supabaseAdmin - Client Supabase service_role
 */
function startPaymentRemindersCron(supabaseAdmin) {
  // Exécution tous les jours à 09h00
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ [CRON] Démarrage de la vérification des impayés (09h00)...');

    if (!isEmailConfigured()) {
      console.warn('⚠️ [CRON] Relances annulées : SMTP non configuré.');
      return;
    }

    try {
      // On récupère tous les paiements "pending"
      const { data: pendingPayments, error } = await supabaseAdmin
        .from('paiements')
        .select(`
          *,
          profiles(nom, prenom, email, telephone),
          reservations(date_debut, date_fin, espaces(nom, type)),
          abonnements(type, date_debut, date_fin)
        `)
        .eq('statut', 'pending');

      if (error) throw error;

      if (!pendingPayments || pendingPayments.length === 0) {
        console.log('✅ [CRON] Aucun paiement en attente à relancer.');
        return;
      }

      let relancesEnvoyees = 0;
      const now = new Date();
      now.setHours(0, 0, 0, 0); // On compare uniquement les dates (sans les heures)

      for (const payment of pendingPayments) {
        // La date de référence est created_at pour un paiement pending
        const dateCreation = new Date(payment.created_at);
        dateCreation.setHours(0, 0, 0, 0);

        // Différence en jours
        const diffTime = Math.abs(now - dateCreation);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        // Relances exactes à J+3, J+7 et J+15
        if (diffDays === 3 || diffDays === 7 || diffDays === 15) {
          try {
            await sendReminderEmail(payment, diffDays, {
              coworkingName:  process.env.COWORKING_NAME  || 'DeskyWork',
              coworkingEmail: process.env.COWORKING_EMAIL || 'contact@deskywork.tn',
              coworkingTel:   process.env.COWORKING_TEL   || '+216 52 882 880 / +216 52 882 930',
            });
            relancesEnvoyees++;
          } catch (err) {
            console.error(`❌ [CRON] Échec envoi relance J+${diffDays} pour paiement ${payment.id}:`, err.message);
          }
        }
        
        // Étape 6 : Suspension du compte à J+15
        if (diffDays >= 15 && payment.profiles?.statut_compte !== 'suspendu') {
          try {
            const { error: suspendErr } = await supabaseAdmin
              .from('profiles')
              .update({ statut_compte: 'suspendu' })
              .eq('id', payment.user_id);

            if (suspendErr) throw suspendErr;
            
            console.log(`🚫 [CRON] Compte suspendu pour le membre ${payment.user_id} (impayé depuis ${diffDays} jours).`);
            
            // On peut aussi créer une notification système ici
            await supabaseAdmin.from('notifications').insert({
              user_id: payment.user_id,
              type: 'system',
              titre: 'Compte suspendu',
              message: 'Votre compte a été suspendu suite à un impayé de plus de 15 jours.',
            });
            
          } catch (err) {
            console.error(`❌ [CRON] Échec suspension compte ${payment.user_id}:`, err.message);
          }
        }
      }

      console.log(`✅ [CRON] Vérification terminée. ${relancesEnvoyees} relance(s) envoyée(s).`);

    } catch (err) {
      console.error('❌ [CRON] Erreur critique lors de la vérification des impayés:', err);
    }
  });

  console.log('⏰ CRON Job "Relances Impayés" planifié (Tous les jours à 09h00).');
}

module.exports = { startPaymentRemindersCron };
