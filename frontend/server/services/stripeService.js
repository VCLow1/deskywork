const Stripe = require('stripe');

let stripeClient = null;

function getStripe() {
  if (!stripeClient && process.env.STRIPE_SECRET_KEY) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getFrontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}

function toStripeAmount(montant) {
  return Math.round(parseFloat(montant) * 1000);
}

async function createCheckoutSession(payment, userId, options = {}) {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error('Stripe non configuré. Ajoutez STRIPE_SECRET_KEY dans .env.');
  }

  const paymentId = payment.id;
  const ref = payment.numero_recu || paymentId.slice(0, 8);
  const frontendUrl = getFrontendUrl();
  const paymentsPath = options.paymentsPath || '/member/payments';
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
  const formationTitre = payment.inscriptions_formations?.[0]?.formations?.titre;
  const productName = formationTitre ? `Formation : ${formationTitre}` : `Paiement ${ref}`;
  const productDescription = formationTitre
    ? `Inscription à la formation « ${formationTitre} »`
    : process.env.COWORKING_NAME || 'Coworking Space';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency,
        product_data: {
          name: productName,
          description: productDescription,
        },
        unit_amount: toStripeAmount(payment.montant),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${frontendUrl}${paymentsPath}/verify?paymentId=${paymentId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}${paymentsPath}`,
    metadata: {
      paymentId,
      userId,
    },
    client_reference_id: paymentId,
  });

  return session;
}

async function retrieveCheckoutSession(sessionId) {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error('Stripe non configuré.');
  }

  return stripe.checkout.sessions.retrieve(sessionId);
}

function validateCheckoutSession(session, paymentId, userId) {
  if (!session) {
    throw new Error('Session Stripe introuvable.');
  }
  if (session.metadata?.paymentId !== paymentId) {
    throw new Error('Session Stripe invalide pour ce paiement.');
  }
  if (session.metadata?.userId !== userId) {
    throw new Error('Session Stripe non autorisée.');
  }
}

function isCheckoutSessionPaid(session) {
  return session.payment_status === 'paid' || session.status === 'complete';
}

function getExternalReference(session) {
  const paymentIntent = session.payment_intent;
  if (typeof paymentIntent === 'string') return paymentIntent;
  return session.id;
}

function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    throw new Error('Webhook Stripe non configuré.');
  }

  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

module.exports = {
  getStripe,
  isStripeConfigured,
  createCheckoutSession,
  retrieveCheckoutSession,
  validateCheckoutSession,
  isCheckoutSessionPaid,
  getExternalReference,
  constructWebhookEvent,
};
