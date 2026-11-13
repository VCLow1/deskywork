// services/api/tenantAdmin.js — Admin Coworking Setup, Espaces, Clients, Staff, Abonnement, Support
import { apiFetch, getAuthHeaders, API_URL } from './_core';

export const tenantAdminApi = {
  getTenant: () => apiFetch('/api/admin/tenant'),
  updateTenant: (payload) =>
    apiFetch('/api/admin/tenant', { method: 'PATCH', body: JSON.stringify(payload) }),
  getEspaces: () => apiFetch('/api/espaces'),
  createEspace: (payload) =>
    apiFetch('/api/admin/espaces', { method: 'POST', body: JSON.stringify(payload) }),
  updateEspace: (id, payload) =>
    apiFetch(`/api/admin/espaces/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteEspace: (id) =>
    apiFetch(`/api/admin/espaces/${id}`, { method: 'DELETE' }),
  completeOnboarding: () =>
    apiFetch('/api/admin/onboarding/complete', { method: 'POST' }),
  uploadPhoto: (payload) =>
    apiFetch('/api/admin/upload', { method: 'POST', body: JSON.stringify(payload) }),
  globalSearch: (q) =>
    apiFetch(`/api/admin/global-search?q=${encodeURIComponent(q)}`),
  getClientsOverview: () => apiFetch('/api/admin/clients/overview'),
  createMember: (payload) =>
    apiFetch('/api/admin/members', { method: 'POST', body: JSON.stringify(payload) }),
  getMemberHistory: (id) => apiFetch(`/api/admin/members/${id}/history`),
  getStaff: () => apiFetch('/api/admin/staff'),
  createStaff: (payload) =>
    apiFetch('/api/admin/staff', { method: 'POST', body: JSON.stringify(payload) }),
  updateStaff: (id, payload) =>
    apiFetch(`/api/admin/staff/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteStaff: (id) =>
    apiFetch(`/api/admin/staff/${id}`, { method: 'DELETE' }),
  getSubscription: () => apiFetch('/api/admin/subscription'),
  requestPackUpgrade: (payload) =>
    apiFetch('/api/admin/subscription/upgrade-request', { method: 'POST', body: JSON.stringify(payload) }),
  downloadDeskyInvoicePdf: async (invoiceId) => {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/api/admin/subscription/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
      headers: { ...headers },
    });
    if (!res.ok) throw new Error('Impossible de télécharger la facture DeskyWork');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Facture-DeskyWork-${invoiceId}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },
  getSupportState: () => apiFetch('/api/admin/notifications-support'),
  updateAlertSettings: (payload) =>
    apiFetch('/api/admin/alert-settings', { method: 'PATCH', body: JSON.stringify(payload) }),
  createSupportTicket: (payload) =>
    apiFetch('/api/admin/support-tickets', { method: 'POST', body: JSON.stringify(payload) }),
  getMarketplaceStats: () => apiFetch('/api/admin/marketplace-stats'),
};
