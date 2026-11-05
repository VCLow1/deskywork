import { loadExcelJS } from './excelHelper';

// ─── Constantes ────────────────────────────────────────────────────────────────
const COLORS = {
  headerBg:    'FF100F0D',
  headerFg:    'FFFFFFFF',
  sectionBg:   'FFF95D00',
  sectionFg:   'FFFFFFFF',
  altRowBg:    'FFF8FAFC',
  kpiLabelBg:  'FFF1F5F9',
  kpiBg:       'FFFFFFFF',
  greenBg:     'FFD1FAE5',
  greenFg:     'FF065F46',
  amberBg:     'FFFEF3C7',
  amberFg:     'FF92400E',
  blueBg:      'FFDBEAFE',
  blueFg:      'FF1E40AF',
  borderColor: 'FFE2E8F0',
};

const THIN_BORDER = {
  top:    { style: 'thin', color: { argb: COLORS.borderColor } },
  left:   { style: 'thin', color: { argb: COLORS.borderColor } },
  bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
  right:  { style: 'thin', color: { argb: COLORS.borderColor } },
};

function formatDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR');
}

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

// ─── Helpers feuille ───────────────────────────────────────────────────────────
function addSectionHeader(sheet, rowIndex, label, colSpan = 5) {
  const endCol = String.fromCharCode(64 + colSpan);
  sheet.mergeCells(`A${rowIndex}:${endCol}${rowIndex}`);
  const cell = sheet.getCell(`A${rowIndex}`);
  cell.value = label;
  cell.font  = { bold: true, size: 11, color: { argb: COLORS.sectionFg } };
  cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sectionBg } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(rowIndex).height = 22;
  return rowIndex + 1;
}

function styleHeaderRow(row, headers) {
  row.height = 24;
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font  = { bold: true, size: 10, color: { argb: COLORS.headerFg } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = THIN_BORDER;
  });
}

function styleDataCell(cell, value, opts = {}) {
  cell.value = value;
  cell.border = THIN_BORDER;
  cell.alignment = { vertical: 'middle', horizontal: opts.align || 'left', wrapText: true };
  if (opts.altRow) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRowBg } };
  }
  if (opts.bold)   cell.font = { ...(cell.font || {}), bold: true };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  if (opts.color)  cell.font = { ...(cell.font || {}), color: { argb: opts.color } };
}

// ─── Export principal ──────────────────────────────────────────────────────────
/**
 * @param {object} kpis       — réponse de GET /api/admin/kpis
 * @param {object} chartData  — réponse de GET /api/admin/kpis/revenue-chart
 */
export async function exportDashboardToExcel(kpis, chartData) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DeskyWork — Flex Office & Coworking';
  wb.created = new Date();

  // ══════════════════════════════════════════════════════════════════════
  // Feuille 1 — Résumé KPIs
  // ══════════════════════════════════════════════════════════════════════
  const sheetKPI = wb.addWorksheet('📊 KPIs DeskyWork', {
    properties: { defaultRowHeight: 20 },
  });
  sheetKPI.columns = [
    { key: 'indicateur', width: 32 },
    { key: 'valeur',     width: 20 },
    { key: 'detail',     width: 28 },
    { key: 'tendance',   width: 16 },
    { key: 'note',       width: 28 },
  ];

  // Titre
  sheetKPI.mergeCells('A1:E1');
  const title = sheetKPI.getCell('A1');
  title.value = '📊 Tableau de Bord KPIs — DeskyWork';
  title.font  = { name: 'Calibri', size: 18, bold: true, color: { argb: COLORS.headerBg } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheetKPI.getRow(1).height = 36;

  sheetKPI.mergeCells('A2:E2');
  const sub = sheetKPI.getCell('A2');
  sub.value = `Exporté le ${formatExportDate()}`;
  sub.font  = { size: 10, italic: true, color: { argb: 'FF64748B' } };
  sub.alignment = { horizontal: 'center' };
  sheetKPI.getRow(2).height = 18;

  let row = 4;

  // ── Section Membres ───────────────────────────────────────────────────
  row = addSectionHeader(sheetKPI, row, '👥  MEMBRES & ABONNEMENTS', 5);
  styleHeaderRow(sheetKPI.getRow(row), ['Indicateur', 'Valeur', 'Détail', 'Tendance', 'Note']);
  row++;

  const membresData = [
    ['Membres actifs',               kpis.membresActifs,             '—', '—', 'Comptes avec statut actif'],
    ['Nouveaux membres (ce mois)',    kpis.nouveauxMembres.moisActuel, `Mois préc. : ${kpis.nouveauxMembres.moisPrecedent}`, `${kpis.nouveauxMembres.evolution > 0 ? '▲' : kpis.nouveauxMembres.evolution < 0 ? '▼' : '→'} ${Math.abs(kpis.nouveauxMembres.evolution)}%`, ''],
    ['Abonnements expirant (J-7)',    kpis.abonnementsExpirant,       '—', '—', 'Renouvellements urgents'],
  ];

  membresData.forEach(([indicateur, valeur, detail, tendance, note], i) => {
    const r = sheetKPI.getRow(row + i);
    r.height = 20;
    styleDataCell(r.getCell(1), indicateur, { altRow: i % 2 === 1, bold: true });
    styleDataCell(r.getCell(2), valeur,     { altRow: i % 2 === 1, align: 'center', bold: true, color: COLORS.headerBg });
    styleDataCell(r.getCell(3), detail,     { altRow: i % 2 === 1 });
    styleDataCell(r.getCell(4), tendance,   { altRow: i % 2 === 1, align: 'center' });
    styleDataCell(r.getCell(5), note,       { altRow: i % 2 === 1 });
  });
  row += membresData.length + 1;

  // ── Section CA ────────────────────────────────────────────────────────
  row = addSectionHeader(sheetKPI, row, '💰  CHIFFRE D\'AFFAIRES', 5);
  styleHeaderRow(sheetKPI.getRow(row), ['Période', 'Montant (DT)', 'Détail', '', '']);
  row++;

  const caData = [
    ['CA du jour',    kpis.chiffreAffaires.jour,  'Paiements encaissés aujourd\'hui'],
    ['CA du mois',    kpis.chiffreAffaires.mois,  'Paiements encaissés ce mois'],
    ['CA de l\'année', kpis.chiffreAffaires.annee, 'Paiements encaissés cette année'],
    ['Paiements en attente (total)', kpis.paiementsEnAttente.montantTotal, `${kpis.paiementsEnAttente.count} paiement(s) en attente`],
  ];

  caData.forEach(([label, montant, detail], i) => {
    const r = sheetKPI.getRow(row + i);
    r.height = 20;
    styleDataCell(r.getCell(1), label,   { altRow: i % 2 === 1, bold: true });
    styleDataCell(r.getCell(2), montant, { altRow: i % 2 === 1, align: 'right', bold: true, numFmt: '#,##0.00', color: COLORS.headerBg });
    styleDataCell(r.getCell(3), detail,  { altRow: i % 2 === 1 });
  });
  row += caData.length + 1;

  // ── Section Réservations & Sessions ──────────────────────────────────
  row = addSectionHeader(sheetKPI, row, '📅  RÉSERVATIONS & SESSIONS', 5);
  styleHeaderRow(sheetKPI.getRow(row), ['Indicateur', 'Valeur', 'Détail', '', '']);
  row++;

  const resData = [
    ['Réservations du jour',  kpis.reservationsDuJour, 'Confirmées + En attente'],
    ['Sessions en cours',     kpis.sessionsEnCours.length, 'Sessions actives en ce moment'],
    ['Formations du jour',    kpis.formationsDuJour,   'Sessions de formation planifiées'],
  ];

  resData.forEach(([label, val, detail], i) => {
    const r = sheetKPI.getRow(row + i);
    r.height = 20;
    styleDataCell(r.getCell(1), label,  { altRow: i % 2 === 1, bold: true });
    styleDataCell(r.getCell(2), val,    { altRow: i % 2 === 1, align: 'center', bold: true, color: COLORS.headerBg });
    styleDataCell(r.getCell(3), detail, { altRow: i % 2 === 1 });
  });
  row += resData.length + 1;

  // ── Section Top Membres ───────────────────────────────────────────────
  row = addSectionHeader(sheetKPI, row, '🏆  TOP 5 MEMBRES (CA annuel)', 5);
  styleHeaderRow(sheetKPI.getRow(row), ['Rang', 'Membre', 'Email', 'CA généré (DT)', '']);
  row++;

  kpis.topMembres.forEach((m, i) => {
    const r = sheetKPI.getRow(row + i);
    r.height = 20;
    styleDataCell(r.getCell(1), `#${i + 1}`, { altRow: i % 2 === 1, align: 'center', bold: true });
    styleDataCell(r.getCell(2), m.nom,        { altRow: i % 2 === 1, bold: true });
    styleDataCell(r.getCell(3), m.email,      { altRow: i % 2 === 1 });
    styleDataCell(r.getCell(4), m.ca,         { altRow: i % 2 === 1, align: 'right', bold: true, numFmt: '#,##0.00', color: COLORS.headerBg });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Feuille 2 — Évolution CA & Occupation (6 mois)
  // ══════════════════════════════════════════════════════════════════════
  const sheetCA = wb.addWorksheet('📈 Évolution 6 mois', {
    properties: { defaultRowHeight: 20 },
  });
  sheetCA.columns = [
    { key: 'mois',         width: 16 },
    { key: 'ca',           width: 18 },
    { key: 'transactions', width: 18 },
    { key: 'taux',         width: 20 },
    { key: 'spacer',       width: 10 },
  ];

  sheetCA.mergeCells('A1:E1');
  const titleCA = sheetCA.getCell('A1');
  titleCA.value = '📈 Évolution CA & Occupation — 6 derniers mois';
  titleCA.font  = { size: 16, bold: true, color: { argb: COLORS.headerBg } };
  titleCA.alignment = { horizontal: 'center', vertical: 'middle' };
  sheetCA.getRow(1).height = 32;

  sheetCA.mergeCells('A2:E2');
  sheetCA.getCell('A2').value = `Exporté le ${formatExportDate()}`;
  sheetCA.getCell('A2').font  = { size: 10, italic: true, color: { argb: 'FF64748B' } };
  sheetCA.getCell('A2').alignment = { horizontal: 'center' };

  const headerRowCA = sheetCA.getRow(4);
  styleHeaderRow(headerRowCA, ['Mois', 'CA (DT)', 'Transactions', 'Taux d\'occupation (%)', '']);
  headerRowCA.height = 26;

  const revenue = chartData?.revenueChart || [];
  const occupation = chartData?.occupationChart || [];

  revenue.forEach((item, i) => {
    const r = sheetCA.getRow(5 + i);
    r.height = 22;
    const occ = occupation.find((o) => o.mois === item.mois);
    styleDataCell(r.getCell(1), item.mois,         { altRow: i % 2 === 1, align: 'center', bold: true });
    styleDataCell(r.getCell(2), item.ca,           { altRow: i % 2 === 1, align: 'right', bold: true, numFmt: '#,##0.00', color: COLORS.headerBg });
    styleDataCell(r.getCell(3), item.transactions, { altRow: i % 2 === 1, align: 'center' });
    styleDataCell(r.getCell(4), occ ? `${occ.taux}%` : '—', { altRow: i % 2 === 1, align: 'center' });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Feuille 3 — Taux d'occupation par espace
  // ══════════════════════════════════════════════════════════════════════
  const sheetOcc = wb.addWorksheet('🏢 Occupation Espaces', {
    properties: { defaultRowHeight: 20 },
  });
  sheetOcc.columns = [
    { key: 'espace', width: 30 },
    { key: 'type',   width: 20 },
    { key: 'taux',   width: 22 },
    { key: 'barre',  width: 30 },
  ];

  sheetOcc.mergeCells('A1:D1');
  const titleOcc = sheetOcc.getCell('A1');
  titleOcc.value = '🏢 Taux d\'Occupation par Espace (mois en cours)';
  titleOcc.font  = { size: 16, bold: true, color: { argb: COLORS.headerBg } };
  titleOcc.alignment = { horizontal: 'center', vertical: 'middle' };
  sheetOcc.getRow(1).height = 32;

  styleHeaderRow(sheetOcc.getRow(3), ['Espace', 'Type', 'Taux d\'occupation (%)', 'Indicateur visuel']);
  sheetOcc.getRow(3).height = 24;

  const TYPE_LABELS = {
    open_space: 'Open Space',
    private_office: 'Bureau privé',
    meeting_room: 'Salle de réunion',
    training_room: 'Salle de formation',
    event_space: 'Espace événementiel',
  };

  kpis.tauxOccupation.forEach((esp, i) => {
    const r = sheetOcc.getRow(4 + i);
    r.height = 22;
    styleDataCell(r.getCell(1), esp.nom,                        { altRow: i % 2 === 1, bold: true });
    styleDataCell(r.getCell(2), TYPE_LABELS[esp.type] || esp.type, { altRow: i % 2 === 1 });
    styleDataCell(r.getCell(3), `${esp.taux}%`,                 { altRow: i % 2 === 1, align: 'center', bold: true, color: esp.taux >= 70 ? COLORS.greenFg : esp.taux >= 40 ? COLORS.amberFg : COLORS.headerBg });
    // Barre de progression textuelle
    const bars = Math.round(esp.taux / 5);
    styleDataCell(r.getCell(4), '█'.repeat(bars) + '░'.repeat(20 - bars), { altRow: i % 2 === 1, color: esp.taux >= 70 ? COLORS.greenFg : COLORS.amberFg });
  });

  // ── Génération et téléchargement ──────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const filename = `dashboard_kpis_${new Date().toISOString().slice(0, 10)}.xlsx`;
  downloadBlob(blob, filename);
}
