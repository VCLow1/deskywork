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

export async function exportBillingToExcel(tenants = [], months = [], barData = []) {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
  wb.creator = 'DeskyWork';
  wb.created = new Date();

  // Feuille 1: Résumé MRR
  const sheet1 = wb.addWorksheet('Synthèse MRR', {
    views: [{ state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 22 },
  });

  sheet1.columns = [
    { key: 'mois', width: 20 },
    { key: 'mrr', width: 24 },
  ];

  // Title
  sheet1.mergeCells('A1:B1');
  const titleCell1 = sheet1.getCell('A1');
  titleCell1.value = 'DeskyWork — Revenue Mensuel Récurrent (MRR)';
  titleCell1.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF100F0D' } };
  titleCell1.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet1.getRow(1).height = 34;

  sheet1.mergeCells('A2:B2');
  const subCell1 = sheet1.getCell('A2');
  subCell1.value = `Exporté le ${formatExportDate()} · DeskyWork Admin`;
  subCell1.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFF95D00' } };
  subCell1.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet1.getRow(2).height = 22;

  // Header
  const hRow1 = sheet1.getRow(4);
  hRow1.height = 26;
  ['Mois', 'MRR Encaissé (DT)'].forEach((h, i) => {
    const c = hRow1.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF95D00' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  months.forEach((m, idx) => {
    const r = sheet1.getRow(5 + idx);
    r.height = 22;
    const c1 = r.getCell(1);
    const c2 = r.getCell(2);

    c1.value = m;
    c2.value = barData[idx] || 0;
    c2.numFmt = '#,##0.00';

    c1.alignment = { horizontal: 'left', vertical: 'middle' };
    c2.alignment = { horizontal: 'right', vertical: 'middle' };

    c1.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    c2.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };

    if (idx % 2 === 1) {
      c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }
  });

  // Feuille 2: Liste des Espaces / Tenants
  if (tenants.length > 0) {
    const sheet2 = wb.addWorksheet('Détails des Abonnements', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    sheet2.columns = [
      { key: 'nom', width: 28 },
      { key: 'plan', width: 20 },
      { key: 'montant', width: 18 },
      { key: 'statut', width: 16 },
    ];

    sheet2.mergeCells('A1:D1');
    const t2 = sheet2.getCell('A1');
    t2.value = 'DeskyWork — Liste des Abonnements Espaces';
    t2.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF100F0D' } };
    t2.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet2.getRow(1).height = 34;

    const hRow2 = sheet2.getRow(4);
    hRow2.height = 26;
    ['Espace', 'Plan', 'Montant Mensuel (DT)', 'Statut'].forEach((h, i) => {
      const c = hRow2.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF95D00' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    tenants.forEach((t, idx) => {
      const r = sheet2.getRow(5 + idx);
      r.height = 22;
      const vals = [t.nom || '—', t.plan || '—', parseFloat(t.montant_mensuel || 0), t.statut || 'actif'];
      vals.forEach((v, cIdx) => {
        const cell = r.getCell(cIdx + 1);
        cell.value = v;
        if (cIdx === 2) cell.numFmt = '#,##0.00';
        cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { horizontal: cIdx === 2 ? 'right' : cIdx === 3 ? 'center' : 'left', vertical: 'middle' };
      });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, `mrr_deskywork_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
