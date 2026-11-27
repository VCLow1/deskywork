// utils/generateInvoicePdf.js — Génération PDF officielle Facture / Devis / Avoir (conforme tunisienne)
const PDFDocument = require('pdfkit');

const COLORS = {
  primary: '#100F0D',
  orange: '#F95D00',
  softOrange: '#FFF7ED',
  border: '#E2E8F0',
  muted: '#64748B',
  emerald: '#059669',
  red: '#DC2626',
  white: '#FFFFFF',
};

function fmtDT(v) {
  const n = Number(v || 0);
  const safe = Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0;
  const sign = safe < 0 ? '-' : '';
  const [intPart, decPart] = Math.abs(safe).toFixed(3).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped},${decPart} DT`;
}

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('fr-FR', {
      timeZone: 'Africa/Tunis',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return String(v);
  }
}

/**
 * Génère le buffer PDF d'une Facture, d'un Devis ou d'un Avoir.
 */
function generateInvoicePDF(docRecord, tenant = {}) {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({ size: 'A4', margin: 45 });
      const chunks = [];
      pdf.on('data', (c) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      const settings = tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
      const snapshot = docRecord?.emetteur_snapshot && Object.keys(docRecord.emetteur_snapshot).length > 0
        ? docRecord.emetteur_snapshot
        : {};

      const emetteurNom = snapshot.nom || tenant?.nom || 'DeskyWork';
      const emetteurAdresse = snapshot.adresse || tenant?.adresse || settings.adresse || 'Tunis, Tunisie';
      const emetteurTel = snapshot.telephone || tenant?.telephone || settings.telephone || '+216 00 000 000';
      const emetteurEmail = snapshot.email || tenant?.email || settings.email || 'contact@deskywork.tn';
      const emetteurMF = snapshot.matricule_fiscal || settings.matricule_fiscal || tenant?.matricule_fiscal || 'Non renseigné';

      const docType = String(docRecord.type || 'facture').toLowerCase();
      const typeTitle = docType === 'avoir' ? 'AVOIR' : docType === 'devis' ? 'DEVIS' : 'FACTURE';
      const bannerColor = docType === 'avoir' ? COLORS.red : COLORS.orange;

      // En-tête
      pdf.rect(0, 0, pdf.page.width, 84).fill(COLORS.primary);
      pdf.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(20).text(emetteurNom, 45, 24);
      pdf.font('Helvetica').fontSize(9).fillColor('#CBD5E1')
        .text(`${emetteurAdresse}  |  Tél : ${emetteurTel}  |  MF : ${emetteurMF}`, 45, 50);

      pdf.rect(pdf.page.width - 210, 20, 165, 44).fill(bannerColor);
      pdf.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(14)
        .text(typeTitle, pdf.page.width - 200, 26, { width: 145, align: 'center' });
      pdf.fontSize(10)
        .text(docRecord.numero || '—', pdf.page.width - 200, 44, { width: 145, align: 'center' });

      // Métadonnées émetteur / client
      let y = 105;
      pdf.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(10).text('CLIENT / DESTINATAIRE', 45, y);
      pdf.font('Helvetica').fontSize(10).fillColor(COLORS.primary)
        .text(docRecord.client_nom || 'Client', 45, y + 16);
      let clientLineY = y + 32;
      if (docRecord.client_matricule_fiscal) {
        pdf.fontSize(9).fillColor(COLORS.muted).text(`Matricule fiscal : ${docRecord.client_matricule_fiscal}`, 45, clientLineY);
        clientLineY += 14;
      }
      if (docRecord.client_telephone) {
        pdf.fontSize(9).fillColor(COLORS.muted).text(`Téléphone : ${docRecord.client_telephone}`, 45, clientLineY);
        clientLineY += 14;
      }
      if (docRecord.client_email) {
        pdf.fontSize(9).fillColor(COLORS.muted).text(`E-mail : ${docRecord.client_email}`, 45, clientLineY);
        clientLineY += 14;
      }
      if (docRecord.client_adresse) {
        pdf.fontSize(9).fillColor(COLORS.muted).text(`Adresse : ${docRecord.client_adresse}`, 45, clientLineY);
      }

      // Bloc dates & statut à droite
      pdf.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(10).text('INFORMATIONS DOCUMENT', 330, y);
      pdf.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
        .text(`Date d'émission : ${fmtDate(docRecord.date_emission || docRecord.created_at)}`, 330, y + 16)
        .text(`Date d'échéance : ${fmtDate(docRecord.date_echeance)}`, 330, y + 30)
        .text(`Statut : ${String(docRecord.statut || 'emise').toUpperCase()}${docRecord.locked ? ' (Verrouillée)' : ''}`, 330, y + 44);
      if (docRecord.parent_facture_numero || docRecord.motif_avoir) {
        pdf.fillColor(COLORS.red).font('Helvetica-Bold').fontSize(9)
          .text(`Motif de l'avoir : ${docRecord.motif_avoir || 'Régularisation'}`, 330, y + 58, { width: 220 });
      }

      // Tableau des lignes HT / TVA / TTC
      y = 210;
      pdf.rect(45, y, pdf.page.width - 90, 24).fill('#F8FAFC');
      pdf.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(9);
      pdf.text('Désignation', 52, y + 7, { width: 230 });
      pdf.text('Qté', 290, y + 7, { width: 45, align: 'right' });
      pdf.text('PU HT', 340, y + 7, { width: 95, align: 'right' });
      pdf.text('Total HT', 445, y + 7, { width: 100, align: 'right' });

      y += 28;
      const lines = Array.isArray(docRecord.lignes) && docRecord.lignes.length > 0
        ? docRecord.lignes
        : [{
            designation: docRecord.notes || `${typeTitle} ${docRecord.numero || ''}`.trim(),
            quantite: 1,
            prix_unitaire_ht: Number(docRecord.montant_ht || 0),
          }];

      const tvaRate = Number(docRecord.tva_pct ?? docRecord.tva_rate ?? 19);

      for (const ln of lines) {
        const qty = Number(ln.quantite || 1);
        const puHT = Number(ln.prix_unitaire_ht ?? ln.pu_ht ?? docRecord.montant_ht ?? 0);
        const lineHT = ln.total_ht != null ? Number(ln.total_ht) : qty * puHT;
        pdf.fillColor(COLORS.primary).font('Helvetica').fontSize(9);
        pdf.text(String(ln.designation || 'Prestation'), 52, y, { width: 230 });
        pdf.text(String(qty), 290, y, { width: 45, align: 'right' });
        pdf.text(fmtDT(puHT), 340, y, { width: 95, align: 'right' });
        pdf.text(fmtDT(lineHT), 445, y, { width: 100, align: 'right' });
        y += 22;
        pdf.moveTo(45, y - 4).lineTo(pdf.page.width - 45, y - 4).strokeColor(COLORS.border).lineWidth(0.5).stroke();
      }

      // Totaux HT / TVA / Timbre / TTC
      y += 16;
      const montantHT = Number(docRecord.montant_ht || 0);
      const totalTVA = docRecord.total_tva != null ? Number(docRecord.total_tva) : Math.round((montantHT * (tvaRate / 100)) * 1000) / 1000;
      const timbreFiscal = Number(docRecord.timbre_fiscal || 0);
      const montantTTC = Number(docRecord.montant_ttc || (montantHT + totalTVA + timbreFiscal));

      pdf.rect(325, y, 225, timbreFiscal !== 0 ? 96 : 78).fill(COLORS.softOrange);
      let ty = y + 10;
      pdf.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('Total HT', 337, ty);
      pdf.fillColor(COLORS.primary).font('Helvetica-Bold').text(fmtDT(montantHT), 425, ty, { width: 115, align: 'right' });
      ty += 18;
      pdf.fillColor(COLORS.muted).font('Helvetica').text(`TVA (${tvaRate}%)`, 337, ty);
      pdf.fillColor(COLORS.primary).font('Helvetica-Bold').text(fmtDT(totalTVA), 425, ty, { width: 115, align: 'right' });
      if (timbreFiscal !== 0) {
        ty += 18;
        pdf.fillColor(COLORS.muted).font('Helvetica').text('Timbre fiscal', 337, ty);
        pdf.fillColor(COLORS.primary).font('Helvetica-Bold').text(fmtDT(timbreFiscal), 425, ty, { width: 115, align: 'right' });
      }
      ty += 20;
      pdf.fillColor(bannerColor).font('Helvetica-Bold').fontSize(11).text('Net à payer TTC', 337, ty);
      pdf.text(fmtDT(montantTTC), 425, ty, { width: 115, align: 'right' });

      // Mentions légales
      const footerY = pdf.page.height - 95;
      pdf.moveTo(45, footerY).lineTo(pdf.page.width - 45, footerY).strokeColor(COLORS.border).lineWidth(0.7).stroke();
      const legalText = docRecord.mentions_legales || settings.mentions_legales ||
        `${emetteurNom} — Matricule Fiscal : ${emetteurMF} — Tél : ${emetteurTel} — ${emetteurEmail}. Document comptable conforme.`;
      pdf.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
        .text(legalText, 45, footerY + 10, { width: pdf.page.width - 90, align: 'center' });

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateInvoicePDF,
};
