const { generateReceiptPDF } = require('../utils/generateReceipt');
const { sendReceiptEmail, isEmailConfigured } = require('../utils/sendEmail');

function getCoworkingConfig() {
  return {
    coworkingName: process.env.COWORKING_NAME || 'DeskyWork',
    coworkingEmail: process.env.COWORKING_EMAIL || 'contact@deskywork.tn',
    coworkingTel: process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930',
    coworkingAdresse: process.env.COWORKING_ADRESSE || 'Tunis, Tunisie',
  };
}

async function finalizeOnlinePayment(supabaseAdmin, paymentId, userId, referenceExterne) {
  const { data: existing } = await supabaseAdmin
    .from('paiements')
    .select('statut')
    .eq('id', paymentId)
    .eq('user_id', userId)
    .single();

  if (existing?.statut === 'paid') {
    const { data: payment } = await supabaseAdmin
      .from('paiements')
      .select(`
        *,
        profiles(nom, prenom, email, telephone),
        reservations(date_debut, date_fin, espaces(nom, type)),
        abonnements(type, date_debut, date_fin)
      `)
      .eq('id', paymentId)
      .single();
    return payment;
  }

  const { data: updatedPayment, error } = await supabaseAdmin
    .from('paiements')
    .update({
      statut: 'paid',
      mode: 'online',
      date_paiement: new Date().toISOString(),
      ...(referenceExterne ? { reference_externe: referenceExterne } : {}),
    })
    .eq('id', paymentId)
    .eq('user_id', userId)
    .select(`
      *,
      profiles(nom, prenom, email, telephone),
      reservations(date_debut, date_fin, espaces(nom, type)),
      abonnements(type, date_debut, date_fin)
    `)
    .single();

  if (error) throw error;

  // Mettre à jour le statut de la réservation associée à 'confirmed'
  if (updatedPayment.reservation_id) {
    const { error: resError } = await supabaseAdmin
      .from('reservations')
      .update({ statut: 'confirmed' })
      .eq('id', updatedPayment.reservation_id);

    if (resError) {
      console.error('Erreur lors de la mise à jour de la réservation:', resError.message);
    }
  }

  // Mettre à jour le statut paiement des inscriptions formations associées
  try {
    await supabaseAdmin
      .from('inscriptions_formations')
      .update({ statut_paiement: 'paye' })
      .eq('paiement_id', paymentId);
  } catch (insPayErr) {
    console.warn('⚠️ Erreur mise à jour statut_paiement inscription formation:', insPayErr.message);
  }

  if (isEmailConfigured()) {
    try {
      const config = getCoworkingConfig();
      const pdfBuffer = await generateReceiptPDF(updatedPayment, config);
      await sendReceiptEmail(updatedPayment, pdfBuffer, config);
    } catch (emailErr) {
      console.error('Avertissement : échec envoi email après paiement Stripe:', emailErr.message);
    }
  }

  return updatedPayment;
}

module.exports = {
  finalizeOnlinePayment,
};
