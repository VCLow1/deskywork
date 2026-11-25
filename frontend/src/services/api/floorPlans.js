// services/api/floorPlans.js — API Plans de salle interactifs 2D & occupation temps réel
import { apiFetch, API_URL } from './_core';

export const floorPlansApi = {
  // Admin / Staff (CRUD)
  list: () => apiFetch('/api/floor-plans'),

  create: (payload) =>
    apiFetch('/api/floor-plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  update: (id, payload) =>
    apiFetch(`/api/floor-plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  toggleItemStatus: (planId, itemId, status) =>
    apiFetch(`/api/floor-plans/${planId}/items/${itemId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  delete: (id) =>
    apiFetch(`/api/floor-plans/${id}`, { method: 'DELETE' }),

  // Occupation temps réel Admin / Staff (Africa/Tunis)
  getLive: (planId = null) =>
    apiFetch(planId ? `/api/floor-plans/${planId}/live` : '/api/floor-plans/live'),

  // Vue publique / client (date + créneau horaire Africa/Tunis)
  getPublic: async (tenantId, params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    const qs = new URLSearchParams(clean).toString();
    const res = await fetch(
      `${API_URL}/api/public/coworkings/${encodeURIComponent(tenantId)}/floor-plans${qs ? `?${qs}` : ''}`
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Impossible de charger le plan 2D.');
    return json;
  },
};
