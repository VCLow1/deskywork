// services/api/subscriptions.js — Abonnements
import { apiFetch } from './_core';

export const subscriptionApi = {
  getMine: () => apiFetch('/api/subscriptions/me'),
  getActive: () => apiFetch('/api/subscriptions/me/active'),
  selfSubscribe: (payload) =>
    apiFetch('/api/subscriptions/self', { method: 'POST', body: JSON.stringify(payload) }),
  approvePayment: (id, payload = { mode: 'cash' }) =>
    apiFetch(`/api/subscriptions/${id}/approve-payment`, { method: 'POST', body: JSON.stringify(payload) }),
  rejectRequest: (id, payload) =>
    apiFetch(`/api/subscriptions/${id}/reject-request`, { method: 'POST', body: JSON.stringify(payload) }),
  cancelRequest: (id) =>
    apiFetch(`/api/subscriptions/${id}/cancel-request`, { method: 'POST' }),
  resiliate: (id, payload = {}) =>
    apiFetch(`/api/subscriptions/${id}/resiliate`, { method: 'POST', body: JSON.stringify(payload) }),
  getAll: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/subscriptions${qs ? `?${qs}` : ''}`);
  },
  create: (payload) =>
    apiFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) =>
    apiFetch(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getConsumptions: (id) =>
    apiFetch(`/api/subscriptions/${id}/consumptions`),
  archive: (id) =>
    apiFetch(`/api/subscriptions/${id}/archive`, { method: 'POST' }),
  restore: (id) =>
    apiFetch(`/api/subscriptions/${id}/restore`, { method: 'POST' }),
};
