// services/api/authUnified.js — Client API pour la refonte authentification, onboarding et multi-tenant
import { apiFetch, API_URL } from './_core';

export const authUnifiedApi = {
  // Inscription Étape 1 & OTP
  registerStep1: async (data) => {
    const res = await fetch(`${API_URL}/api/auth/register-step1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erreur lors de l\'inscription.');
    return json;
  },

  verifyEmailOtp: async ({ email, code, userId }) => {
    const res = await fetch(`${API_URL}/api/auth/verify-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, userId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Code email invalide.');
    return json;
  },

  sendPhoneOtp: async ({ phone, channel = 'whatsapp' }) => {
    const res = await fetch(`${API_URL}/api/auth/send-phone-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, channel }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erreur d\'envoi OTP téléphone.');
    return json;
  },

  verifyPhoneOtp: async ({ phone, code, userId }) => {
    const res = await fetch(`${API_URL}/api/auth/verify-phone-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, userId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Code téléphone invalide.');
    return json;
  },

  // Étape 2 : Profils et Onboarding
  chooseProfileType: async ({ profileType, userId, entrepriseData }) => {
    const res = await fetch(`${API_URL}/api/auth/onboarding/profile-type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileType, userId, entrepriseData }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erreur lors du choix du profil.');
    return json;
  },

  createSpaceOnboarding: (data) => {
    return apiFetch('/api/auth/onboarding/create-space', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  createTrainerProfile: (data) => {
    return apiFetch('/api/auth/onboarding/trainer-profile', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Contexte utilisateur & Switcher
  getMyContext: () => {
    return apiFetch('/api/auth/my-context', { noCache: true });
  },

  // Invitations
  getInvitationInfo: async (token) => {
    const res = await fetch(`${API_URL}/api/invitations/info/${token}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Invitation introuvable.');
    return json;
  },

  acceptInvitation: (token) => {
    return apiFetch(`/api/invitations/accept/${token}`, {
      method: 'POST',
    });
  },

  createInvitation: (orgId, { email, role }) => {
    return apiFetch(`/api/organizations/${orgId}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  },

  listInvitations: (orgId) => {
    return apiFetch(`/api/organizations/${orgId}/invitations`);
  },

  revokeInvitation: (id) => {
    return apiFetch(`/api/invitations/${id}`, {
      method: 'DELETE',
    });
  },

  // Super Admin Validation
  getPendingValidations: () => {
    return apiFetch('/api/super-admin/pending-validations', { noCache: true });
  },

  validateOrganization: (id, { action, notes }) => {
    return apiFetch(`/api/super-admin/organizations/${id}/validation`, {
      method: 'PATCH',
      body: JSON.stringify({ action, notes }),
    });
  },

  validateTrainer: (id, { action, notes }) => {
    return apiFetch(`/api/super-admin/trainers/${id}/validation`, {
      method: 'PATCH',
      body: JSON.stringify({ action, notes }),
    });
  },
};

