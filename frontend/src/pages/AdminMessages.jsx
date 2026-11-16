import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useSessionUser } from '../hooks/useSessionUser';
import PortalLayout from '../components/layout/PortalLayout';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function getRelativeTime(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `${diffMin} min`;
  if (diffH < 24) return `${diffH}h`;
  if (diffD < 7) return `${diffD}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getDateLabel(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date >= today) return "Aujourd'hui";
  if (date >= yesterday) return 'Hier';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function ConversationItem({ conv, isActive, onClick }) {
  const isCommunity = conv.type === 'group' || /canal/i.test(conv.title);
  const memberName = isCommunity
    ? conv.title
    : (conv.member ? `${conv.member.prenom || ''} ${conv.member.nom || ''}`.trim() : conv.title);
  const lastMsg = conv.last_message;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 p-3.5 rounded-2xl transition-all duration-200 ${
        isActive
          ? 'bg-secondary/8 border-2 border-secondary/20 shadow-xs'
          : 'bg-white border border-outline-variant/10 hover:bg-surface-variant/20 hover:border-outline-variant/20'
      }`}
      style={{ boxShadow: isActive ? '0 4px 16px rgba(0,84,203,0.06)' : '0 2px 8px rgba(16,35,63,0.04)' }}
    >
      <div
        className="flex items-center justify-center w-11 h-11 rounded-2xl shrink-0 text-white font-bold text-sm"
        style={{
          background: isCommunity
            ? 'linear-gradient(135deg, #f95d00, #ff7a28)'
            : 'linear-gradient(135deg, #2FBE8F, #28a745)',
        }}
      >
        {isCommunity ? (
          <span className="material-symbols-outlined text-white" style={{ fontSize: 22 }}>groups</span>
        ) : (
          conv.member?.prenom?.charAt(0) || memberName.charAt(0) || '?'
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-sm font-semibold text-primary truncate" style={{ fontFamily: 'Sora, sans-serif' }}>
            {memberName}
          </span>
          {lastMsg && <span className="text-[11px] text-on-surface-variant/50 shrink-0">{getRelativeTime(lastMsg.created_at)}</span>}
        </div>
        {isCommunity ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Canal Coworking
          </span>
        ) : (
          conv.member?.email && <p className="text-[11px] text-on-surface-variant/40 truncate mb-0.5">{conv.member.email}</p>
        )}
        {lastMsg ? (
          <p className={`text-xs truncate ${conv.unread_count > 0 ? 'text-on-surface-variant font-semibold' : 'text-on-surface-variant/60'}`}>
            {lastMsg.sender_id === conv.currentUserId ? 'Vous: ' : ''}{lastMsg.content}
          </p>
        ) : (
          <p className="text-xs text-on-surface-variant/40 italic">Aucun message pour le moment</p>
        )}
      </div>
      {conv.unread_count > 0 && (
        <span className="flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold text-white shrink-0 mt-1" style={{ background: '#f95d00' }}>
          {conv.unread_count > 99 ? '99+' : conv.unread_count}
        </span>
      )}
    </button>
  );
}

function MessageBubble({ msg, isOwn, showSender }) {
  const senderName = msg.profiles ? `${msg.profiles.prenom || ''} ${msg.profiles.nom || ''}`.trim() || 'Utilisateur' : 'Utilisateur';
  const isAdmin = msg.profiles?.role && ['super_admin', 'admin', 'staff'].includes(msg.profiles.role);

  return (
    <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} mb-3`}>
      {showSender && !isOwn && (
        <div className="flex items-center gap-1.5 mb-1 ml-1">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: isAdmin ? 'linear-gradient(135deg, #f95d00, #ff7a28)' : 'linear-gradient(135deg, #2FBE8F, #28a745)' }}>
            {senderName.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs font-semibold text-on-surface-variant">{senderName}</span>
          {isAdmin && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-secondary/10 text-secondary">Staff</span>}
        </div>
      )}
      <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${isOwn ? 'text-white rounded-br-md' : 'bg-white border border-outline-variant/10 text-on-surface rounded-bl-md'}`} style={isOwn ? { background: 'linear-gradient(135deg, #f95d00, #ff7a28)', boxShadow: '0 4px 12px rgba(249,93,0,0.15)' } : { boxShadow: '0 2px 8px rgba(16,35,63,0.04)' }}>
        {msg.content}
      </div>
      <span className="text-[10px] text-on-surface-variant/40 mt-0.5 mx-2">
        {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        {msg._sending && ' ...'}
      </span>
    </div>
  );
}

export default function AdminMessages({ session }) {
  const { userId, email, metadata } = useSessionUser(session);
  const navigate = useNavigate();
  const [profile, setProfile] = useState(() =>
    userId ? { id: userId, email, role: metadata.role || 'admin', ...metadata } : null
  );
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewConvModal, setShowNewConvModal] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [creatingConv, setCreatingConv] = useState(false);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const inputRef = useRef(null);
  const activeConvRef = useRef(null);
  const profileRef = useRef(null);
  const joinedRooms = useRef(new Set());

  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { activeConvRef.current = activeConv; }, [activeConv]);

  // profile déjà initialisé depuis le JWT — aucun appel DB nécessaire

  const fetchConversations = useCallback(async () => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SOCKET_URL}/api/admin/conversations`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setConversations((data.conversations || []).map(c => ({ ...c, currentUserId: profile?.id })));
    } catch (err) { /* silencieux */ } finally { setLoading(false); }
  }, [profile?.id]);

  useEffect(() => { if (profile) fetchConversations(); }, [profile, fetchConversations]);

  // Stable socket
  useEffect(() => {
    if (!profile) return;
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000 });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join:user', profile.id);
      socket.emit('join:staff');
      joinedRooms.current.clear();
      joinedRooms.current.add(`user:${profile.id}`);
      conversations.forEach(c => { socket.emit('join:conversation', c.id); joinedRooms.current.add(`conv:${c.id}`); });
    });

    socket.on('message:received', ({ conversation_id, message }) => {
      const active = activeConvRef.current;
      if (active?.id === conversation_id) {
        setMessages(prev => { if (prev.find(m => m.id === message.id)) return prev; return [...prev, { ...message, _sending: false }]; });
      }
      setConversations(prev => prev.map(c => c.id === conversation_id ? { ...c, last_message: { id: message.id, content: message.content, sender_id: message.sender_id, created_at: message.created_at }, unread_count: active?.id === conversation_id ? 0 : (c.unread_count || 0) + (message.sender_id !== profileRef.current?.id ? 1 : 0) } : c));
    });

    socket.on('conversation:update', ({ conversation_id, last_message }) => {
      setConversations(prev => {
        const exists = prev.find(c => c.id === conversation_id);
        if (exists) return prev.map(c => c.id === conversation_id ? { ...c, last_message } : c);
        fetchConversations();
        return prev;
      });
    });

    socket.on('disconnect', () => {});
    socket.on('reconnect', () => { socket.emit('join:user', profile.id); socket.emit('join:staff'); });

    return () => { socket.disconnect(); };
  }, [profile]);

  const joinConversation = useCallback((convId) => {
    if (socketRef.current && !joinedRooms.current.has(`conv:${convId}`)) {
      socketRef.current.emit('join:conversation', convId);
      joinedRooms.current.add(`conv:${convId}`);
    }
  }, []);

  const selectConversation = useCallback(async (conv) => {
    setActiveConv(conv);
    setShowMobileChat(true);
    setMessages([]);
    joinConversation(conv.id);

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SOCKET_URL}/api/conversations/${conv.id}/messages?limit=100`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setMessages((data.messages || []).reverse().map(m => ({ ...m, _sending: false })));
      await fetch(`${SOCKET_URL}/api/conversations/${conv.id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread_count: 0, currentUserId: profile?.id } : c));
    } catch (err) { /* silencieux */ }
  }, [profile?.id, joinConversation]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !activeConv || sending) return;
    const content = newMessage.trim();
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const optimisticMsg = { id: tempId, conversation_id: activeConv.id, sender_id: profile.id, content, created_at: now, profiles: { id: profile.id, nom: profile.nom, prenom: profile.prenom, role: profile.role }, _sending: true };

    setMessages(prev => [...prev, optimisticMsg]);
    setNewMessage('');
    setSending(true);
    setConversations(prev => prev.map(c => c.id === activeConv.id ? { ...c, last_message: { id: tempId, content, sender_id: profile.id, created_at: now }, currentUserId: profile.id } : c));

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SOCKET_URL}/api/conversations/${activeConv.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ content }) });
      const data = await res.json();
      if (data.message) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...data.message, _sending: false } : m));
        setConversations(prev => prev.map(c => c.id === activeConv.id ? { ...c, last_message: { id: data.message.id, content, sender_id: profile.id, created_at: data.message.created_at } } : c));
      } else { throw new Error(data.error || 'Erreur envoi'); }
    } catch (err) {
      /* silencieux */
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, _sending: false, _error: true } : m));
      setNewMessage(content);
    } finally { setSending(false); inputRef.current?.focus(); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  const loadAllMembers = async () => {
    setSearchingMembers(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SOCKET_URL}/api/admin/members`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setMembers(data.members || []);
    } catch (err) { /* silencieux */ } finally { setSearchingMembers(false); }
  };

  const openNewConvModal = async () => {
    setMemberSearch('');
    setShowNewConvModal(true);
    loadAllMembers();
  };

  const filteredMembers = members.filter(m => {
    if (!memberSearch.trim()) return true;
    const s = memberSearch.toLowerCase();
    return `${m.prenom || ''} ${m.nom || ''}`.toLowerCase().includes(s) || (m.email || '').toLowerCase().includes(s);
  });

  const handleStartConversation = async (member) => {
    setCreatingConv(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SOCKET_URL}/api/admin/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ member_id: member.id }) });
      const data = await res.json();
      if (data.conversation) {
        const convWithMeta = { ...data.conversation, member, last_message: null, unread_count: 0, currentUserId: profile?.id };
        setConversations(prev => { if (prev.find(c => c.id === convWithMeta.id)) return prev; return [convWithMeta, ...prev]; });
        joinConversation(convWithMeta.id);
        selectConversation(convWithMeta);
        setShowNewConvModal(false);
        setMemberSearch(''); setMembers([]);
      }
    } catch (err) { console.error('Failed to create conversation:', err); } finally { setCreatingConv(false); }
  };

  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'channels' | 'direct'

  const filteredConversations = conversations.filter(c => {
    const isChan = c.type === 'group' || /canal/i.test(c.title);
    if (filterTab === 'channels' && !isChan) return false;
    if (filterTab === 'direct' && isChan) return false;
    if (!searchQuery.trim()) return true;
    const s = searchQuery.toLowerCase();
    const name = c.member ? `${c.member.prenom || ''} ${c.member.nom || ''}`.toLowerCase() : '';
    const email = (c.member?.email || '').toLowerCase();
    const title = (c.title || '').toLowerCase();
    return name.includes(s) || email.includes(s) || title.includes(s);
  });

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  return (
    <PortalLayout profile={profile}>
      <div className="max-w-6xl mx-auto px-1 sm:px-6 py-4 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-primary" style={{ fontFamily: 'Sora, sans-serif' }}>Messagerie</h1>
            {totalUnread > 0 && <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full text-xs font-bold text-white" style={{ background: '#f95d00' }}>{totalUnread}</span>}
          </div>
          <button onClick={openNewConvModal} className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]" style={{ background: 'linear-gradient(135deg, #f95d00, #ff7a28)', boxShadow: '0 4px 12px rgba(249,93,0,0.2)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>Nouvelle conversation
          </button>
        </div>
        <div className="flex rounded-2xl sm:rounded-3xl overflow-hidden border border-outline-variant/10 bg-white" style={{ height: 'calc(100dvh - 180px)', minHeight: '420px', boxShadow: '0 8px 32px rgba(16,35,63,0.08)' }}>
          {/* Left */}
          <div className={`w-full md:w-[340px] shrink-0 border-r border-outline-variant/10 flex flex-col bg-surface-variant/10 ${showMobileChat ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-3 border-b border-outline-variant/10 space-y-2">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" style={{ fontSize: 18 }}>search</span>
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Rechercher..." className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-outline-variant/15 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-secondary/40 transition-colors" />
              </div>
              <div className="flex p-0.5 rounded-xl bg-surface-variant/30 gap-1 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setFilterTab('all')}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${filterTab === 'all' ? 'bg-white shadow-2xs text-primary' : 'text-on-surface-variant/60 hover:text-primary'}`}
                >
                  Tous ({conversations.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('channels')}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all ${filterTab === 'channels' ? 'bg-[#f95d00] text-white shadow-2xs' : 'text-on-surface-variant/60 hover:text-primary'}`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>groups</span>
                  <span>Canaux</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('direct')}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all ${filterTab === 'direct' ? 'bg-white shadow-2xs text-primary' : 'text-on-surface-variant/60 hover:text-primary'}`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>chat</span>
                  <span>Direct</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <div className="flex items-center justify-center py-12"><span className="material-symbols-outlined animate-spin text-secondary" style={{ fontSize: 28 }}>progress_activity</span></div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <span className="material-symbols-outlined text-on-surface-variant/30" style={{ fontSize: 40 }}>chat_bubble_outline</span>
                  <p className="text-sm text-on-surface-variant/50 text-center">{searchQuery ? 'Aucun résultat' : 'Aucune discussion dans cette vue'}</p>
                </div>
              ) : filteredConversations.map(conv => (
                <ConversationItem key={conv.id} conv={{ ...conv, currentUserId: profile?.id }} isActive={activeConv?.id === conv.id} onClick={() => selectConversation(conv)} />
              ))}
            </div>
            <div className="p-3 border-t border-outline-variant/10"><p className="text-[11px] text-on-surface-variant/40 text-center">{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</p></div>
          </div>
          {/* Right */}
          <div className={`flex-1 flex flex-col bg-white ${showMobileChat ? 'flex' : 'hidden md:flex'}`}>
            {!activeConv ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <span className="flex items-center justify-center w-20 h-20 rounded-full" style={{ background: 'rgba(0,84,203,0.06)' }}>
                  <span className="material-symbols-outlined text-on-surface-variant/30" style={{ fontSize: 40 }}>forum</span>
                </span>
                <div className="text-center">
                  <p className="text-on-surface-variant/60 text-sm font-medium" style={{ fontFamily: 'Sora, sans-serif' }}>Sélectionnez une discussion</p>
                  <p className="text-on-surface-variant/40 text-xs mt-1">ou échangez sur un canal public</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 px-5 py-4 border-b border-outline-variant/10">
                  <button onClick={() => setShowMobileChat(false)} className="md:hidden flex items-center justify-center w-9 h-9 rounded-full hover:bg-surface-variant/30">
                    <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 20 }}>arrow_back</span>
                  </button>
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{
                      background: activeConv.type === 'group' || /canal/i.test(activeConv.title)
                        ? 'linear-gradient(135deg, #f95d00, #ff7a28)'
                        : 'linear-gradient(135deg, #2FBE8F, #28a745)',
                    }}
                  >
                    {activeConv.type === 'group' || /canal/i.test(activeConv.title) ? (
                      <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>groups</span>
                    ) : (
                      activeConv.member?.prenom?.charAt(0) || activeConv.title?.charAt(0) || '?'
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-primary truncate" style={{ fontFamily: 'Sora, sans-serif' }}>
                        {activeConv.type === 'group' || /canal/i.test(activeConv.title)
                          ? activeConv.title
                          : (activeConv.member ? `${activeConv.member.prenom || ''} ${activeConv.member.nom || ''}`.trim() : activeConv.title)}
                      </p>
                      {(activeConv.type === 'group' || /canal/i.test(activeConv.title)) && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 shrink-0">
                          Canal Ouvert
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant/50 truncate">
                      {activeConv.type === 'group' || /canal/i.test(activeConv.title)
                        ? 'Canal public du coworking : accessible à tous les participants DeskyWork'
                        : (activeConv.member?.email || 'Membre')}
                    </p>
                  </div>
                </div>
                {(activeConv.type === 'group' || /canal/i.test(activeConv.title)) && (
                  <div className="px-5 py-2.5 bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 border-b border-orange-100 flex items-center gap-2 text-xs text-orange-950 font-medium">
                    <span className="material-symbols-outlined text-orange-600 shrink-0" style={{ fontSize: 18 }}>campaign</span>
                    <span>Canal public du coworking : Tous les coworkers, membres et formateurs de DeskyWork peuvent échanger ici.</span>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-5 py-4" style={{ background: '#F8F9FB' }}>
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      <span className="material-symbols-outlined text-on-surface-variant/20" style={{ fontSize: 48 }}>chat_bubble_outline</span>
                      <p className="text-sm text-on-surface-variant/40 text-center">Démarrez la conversation</p>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg, idx) => {
                        const isOwn = msg.sender_id === profile?.id;
                        const prevMsg = messages[idx - 1];
                        const showSender = !prevMsg || prevMsg.sender_id !== msg.sender_id;
                        const showDate = !prevMsg || getDateLabel(msg.created_at) !== getDateLabel(prevMsg.created_at);
                        return (
                          <React.Fragment key={msg.id}>
                            {showDate && <div className="flex items-center justify-center my-4"><span className="text-[11px] font-semibold text-on-surface-variant/40 px-3 py-1 rounded-full bg-white border border-outline-variant/10">{getDateLabel(msg.created_at)}</span></div>}
                            <MessageBubble msg={msg} isOwn={isOwn} showSender={showSender} />
                          </React.Fragment>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>
                <div className="px-5 py-4 border-t border-outline-variant/10 bg-white">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <textarea ref={inputRef} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={handleKeyDown} placeholder="Écrivez votre message..." rows={1} className="w-full px-4 py-3 rounded-2xl bg-surface-variant/30 border border-outline-variant/15 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-secondary/40 transition-colors resize-none" style={{ minHeight: '44px', maxHeight: '120px' }} />
                    </div>
                    <button onClick={handleSend} disabled={!newMessage.trim() || sending} className="flex items-center justify-center w-11 h-11 rounded-full text-white shrink-0 transition-all duration-200 disabled:opacity-40 hover:scale-105 active:scale-95" style={{ background: 'linear-gradient(135deg, #f95d00, #ff7a28)', boxShadow: '0 4px 12px rgba(249,93,0,0.2)' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* New Conversation Modal */}
        {showNewConvModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
            <div className="bg-white rounded-3xl p-6 sm:p-8 w-full max-w-md" style={{ boxShadow: '0 24px 64px rgba(0,13,35,0.2)' }}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-primary" style={{ fontFamily: 'Sora, sans-serif' }}>Nouvelle conversation</h3>
                <button onClick={() => { setShowNewConvModal(false); setMemberSearch(''); setMembers([]); }} className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-surface-variant/30">
                  <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 20 }}>close</span>
                </button>
              </div>
              <div className="relative mb-4">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" style={{ fontSize: 20 }}>search</span>
                <input type="text" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Rechercher un utilisateur..." autoFocus className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-variant/20 border border-outline-variant/15 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-secondary/40 transition-colors" />
              </div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-on-surface-variant/60">Utilisateurs du coworking</p>
                <span className="text-[11px] text-on-surface-variant/40">{filteredMembers.length} utilisateur{filteredMembers.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {searchingMembers ? (
                  <div className="flex items-center justify-center py-8"><span className="material-symbols-outlined animate-spin text-secondary" style={{ fontSize: 24 }}>progress_activity</span></div>
                ) : filteredMembers.length === 0 ? (
                  <p className="text-sm text-on-surface-variant/50 text-center py-8">Aucun utilisateur trouvé</p>
                ) : filteredMembers.map(member => (
                  <button key={member.id} onClick={() => handleStartConversation(member)} disabled={creatingConv} className="w-full text-left flex items-center gap-3 p-3 rounded-xl hover:bg-surface-variant/20 transition-all disabled:opacity-50">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: 'linear-gradient(135deg, #2FBE8F, #28a745)' }}>
                      {(member.prenom || member.nom || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{member.prenom || ''} {member.nom || ''}</p>
                      <p className="text-xs text-on-surface-variant/50 truncate">{member.email}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-variant/30 text-on-surface-variant/60 shrink-0">{member.type_membre || 'Membre'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
