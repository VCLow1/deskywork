// backend/services/whatsappService.js
// Service de notification WhatsApp pour la plateforme DeskyWork / VC LOW
// Supporte UltraMsg, Twilio, Meta Cloud API, GreenAPI et simulateur de développement

const https = require('https');
const http = require('http');

/**
 * Normalise un numéro de téléphone pour WhatsApp (ex: +216 98 123 456 -> 21698123456)
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  // Retirer tous les caractères non numériques sauf le +
  let cleaned = String(phone).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  // Si numéro tunisien à 8 chiffres (ex: 98123456 ou 20123456), ajouter l'indicatif 216
  if (cleaned.length === 8 && /^[24597]/.test(cleaned)) {
    cleaned = '216' + cleaned;
  }
  return cleaned;
}

/**
 * Envoie une requête HTTP/HTTPS générique
 */
function makeHttpRequest(urlStr, options, postData) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method || 'POST',
        headers: options.headers || {},
      };

      const req = lib.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ raw: data, status: res.statusCode });
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.setTimeout(10000, () => {
        req.destroy(new Error('Timeout de connexion WhatsApp API (10s)'));
      });

      if (postData) {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Envoie un message texte ou média via WhatsApp
 * 
 * @param {string} toPhone - Numéro de téléphone du destinataire
 * @param {string} body - Texte du message WhatsApp (supporte *gras*, _italique_, emojis)
 * @param {Object} options - Options ({ withLogo: boolean, logoUrl?: string })
 * @returns {Promise<Object>} - { success: boolean, messageId?: string, error?: string, simulated?: boolean }
 */
async function sendWhatsApp(toPhone, body, options = {}) {
  const normalizedTo = normalizePhoneNumber(toPhone);
  if (!normalizedTo) {
    return { success: false, error: 'Numéro de téléphone invalide ou manquant' };
  }

  const provider = (process.env.WHATSAPP_PROVIDER || 'ultramsg').toLowerCase();
  const logoUrl = options.logoUrl || process.env.DESKYWORK_LOGO_URL || 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/avatars/branding/deskywork-logo.png';
  const shouldAttachLogo = options.withLogo !== false && !!logoUrl;

  // ── 1. ULTRAMSG (UltraMsg API) ──────────────────────────────────────────
  if (provider === 'ultramsg' && process.env.ULTRAMSG_INSTANCE_ID && process.env.ULTRAMSG_TOKEN) {
    try {
      const instanceId = process.env.ULTRAMSG_INSTANCE_ID;
      const token = process.env.ULTRAMSG_TOKEN;
      
      let apiUrl = `https://api.ultramsg.com/${instanceId}/messages/chat`;
      let postData;

      if (shouldAttachLogo) {
        apiUrl = `https://api.ultramsg.com/${instanceId}/messages/image`;
        postData = new URLSearchParams({
          token,
          to: normalizedTo,
          image: logoUrl,
          caption: body,
          priority: '10',
        }).toString();
      } else {
        postData = new URLSearchParams({
          token,
          to: normalizedTo,
          body,
          priority: '10',
        }).toString();
      }

      const result = await makeHttpRequest(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, postData);

      console.log(`📱 WhatsApp envoyé via UltraMsg à ${normalizedTo} (ID: ${result.id || 'OK'})`);
      return { success: true, messageId: result.id || 'ultramsg-sent', provider: 'ultramsg' };
    } catch (err) {
      console.error(`❌ Erreur UltraMsg WhatsApp à ${normalizedTo}:`, err.message);
      return { success: false, error: err.message, provider: 'ultramsg' };
    }
  }

  // ── 2. TWILIO WHATSAPP ──────────────────────────────────────────────────
  if (provider === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_WHATSAPP_FROM.startsWith('whatsapp:') ? process.env.TWILIO_WHATSAPP_FROM : `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`;
      const to = `whatsapp:+${normalizedTo}`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

      const params = { From: from, To: to, Body: body };
      if (shouldAttachLogo) {
        params.MediaUrl = logoUrl;
      }

      const postData = new URLSearchParams(params).toString();
      const result = await makeHttpRequest(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, postData);

      console.log(`📱 WhatsApp envoyé via Twilio à ${normalizedTo} (SID: ${result.sid})`);
      return { success: true, messageId: result.sid, provider: 'twilio' };
    } catch (err) {
      console.error(`❌ Erreur Twilio WhatsApp à ${normalizedTo}:`, err.message);
      return { success: false, error: err.message, provider: 'twilio' };
    }
  }

  // ── 3. META CLOUD API (Official WhatsApp Business API) ──────────────────
  if (provider === 'meta' && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    try {
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const apiUrl = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

      const payload = shouldAttachLogo
        ? {
            messaging_product: 'whatsapp',
            to: normalizedTo,
            type: 'image',
            image: { link: logoUrl, caption: body },
          }
        : {
            messaging_product: 'whatsapp',
            to: normalizedTo,
            type: 'text',
            text: { body },
          };

      const result = await makeHttpRequest(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }, payload);

      console.log(`📱 WhatsApp envoyé via Meta Cloud API à ${normalizedTo}`);
      return { success: true, messageId: result.messages?.[0]?.id || 'meta-sent', provider: 'meta' };
    } catch (err) {
      console.error(`❌ Erreur Meta WhatsApp à ${normalizedTo}:`, err.message);
      return { success: false, error: err.message, provider: 'meta' };
    }
  }

  // ── 4. GREEN API (Green-API WhatsApp avec support Logo) ─────────────────
  if (provider === 'greenapi' && process.env.GREEN_API_INSTANCE_ID && process.env.GREEN_API_TOKEN) {
    try {
      const baseUrl = (process.env.GREEN_API_URL || 'https://api.green-api.com').replace(/\/+$/, '');
      const instanceId = process.env.GREEN_API_INSTANCE_ID;
      const token = process.env.GREEN_API_TOKEN;

      // 1. Tenter d'envoyer avec le logo officiel DeskyWork en image d'en-tête
      if (shouldAttachLogo) {
        try {
          const mediaApiUrl = `${baseUrl}/waInstance${instanceId}/sendFileByUrl/${token}`;
          const mediaPayload = {
            chatId: `${normalizedTo}@c.us`,
            urlFile: logoUrl,
            fileName: 'deskywork-logo.png',
            caption: body,
          };

          const mediaResult = await makeHttpRequest(mediaApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }, mediaPayload);

          if (mediaResult && (mediaResult.idMessage || mediaResult.messageId)) {
            console.log(`📱 WhatsApp avec logo envoyé via Green-API à ${normalizedTo} (ID: ${mediaResult.idMessage || 'ok'})`);
            return { success: true, messageId: mediaResult.idMessage || 'greenapi-media-sent', provider: 'greenapi' };
          }
        } catch (mediaErr) {
          console.warn(`⚠️ Échec envoi image Green-API, basculement en message texte : ${mediaErr.message}`);
        }
      }

      // 2. Envoi message texte standard
      const textApiUrl = `${baseUrl}/waInstance${instanceId}/sendMessage/${token}`;
      const payload = {
        chatId: `${normalizedTo}@c.us`,
        message: body,
      };

      const result = await makeHttpRequest(textApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, payload);

      console.log(`📱 WhatsApp envoyé via Green-API à ${normalizedTo} (ID: ${result.idMessage || 'ok'})`);
      return { success: true, messageId: result.idMessage || 'greenapi-sent', provider: 'greenapi' };
    } catch (err) {
      console.error(`❌ Erreur Green-API WhatsApp à ${normalizedTo}:`, err.message);
      return { success: false, error: err.message, provider: 'greenapi' };
    }
  }

  // ── 5. MODE SIMULATEUR / DÉVELOPPEMENT ───────────────────────────────────
  console.log(`\n💬 ─────────────────── [SIMULATION WHATSAPP] ───────────────────`);
  console.log(`📞 Destinataire : +${normalizedTo}`);
  console.log(`📝 Message :\n${body}`);
  console.log(`─────────────────────────────────────────────────────────────────\n`);

  return {
    success: true,
    simulated: true,
    messageId: `sim-wa-${Date.now()}`,
    note: 'Message simulé avec succès en console (configurez ULTRAMSG_TOKEN ou TWILIO_AUTH_TOKEN pour la production).',
  };
}

// ══════════════════════════════════════════════════════════════════════════
// GÉNÉRATEUR DE TEXTE WHATSAPP SELON LE TYPE DE NOTIFICATION
// ══════════════════════════════════════════════════════════════════════════

/**
 * Construit le texte formaté pour WhatsApp pour chacun des types d'événements
 */
function generateWhatsAppMessage(type, data, config) {
  const app = config.appName || process.env.COWORKING_NAME || 'DeskyWork';
  const cName = config.coworkingName || process.env.COWORKING_NAME || 'DeskyWork';
  const cTel = config.coworkingTel || process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930';
  const url = config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
  const prenom = data.membre?.prenom || data.formateur?.prenom || data.nom || 'Membre';

  switch (type) {
    case 'test_notification':
      return `✨ *${app}* — Test de Notification WhatsApp\n\nBonjour *${prenom}*,\n\nVotre canal de notification *WhatsApp* est opérationnel et validé avec succès ! 🎉\n\nVous recevrez désormais vos confirmations de réservation, vos reçus de paiement et vos alertes instantanément ici.\n\n📍 _${cName} • Espace Coworking & Formation_\n📞 Support : ${cTel}`;

    case 'nouveau_membre':
      return `✨ *Bienvenue chez ${cName} !*\n\nBonjour *${prenom}*,\n\nVotre compte membre sur la plateforme *${app}* a été activé avec succès.\n\n💼 Accédez à votre tableau de bord pour réserver vos bureaux, suivre vos forfaits et consulter vos documents :\n👉 *${url}/login*\n\nAu plaisir de vous accueillir ! 👋\n📍 _L'équipe ${cName}_`;

    case 'nouveau_formateur':
      return `🎓 *Compte Formateur Activé — ${cName}*\n\nBonjour *${prenom}*,\n\nVotre profil de formateur est désormais actif sur la plateforme.\n\n📊 Vous pouvez dès maintenant publier vos programmes de formation, gérer vos sessions et suivre les participants :\n👉 *${url}/trainer/dashboard*\n\nBienvenue dans notre équipe pédagogique ! 🚀`;

    case 'confirmation_reservation': {
      const res = data.reservation || {};
      const deb = res.date_debut ? new Date(res.date_debut).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'À venir';
      const fin = res.date_fin ? new Date(res.date_fin).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'À venir';
      const espace = res.espaces?.nom || res.espace_nom || 'Espace de travail';
      const montant = res.montant || res.montant_total || '0';
      return `✅ *Réservation Confirmée — ${cName}*\n\nBonjour *${prenom}*,\n\nVotre réservation a bien été enregistrée et validée :\n\n🏢 *Espace :* ${espace}\n📅 *Début :* ${deb}\n📅 *Fin :* ${fin}\n💳 *Montant :* ${montant} DT\n\n📲 Retrouvez les détails et votre QR Code d'accès :\n👉 *${url}/member/bookings*\n\nBonne session de travail chez ${cName} ! ⚡`;
    }

    case 'rappel_reservation_j1': {
      const res = data.reservation || {};
      const deb = res.date_debut ? new Date(res.date_debut).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) : 'Demain';
      const espace = res.espaces?.nom || res.espace_nom || 'Espace réservé';
      return `⏰ *Rappel de Réservation Demain*\n\nBonjour *${prenom}*,\n\nNous vous rappelons votre session prévue pour demain chez *${cName}* :\n\n🏢 *Espace :* ${espace}\n🕒 *Horaire :* ${deb}\n📍 *Adresse :* ${process.env.COWORKING_ADRESSE || 'Tunis, Tunisie'}\n\n👉 Accéder à votre QR Pass : *${url}/member/dashboard*\n\nÀ très vite ! 👋`;
    }

    case 'alerte_15min_avant_fin': {
      const espace = data.session?.espaces?.nom || data.espace_nom || 'votre espace';
      return `⏳ *Plus que 15 minutes — ${cName}*\n\nBonjour *${prenom}*,\n\nVotre temps de réservation sur *${espace}* arrive à son terme dans *15 minutes*.\n\n🔄 Vous souhaitez prolonger votre session ?\n👉 *${url}/member/dashboard*\n\nMerci de bien vouloir préparer votre départ à l'heure prévue si l'espace est réservé après vous.`;
    }

    case 'fin_session':
      return `⏱️ *Fin de votre session — ${cName}*\n\nBonjour *${prenom}*,\n\nVotre réservation est désormais terminée. Nous espérons que votre journée de travail s'est bien passée ! 🌟\n\nMerci de libérer l'espace et à très bientôt chez *${cName}*.\n👉 Réserver une prochaine session : *${url}/member/bookings*`;

    case 'depassement_session': {
      const min = data.minutesDepassement || 15;
      return `🚨 *Alerte Dépassement de Temps — ${cName}*\n\nBonjour *${prenom}*,\n\nUn dépassement de *${min} minute(s)* a été constaté sur votre espace de travail.\n\n⚠️ Merci de régulariser votre temps de présence en ligne ou auprès de l'accueil :\n👉 *${url}/member/dashboard*\n\n📞 Accueil : ${cTel}`;
    }

    case 'abonnement_expirant_j7': {
      const fin = data.abonnement?.date_fin ? new Date(data.abonnement.date_fin).toLocaleDateString('fr-FR') : 'dans 7 jours';
      const forfait = data.abonnement?.type_forfait || data.abonnement?.plan || 'Forfait Coworking';
      return `📆 *Renouvellement de Forfait — ${cName}*\n\nBonjour *${prenom}*,\n\nVotre abonnement *${forfait}* arrive à expiration le *${fin}* (dans 7 jours).\n\n🚀 Renouvelez dès maintenant pour conserver vos accès, vos crédits et vos avantages sans interruption :\n👉 *${url}/member/subscription*`;
    }

    case 'abonnement_expire':
      return `⚠️ *Abonnement Expiré — ${cName}*\n\nBonjour *${prenom}*,\n\nVotre abonnement est arrivé à échéance. Vos accès aux espaces de coworking sont actuellement suspendus.\n\n👉 Pour réactiver vos services immédiatement :\n👉 *${url}/member/subscription*\n\nBesoin d'aide ? Contactez notre support au ${cTel}.`;

    case 'paiement_enregistre': {
      const p = data.payment || {};
      const ref = p.numero_recu || p.reference || p.id?.slice(0, 8) || 'REC-' + Date.now().toString().slice(-6);
      return `💳 *Paiement Enregistré — ${cName}*\n\nBonjour *${prenom}*,\n\nNous confirmons la bonne réception de votre règlement :\n\n💰 *Montant :* ${p.montant || 0} DT\n📄 *Réf. Reçu :* ${ref}\n💳 *Moyen :* ${p.moyen_paiement || 'Carte / En ligne'}\n\n📥 Téléchargez votre reçu fiscal au format PDF :\n👉 *${url}/member/payments*`;
    }

    case 'paiement_retard_j3':
    case 'paiement_retard_j7': {
      const p = data.payment || {};
      return `⚠️ *Rappel de Paiement — ${cName}*\n\nBonjour *${prenom}*,\n\nSauf erreur de notre part, une facture d'un montant de *${p.montant || 0} DT* est actuellement en attente de règlement.\n\n🔒 Réglez en toute sécurité en 1 clic par carte bancaire :\n👉 *${url}/member/payments*\n\nSi le règlement a déjà été effectué, merci d'ignorer ce message.`;
    }

    case 'annulation_reservation': {
      const res = data.reservation || {};
      const espace = res.espaces?.nom || res.espace_nom || 'votre espace';
      return `🗑️ *Réservation Annulée — ${cName}*\n\nBonjour *${prenom}*,\n\nVotre réservation pour *${espace}* a bien été annulée.\n\n${data.remboursement ? '💰 Le montant a été recrédité conformément à nos conditions d\'annulation.\n\n' : ''}👉 Effectuer une nouvelle réservation : *${url}/member/bookings*`;
    }

    case 'inscription_formation': {
      const f = data.formation || {};
      const deb = f.date_debut ? new Date(f.date_debut).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date à confirmer';
      return `🎓 *Inscription Confirmée à la Formation*\n\nBonjour *${prenom}*,\n\nVotre place pour la formation *"${f.titre || 'Formation Pro'}"* est validée ! 🎉\n\n📅 *Session :* ${deb}\n🏢 *Lieu :* ${cName} (${process.env.COWORKING_ADRESSE || 'Tunis'})\n👨‍🏫 *Formateur :* ${f.formateur_nom || 'Équipe pédagogique'}\n\n🔗 Retrouvez vos supports de cours et votre planning :\n👉 *${url}/member/formations*`;
    }

    case 'rappel_formation_j1': {
      const f = data.formation || {};
      const deb = f.date_debut ? new Date(f.date_debut).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) : 'Demain';
      return `📚 *Rappel : Votre Formation Démarre Demain !*\n\nBonjour *${prenom}*,\n\nNous vous attendons demain pour votre session :\n\n🎯 *Formation :* ${f.titre || 'Session de formation'}\n⏰ *Horaire :* ${deb}\n📍 *Lieu :* ${cName}\n\nÀ demain et bonne formation ! 🚀`;
    }

    case 'nouveau_message_portail': {
      const expediteur = data.expediteur?.prenom || 'L\'équipe DeskyWork';
      const sujet = data.message?.sujet || 'Nouveau message reçu';
      return `💬 *Nouveau Message Reçu — ${cName}*\n\nBonjour *${prenom}*,\n\nVous avez reçu un nouveau message de *${expediteur}* :\n\n📌 *Objet :* ${sujet}\n\n👉 Lire et répondre au message :\n👉 *${url}/member/messages*`;
    }

    default:
      return `🔔 *Notification ${app}*\n\nBonjour *${prenom}*,\n\n${data.message || 'Vous avez une nouvelle notification dans votre espace.'}\n\n👉 Accéder à votre compte : *${url}/dashboard*`;
  }
}

module.exports = {
  sendWhatsApp,
  generateWhatsAppMessage,
  normalizePhoneNumber,
};

