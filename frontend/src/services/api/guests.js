// services/api/guests.js — Réservations Invités & API Publique Marketplace (CDC v3.0)
import { apiFetch, API_URL } from './_core';

export const guestApi = {
  create: (payload) =>
    fetch(`${API_URL}/api/guests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
  booking: (payload) =>
    fetch(`${API_URL}/api/guests/booking`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
  formation: (payload) =>
    fetch(`${API_URL}/api/guests/formation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
  cancelByToken: (token) =>
    fetch(`${API_URL}/api/guests/booking/${token}`, { method: 'DELETE' }).then(r => r.json()),
  getAll: () => apiFetch('/api/guests'),
  convert: (id, payload) =>
    apiFetch(`/api/guests/${id}/convert`, { method: 'POST', body: JSON.stringify(payload) }),

  // API publique — Marketplace (établissements, espaces, sessions de formation, candidatures)
  getCoworkings: () =>
    fetch(`${API_URL}/api/public/coworkings`).then(r => r.json()),
  getCoworking: (id) => {
    const headers = {};
    try {
      const authKey = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
      if (authKey) {
        const parsed = JSON.parse(localStorage.getItem(authKey));
        if (parsed?.access_token) headers.Authorization = `Bearer ${parsed.access_token}`;
      }
    } catch (_) {}
    return fetch(`${API_URL}/api/public/coworkings/${id}`, { headers }).then(r => r.json());
  },
  getPublicEspaces: (tenantId) =>
    fetch(`${API_URL}/api/public/espaces${tenantId ? `?tenant_id=${tenantId}` : ''}`).then(r => r.json()),
  getPublicFormations: (limit = 12) =>
    fetch(`${API_URL}/api/public/formations?limit=${limit}`).then(r => r.json()),
  submitTrainerApplication: async (payload) => {
    const r = await fetch(`${API_URL}/api/public/trainer-application`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Erreur lors de la soumission.');
    return json;
  },
  submitPartnerRequest: async (payload) => {
    const r = await fetch(`${API_URL}/api/public/partner-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Erreur lors de la soumission.');
    return json;
  },
};
