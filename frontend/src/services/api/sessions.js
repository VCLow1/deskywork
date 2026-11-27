// services/api/sessions.js — Sessions de travail, chrono synchronisé serveur & Walk-in (LOT 3)
import { apiFetch } from './_core';

export const sessionApi = {
  getAll: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/sessions${qs ? `?${qs}` : ''}`);
  },
  getLive: () => apiFetch('/api/sessions/live'),
  start: (payload) =>
    apiFetch('/api/sessions/start', { method: 'POST', body: JSON.stringify(payload) }),
  startWalkin: (payload) =>
    apiFetch('/api/sessions/walkin/start', { method: 'POST', body: JSON.stringify(payload) }),
  stop: (id, payload = {}) =>
    apiFetch(`/api/sessions/${id}/stop`, { method: 'POST', body: JSON.stringify(payload) }),
  extend: (id, payload = { minutes: 30 }) =>
    apiFetch(`/api/sessions/${id}/extend`, { method: 'POST', body: JSON.stringify(payload) }),
  autoCloseSweep: () =>
    apiFetch('/api/sessions/auto-close-sweep', { method: 'POST' }),
  release: (id) => apiFetch(`/api/sessions/${id}/release`, { method: 'POST' }),
  getMine: () => apiFetch('/api/sessions/me'),
  getActive: () => apiFetch('/api/sessions/me/active'),
  checkIn: (payload) =>
    apiFetch('/api/sessions/check-in', { method: 'POST', body: JSON.stringify(payload) }),
  checkOut: (payload) =>
    apiFetch('/api/sessions/check-out', { method: 'POST', body: JSON.stringify(payload) }),
};
