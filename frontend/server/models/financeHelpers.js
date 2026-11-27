/**
 * Helpers Finance LOT 4 :
 * - Arrondi strict au millime tunisien (3 décimales)
 * - Calcul des tranches de paiements partiels (Montant payé / Reste à payer)
 * - Classement d'ancienneté des impayés (J+1, J+7, J+15)
 * - Blocage des nouvelles réservations après X jours d'impayé (défaut 7 jours)
 * - Génération des modèles de relance WhatsApp / E-mail en français sans jargon
 */

function roundMillime(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function formatDT(value) {
  const rounded = roundMillime(value);
  const fixed = rounded.toFixed(3);
  const [intPart, decPart] = fixed.split('.');
  const withSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${withSpaces},${decPart} DT`;
}

/**
 * Calcule le nouvel état après un encaissement partiel ou total.
 */
function computePartialPaymentState({ totalDue, alreadyPaid = 0, collectedNow }) {
  const total = roundMillime(totalDue);
  const prevPaid = roundMillime(alreadyPaid);
  const remainingBefore = roundMillime(Math.max(0, total - prevPaid));
  const amountCollected = roundMillime(collectedNow);

  if (!Number.isFinite(amountCollected) || amountCollected <= 0) {
    return { valid: false, error: 'Le montant encaissé doit être strictement positif.' };
  }
  if (amountCollected > roundMillime(remainingBefore + 0.001)) {
    return {
      valid: false,
      error: `Le montant encaissé (${formatDT(amountCollected)}) dépasse le reste à payer (${formatDT(remainingBefore)}).`,
    };
  }

  const effectiveCollected = Math.min(amountCollected, remainingBefore);
  const nextRemaining = roundMillime(Math.max(0, remainingBefore - effectiveCollected));
  const nextPaidTotal = roundMillime(prevPaid + effectiveCollected);
  const isFullyPaid = nextRemaining <= 0.001;

  return {
    valid: true,
    totalDue: total,
    previouslyPaid: prevPaid,
    collectedNow: roundMillime(effectiveCollected),
    montantPayeTotal: isFullyPaid ? total : nextPaidTotal,
    resteAPayer: isFullyPaid ? 0 : nextRemaining,
    nextStatus: isFullyPaid ? 'paid' : 'partial',
    isFullyPaid,
  };
}

/**
 * Calcule le nombre de jours de retard et le palier d'ancienneté (a_echeance, J+1, J+7, J+15).
 */
function computeAgingBucket(referenceDateInput, now = new Date()) {
  if (!referenceDateInput) {
    return { daysOverdue: 0, bucket: 'a_echeance', label: 'À échéance' };
  }
  const refDate = new Date(referenceDateInput);
  if (Number.isNaN(refDate.getTime())) {
    return { daysOverdue: 0, bucket: 'a_echeance', label: 'À échéance' };
  }
  const diffMs = now.getTime() - refDate.getTime();
  const daysOverdue = Math.max(0, Math.floor(diffMs / 86400000));

  if (daysOverdue >= 15) {
    return { daysOverdue, bucket: 'j15', label: 'J+15 et plus' };
  }
  if (daysOverdue >= 7) {
    return { daysOverdue, bucket: 'j7', label: 'J+7' };
  }
  if (daysOverdue >= 1) {
    return { daysOverdue, bucket: 'j1', label: 'J+1' };
  }
  return { daysOverdue: 0, bucket: 'a_echeance', label: 'À échéance' };
}

function getUnpaidBlockingConfig(tenantSettings = {}) {
  const finance = tenantSettings?.finance_rules && typeof tenantSettings.finance_rules === 'object'
    ? tenantSettings.finance_rules
    : {};
  return {
    block_booking_on_overdue: finance.block_booking_on_overdue !== undefined ? Boolean(finance.block_booking_on_overdue) : false,
    overdue_block_days: Math.max(1, parseInt(finance.overdue_block_days ?? 7, 10) || 7),
    auto_proposal_noshow_minutes: Math.max(5, parseInt(finance.auto_proposal_noshow_minutes ?? 15, 10) || 15),
    unconfirmed_booking_expiry_hours: Math.max(1, parseInt(finance.unconfirmed_booking_expiry_hours ?? 2, 10) || 2),
  };
}

/**
 * Construit les modèles prêts à l'envoi (WhatsApp & E-mail) pour une relance d'impayé.
 */
function buildReminderTemplates({
  clientName = 'Client',
  amountRemaining = 0,
  daysOverdue = 0,
  tenantName = 'DeskyWork',
  reference = '',
  promiseDate = null,
}) {
  const formattedAmount = formatDT(amountRemaining);
  const refPart = reference ? ` (${reference})` : '';
  const delayPart = daysOverdue > 0 ? ` (retard de ${daysOverdue} jour${daysOverdue > 1 ? 's' : ''})` : '';
  const promisePart = promiseDate
    ? ` Nous avons bien noté votre engagement de règlement pour le ${new Date(promiseDate).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })}.`
    : '';

  const whatsapp =
    `Bonjour ${clientName}, sauf erreur de notre part, un solde de ${formattedAmount}${refPart} reste dû auprès de ${tenantName}${delayPart}.${promisePart} Merci de bien vouloir régulariser votre situation à l'accueil ou par virement bancaire.`;

  const emailSubject = `Rappel de paiement — Solde de ${formattedAmount} (${tenantName})`;
  const emailBody =
    `Bonjour ${clientName},\n\n` +
    `Nous vous informons qu'un montant de ${formattedAmount}${refPart} demeure en attente de règlement auprès de ${tenantName}${delayPart}.${promisePart}\n\n` +
    `Vous pouvez régler ce montant à l'accueil (espèces, carte bancaire, chèque) ou par virement bancaire.\n\n` +
    `Si votre règlement vient d'être effectué, merci de ne pas tenir compte de ce message.\n\n` +
    `Cordialement,\nL'équipe ${tenantName}`;

  return { whatsapp, emailSubject, emailBody };
}

module.exports = {
  roundMillime,
  formatDT,
  computePartialPaymentState,
  computeAgingBucket,
  getUnpaidBlockingConfig,
  buildReminderTemplates,
};
