// backend/utils/generateReceipt.js
// Génération de reçus PDF pour les paiements — Module C Dev 2
// Utilise pdfkit pour créer un PDF professionnel

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// ── Palette de couleurs DeskyWork (Noir, Orange, Blanc) ──────────────────────
const COLORS = {
  primary:    '#100F0D', // Noir profond DeskyWork
  secondary:  '#F95D00', // Orange Vif DeskyWork
  accent:     '#F95D00', // Orange Accent
  light:      '#FFF7ED', // Orange/Crème soft
  text:       '#100F0D', // Texte principal
  muted:      '#64748B', // Texte secondaire
  border:     '#FED7AA', // Bordure orangée
  success:    '#10B981', // Vert pour "Payé"
  warning:    '#F59E0B', // Ambre pour "En attente"
  white:      '#FFFFFF',
};

// ── Modes de paiement lisibles ───────────────────────────────────────────────
const MODE_LABELS = {
  cash:          'Espèces',
  bank_transfer: 'Virement bancaire',
  check:         'Chèque',
  online:        'Paiement en ligne',
};

// ── Statuts lisibles ─────────────────────────────────────────────────────────
const STATUT_LABELS = {
  pending:  'En attente',
  paid:     'Payé',
  failed:   'Échoué',
  refunded: 'Remboursé',
};

/**
 * Génère un reçu PDF pour un paiement donné aux couleurs DeskyWork.
 */
function generateReceiptPDF(payment, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const config = {
        coworkingName:    options.coworkingName    || process.env.COWORKING_NAME    || 'DeskyWork',
        coworkingEmail:   options.coworkingEmail   || process.env.COWORKING_EMAIL   || 'contact@deskywork.tn',
        coworkingTel:     options.coworkingTel     || process.env.COWORKING_TEL     || '+216 52 882 880 / +216 52 882 930',
        coworkingAdresse: options.coworkingAdresse || process.env.COWORKING_ADRESSE || 'Tunis, Tunisie',
      };

      // ── Données membre ──────────────────────────────────────────────────────
      const membre = payment.profiles || {};
      const nomMembre = `${membre.prenom || ''} ${membre.nom || ''}`.trim() || 'Client';
      const emailMembre = membre.email || '—';

      // ── Données réservation / abonnement ────────────────────────────────────
      const reservation = payment.reservations || null;
      const abonnement  = payment.abonnements  || null;

      // ── Dates ───────────────────────────────────────────────────────────────
      const datePaiement = payment.date_paiement
        ? new Date(payment.date_paiement).toLocaleDateString('fr-FR', {
            day: '2-digit', month: 'long', year: 'numeric',
          })
        : new Date(payment.created_at).toLocaleDateString('fr-FR', {
            day: '2-digit', month: 'long', year: 'numeric',
          });

      const dateEmission = new Date().toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'long', year: 'numeric',
      });

      // ── Montant ─────────────────────────────────────────────────────────────
      const montant = parseFloat(payment.montant || 0).toFixed(3);
      const statut  = payment.statut || 'pending';

      // ── Document PDF ────────────────────────────────────────────────────────
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title:    `Reçu ${payment.numero_recu || payment.id}`,
          Author:   config.coworkingName,
          Subject:  'Reçu de paiement DeskyWork',
          Keywords: 'reçu paiement coworking deskywork',
        },
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth  = doc.page.width;
      const pageHeight = doc.page.height;
      const margin     = 50;
      const contentW   = pageWidth - margin * 2;

      // ════════════════════════════════════════════════════════════════════════
      // EN-TÊTE — Bandeau Noir & Orange DeskyWork
      // ════════════════════════════════════════════════════════════════════════
      doc.rect(0, 0, pageWidth, 120).fill(COLORS.primary);

      // Logo Image DeskyWork si disponible sur disque, sinon Texte
      const logoPath = path.join(__dirname, '../../frontend/public/logo 2.png');
      let hasLogoImage = false;
      if (fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, margin, 22, { height: 48 });
          hasLogoImage = true;
        } catch (_) {}
      }

      if (!hasLogoImage) {
        doc.fillColor(COLORS.secondary)
           .font('Helvetica-Bold')
           .fontSize(24)
           .text(config.coworkingName, margin, 30, { width: contentW * 0.6 });
        doc.fillColor(COLORS.white)
           .font('Helvetica')
           .fontSize(9)
           .text('Espace de Coworking & Flex Office', margin, 58);
      } else {
        doc.fillColor(COLORS.secondary)
           .font('Helvetica-Bold')
           .fontSize(9)
           .text('COWORKING & FLEX OFFICE', margin, 74);
      }

      // Informations de contact DeskyWork (droite)
      doc.fillColor(COLORS.white)
         .font('Helvetica-Bold')
         .fontSize(10)
         .text(config.coworkingName, margin + contentW * 0.5, 28, { width: contentW * 0.5, align: 'right' });

      doc.fillColor(COLORS.muted)
         .font('Helvetica')
         .fontSize(8.5)
         .text(config.coworkingEmail, margin + contentW * 0.5, 42, { width: contentW * 0.5, align: 'right' })
         .text(config.coworkingTel, margin + contentW * 0.5, 54, { width: contentW * 0.5, align: 'right' })
         .text(config.coworkingAdresse, margin + contentW * 0.5, 66, { width: contentW * 0.5, align: 'right' });

      // Barre d'accent orange séparatrice
      doc.rect(0, 116, pageWidth, 4).fill(COLORS.secondary);

      // ════════════════════════════════════════════════════════════════════════
      // TITRE REÇU DE PAIEMENT + NUMÉRO & STATUT
      // ════════════════════════════════════════════════════════════════════════
      const yAfterHeader = 135;

      // Card Résumé Reçu (fond crème/orange)
      doc.rect(margin, yAfterHeader, contentW, 58)
         .fillAndStroke(COLORS.light, COLORS.border);

      doc.fillColor(COLORS.secondary)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text('REÇU OFFICIEL DE PAIEMENT', margin + 15, yAfterHeader + 10);

      doc.fillColor(COLORS.primary)
         .font('Helvetica-Bold')
         .fontSize(15)
         .text(payment.numero_recu || `PAY-${payment.id.slice(0, 8).toUpperCase()}`, margin + 15, yAfterHeader + 24);

      doc.fillColor(COLORS.muted)
         .font('Helvetica')
         .fontSize(8.5)
         .text(`Émis le : ${dateEmission}`, margin + 15, yAfterHeader + 42);

      // Badge Statut
      const statutColor = statut === 'paid' ? COLORS.success : COLORS.warning;
      const statutLabel = STATUT_LABELS[statut] || statut;
      const badgeX      = margin + contentW - 120;
      const badgeY      = yAfterHeader + 16;

      doc.rect(badgeX, badgeY, 105, 26).fill(statutColor);
      doc.fillColor(COLORS.white)
         .font('Helvetica-Bold')
         .fontSize(10)
         .text(statutLabel.toUpperCase(), badgeX, badgeY + 8, { width: 105, align: 'center' });

      // ════════════════════════════════════════════════════════════════════════
      // INFORMATIONS CLIENT
      // ════════════════════════════════════════════════════════════════════════
      const yClient = yAfterHeader + 75;

      doc.fillColor(COLORS.primary)
         .font('Helvetica-Bold')
         .fontSize(11)
         .text('INFORMATIONS CLIENT', margin, yClient);

      doc.moveTo(margin, yClient + 16)
         .lineTo(margin + contentW, yClient + 16)
         .strokeColor(COLORS.secondary)
         .lineWidth(2)
         .stroke();

      const col1X = margin;
      const col2X = margin + contentW / 2;
      const yData = yClient + 26;

      _field(doc, 'Nom & Prénom', nomMembre,      col1X, yData);
      _field(doc, 'Email',        emailMembre,    col1X, yData + 36);
      _field(doc, 'Date de règlement', datePaiement, col1X, yData + 72);

      _field(doc, 'Mode de règlement', MODE_LABELS[payment.mode] || payment.mode, col2X, yData);
      if (payment.reference_externe) {
        _field(doc, 'Référence transaction', payment.reference_externe, col2X, yData + 36);
      }

      // ════════════════════════════════════════════════════════════════════════
      // DÉTAIL DU SERVICE
      // ════════════════════════════════════════════════════════════════════════
      const yDetail = yData + 115;

      doc.fillColor(COLORS.primary)
         .font('Helvetica-Bold')
         .fontSize(11)
         .text('DÉTAIL DE LA FACTURATION', margin, yDetail);

      doc.moveTo(margin, yDetail + 16)
         .lineTo(margin + contentW, yDetail + 16)
         .strokeColor(COLORS.secondary)
         .lineWidth(2)
         .stroke();

      // En-têtes Tableau
      const tableY     = yDetail + 26;
      const col_desc   = margin;
      const col_detail = margin + contentW * 0.5;
      const col_prix   = margin + contentW * 0.82;

      doc.rect(col_desc, tableY, contentW, 24).fill(COLORS.primary);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(9);
      doc.text('DESCRIPTION',   col_desc   + 8, tableY + 8, { width: contentW * 0.48 });
      doc.text('PÉRIODE / DÉTAIL', col_detail + 8, tableY + 8, { width: contentW * 0.3  });
      doc.text('MONTANT (DT)',  col_prix,        tableY + 8, { width: contentW * 0.18, align: 'right' });

      // Ligne de données
      const rowY = tableY + 30;
      doc.rect(col_desc, rowY, contentW, 30).fill(COLORS.light);

      let description = 'Service DeskyWork';
      let detail      = '—';

      if (reservation) {
        description = `Réservation d'Espace — ${reservation.espaces?.nom || 'Espace'}`;
        const d1 = new Date(reservation.date_debut).toLocaleDateString('fr-FR');
        const h1 = new Date(reservation.date_debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const h2 = new Date(reservation.date_fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        detail = `${d1} (${h1} - ${h2})`;
      } else if (abonnement) {
        const LABELS = { day_pass: 'Day Pass', week_pass: 'Week Pass', mensuel: 'Mensuel', trimestriel: 'Trimestriel', annuel: 'Annuel', bureau_prive: 'Bureau Privé' };
        description = `Abonnement — ${LABELS[abonnement.type] || abonnement.type}`;
        const d1 = new Date(abonnement.date_debut).toLocaleDateString('fr-FR');
        const d2 = new Date(abonnement.date_fin).toLocaleDateString('fr-FR');
        detail = `${d1} → ${d2}`;
      }

      doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(9);
      doc.text(description, col_desc + 8, rowY + 10, { width: contentW * 0.48 });
      doc.font('Helvetica').fontSize(8.5);
      doc.text(detail, col_detail + 8, rowY + 10, { width: contentW * 0.3 });
      doc.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(10)
         .text(`${montant} DT`, col_prix, rowY + 9, { width: contentW * 0.18, align: 'right' });

      // ════════════════════════════════════════════════════════════════════════
      // BLOC TOTAL HIGHLIGHTED ORANGE
      // ════════════════════════════════════════════════════════════════════════
      const totalY = rowY + 48;

      doc.rect(col_prix - 70, totalY, 70 + contentW * 0.18, 34).fill(COLORS.secondary);
      doc.fillColor(COLORS.white)
         .font('Helvetica-Bold')
         .fontSize(10)
         .text('TOTAL TTC', col_prix - 65, totalY + 11, { width: 60, align: 'left' });
      doc.fillColor(COLORS.white)
         .font('Helvetica-Bold')
         .fontSize(14)
         .text(`${montant} DT`, col_prix, totalY + 9, { width: contentW * 0.18, align: 'right' });

      // ════════════════════════════════════════════════════════════════════════
      // NOTE BAS DE PAGE
      // ════════════════════════════════════════════════════════════════════════
      const yNote = totalY + 60;

      doc.rect(margin, yNote, contentW, 46).fill(COLORS.light);
      doc.fillColor(COLORS.muted)
         .font('Helvetica')
         .fontSize(8)
         .text(
           'Ce reçu est généré automatiquement par la plateforme DeskyWork. Conservez ce document comme justificatif officiel. ' +
           'Pour toute assistance, contactez notre équipe support : ' + config.coworkingEmail,
           margin + 10, yNote + 10,
           { width: contentW - 20, align: 'center' }
         );

      // ════════════════════════════════════════════════════════════════════════
      // FOOTER NOIR DESKYWORK
      // ════════════════════════════════════════════════════════════════════════
      doc.rect(0, pageHeight - 38, pageWidth, 38).fill(COLORS.primary);
      doc.fillColor(COLORS.white)
         .font('Helvetica-Bold')
         .fontSize(8)
         .text('DeskyWork', margin, pageHeight - 24, { width: contentW, align: 'center' });
      doc.fillColor(COLORS.muted)
         .font('Helvetica')
         .fontSize(8)
         .text('  ·  Espace de Coworking & Flex Office  ·  www.deskywork.tn', margin + 60, pageHeight - 24, { width: contentW - 120, align: 'center' });

      doc.end();

    } catch (err) {
      reject(err);
    }
  });
}

// ── Helper : affichage d'un champ label / valeur ────────────────────────────
function _field(doc, label, value, x, y) {
  doc.fillColor(COLORS.muted)
     .font('Helvetica')
     .fontSize(8)
     .text(label, x, y);
  doc.fillColor(COLORS.text)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text(value || '—', x, y + 11, { width: 220 });
}

module.exports = { generateReceiptPDF };
