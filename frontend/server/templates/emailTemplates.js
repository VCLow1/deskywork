// backend/templates/emailTemplates.js
// Module F Dev 2 — Étape F1 — S3
// Templates d'emails pour les 15 notifications automatiques
// Style : DeskyWork — Orange · Blanc · Noir — Design Professionnel

// ── Palette couleurs (DeskyWork) ──────────────────────────────────────────────
const PRIMARY = '#100f0d';
const SECONDARY = '#f95d00';
const ACCENT = '#ff7a28';
const LIGHT = '#fff4ec';
const MUTED = '#6B7280';
const SUCCESS = '#059669';
const WARNING = '#D97706';
const DANGER = '#DC2626';
const WHITE = '#FFFFFF';
const BG_PAGE = '#F2F2F2';

// ── Helper : en-tête DeskyWork — design professionnel ────────────────────────
function buildHeader(config) {
  const coworkingName = config?.coworkingName || 'DeskyWork';
  const coworkingEmail = config?.coworkingEmail || process.env.COWORKING_EMAIL || 'contact@deskywork.tn';
  const coworkingTel = config?.coworkingTel || process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930';
  const frontendUrl = config?.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';

  let telHtml = '';
  if (coworkingTel) {
    const nums = coworkingTel.split(/[\/\n]+/).map(n => n.trim()).filter(Boolean);
    telHtml = nums.map(num => `
      <p style="margin:2px 0 0;font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.75);">
        <a href="tel:${num.replace(/[^\d+]/g, '')}" style="color:inherit;text-decoration:none;">📞 ${num}</a>
      </p>
    `).join('');
  }

  return `
    <!-- ══ HEADER ══════════════════════════════════════════════════════ -->
    <style type="text/css">
      :root {
        color-scheme: light dark;
        supported-color-schemes: light dark;
      }
      /* Mode clair par défaut : logo blanc sur fond sombre */
      .desky-logo-white { display: block !important; }
      .desky-logo-dark { display: none !important; }

      /* Mode sombre mobile (Apple Mail, iOS, Outlook Dark) : bascule sur le logo foncé contrasté */
      @media (prefers-color-scheme: dark) {
        .desky-logo-white { display: none !important; }
        .desky-logo-dark { display: block !important; }
        .dark-header-bg { background-color: #100f0d !important; }
        .dark-header-text { color: #ffffff !important; }
      }
      [data-ogsc] .desky-logo-white { display: none !important; }
      [data-ogsc] .desky-logo-dark { display: block !important; }
    </style>
    <tr>
      <td style="padding:0;">
        <!-- Bande supérieure fine orange -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:${SECONDARY};height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>
        <!-- Corps de l'en-tête avec protection de couleur sombre -->
        <table width="100%" cellpadding="0" cellspacing="0" class="dark-header-bg" style="background-color:${PRIMARY};background-image:linear-gradient(${PRIMARY},${PRIMARY});">
          <tr>
            <td style="padding:24px 32px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Logo DeskyWork officiel adaptatif (Mode Clair & Sombre) -->
                  <td style="vertical-align:middle;" width="52%">
                    <a href="${frontendUrl}" target="_blank" style="text-decoration:none;display:inline-block;">
                      <!-- Logo 1 (Texte sombre) : affiché si le client email inverse le fond en mode sombre -->
                      <div class="desky-logo-dark" style="display:none;">
                        <img
                          src="cid:deskywork-logo-light"
                          alt="DeskyWork"
                          width="210"
                          style="display:block;width:210px;max-width:210px;height:auto;border:0;outline:none;text-decoration:none;"
                        />
                      </div>
                      <!-- Logo 2 (Texte blanc) : affiché par défaut sur fond noir -->
                      <div class="desky-logo-white">
                        <img
                          src="cid:deskywork-logo-dark"
                          alt="DeskyWork"
                          width="210"
                          style="display:block;width:210px;max-width:210px;height:auto;border:0;outline:none;text-decoration:none;"
                        />
                      </div>
                    </a>
                  </td>
                  <!-- Infos coworking à droite -->
                  <td align="right" style="vertical-align:middle;" width="48%">
                    <p class="dark-header-text" style="
                      margin:0;
                      font-family:'Segoe UI',Arial,sans-serif;
                      font-size:14px;font-weight:700;
                      color:#ffffff;
                    ">${coworkingName}</p>
                    ${coworkingEmail ? `<p style="margin:4px 0 0;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.75);"><a href="mailto:${coworkingEmail}" style="color:inherit;text-decoration:none;">${coworkingEmail}</a></p>` : ''}
                    ${telHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Séparateur orange bas -->
          <tr>
            <td style="background:${SECONDARY};height:3px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// ── Helper : pied de page DeskyWork ──────────────────────────────────────────
function buildFooter(config) {
  const coworkingName = config?.coworkingName || 'DeskyWork';
  const coworkingTel = config?.coworkingTel || process.env.COWORKING_TEL || '+216 52 882 880 / +216 52 882 930';
  const frontendUrl = config?.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
  const year = new Date().getFullYear();

  return `
    <!-- ══ FOOTER ══════════════════════════════════════════════════════ -->
    <tr>
      <td style="padding:0;">
        <!-- Séparateur orange haut -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:${SECONDARY};height:2px;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
        <!-- Corps du footer avec protection de couleur sombre -->
        <table width="100%" cellpadding="0" cellspacing="0" class="dark-header-bg" style="background-color:${PRIMARY};background-image:linear-gradient(${PRIMARY},${PRIMARY});">
          <tr>
            <td style="padding:28px 36px;text-align:center;">
              <!-- Logo DeskyWork adaptatif au footer -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td align="center">
                    <a href="${frontendUrl}" target="_blank" style="text-decoration:none;display:inline-block;">
                      <div class="desky-logo-dark" style="display:none;">
                        <img
                          src="cid:deskywork-logo-light"
                          alt="DeskyWork"
                          width="150"
                          style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;margin:0 auto;"
                        />
                      </div>
                      <div class="desky-logo-white">
                        <img
                          src="cid:deskywork-logo-dark"
                          alt="DeskyWork"
                          width="150"
                          style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;margin:0 auto;"
                        />
                      </div>
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px;font-family:'Segoe UI',Arial,sans-serif;color:rgba(255,255,255,0.8);font-size:12px;">
                ${coworkingName} · 📞 +216 52 882 880 / +216 52 882 930 · Propulsé par <strong style="color:${SECONDARY};">DeskyWork</strong>
              </p>
              <p style="margin:0 0 10px;font-family:'Segoe UI',Arial,sans-serif;color:rgba(255,255,255,0.5);font-size:11px;">
                Cet email est généré automatiquement. Merci de ne pas y répondre directement.
              </p>
              <!-- Ligne de séparation fine -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;">
                <tr><td style="border-top:1px solid rgba(255,255,255,0.15);font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
              <p style="margin:0;font-family:'Segoe UI',Arial,sans-serif;color:rgba(255,255,255,0.4);font-size:10px;">
                © ${year} DeskyWork — Tous droits réservés
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// ── Helper : wrapper HTML commun ─────────────────────────────────────────────
function wrapEmail(innerRows, title = 'DeskyWork', config = {}) {
  const cName = config?.coworkingName || process.env.COWORKING_NAME || 'DeskyWork';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:${BG_PAGE};font-family:'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${BG_PAGE};padding:36px 16px;">
    <tr><td align="center">
      <!-- Conteneur principal -->
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
        style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;
               box-shadow:0 6px 30px rgba(0,0,0,0.12);background:#ffffff;">
        ${innerRows}
      </table>
      <!-- Bas de page hors email -->
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-top:18px;">
        <tr>
          <td align="center" style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#9ca3af;">
            Vous recevez cet email car vous êtes membre de <strong>${cName}</strong>.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}


// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 1 — Nouvelle inscription membre
// ══════════════════════════════════════════════════════════════════════════════

function templateNouveauMembre(membre, config) {
  const prenom = membre.prenom || 'Membre';
  const nom = membre.nom || '';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Bienvenue ${prenom}</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${SUCCESS};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">✨ Bienvenue dans notre communauté !</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:18px;font-weight:700;">
              Bonjour ${prenom} ${nom},
            </p>
            <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
              Nous sommes ravis de vous accueillir chez <strong>${config.coworkingName}</strong> ! 
              Votre compte a été créé avec succès.
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Vous pouvez dès maintenant accéder à votre portail membre pour :
            </p>
            <ul style="margin:0 0 28px;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
              <li>Réserver un espace de travail</li>
              <li>Consulter vos factures et historique</li>
              <li>Voir les formations disponibles</li>
              <li>Gérer votre abonnement</li>
            </ul>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Accéder à mon portail
                </a>
              </td></tr>
            </table>
            <p style="margin:0;color:${MUTED};font-size:12px;">
              Questions ? Contactez-nous à <a href="mailto:${config.coworkingEmail}" style="color:${ACCENT};">${config.coworkingEmail}</a>
            </p>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 2 — Confirmation de réservation
// ══════════════════════════════════════════════════════════════════════════════

function templateConfirmationReservation(reservation, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const espace = reservation.espaces?.nom || 'Espace';
  const dateDebut = new Date(reservation.date_debut);
  const dateFin = new Date(reservation.date_fin);
  const dateStr = dateDebut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heureDebut = dateDebut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const heureFin = dateFin.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const isSurPlace = reservation.mode === 'sur_place' || reservation.mode === 'on_site' || reservation.mode === 'cash';
  const modeLabel = isSurPlace ? '💵 Sur place (à l\'accueil)' : '💳 En ligne par carte bancaire';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Confirmation de réservation</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background-color:${SECONDARY};background:linear-gradient(135deg, #f95d00 0%, #ff7a28 100%);padding:18px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.3px;">✅ Réservation acceptée & confirmée</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 20px;color:${PRIMARY};font-size:16px;line-height:1.5;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.7;">
              Excellente nouvelle ! L'administrateur de <strong>${config.coworkingName}</strong> a accepté votre demande de réservation. Voici le récapitulatif de votre séance :
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fed7aa;border-radius:14px;overflow:hidden;margin-bottom:24px;box-shadow:0 2px 8px rgba(249,93,0,0.06);">
              <tr>
                <td style="background:#fff7ed;padding:12px 20px;border-bottom:1px solid #fed7aa;">
                  <p style="margin:0;color:#c2410c;font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;">Détails de votre réservation</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;background:#ffffff;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:${MUTED};font-size:13px;padding-bottom:12px;">Espace de coworking</td>
                      <td align="right" style="color:${PRIMARY};font-size:14px;font-weight:700;padding-bottom:12px;">${espace}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:13px;padding-bottom:12px;">Date</td>
                      <td align="right" style="color:${PRIMARY};font-size:14px;font-weight:600;padding-bottom:12px;">${dateStr}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:13px;padding-bottom:12px;">Créneau horaire</td>
                      <td align="right" style="color:${PRIMARY};font-size:14px;font-weight:600;padding-bottom:12px;">${heureDebut} → ${heureFin}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:13px;">Mode de règlement</td>
                      <td align="right" style="color:${SECONDARY};font-size:14px;font-weight:700;">${modeLabel}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Alerte consignes de paiement selon le mode -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf5;border:1px solid #ffedd8;border-left:4px solid ${SECONDARY};border-radius:10px;padding:16px;margin-bottom:28px;">
              <tr><td>
                <p style="margin:0;color:#9a3412;font-size:13px;line-height:1.6;">
                  ${isSurPlace
      ? '💡 <strong>Paiement sur place :</strong> Votre place est réservée. Vous pourrez procéder au règlement directement à l\'accueil le jour de votre arrivée (espèces, carte, TPE).'
      : '💡 <strong>Paiement en ligne :</strong> Votre réservation a été approuvée ! Vous pouvez dès à présent régler par carte bancaire en toute sécurité depuis votre espace membre.'}
                </p>
              </td></tr>
            </table>

            <!-- Bouton d'action DeskyWork -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/bookings" 
                   style="display:inline-block;background-color:${SECONDARY};background:linear-gradient(135deg, #f95d00 0%, #ff7a28 100%);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;box-shadow:0 4px 14px rgba(249,93,0,0.35);">
                  Accéder à mes réservations
                </a>
              </td></tr>
            </table>

            <p style="margin:0;color:${MUTED};font-size:12px;text-align:center;">
              Une question ? Contactez-nous à <a href="mailto:${config.coworkingEmail}" style="color:${SECONDARY};text-decoration:none;font-weight:600;">${config.coworkingEmail}</a>
            </p>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 3 — Rappel réservation J-1
// ══════════════════════════════════════════════════════════════════════════════

function templateRappelReservationJ1(reservation, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const espace = reservation.espaces?.nom || 'Espace';
  const dateDebut = new Date(reservation.date_debut);
  const dateStr = dateDebut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heureDebut = dateDebut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Rappel de réservation</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${ACCENT};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">📅 Rappel : Votre réservation est demain !</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Petit rappel : votre réservation est programmée pour <strong>demain</strong> !
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT};border:1px solid #DBEAFE;border-radius:12px;padding:20px;margin-bottom:28px;">
              <tr>
                <td>
                  <p style="margin:0 0 12px;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Votre réservation</p>
                  <p style="margin:0 0 8px;color:${PRIMARY};font-size:18px;font-weight:700;">${espace}</p>
                  <p style="margin:0 0 4px;color:#374151;font-size:14px;">📆 ${dateStr}</p>
                  <p style="margin:0;color:#374151;font-size:14px;">🕐 ${heureDebut}</p>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 24px;color:#374151;font-size:13px;line-height:1.6;">
              💡 <strong>Astuce :</strong> Pensez à arriver quelques minutes en avance pour un check-in sans stress !
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Voir ma réservation
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 4 — Session : 15 min avant la fin
// ══════════════════════════════════════════════════════════════════════════════

function templateAlerte15MinAvantFin(session, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const espace = session.reservations?.espaces?.nom || 'Espace';
  const heureFin = new Date(session.reservations?.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Votre session se termine bientôt</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${WARNING};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">⏰ Plus que 15 minutes !</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Votre session dans <strong>${espace}</strong> se termine dans <strong style="color:${WARNING};">15 minutes</strong> (heure de fin : ${heureFin}).
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7ED;border:2px solid #FBBF24;border-radius:12px;padding:18px;margin-bottom:24px;">
              <tr><td align="center">
                <p style="margin:0 0 8px;color:#92400E;font-size:14px;font-weight:700;">💡 Vous avez besoin de plus de temps ?</p>
                <p style="margin:0;color:#78350F;font-size:13px;">
                  Prolongez votre session directement depuis votre portail (si l'espace est disponible).
                </p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard" 
                   style="display:inline-block;background:${WARNING};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Prolonger ma session
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 5 — Session : fin du temps réservé
// ══════════════════════════════════════════════════════════════════════════════

function templateFinSession(session, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const espace = session.reservations?.espaces?.nom || 'Espace';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Votre session est terminée</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${DANGER};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">⏱️ Temps écoulé !</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
              Votre temps de réservation dans <strong>${espace}</strong> est maintenant écoulé.
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Merci de libérer l'espace pour les prochains utilisateurs.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:12px;padding:18px;margin-bottom:24px;">
              <tr><td align="center">
                <p style="margin:0;color:#7F1D1D;font-size:13px;">
                  💳 Si vous souhaitez prolonger votre session, des frais supplémentaires s'appliqueront automatiquement.
                </p>
              </td></tr>
            </table>
            <p style="margin:0;color:${MUTED};font-size:13px;text-align:center;">
              Merci d'avoir choisi ${config.coworkingName} ! À bientôt 👋
            </p>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 6 — Dépassement de session détecté
// ══════════════════════════════════════════════════════════════════════════════

function templateDepassementSession(session, membre, minutesDepassement, config) {
  const prenom = membre.prenom || 'Membre';
  const espace = session.reservations?.espaces?.nom || 'Espace';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Dépassement de session</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${DANGER};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">🚨 Dépassement de ${minutesDepassement} minute${minutesDepassement > 1 ? 's' : ''}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Nous avons constaté que vous êtes toujours dans <strong>${espace}</strong> alors que votre créneau est terminé depuis <strong style="color:${DANGER};">${minutesDepassement} minute${minutesDepassement > 1 ? 's' : ''}</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FEF2F2;border:2px solid #DC2626;border-radius:12px;padding:20px;margin-bottom:28px;">
              <tr><td>
                <p style="margin:0 0 12px;color:#7F1D1D;font-size:14px;font-weight:700;">⚠️ Facturation supplémentaire</p>
                <p style="margin:0;color:#991B1B;font-size:13px;line-height:1.6;">
                  Des frais d'extension seront appliqués automatiquement sur votre prochaine facture conformément à notre politique tarifaire.
                </p>
              </td></tr>
            </table>
            <p style="margin:0 0 24px;color:#374151;font-size:13px;line-height:1.6;">
              Merci de libérer l'espace dès que possible pour éviter tout désagrément avec les réservations suivantes.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard" 
                   style="display:inline-block;background:${DANGER};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Voir ma facture
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 7 — Abonnement expirant (J-7)
// ══════════════════════════════════════════════════════════════════════════════

function templateAbonnementExpirantJ7(abonnement, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const typeAbonnement = {
    day_pass: 'Day Pass',
    week_pass: 'Week Pass',
    mensuel: 'Mensuel',
    trimestriel: 'Trimestriel',
    annuel: 'Annuel',
    bureau_prive: 'Bureau Privé'
  }[abonnement.type || abonnement.type_forfait] || abonnement.type_forfait || abonnement.type || 'Abonnement Coworking';

  const dateFin = new Date(abonnement.date_fin).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Votre abonnement expire bientôt</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${WARNING};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">📆 Votre abonnement expire dans 7 jours</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Votre abonnement <strong>${typeAbonnement}</strong> arrivera à expiration le <strong>${dateFin}</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:12px;padding:20px;margin-bottom:28px;">
              <tr><td>
                <p style="margin:0 0 12px;color:#78350F;font-size:14px;font-weight:700;">💡 Renouvelez dès maintenant</p>
                <p style="margin:0;color:#92400E;font-size:13px;line-height:1.6;">
                  Pour continuer à profiter de votre espace sans interruption, pensez à renouveler votre abonnement avant la date d'expiration.
                </p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/abonnement" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Renouveler mon abonnement
                </a>
              </td></tr>
            </table>
            <p style="margin:0;color:${MUTED};font-size:12px;text-align:center;">
              Questions ? Contactez-nous à <a href="mailto:${config.coworkingEmail}" style="color:${ACCENT};">${config.coworkingEmail}</a>
            </p>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 8 — Abonnement expiré
// ══════════════════════════════════════════════════════════════════════════════

function templateAbonnementExpire(abonnement, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const typeAbonnement = {
    day_pass: 'Day Pass',
    week_pass: 'Week Pass',
    mensuel: 'Mensuel',
    trimestriel: 'Trimestriel',
    annuel: 'Annuel',
    bureau_prive: 'Bureau Privé'
  }[abonnement.type || abonnement.type_forfait] || abonnement.type_forfait || abonnement.type || 'Abonnement Coworking';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Votre abonnement a expiré</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${DANGER};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">⚠️ Votre abonnement a expiré</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Votre abonnement <strong>${typeAbonnement}</strong> a expiré. Vous n'avez plus accès aux espaces de coworking.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FEF2F2;border:2px solid #DC2626;border-radius:12px;padding:20px;margin-bottom:28px;">
              <tr><td>
                <p style="margin:0 0 12px;color:#7F1D1D;font-size:14px;font-weight:700;">🚫 Accès suspendu</p>
                <p style="margin:0;color:#991B1B;font-size:13px;line-height:1.6;">
                  Pour retrouver l'accès à votre espace de travail, veuillez souscrire un nouvel abonnement.
                </p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/abonnement" 
                   style="display:inline-block;background:${DANGER};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Renouveler maintenant
                </a>
              </td></tr>
            </table>
            <p style="margin:0;color:${MUTED};font-size:12px;text-align:center;">
              Besoin d'aide ? <a href="mailto:${config.coworkingEmail}" style="color:${ACCENT};">${config.coworkingEmail}</a>
            </p>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 9 — Paiement enregistré (déjà existant dans sendEmail.js, on le garde pour cohérence)
// ══════════════════════════════════════════════════════════════════════════════
// Note : Ce template existe déjà dans utils/sendEmail.js (buildReceiptEmailHTML)
// On peut soit le réutiliser, soit créer une version simplifiée ici

function templatePaiementEnregistre(payment, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const montant = parseFloat(payment.montant || 0).toFixed(3);
  const numero = payment.numero_recu || payment.id;
  const statut = payment.statut === 'paid' ? '✅ Payé' : '⏳ En attente';
  const statutColor = payment.statut === 'paid' ? SUCCESS : WARNING;

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Paiement enregistré</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${statutColor};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">${statut} — Reçu ${numero}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              ${payment.statut === 'paid'
      ? 'Votre paiement a bien été enregistré. Vous trouverez votre reçu en pièce jointe.'
      : 'Votre paiement est en attente de validation. Vous recevrez une confirmation dès qu\'il sera traité.'}
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:28px;">
              <tr>
                <td style="background:${PRIMARY};padding:12px 20px;">
                  <p style="margin:0;color:#ffffff;font-size:12px;font-weight:700;">DÉTAIL DU PAIEMENT</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:12px;">Référence</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:12px;">${numero}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;">Montant TTC</td>
                      <td align="right" style="color:${SECONDARY};font-size:18px;font-weight:700;">${montant} DT</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/factures" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Voir mes factures
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 10 — Paiement en retard J+3 (déjà existant dans sendEmail.js, version simplifiée)
// ══════════════════════════════════════════════════════════════════════════════
// Note : Ce template existe dans utils/sendEmail.js (buildReminderEmailHTML)

function templatePaiementRetardJ3(payment, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const montant = parseFloat(payment.montant || 0).toFixed(3);
  const numero = payment.numero_recu || payment.id;

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Rappel de paiement</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:#D97706;padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">💳 Rappel de paiement — Retard de 3 jours</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Nous vous contactons car un paiement de votre compte est toujours en attente depuis <strong>3 jours</strong>. Merci de régulariser votre situation dès que possible.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #D97706;border-radius:12px;overflow:hidden;margin-bottom:28px;">
              <tr>
                <td style="background:#D97706;padding:10px 20px;">
                  <p style="margin:0;color:#ffffff;font-size:12px;font-weight:700;">PAIEMENT EN ATTENTE</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:${MUTED};font-size:12px;">Référence</td>
                      <td align="right" style="color:#111827;font-size:13px;font-weight:600;">${numero}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background:#FEF2F2;padding:14px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:#991B1B;font-size:14px;font-weight:700;">Montant dû</td>
                      <td align="right" style="color:#DC2626;font-size:20px;font-weight:800;">${montant} DT</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/factures" 
                   style="display:inline-block;background:#D97706;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Régulariser mon paiement
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 11 — Paiement en retard J+7
// ══════════════════════════════════════════════════════════════════════════════

function templatePaiementRetardJ7(payment, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const montant = parseFloat(payment.montant || 0).toFixed(3);
  const numero = payment.numero_recu || payment.id;

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Rappel urgent de paiement</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${WARNING};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">⚠️ RAPPEL URGENT — Retard de 7 jours</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Malgré notre premier rappel, votre paiement est toujours en attente depuis <strong>7 jours</strong>. <strong>Merci de régulariser rapidement</strong> pour éviter toute suspension de votre compte.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${WARNING};border-radius:12px;overflow:hidden;margin-bottom:28px;">
              <tr>
                <td style="background:${WARNING};padding:12px 20px;">
                  <p style="margin:0;color:#ffffff;font-size:12px;font-weight:700;">⚠️ PAIEMENT IMPAYÉ DEPUIS 7 JOURS</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:${MUTED};font-size:12px;">Référence</td>
                      <td align="right" style="color:#111827;font-size:13px;font-weight:600;">${numero}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background:#FEF2F2;padding:16px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:#991B1B;font-size:14px;font-weight:700;">Montant dû</td>
                      <td align="right" style="color:#DC2626;font-size:22px;font-weight:800;">${montant} DT</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;padding:16px;margin-bottom:24px;">
              <tr><td>
                <p style="margin:0;color:#78350F;font-size:13px;line-height:1.6;">
                  ⚠️ <strong>Sans régularisation sous 8 jours</strong>, votre accès aux espaces sera suspendu automatiquement.
                </p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/factures" 
                   style="display:inline-block;background:${WARNING};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Régulariser MAINTENANT
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 12 — Annulation de réservation
// ══════════════════════════════════════════════════════════════════════════════

function templateAnnulationReservation(reservation, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const espace = reservation.espaces?.nom || 'Espace';
  const dateDebut = new Date(reservation.date_debut);
  const dateStr = dateDebut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heureDebut = dateDebut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Annulation de réservation</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background-color:${SECONDARY};background:linear-gradient(135deg, #f95d00 0%, #ff7a28 100%);padding:18px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.3px;">🗑️ Réservation annulée</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 20px;color:${PRIMARY};font-size:16px;line-height:1.5;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.7;">
              Votre réservation a bien été annulée. Voici le récapitulatif de l'espace concerné :
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fed7aa;border-radius:14px;overflow:hidden;margin-bottom:24px;box-shadow:0 2px 8px rgba(249,93,0,0.06);">
              <tr>
                <td style="background:#fff7ed;padding:12px 20px;border-bottom:1px solid #fed7aa;">
                  <p style="margin:0;color:#c2410c;font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;">Détails de la réservation annulée</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;background:#ffffff;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:${MUTED};font-size:13px;padding-bottom:12px;">Espace de coworking</td>
                      <td align="right" style="color:${PRIMARY};font-size:14px;font-weight:700;padding-bottom:12px;">${espace}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:13px;padding-bottom:12px;">Date</td>
                      <td align="right" style="color:${PRIMARY};font-size:14px;font-weight:600;padding-bottom:12px;">${dateStr}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:13px;">Heure</td>
                      <td align="right" style="color:${SECONDARY};font-size:14px;font-weight:700;">${heureDebut}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Alerte politique remboursement assortie à la charte -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf5;border:1px solid #ffedd8;border-left:4px solid ${SECONDARY};border-radius:10px;padding:16px;margin-bottom:28px;">
              <tr><td>
                <p style="margin:0;color:#9a3412;font-size:13px;line-height:1.6;">
                  💡 <strong>Politique de remboursement :</strong> Le traitement du remboursement éventuel s'effectuera sous 3 à 5 jours ouvrés selon les conditions de votre espace.
                </p>
              </td></tr>
            </table>

            <!-- Bouton d'action DeskyWork -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/bookings" 
                   style="display:inline-block;background-color:${SECONDARY};background:linear-gradient(135deg, #f95d00 0%, #ea580c 100%);color:#ffffff;text-decoration:none;padding:14px 34px;border-radius:12px;font-size:14px;font-weight:700;box-shadow:0 4px 14px rgba(249,93,0,0.35);">
                  Faire une nouvelle réservation
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 13 — Inscription à une formation
// ══════════════════════════════════════════════════════════════════════════════

function templateNouveauFormateur(formateur, config) {
  const prenom = formateur.prenom || 'Formateur';
  const nom = formateur.nom || '';
  const email = formateur.email || '—';
  const temporaryPassword = formateur.temporaryPassword || '—';
  const loginUrl = formateur.loginUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetLink = formateur.resetLink || `${loginUrl}/forgot-password`;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Bienvenue ${prenom}</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${SUCCESS};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">✨ Votre compte formateur est prêt !</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:18px;font-weight:700;">Bonjour ${prenom} ${nom},</p>
            <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
              Votre compte formateur a été créé avec succès sur <strong>${config.coworkingName}</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:28px;">
              <tr>
                <td style="background:${LIGHT};padding:18px 24px;font-size:13px;color:${MUTED};font-weight:700;">Vos identifiants</td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <p style="margin:0 0 10px;color:#111827;font-size:14px;"><strong>Email :</strong> ${email}</p>
                  <p style="margin:0;color:#111827;font-size:14px;"><strong>Mot de passe temporaire :</strong> ${temporaryPassword}</p>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.7;">
              Pour votre sécurité, vous pouvez modifier ce mot de passe dès votre première connexion.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${loginUrl}/login" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Accéder à mon espace formateur
                </a>
              </td></tr>
            </table>
            <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.7;">
              Si vous souhaitez changer votre mot de passe immédiatement, utilisez ce lien : <a href="${resetLink}" style="color:${ACCENT};">Réinitialiser mon mot de passe</a>.
            </p>
            <p style="margin:0;color:${MUTED};font-size:12px;">
              Si vous n’avez pas demandé ce compte, contactez votre administrateur.
            </p>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}


function templateInscriptionFormation(formation, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const titre = formation.titre || 'Formation';
  const dateDebut = new Date(formation.date);
  const dateStr = dateDebut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heureDebut = dateDebut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const formateur = formation.formateurs?.nom || 'Formateur';
  const salle = formation.espaces?.nom || 'Salle à définir';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Inscription confirmée</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${SUCCESS};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">🎓 Inscription confirmée !</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Votre inscription à la formation <strong>${titre}</strong> a bien été enregistrée !
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:28px;">
              <tr>
                <td style="background:${PRIMARY};padding:12px 20px;">
                  <p style="margin:0;color:#ffffff;font-size:12px;font-weight:700;">DÉTAILS DE LA FORMATION</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:12px;">Formation</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:12px;">${titre}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:12px;">Formateur</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:12px;">${formateur}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:12px;">Date</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:12px;">${dateStr}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:12px;">Horaire</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:12px;">${heureDebut}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;">Lieu</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;">${salle}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT};border:1px solid #DBEAFE;border-radius:10px;padding:16px;margin-bottom:24px;">
              <tr><td>
                <p style="margin:0;color:#1E40AF;font-size:13px;">
                  📌 <strong>Rappel :</strong> Vous recevrez un rappel la veille de la formation.
                </p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/formations" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Voir mes formations
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 14 — Rappel formation J-1
// ══════════════════════════════════════════════════════════════════════════════

function templateRappelFormationJ1(formation, membre, config) {
  const prenom = membre.prenom || 'Membre';
  const titre = formation.titre || 'Formation';
  const dateDebut = new Date(formation.date);
  const dateStr = dateDebut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heureDebut = dateDebut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const formateur = formation.formateurs?.nom || 'Formateur';
  const salle = formation.espaces?.nom || 'Salle à définir';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Rappel de formation</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${ACCENT};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">🎓 Rappel : Votre formation est demain !</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Petit rappel : la formation <strong>${titre}</strong> à laquelle vous êtes inscrit(e) aura lieu <strong>demain</strong> !
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT};border:1px solid #DBEAFE;border-radius:12px;padding:20px;margin-bottom:28px;">
              <tr>
                <td>
                  <p style="margin:0 0 12px;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Votre formation</p>
                  <p style="margin:0 0 12px;color:${PRIMARY};font-size:18px;font-weight:700;">${titre}</p>
                  <p style="margin:0 0 6px;color:#374151;font-size:14px;">👤 Formateur : ${formateur}</p>
                  <p style="margin:0 0 6px;color:#374151;font-size:14px;">📆 ${dateStr}</p>
                  <p style="margin:0 0 6px;color:#374151;font-size:14px;">🕐 ${heureDebut}</p>
                  <p style="margin:0;color:#374151;font-size:14px;">📍 ${salle}</p>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7ED;border:1px solid #FCD34D;border-radius:10px;padding:16px;margin-bottom:24px;">
              <tr><td>
                <p style="margin:0;color:#78350F;font-size:13px;">
                  💡 <strong>Conseil :</strong> Prévoyez d'arriver 10 minutes en avance et apportez de quoi prendre des notes !
                </p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/formations" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Voir ma formation
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 15 — Nouveau message portail
// ══════════════════════════════════════════════════════════════════════════════

function templateNouveauMessagePortail(message, expediteur, config) {
  const prenomExpediteur = expediteur?.prenom || 'Un membre';
  const nomExpediteur = expediteur?.nom || '';
  const contenuMessage = message.contenu || 'Nouveau message';
  const sujet = message.sujet || 'Message';

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Nouveau message</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${ACCENT};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">💬 Nouveau message portail</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 24px;color:${PRIMARY};font-size:16px;">
              <strong>Bonjour,</strong>
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:14px;line-height:1.7;">
              Vous avez reçu un nouveau message de <strong>${prenomExpediteur} ${nomExpediteur}</strong> via le portail membre.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:28px;">
              <tr>
                <td style="background:${LIGHT};padding:12px 20px;border-bottom:1px solid #DBEAFE;">
                  <p style="margin:0;color:${PRIMARY};font-size:14px;font-weight:700;">Sujet : ${sujet}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 20px;background:#FAFAFA;">
                  <p style="margin:0;color:#374151;font-size:14px;line-height:1.7;white-space:pre-wrap;">${contenuMessage}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 20px;background:#F9FAFB;border-top:1px solid #E5E7EB;">
                  <p style="margin:0;color:${MUTED};font-size:12px;">
                    Envoyé le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} 
                    à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/messages" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  Répondre au message
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 16 — Nouvelle formation disponible
// ══════════════════════════════════════════════════════════════════════════════

function templateNouvelleFormation(formation, membre, config) {
  const prenom = membre?.prenom || 'Membre';
  const titre = formation?.titre || 'Nouvelle Formation';
  const description = formation?.description || 'Une nouvelle opportunité d\'apprentissage est disponible.';
  const formateur = formation?.profiles ? `${formation.profiles.prenom || ''} ${formation.profiles.nom || ''}`.trim() : (formation?.formateur_nom || 'Formateur qualifié');
  const salle = formation?.espaces?.nom || 'Salle dédiée';
  const prix = formation?.prix_inscription > 0 ? `${formation.prix_inscription} DT` : 'Gratuit';
  const capacite = formation?.capacite_max ? `${formation.capacite_max} places` : 'Places limitées';

  let dateStr = 'Date à venir';
  let heureStr = '';
  if (formation?.date_debut) {
    const dDebut = new Date(formation.date_debut);
    dateStr = dDebut.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    heureStr = dDebut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (formation?.date_fin) {
      const dFin = new Date(formation.date_fin);
      heureStr += ` - ${dFin.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  }

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Nouvelle Formation Disponible</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F2;padding:36px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.13);">
        ${buildHeader(config)}
        <tr>
          <td style="background:${SECONDARY};padding:16px 40px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">🎓 Nouvelle formation disponible !</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            <p style="margin:0 0 20px;color:${PRIMARY};font-size:16px;">
              Bonjour <strong>${prenom}</strong>,
            </p>
            <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.7;">
              Une nouvelle session de formation vient d'être planifiée : <strong>${titre}</strong>. Les inscriptions sont désormais ouvertes !
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:24px;">
              <tr>
                <td style="background:${PRIMARY};padding:12px 20px;">
                  <p style="margin:0;color:#ffffff;font-size:12px;font-weight:700;">DÉTAILS DU WORKSHOP</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:10px;">Formation</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">${titre}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:10px;">Formateur</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:10px;">${formateur}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:10px;">Date</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:10px;">${dateStr}</td>
                    </tr>
                    ${heureStr ? `
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:10px;">Horaire</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:10px;">${heureStr}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:10px;">Lieu</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;padding-bottom:10px;">${salle}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;padding-bottom:10px;">Tarif</td>
                      <td align="right" style="color:${SECONDARY};font-size:14px;font-weight:700;padding-bottom:10px;">${prix}</td>
                    </tr>
                    <tr>
                      <td style="color:${MUTED};font-size:12px;">Places</td>
                      <td align="right" style="color:#111827;font-size:14px;font-weight:600;">${capacite}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            ${description ? `
            <div style="background:#F9FAFB;border-left:4px solid ${SECONDARY};padding:14px 18px;border-radius:0 8px 8px 0;margin-bottom:24px;">
              <p style="margin:0 0 4px;color:${MUTED};font-size:11px;font-weight:700;text-transform:uppercase;">Description</p>
              <p style="margin:0;color:#374151;font-size:13px;line-height:1.6;">${description}</p>
            </div>` : ''}

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/formations" 
                   style="display:inline-block;background:${SECONDARY};color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;box-shadow:0 4px 14px rgba(249,93,0,0.35);">
                  Découvrir & S'inscrire
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        ${buildFooter(config)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS — Toutes les fonctions de templates
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Helpers
  buildHeader,
  buildFooter,
  wrapEmail,

  // Templates (15 notifications du Tableau F + 16 Nouvelle Formation)
  templateNouveauMembre,                  // 1. Nouvelle inscription membre
  templateNouveauFormateur,                // 1b. Nouveau formateur
  templateConfirmationReservation,        // 2. Confirmation réservation
  templateRappelReservationJ1,            // 3. Rappel réservation J-1
  templateAlerte15MinAvantFin,            // 4. Session : 15 min avant la fin
  templateFinSession,                     // 5. Session : fin du temps réservé
  templateDepassementSession,             // 6. Dépassement de session détecté
  templateAbonnementExpirantJ7,           // 7. Abonnement expirant (J-7)
  templateAbonnementExpire,               // 8. Abonnement expiré
  templatePaiementEnregistre,             // 9. Paiement enregistré
  templatePaiementRetardJ3,               // 10. Paiement en retard J+3
  templatePaiementRetardJ7,               // 11. Paiement en retard J+7
  templateAnnulationReservation,          // 12. Annulation de réservation
  templateInscriptionFormation,           // 13. Inscription à une formation
  templateRappelFormationJ1,              // 14. Rappel formation J-1
  templateNouveauMessagePortail,          // 15. Nouveau message portail
  templateNouvelleFormation,              // 16. Nouvelle formation disponible
};
