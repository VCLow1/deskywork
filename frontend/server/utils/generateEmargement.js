// server/utils/generateEmargement.js — Génération de feuille d'émargement PDF (CDC v3.0 Chantier 5.3)
const PDFDocument = require('pdfkit');

function generateEmargementPDF(formationInfo, participants = [], waitlist = []) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Feuille d'émargement - ${formationInfo.titre || 'Formation'}`,
          Author: 'DeskyWork',
        },
      });

      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const margin = 40;
      const contentW = pageW - margin * 2;

      // En-tête noir & orange DeskyWork
      doc.rect(0, 0, pageW, 88).fill('#100F0D');
      doc.fillColor('#F95D00').font('Helvetica-Bold').fontSize(18).text('DESKYWORK', margin, 22);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13).text("FEUILLE D'ÉMARGEMENT — SESSION DE FORMATION", margin, 46);
      doc.fillColor('#CFCAC3').font('Helvetica').fontSize(9).text(`Générée le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Tunis' })} (Africa/Tunis)`, pageW - margin - 210, 26, { width: 210, align: 'right' });

      let y = 108;
      // Cartouche infos session
      doc.roundedRect(margin, y, contentW, 74, 8).fillAndStroke('#FFF7ED', '#FED7AA');
      doc.fillColor('#100F0D').font('Helvetica-Bold').fontSize(12).text(formationInfo.titre || 'Session de formation', margin + 14, y + 12, { width: contentW - 28 });
      doc.fillColor('#475569').font('Helvetica').fontSize(9.5)
        .text(`Date : ${formationInfo.date || '—'}   |   Horaire : ${formationInfo.horaire || '—'}`, margin + 14, y + 32)
        .text(`Formateur : ${formationInfo.formateur || '—'}   |   Salle : ${formationInfo.salle || '—'}`, margin + 14, y + 48);

      y += 94;

      // En-tête tableau participants confirmés
      const drawHeader = (topY) => {
        doc.rect(margin, topY, contentW, 24).fill('#100F0D');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
        doc.text('N°', margin + 8, topY + 8, { width: 24 });
        doc.text('Apprenant', margin + 36, topY + 8, { width: 145 });
        doc.text('E-mail & Téléphone', margin + 185, topY + 8, { width: 145 });
        doc.text('Règlement', margin + 335, topY + 8, { width: 70 });
        doc.text('Signature / Émargement', margin + 410, topY + 8, { width: 100 });
        return topY + 24;
      };

      y = drawHeader(y);

      if (participants.length === 0) {
        doc.rect(margin, y, contentW, 34).stroke('#E2E8F0');
        doc.fillColor('#64748B').font('Helvetica').fontSize(9.5).text('Aucun apprenant confirmé inscrit à ce jour.', margin + 14, y + 12);
        y += 40;
      } else {
        participants.forEach((p, idx) => {
          if (y > doc.page.height - 90) {
            doc.addPage();
            y = drawHeader(40);
          }
          const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
          doc.rect(margin, y, contentW, 32).fillAndStroke(bg, '#E2E8F0');
          doc.fillColor('#100F0D').font('Helvetica-Bold').fontSize(9).text(String(p.numero || idx + 1), margin + 8, y + 11, { width: 24 });
          doc.font('Helvetica-Bold').text(`${p.prenom || ''} ${p.nom || ''}`.trim() || 'Apprenant', margin + 36, y + 11, { width: 145, ellipsis: true });
          doc.fillColor('#475569').font('Helvetica').fontSize(8).text(`${p.email || '—'}\n${p.telephone || '—'}`, margin + 185, y + 6, { width: 145 });
          doc.fillColor('#0F172A').fontSize(8.5).text(p.statut_paiement === 'paye' ? 'Payé' : p.statut_paiement === 'gratuit' ? 'Gratuit' : 'Sur place', margin + 335, y + 11, { width: 70 });
          doc.fillColor('#94A3B8').fontSize(8).text(p.present ? 'Présent(e)' : '________________', margin + 410, y + 13, { width: 100 });
          y += 32;
        });
      }

      if (waitlist.length > 0) {
        y += 18;
        if (y > doc.page.height - 90) {
          doc.addPage();
          y = 40;
        }
        doc.fillColor('#B45309').font('Helvetica-Bold').fontSize(10).text(`Liste d'attente (${waitlist.length})`, margin, y);
        y += 16;
        waitlist.forEach((w, idx) => {
          if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
          doc.fillColor('#475569').font('Helvetica').fontSize(8.5).text(`${idx + 1}. ${w.prenom || ''} ${w.nom || ''} (${w.email || '—'})`, margin + 8, y);
          y += 14;
        });
      }

      // Pied signature formateur
      const sigY = Math.min(doc.page.height - 70, y + 26);
      doc.fillColor('#475569').font('Helvetica-Bold').fontSize(9).text('Signature du formateur / responsable :', margin, sigY);
      doc.rect(margin + 210, sigY - 4, 220, 32).stroke('#CBD5E1');

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateEmargementPDF };

