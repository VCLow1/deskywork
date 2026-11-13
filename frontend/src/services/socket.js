import { io } from 'socket.io-client';

const EXPLICIT_SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || '';
const IS_LOCALHOST = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const SOCKET_ENABLED = Boolean(import.meta.env.VITE_SOCKET_URL) || (IS_LOCALHOST && (!EXPLICIT_SOCKET_URL || EXPLICIT_SOCKET_URL.includes('localhost')));
const SOCKET_URL = EXPLICIT_SOCKET_URL || (IS_LOCALHOST ? 'http://localhost:5000' : '');

const NOOP_SOCKET = {
  connected: false,
  connect: () => NOOP_SOCKET,
  disconnect: () => {},
  emit: () => {},
  on: () => {},
  off: () => {},
};

let socket = null;

export function getSocket() {
  if (!SOCKET_ENABLED || !SOCKET_URL) {
    return NOOP_SOCKET;
  }
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      reconnectionAttempts: 2,
      reconnectionDelay: 2000,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (s === NOOP_SOCKET) return s;
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function joinUser(userId) {
  const s = connectSocket();
  s.emit('join:user', userId);
}

export function joinStaff() {
  const s = connectSocket();
  s.emit('join:staff');
}

export function onNotificationCreated(callback) {
  const s = connectSocket();
  s.on('notification:new', callback);
  return () => s.off('notification:new', callback);
}

export function onNotificationChanged(callback) {
  const s = connectSocket();
  s.on('notification:changed', callback);
  return () => s.off('notification:changed', callback);
}

export function onSessionStarted(callback) {
  const s = connectSocket();
  s.on('session:started', callback);
  return () => s.off('session:started', callback);
}

export function onSessionEnded(callback) {
  const s = connectSocket();
  s.on('session:ended', callback);
  return () => s.off('session:ended', callback);
}

export function onSessionOvertime(callback) {
  const s = connectSocket();
  s.on('session:overtime', callback);
  return () => s.off('session:overtime', callback);
}

export function onSessionAlert15Min(callback) {
  const s = connectSocket();
  s.on('session:alert-15min', callback);
  return () => s.off('session:alert-15min', callback);
}

export function onSessionTimer(callback) {
  const s = connectSocket();
  s.on('session:timer', callback);
  return () => s.off('session:timer', callback);
}
