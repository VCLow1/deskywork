// utils/excelHelper.js — Lazy load dynamique d'ExcelJS (optimisation bundle ~930KB)
let excelPromise = null;

export async function loadExcelJS() {
  if (!excelPromise) {
    excelPromise = import('exceljs').then(m => m.default || m);
  }
  return excelPromise;
}

