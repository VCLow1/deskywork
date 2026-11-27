// services/api/tenantAdmin.js — Admin Coworking Setup, Espaces, Clients, Staff, Abonnement, Support
import { apiFetch, getAuthHeaders, API_URL } from './_core';

export const tenantAdminApi = {
  getTenant: () => apiFetch('/api/admin/tenant'),
  updateTenant: (payload) =>
    apiFetch('/api/admin/tenant', { method: 'PATCH', body: JSON.stringify(payload) }),
  getEspaces: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/espaces${qs ? `?${qs}` : ''}`);
  },
  createEspace: (payload) =>
    apiFetch('/api/admin/espaces', { method: 'POST', body: JSON.stringify(payload) }),
  updateEspace: (id, payload) =>
    apiFetch(`/api/admin/espaces/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteEspace: (id) =>
    apiFetch(`/api/admin/espaces/${id}`, { method: 'DELETE' }),
  archiveEspace: (id) =>
    apiFetch(`/api/admin/espaces/${id}/archive`, { method: 'POST' }),
  restoreEspace: (id) =>
    apiFetch(`/api/admin/espaces/${id}/restore`, { method: 'POST' }),
  updateEspaceTarifs: (id, payload) =>
    apiFetch(`/api/admin/espaces/${id}/tarifs`, { method: 'PUT', body: JSON.stringify(payload) }),
  getTarifHistory: (espaceId = null) =>
    apiFetch(`/api/admin/tarifs/historique${espaceId ? `?espace_id=${encodeURIComponent(espaceId)}` : ''}`),
  completeOnboarding: () =>
    apiFetch('/api/admin/onboarding/complete', { method: 'POST' }),
  uploadPhoto: (payload) =>
    apiFetch('/api/admin/upload', { method: 'POST', body: JSON.stringify(payload) }),
  globalSearch: (q) =>
    apiFetch(`/api/admin/global-search?q=${encodeURIComponent(q)}`),
  getClientsOverview: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/clients/overview${qs ? `?${qs}` : ''}`);
  },
  createMember: (payload) =>
    apiFetch('/api/admin/members', { method: 'POST', body: JSON.stringify(payload) }),
  createPersonne: (payload) =>
    apiFetch('/api/admin/personnes', { method: 'POST', body: JSON.stringify(payload) }),
  archivePersonne: (id) =>
    apiFetch(`/api/admin/personnes/${id}/archive`, { method: 'POST' }),
  restorePersonne: (id) =>
    apiFetch(`/api/admin/personnes/${id}/restore`, { method: 'POST' }),
  getMemberHistory: (id) => apiFetch(`/api/admin/members/${id}/history`),
  getActivityLog: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/activity-log${qs ? `?${qs}` : ''}`);
  },
  getPacks: () => apiFetch('/api/admin/packs'),
  getRessources: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/ressources${qs ? `?${qs}` : ''}`);
  },
  createRessource: (payload) => apiFetch('/api/admin/ressources', { method: 'POST', body: JSON.stringify(payload) }),
  updateRessource: (id, payload) => apiFetch(`/api/admin/ressources/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archiveRessource: (id) => apiFetch(`/api/admin/ressources/${id}/archive`, { method: 'POST' }),
  restoreRessource: (id) => apiFetch(`/api/admin/ressources/${id}/restore`, { method: 'POST' }),
  getServices: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/services${qs ? `?${qs}` : ''}`);
  },
  createService: (payload) => apiFetch('/api/admin/services', { method: 'POST', body: JSON.stringify(payload) }),
  updateService: (id, payload) => apiFetch(`/api/admin/services/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archiveService: (id) => apiFetch(`/api/admin/services/${id}/archive`, { method: 'POST' }),
  restoreService: (id) => apiFetch(`/api/admin/services/${id}/restore`, { method: 'POST' }),
  getIncidents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/incidents${qs ? `?${qs}` : ''}`);
  },
  createIncident: (payload) => apiFetch('/api/admin/incidents', { method: 'POST', body: JSON.stringify(payload) }),
  updateIncident: (id, payload) => apiFetch(`/api/admin/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archiveIncident: (id) => apiFetch(`/api/admin/incidents/${id}/archive`, { method: 'POST' }),
  restoreIncident: (id) => apiFetch(`/api/admin/incidents/${id}/restore`, { method: 'POST' }),
  getDevisFactures: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/devis-factures${qs ? `?${qs}` : ''}`);
  },
  createDevisFacture: (payload) => apiFetch('/api/admin/devis-factures', { method: 'POST', body: JSON.stringify(payload) }),
  updateDevisFacture: (id, payload) => apiFetch(`/api/admin/devis-factures/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archiveDevisFacture: (id) => apiFetch(`/api/admin/devis-factures/${id}/archive`, { method: 'POST' }),
  restoreDevisFacture: (id) => apiFetch(`/api/admin/devis-factures/${id}/restore`, { method: 'POST' }),
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
