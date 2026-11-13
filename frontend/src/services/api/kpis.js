// services/api/kpis.js — KPIs & Dashboard (Module D)
import { apiFetch, getAuthHeaders, API_URL } from './_core';

export const kpiApi = {
  getAll: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/kpis${qs ? `?${qs}` : ''}`);
  },
  getRevenueChart: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/kpis/revenue-chart${qs ? `?${qs}` : ''}`);
  },
  getReport: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/report${qs ? `?${qs}` : ''}`);
  },
  getDetailedReport: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    return apiFetch(`/api/admin/reports/detailed${qs ? `?${qs}` : ''}`);
  },
  downloadPdfReport: async (params = {}) => {
    const headers = await getAuthHeaders();
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    const res = await fetch(`${API_URL}/api/admin/reports/pdf${qs ? `?${qs}` : ''}`, {
      headers: { ...headers },
    });
    if (!res.ok) {
      let msg = 'Erreur lors de la génération du rapport PDF';
      try {
        const errJson = await res.json();
        if (errJson?.error) msg = errJson.error;
      } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DeskyWork-Rapport-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },
};
