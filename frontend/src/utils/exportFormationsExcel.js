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

export async function exportFormationsToExcel(formations = []) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DeskyWork';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Formations DeskyWork', {
    views: [{ state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 22 },
  });

  sheet.columns = [
    { key: 'titre', width: 30 },
    { key: 'formateur', width: 24 },
    { key: 'espace', width: 24 },
    { key: 'date_debut', width: 18 },
    { key: 'inscrits', width: 14 },
    { key: 'prix', width: 16 },
    { key: 'statut', width: 14 },
  ];

  // Titre principal
  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'DeskyWork — Catalogue des Formations';
  titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF100F0D' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 34;

  // Sous-titre
  sheet.mergeCells('A2:G2');
  const subCell = sheet.getCell('A2');
  subCell.value = `Exporté le ${formatExportDate()} · ${formations.length} formation(s)`;
  subCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFF95D00' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 22;

  // En-têtes
  const headerRow = sheet.getRow(4);
  headerRow.height = 26;
  const headers = ['Formation', 'Formateur', 'Espace / Coworking', 'Date début', 'Inscrits', 'Tarif', 'Statut'];
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF95D00' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  });

  // Données
  formations.forEach((f, index) => {
    const r = sheet.getRow(5 + index);
    r.height = 22;

    const formateurName = f.profiles ? `${f.profiles.prenom} ${f.profiles.nom}` : '—';
    const dateDebut = f.date_debut ? new Date(f.date_debut).toLocaleDateString('fr-FR') : '—';
    const inscritsStr = `${f.nb_inscrits ?? 0} / ${f.capacite_max || '∞'}`;
    const prixStr = f.prix_inscription > 0 ? `${f.prix_inscription} DT` : 'Gratuit';
    const statutStr = f.statut === 'planifiee' ? 'Planifiée' : f.statut === 'en_cours' ? 'En cours' : f.statut === 'terminee' ? 'Terminée' : 'Annulée';

    const values = [f.titre, formateurName, f.espaces?.nom || '—', dateDebut, inscritsStr, prixStr, statutStr];

    values.forEach((val, colIdx) => {
      const c = r.getCell(colIdx + 1);
      c.value = val;
      c.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      c.alignment = { horizontal: colIdx === 4 || colIdx === 6 ? 'center' : colIdx === 5 ? 'right' : 'left', vertical: 'middle' };

      if (index % 2 === 1) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      if (colIdx === 0) c.font = { bold: true, color: { argb: 'FF100F0D' } };
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, `formations_deskywork_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
