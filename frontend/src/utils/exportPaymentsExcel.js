import { loadExcelJS } from './excelHelper';

const MODE_LABELS = {
  cash: 'Espèces',
  bank_transfer: 'Virement',
  check: 'Chèque',
  online: 'En ligne',
};

const STATUT_LABELS = {
  paid: 'Payé',
  pending: 'En attente',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

const STATUT_COLORS = {
  paid: 'FFD1FAE5',
  pending: 'FFFEF3C7',
  failed: 'FFFEE2E2',
  refunded: 'FFEDE9FE',
};

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR');
}

function formatExportDate() {
  return new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportPaymentsToExcel(payments = [], stats = null) {
  const safeStats = {
    totalRevenue: stats?.totalRevenue ?? payments.filter(p => p.statut === 'paid').reduce((s, p) => s + parseFloat(p.montant || 0), 0),
    pendingAmount: stats?.pendingAmount ?? payments.filter(p => p.statut === 'pending').reduce((s, p) => s + parseFloat(p.montant || 0), 0),
    paidCount: stats?.paidCount ?? payments.filter(p => p.statut === 'paid').length,
    totalInvoices: stats?.totalInvoices ?? payments.length,
    recoveryRate: stats?.recoveryRate ?? (payments.length ? Math.round((payments.filter(p => p.statut === 'paid').length / payments.length) * 100) : 0),
  };

  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DeskyWork';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Paiements DeskyWork', {
    views: [{ state: 'frozen', ySplit: 8 }],
    properties: { defaultRowHeight: 20 },
  });

  sheet.columns = [
    { key: 'reference', width: 20 },
    { key: 'date', width: 14 },
    { key: 'membre', width: 24 },
    { key: 'email', width: 32 },
    { key: 'montant', width: 16 },
    { key: 'mode', width: 14 },
    { key: 'statut', width: 14 },
  ];

  // Titre principal
  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'DeskyWork — Rapport de Gestion des Paiements';
  titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF100F0D' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 34;

  // Sous-titre (date d'export)
  sheet.mergeCells('A2:G2');
  const subtitleCell = sheet.getCell('A2');
  subtitleCell.value = `Exporté le ${formatExportDate()} · DeskyWork Flex Office`;
  subtitleCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFF95D00' } };
  subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 22;

  // Résumé KPI
  const kpiRow = sheet.getRow(4);
  kpiRow.height = 24;
  const kpis = [
    { label: 'Recettes encaissées', value: `${safeStats.totalRevenue.toLocaleString('fr-FR')} DT`, col: 1 },
    { label: 'En attente', value: `${safeStats.pendingAmount.toLocaleString('fr-FR')} DT`, col: 3 },
    { label: 'Taux de recouvrement', value: `${safeStats.recoveryRate}% (${safeStats.paidCount}/${safeStats.totalInvoices})`, col: 5 },
  ];

  kpis.forEach(({ label, value, col }) => {
    const labelCell = kpiRow.getCell(col);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 10, color: { argb: 'FF100F0D' } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD8' } };
    labelCell.border = THIN_BORDER;
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const valueCell = kpiRow.getCell(col + 1);
    valueCell.value = value;
    valueCell.font = { bold: true, size: 11, color: { argb: 'FFF95D00' } };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    valueCell.border = THIN_BORDER;
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Nombre total de transactions
  sheet.mergeCells('A5:G5');
  const countCell = sheet.getCell('A5');
  countCell.value = `${payments.length} transaction${payments.length > 1 ? 's' : ''} au total`;
  countCell.font = { size: 10, color: { argb: 'FF64748B' } };
  countCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // En-têtes du tableau
  const headerRowIndex = 7;
  const headers = ['Référence', 'Date', 'Membre', 'Email', 'Montant (DT)', 'Mode', 'Statut'];
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.height = 26;

  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF95D00' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = THIN_BORDER;
  });

  // Données
  payments.forEach((payment, index) => {
    const rowIndex = headerRowIndex + 1 + index;
    const row = sheet.getRow(rowIndex);
    row.height = 22;

    const memberName = payment.profiles
      ? `${payment.profiles.prenom} ${payment.profiles.nom}`.trim()
      : payment.user_id;
    const dateValue = payment.date_paiement || payment.created_at;
    const montant = parseFloat(payment.montant || 0);
    const statutKey = payment.statut;

    const values = [
      payment.numero_recu || payment.id.slice(0, 8),
      formatDate(dateValue),
      memberName,
      payment.profiles?.email || '—',
      montant,
      MODE_LABELS[payment.mode] || payment.mode || '—',
      STATUT_LABELS[statutKey] || statutKey || '—',
    ];

    values.forEach((value, colIndex) => {
      const cell = row.getCell(colIndex + 1);
      cell.value = value;
      cell.border = THIN_BORDER;
      cell.alignment = {
        horizontal: colIndex === 4 ? 'right' : colIndex <= 1 ? 'center' : 'left',
        vertical: 'middle',
        wrapText: colIndex === 2 || colIndex === 3,
      };

      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }

      if (colIndex === 0) {
        cell.font = { name: 'Consolas', size: 10, color: { argb: 'FF334155' } };
      }

      if (colIndex === 4) {
        cell.numFmt = '#,##0.00';
        cell.font = { bold: true, color: { argb: 'FF0F766E' } };
      }

      if (colIndex === 6 && STATUT_COLORS[statutKey]) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUT_COLORS[statutKey] } };
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const filename = `export_paiements_${new Date().toISOString().slice(0, 10)}.xlsx`;
  downloadBlob(blob, filename);
}
