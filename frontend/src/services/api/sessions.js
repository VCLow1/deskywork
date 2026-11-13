// services/api/sessions.js — Sessions de travail & libération manuelle (CDC v3.0 D3/D4)
import { apiFetch } from './_core';

export const sessionApi = {
  getAll: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/sessions${qs ? `?${qs}` : ''}`);
  },
  getLive: () => apiFetch('/api/sessions/live'),
  release: (id) => apiFetch(`/api/sessions/${id}/release`, { method: 'POST' }),
  getMine: () => apiFetch('/api/sessions/me'),
  getActive: () => apiFetch('/api/sessions/me/active'),
  checkIn: (payload) =>
    apiFetch('/api/sessions/check-in', { method: 'POST', body: JSON.stringify(payload) }),
  checkOut: (payload) =>
    apiFetch('/api/sessions/check-out', { method: 'POST', body: JSON.stringify(payload) }),
};
