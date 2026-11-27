// services/api/pricing.js — Tarifs et Codes promo
import { apiFetch } from './_core';

export const pricingApi = {
  getPlans: () => apiFetch('/api/pricing'),
  getAllPlans: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/pricing/all${qs ? `?${qs}` : ''}`);
  },
  createPlan: (payload) =>
    apiFetch('/api/pricing', { method: 'POST', body: JSON.stringify(payload) }),
  updatePlan: (id, payload) =>
    apiFetch(`/api/pricing/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archivePlan: (id) =>
    apiFetch(`/api/pricing/${id}/archive`, { method: 'POST' }),
  restorePlan: (id) =>
    apiFetch(`/api/pricing/${id}/restore`, { method: 'POST' }),
  validatePromo: (payload) =>
    apiFetch('/api/promo-codes/validate', { method: 'POST', body: JSON.stringify(payload) }),
  getPromoCodes: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/promo-codes${qs ? `?${qs}` : ''}`);
  },
  createPromoCode: (payload) =>
    apiFetch('/api/promo-codes', { method: 'POST', body: JSON.stringify(payload) }),
  updatePromoCode: (id, payload) =>
    apiFetch(`/api/promo-codes/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archivePromoCode: (id) =>
    apiFetch(`/api/promo-codes/${id}/archive`, { method: 'POST' }),
  restorePromoCode: (id) =>
    apiFetch(`/api/promo-codes/${id}/restore`, { method: 'POST' }),
  getMyHistory: () => apiFetch('/api/pricing/history/me'),
};
