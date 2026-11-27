// services/api/payments.js — Encaissements sur place, Impayés, Remboursements & Reçus PDF
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
  getUnpaidSummary: () => apiFetch('/api/payments/unpaid/summary'),
  createMontantDu: (payload) =>
    apiFetch('/api/montant-du', { method: 'POST', body: JSON.stringify(payload) }),
  collect: (id, payload) =>
    apiFetch(`/api/payments/${id}/collect`, { method: 'POST', body: JSON.stringify(payload) }),
  refund: (id, payload) =>
    apiFetch(`/api/payments/${id}/refund`, { method: 'POST', body: JSON.stringify(payload) }),
  sendReminder: (id, payload) =>
    apiFetch(`/api/payments/${id}/relance`, { method: 'POST', body: JSON.stringify(payload) }),
  recordPromise: (id, payload) =>
    apiFetch(`/api/payments/${id}/promesse`, { method: 'POST', body: JSON.stringify(payload) }),
  getMemberPayments: (memberId) => apiFetch(`/api/payments/member/${memberId}`),
  create: (payload) =>
    apiFetch('/api/payments', { method: 'POST', body: JSON.stringify(payload) }),
  createSelf: (payload) =>
    apiFetch('/api/payments/self', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) =>
    apiFetch(`/api/payments/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getMyInvoices: () => apiFetch('/api/payments/me/invoices'),
  downloadMyInvoicePdf: async (id, filename = null) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/payments/me/invoices/${id}/pdf`, {
      headers: { ...headers },
    });
    if (!response.ok) throw new Error('Erreur lors du téléchargement de la facture PDF');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `facture-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },
  downloadReceiptsZip: async (params = {}) => {
    const headers = await getAuthHeaders();
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    const response = await fetch(`${API_URL}/api/payments/me/receipts-zip${qs ? `?${qs}` : ''}`, {
      headers: { ...headers },
    });
    if (!response.ok) {
      let msg = 'Aucun reçu encaissé à télécharger pour cette sélection.';
      try {
        const err = await response.json();
        if (err?.error) msg = err.error;
      } catch (_) {}
      throw new Error(msg);
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recus-deskywork.zip';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },
  downloadReceipt: async (id, numeroRecu = null) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/payments/${id}/receipt`, {
      headers: { ...headers },
    });
    if (!response.ok) throw new Error('Erreur de téléchargement du reçu PDF');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recu-${numeroRecu || id}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  },
};
