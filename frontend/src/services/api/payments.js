// services/api/payments.js — Encaissements sur place & Reçus PDF (CDC v3.0 D1)
import { apiFetch, getAuthHeaders, API_URL } from './_core';

export const paymentApi = {
  getAll: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/payments?${qs}`);
  },
  getPending: () => apiFetch('/api/payments/pending'),
  getMontantDu: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/montant-du${qs ? `?${qs}` : ''}`);
  },
  getMyMontantDu: () => apiFetch('/api/montant-du/me'),
  createMontantDu: (payload) =>
    apiFetch('/api/montant-du', { method: 'POST', body: JSON.stringify(payload) }),
  collect: (id, payload) =>
    apiFetch(`/api/payments/${id}/collect`, { method: 'POST', body: JSON.stringify(payload) }),
  refund: (id, payload) =>
    apiFetch(`/api/payments/${id}/refund`, { method: 'POST', body: JSON.stringify(payload) }),
  getMemberPayments: (memberId) => apiFetch(`/api/payments/member/${memberId}`),
  create: (payload) =>
    apiFetch('/api/payments', { method: 'POST', body: JSON.stringify(payload) }),
  createSelf: (payload) =>
    apiFetch('/api/payments/self', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) =>
    apiFetch(`/api/payments/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  downloadReceipt: async (id) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/payments/${id}/receipt`, {
      headers: { ...headers },
    });
    if (!response.ok) throw new Error('Erreur de téléchargement du reçu PDF');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recu-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },
};
