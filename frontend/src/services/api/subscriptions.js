// services/api/subscriptions.js — Abonnements
import { apiFetch } from './_core';

export const subscriptionApi = {
  getMine: () => apiFetch('/api/subscriptions/me'),
  getActive: () => apiFetch('/api/subscriptions/me/active'),
  selfSubscribe: (payload) =>
    apiFetch('/api/subscriptions/self', { method: 'POST', body: JSON.stringify(payload) }),
  getAll: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/subscriptions${qs ? `?${qs}` : ''}`);
  },
  create: (payload) =>
    apiFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) =>
    apiFetch(`/api/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archive: (id) =>
    apiFetch(`/api/subscriptions/${id}/archive`, { method: 'POST' }),
  restore: (id) =>
    apiFetch(`/api/subscriptions/${id}/restore`, { method: 'POST' }),
};
