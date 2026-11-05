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

export async function exportAuditLogsToExcel(logs = []) {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
  wb.creator = 'DeskyWork';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Logs d Audit DeskyWork', {
    views: [{ state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 22 },
  });

  sheet.columns = [
    { key: 'timestamp', width: 22 },
    { key: 'user', width: 26 },
    { key: 'action', width: 28 },
    { key: 'target', width: 26 },
    { key: 'status', width: 16 },
  ];

  // Title
  sheet.mergeCells('A1:E1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'DeskyWork — Journaux d\'Audit & Surveillance Système';
  titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF100F0D' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 34;

  sheet.mergeCells('A2:E2');
  const subCell = sheet.getCell('A2');
  subCell.value = `Exporté le ${formatExportDate()} · ${logs.length} entrée(s) de journal`;
  subCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFF95D00' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 22;

  // Header
  const hRow = sheet.getRow(4);
  hRow.height = 26;
  const headers = ['Date & Heure', 'Utilisateur', 'Action effectuée', 'Cible', 'Statut'];
  headers.forEach((h, i) => {
    const c = hRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF95D00' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
  });

  logs.forEach((l, idx) => {
    const r = sheet.getRow(5 + idx);
    r.height = 22;

    const userName = l.profiles ? `${l.profiles.prenom || ''} ${l.profiles.nom || ''}`.trim() : (l.user_email || 'Système');
    const timestampStr = l.created_at ? new Date(l.created_at).toLocaleString('fr-TN') : '—';
    const targetStr = l.target_name || l.target_type || '—';
    const statusStr = l.status || 'OK';

    const vals = [timestampStr, userName, l.action || '—', targetStr, statusStr];

    vals.forEach((v, cIdx) => {
      const c = r.getCell(cIdx + 1);
      c.value = v;
      c.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      c.alignment = { horizontal: cIdx === 0 || cIdx === 4 ? 'center' : 'left', vertical: 'middle' };

      if (idx % 2 === 1) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      if (cIdx === 4) {
        c.font = { bold: true, color: { argb: statusStr.toLowerCase().includes('err') || statusStr.toLowerCase().includes('fail') ? 'FFDC2626' : 'FF059669' } };
      }
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, `audit_logs_deskywork_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
