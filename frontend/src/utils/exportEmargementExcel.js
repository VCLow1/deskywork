import { loadExcelJS } from './excelHelper';

function formatExportDate() {
  return new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportEmargementToExcel(formation, emargementData) {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
  wb.creator = 'DeskyWork';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Feuille d Emargement', {
    views: [{ state: 'frozen', ySplit: 6 }],
    properties: { defaultRowHeight: 22 },
  });

  sheet.columns = [
    { key: 'nom', width: 26 },
    { key: 'email', width: 32 },
    { key: 'telephone', width: 18 },
    { key: 'date_inscription', width: 20 },
    { key: 'presence', width: 16 },
    { key: 'emargement', width: 24 },
  ];

  // Title
  sheet.mergeCells('A1:F1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `DeskyWork — Feuille d'Émargement: ${formation.titre || 'Formation'}`;
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF100F0D' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  sheet.mergeCells('A2:F2');
  const subCell = sheet.getCell('A2');
  const dateDebut = formation.date_debut ? new Date(formation.date_debut).toLocaleDateString('fr-FR') : '—';
  subCell.value = `Session du ${dateDebut} · Lieu: ${formation.espaces?.nom || 'DeskyWork Workspace'}`;
  subCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFF95D00' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 20;

  sheet.mergeCells('A3:F3');
  const metaCell = sheet.getCell('A3');
  metaCell.value = `Formateur: ${emargementData?.formateur || '—'} · Capacite: ${formation.nb_inscrits || 0}/${formation.capacite_max || '∞'} inscrits`;
  metaCell.font = { name: 'Calibri', size: 10, color: { argb: 'FF64748B' } };
  metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(3).height = 18;

  // Header
  const hRow = sheet.getRow(6);
  hRow.height = 26;
  const headers = ['Nom & Prénom', 'Email', 'Téléphone', 'Date d\'inscription', 'Statut Présence', 'Émargement / Signature'];
  headers.forEach((h, i) => {
    const c = hRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF95D00' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
  });

  const participants = emargementData?.inscrits || emargementData?.participants || (Array.isArray(emargementData) ? emargementData : []);

  if (participants.length === 0) {
    const r = sheet.getRow(7);
    r.getCell(1).value = 'Aucun inscrit pour cette formation.';
    sheet.mergeCells('A7:F7');
    r.getCell(1).alignment = { horizontal: 'center' };
  } else {
    participants.forEach((p, idx) => {
      const r = sheet.getRow(7 + idx);
      r.height = 24;

      const name = p.nom_complet || `${p.prenom || ''} ${p.nom || ''}`.trim() || p.email || 'Participant';
      const email = p.email || '—';
      const phone = p.telephone || '—';
      const dateInsc = p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR') : '—';
      const presence = p.present ? 'Présent' : 'En attente';

      const vals = [name, email, phone, dateInsc, presence, '[   ] Émargé'];

      vals.forEach((v, cIdx) => {
        const c = r.getCell(cIdx + 1);
        c.value = v;
        c.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        c.alignment = { horizontal: cIdx >= 3 ? 'center' : 'left', vertical: 'middle' };

        if (idx % 2 === 1) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `emargement_${(formation.titre || 'formation').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  downloadBlob(blob, filename);
}
