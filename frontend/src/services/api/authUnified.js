// services/api/authUnified.js — Client API pour l'inscription multi-rôles, vérification e-mail, OAuth et onboarding
import { apiFetch, API_URL } from './_core';

async function postPublicJson(path, payload) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || 'Une erreur est survenue.');
    err.code = json.code;
    err.retryAfter = json.retryAfter;
    throw err;
  }
  return json;
}

export const authUnifiedApi = {
  // Inscription Multi-Rôles Unifiée (/register)
  register: (data) => postPublicJson('/api/auth/register', data),
  registerStep1: (data) => postPublicJson('/api/auth/register', data),

  verifyEmailOtp: ({ email, code, userId }) =>
    postPublicJson('/api/auth/verify-email-otp', { email, code, userId }),

  verifyEmailToken: (token) =>
    postPublicJson('/api/auth/verify-email-token', { token }),

  resendVerificationEmail: (email) =>
    postPublicJson('/api/auth/resend-verification-email', { email }),

  // Google OAuth Status & Complétion
  checkOAuthStatus: ({ requestedRole } = {}) =>
    apiFetch('/api/auth/oauth-status', {
      method: 'POST',
      body: JSON.stringify({ requestedRole }),
    }),

  completeOAuthRegistration: (data) =>
    apiFetch('/api/auth/complete-oauth-registration', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // (CDC v3.0 — D2) OTP téléphone WhatsApp/SMS retirés : reportés en phase 2.

  // Étape 2 legacy : Profils et Onboarding
  chooseProfileType: ({ profileType, userId, entrepriseData }) =>
    postPublicJson('/api/auth/onboarding/profile-type', { profileType, userId, entrepriseData }),

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

  validatePackUpgrade: (tenantId, requestId, { action, notes }) => {
    return apiFetch(`/api/super-admin/tenants/${tenantId}/pack-upgrades/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ action, notes }),
    });
  },
};
