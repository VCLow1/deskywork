// AdminNotifications.jsx
// Page centre de notifications pour les rôles admin, staff, super_admin et formateur
// Réutilise la même logique que MemberNotifications mais avec navigation role-aware

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import { memberPortalApi } from '../services/api';
import PortalLayout from '../components/layout/PortalLayout';
import { formatDateDMY } from '../utils/format';

function getTypeIcon(type = '') {
  if (type.includes('formation') || type.includes('inscription')) return 'school';
  if (type.includes('reservation') || type.includes('session') || type === 'nouvelle_demande_reservation') return 'calendar_month';
  if (type.includes('payment') || type.includes('paiement') || type.includes('facture')) return 'receipt_long';
  if (type.includes('message')) return 'chat';
  if (type.includes('abonnement')) return 'payments';
  if (type.includes('membre') || type.includes('member')) return 'person_add';
  if (type.includes('formateur')) return 'school';
  return 'notifications';
}

function getTypeColor(type = '') {
  if (type.includes('formation') || type.includes('inscription')) return 'rgba(255,176,32,0.12)';
  if (type.includes('reservation') || type.includes('session')) return 'rgba(0,84,203,0.09)';
  if (type.includes('payment') || type.includes('paiement') || type.includes('facture')) return 'rgba(47,190,143,0.09)';
  if (type.includes('message')) return 'rgba(139,92,246,0.1)';
  if (type.includes('abonnement')) return 'rgba(249,93,0,0.09)';
  if (type.includes('membre') || type.includes('member') || type.includes('formateur')) return 'rgba(14,165,233,0.09)';
  return 'rgba(16,15,13,0.06)';
}

function getRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffH < 24) return `il y a ${diffH}h`;
  if (diffD < 7) return `il y a ${diffD}j`;
  return formatDateDMY(dateStr);
}

function getDateGroup(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date >= today) return "Aujourd'hui";
  if (date >= yesterday) return 'Hier';
  if (date >= weekAgo) return 'Cette semaine';
  return 'Plus ancien';
}

function groupNotifications(notifications) {
  const groups = {};
  notifications.forEach((n) => {
    const group = getDateGroup(n.created_at);
    if (!groups[group]) groups[group] = [];
    groups[group].push(n);
  });
  return groups;
}

// DB field is "lu" (boolean)
function NotificationItem({ notification, onClick, dark }) {
  const { type, message, title, lu, created_at } = notification;
  const isRead = !!lu;

  return (
    <button
      onClick={() => onClick(notification)}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        borderRadius: 16,
        border: isRead
          ? `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(16,15,13,0.08)'}`
          : '1px solid rgba(249,93,0,0.2)',
        background: isRead
          ? (dark ? 'rgba(255,255,255,0.03)' : '#ffffff')
          : (dark ? 'rgba(249,93,0,0.06)' : 'rgba(249,93,0,0.03)'),
        padding: '16px 20px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: isRead
          ? '0 2px 8px rgba(16,35,63,0.04)'
          : '0 4px 16px rgba(249,93,0,0.08)',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <span
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 40, height: 40, borderRadius: 12, flexShrink: 0, marginTop: 2,
          background: isRead
            ? (dark ? 'rgba(255,255,255,0.06)' : getTypeColor(type))
            : getTypeColor(type),
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: isRead ? (dark ? 'rgba(251,255,255,0.5)' : '#6b7280') : '#f95d00' }}>
          {getTypeIcon(type)}
        </span>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 13,
            fontWeight: isRead ? 500 : 700,
            color: isRead ? (dark ? 'rgba(251,255,255,0.6)' : '#44474d') : (dark ? '#fbffff' : '#100f0d'),
            fontFamily: 'Sora, sans-serif',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title || message || 'Notification'}
          </span>
          {!isRead && (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f95d00', flexShrink: 0 }} />
          )}
        </div>
        {title && message && (
          <p style={{
            fontSize: 13,
            color: dark ? 'rgba(251,255,255,0.5)' : '#6b7280',
            margin: '0 0 6px',
            lineHeight: 1.45,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {message}
          </p>
        )}
        <span style={{ fontSize: 12, color: dark ? 'rgba(251,255,255,0.45)' : '#6b7280' }}>
          {getRelativeTime(created_at)}
        </span>
      </div>
    </button>
  );
}

export default function AdminNotifications({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const navigate = useNavigate();
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', ...metadata } : null
  );
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('theme') === 'dark'; } catch { return false; }
  });
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const totalRef = useRef(0);

  // profile déjà initialisé depuis le JWT — aucun appel DB nécessaire

  const fetchNotifications = useCallback(async (pageNum, append = false) => {
    try {
      const res = await memberPortalApi.getNotifications({
        page: pageNum,
        limit: 20,
        unread_only: filter === 'unread',
      });
      // Backend: { notifications: [], unreadCount, pagination: { total } }
      const items = res.data?.notifications ?? res.notifications ?? res.data ?? [];
      const total = res.data?.pagination?.total ?? res.pagination?.total ?? res.data?.total ?? res.total ?? items.length;
      totalRef.current = total;
      if (append) {
        setNotifications((prev) => {
          const combined = [...prev, ...items];
          setHasMore(combined.length < total);
          return combined;
        });
      } else {
        setNotifications(items);
        setHasMore(items.length < total);
      }
    } catch (err) {
      // silencieux
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!profile?.id) return;
    setLoading(true);
    setPage(1);
    setNotifications([]);
    fetchNotifications(1, false);
  }, [filter, profile?.id, fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel(`admin-notif-page-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            setNotifications((prev) => {
              if (prev.some((n) => n.id === payload.new.id)) return prev;
              totalRef.current += 1;
              return [payload.new, ...prev];
            });
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            setNotifications((prev) =>
              prev.map((n) => (n.id === payload.new.id ? payload.new : n))
            );
          } else if (payload.eventType === 'DELETE' && payload.old) {
            setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
          }
        }
      )
      .subscribe((status, err) => {
        if (err) console.warn('AdminNotifications realtime error:', err.message);
      });

    const onLiveNotif = (e) => {
      const notif = e?.detail;
      if (!notif?.id) return;
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notif.id)) return prev;
        totalRef.current += 1;
        return [notif, ...prev];
      });
    };
    window.addEventListener('deskywork-notification-received', onLiveNotif);

    return () => {
      window.removeEventListener('deskywork-notification-received', onLiveNotif);
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  const handleNotificationClick = async (n) => {
    if (!n.lu) {
      try {
        await memberPortalApi.markNotificationRead(n.id);
        setNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, lu: true } : item))
        );
      } catch (err) {
        // silencieux
      }
    }

    const type = n.type || '';
    const role = profile?.role;
    const isAdmin = ['super_admin', 'admin', 'staff'].includes(role);
    const isTrainer = role === 'formateur';

    if (type.includes('reservation') || type.includes('session') || type === 'nouvelle_demande_reservation') {
      navigate(isAdmin ? '/admin/reservations' : '/dashboard/bookings');
    } else if (type.includes('paiement') || type.includes('payment') || type.includes('facture')) {
      navigate(isAdmin ? '/admin/payments' : isTrainer ? '/trainer/payments' : '/member/payments');
    } else if (type.includes('message')) {
      navigate(isAdmin ? '/admin/messages' : isTrainer ? '/trainer/messages' : '/dashboard/messages');
    } else if (type.includes('formation') || type.includes('inscription')) {
      navigate(isTrainer ? '/trainer/formations' : isAdmin ? '/admin/formations' : '/dashboard/formations');
    } else if (type.includes('abonnement')) {
      navigate('/dashboard/subscription');
    } else if (type.includes('membre') || type.includes('member') || type.includes('formateur')) {
      navigate(isAdmin ? '/admin/members' : '/dashboard');
    } else {
      navigate(isAdmin ? '/admin/dashboard' : isTrainer ? '/trainer-dashboard' : '/dashboard');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await memberPortalApi.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, lu: true })));
    } catch (err) {
      // silencieux
    }
  };

  const handleLoadMore = () => {
    const next = page + 1;
    setLoadingMore(true);
    setPage(next);
    fetchNotifications(next, true);
  };

  const unreadCount = notifications.filter((n) => !n.lu).length;
  const grouped = groupNotifications(notifications);
  const groupOrder = ["Aujourd'hui", 'Hier', 'Cette semaine', 'Plus ancien'];

  const bgPage = dark ? '#100f0d' : '#f6f4f1';
  const textPrimary = dark ? '#fbffff' : '#100f0d';
  const textMuted = dark ? 'rgba(251,255,255,0.5)' : '#9ca3af';

  return (
    <PortalLayout profile={profile}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px 0 40px' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12, marginBottom: 28,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{
              fontSize: 22, fontWeight: 700, margin: 0,
              fontFamily: 'Sora, sans-serif', color: textPrimary,
            }}>
              Notifications
            </h1>
            {unreadCount > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 24, height: 24, padding: '0 8px',
                borderRadius: 99, background: '#f95d00',
                fontSize: 12, fontWeight: 800, color: '#ffffff',
              }}>
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              style={{
                fontSize: 13, fontWeight: 600, color: '#f95d00',
                border: '1px solid rgba(249,93,0,0.25)', borderRadius: 10,
                padding: '6px 14px', background: 'transparent', cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,93,0,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              Tout marquer comme lu
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[
            { key: 'all', label: 'Toutes' },
            { key: 'unread', label: 'Non lues' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                padding: '7px 18px', borderRadius: 99,
                fontSize: 13, fontWeight: 600,
                border: filter === tab.key ? 'none' : `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(16,15,13,0.12)'}`,
                background: filter === tab.key ? '#f95d00' : (dark ? 'rgba(255,255,255,0.06)' : '#ffffff'),
                color: filter === tab.key ? '#ffffff' : textPrimary,
                cursor: 'pointer', transition: 'all 0.15s ease',
                boxShadow: filter === tab.key ? '0 2px 8px rgba(249,93,0,0.25)' : 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#f95d00', animation: 'spin 1s linear infinite' }}>
              progress_activity
            </span>
            <span style={{ fontSize: 13, color: textMuted }}>Chargement...</span>
            <style>{'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 16 }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 64, height: 64, borderRadius: '50%',
              background: 'rgba(249,93,0,0.07)',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32, color: 'rgba(249,93,0,0.4)' }}>
                notifications_none
              </span>
            </span>
            <p style={{ fontSize: 14, color: textMuted, margin: 0, textAlign: 'center' }}>
              {filter === 'unread'
                ? 'Toutes les notifications ont été lues.'
                : 'Aucune notification pour le moment.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {groupOrder.map((group) => {
              const items = grouped[group];
              if (!items || items.length === 0) return null;
              return (
                <div key={group}>
                  <p style={{
                    fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.12em', color: textMuted, margin: '0 0 10px 4px',
                    fontFamily: 'Sora, sans-serif',
                  }}>
                    {group}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map((n) => (
                      <NotificationItem
                        key={n.id}
                        notification={n}
                        onClick={handleNotificationClick}
                        dark={dark}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load more */}
        {hasMore && !loading && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              style={{
                padding: '10px 28px', borderRadius: 99,
                fontSize: 13, fontWeight: 600,
                border: '1px solid rgba(249,93,0,0.25)',
                background: 'transparent', color: '#f95d00',
                cursor: loadingMore ? 'not-allowed' : 'pointer',
                opacity: loadingMore ? 0.6 : 1,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { if (!loadingMore) e.currentTarget.style.background = 'rgba(249,93,0,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {loadingMore ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, animation: 'spin 1s linear infinite' }}>
                    progress_activity
                  </span>
                  Chargement...
                </span>
              ) : (
                'Charger plus'
              )}
            </button>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
