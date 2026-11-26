// services/api/memberPortal.js — Espace membre (Module E)
import { apiFetch } from './_core';

export const memberPortalApi = {
  getBookingsHistory: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/bookings/history?${qs}`);
  },
  getStats: () => apiFetch('/api/member/stats'),
  getNearbySpaces: () => apiFetch('/api/member/spaces-nearby'),
  getBookingRecommendations: () => apiFetch('/api/member/booking-recommendations'),
  getNotifications: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/member/notifications?${qs}`);
  },
  markNotificationRead: (id) =>
    apiFetch(`/api/member/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () =>
    apiFetch('/api/member/notifications/read-all', { method: 'POST' }),
  updateSettings: (payload) =>
    apiFetch('/api/members/me/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
};
