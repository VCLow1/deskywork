// controllers/conversationsController.js — MESSAGERIE (Temps réel)
const { supabaseAdmin } = require('../config/supabase');
const { applyTenantFilter } = require('../middleware/guards');
const { emitToUser } = require('../services/socketService');
const { ensureConversationLinks, notifyNewMessage } = require('../services/messagingService');

async function listConversations(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { data: memberships, error: mErr } = await supabaseAdmin
      .from('conversation_members')
      .select('conversation_id, last_read_at')
      .eq('user_id', req.user.id);

    if (mErr) return res.status(500).json({ error: mErr.message });

    const convIds = (memberships || []).map(m => m.conversation_id);
    if (convIds.length === 0) return res.json({ conversations: [], total: 0 });

    const { data: conversations, error, count } = await supabaseAdmin
      .from('conversations')
      .select('*', { count: 'exact' })
      .in('id', convIds)
      .order('updated_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });

    const enriched = await Promise.all((conversations || []).map(async (conv) => {
      const { data: lastMsg } = await supabaseAdmin
        .from('messages')
        .select('id, content, sender_id, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const membership = memberships.find(m => m.conversation_id === conv.id);
      const lastRead = membership?.last_read_at || '1970-01-01T00:00:00Z';

      const { count: unreadCount } = await supabaseAdmin
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', req.user.id)
        .gt('created_at', lastRead);

      return { ...conv, last_message: lastMsg, unread_count: unreadCount || 0 };
    }));

    res.json({ conversations: enriched, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createConversation(req, res) {
  try {
    const { title, type = 'support' } = req.body;

    const { data: conv, error } = await supabaseAdmin
      .from('conversations')
      .insert({ title: title || 'Support 33S', type, created_by: req.user.id, tenant_id: req.tenantId })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await supabaseAdmin.from('conversation_members').insert({
      conversation_id: conv.id,
      user_id: req.user.id,
    });

    const { added } = await ensureConversationLinks(supabaseAdmin, conv.id, req.tenantId);
    (added || []).forEach(m => {
      emitToUser(m, 'conversation:update', { conversation_id: conv.id, last_message: null, title: conv.title });
    });

    res.json({ conversation: conv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getConversation(req, res) {
  try {
    const { data: membership } = await supabaseAdmin
      .from('conversation_members')
      .select('*')
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Accès refusé.' });

    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) return res.status(404).json({ error: 'Conversation introuvable.' });

    res.json({ conversation, membership });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listMessages(req, res) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { data: membership } = await supabaseAdmin
      .from('conversation_members')
      .select('*')
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Accès refusé.' });

    const { data: messages, error, count } = await supabaseAdmin
      .from('messages')
      .select('*, profiles!sender_id (id, nom, prenom, photo_url, role)', { count: 'exact' })
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ messages: messages || [], pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createMessage(req, res) {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Message vide.' });

    const { data: membership } = await supabaseAdmin
      .from('conversation_members')
      .select('*')
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Accès refusé.' });

    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert({ conversation_id: req.params.id, sender_id: req.user.id, content: content.trim() })
      .select('*, profiles!sender_id (id, nom, prenom, photo_url, role)')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await supabaseAdmin.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', req.params.id);

    await ensureConversationLinks(supabaseAdmin, req.params.id, req.tenantId);

    const { data: otherMembers } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', req.params.id)
      .neq('user_id', req.user.id);

    (otherMembers || []).forEach(m => {
      emitToUser(m.user_id, 'message:received', { conversation_id: req.params.id, message });
      emitToUser(m.user_id, 'conversation:update', { conversation_id: req.params.id, last_message: message });
    });

    await notifyNewMessage(supabaseAdmin, req.params.id, message, req.user.id);

    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function markRead(req, res) {
  try {
    const { error } = await supabaseAdmin
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getUnreadCount(req, res) {
  try {
    const { data: memberships } = await supabaseAdmin
      .from('conversation_members')
      .select('conversation_id, last_read_at')
      .eq('user_id', req.user.id);

    if (!memberships || memberships.length === 0) return res.json({ count: 0 });

    let totalUnread = 0;
    for (const m of memberships) {
      const lastRead = m.last_read_at || '1970-01-01T00:00:00Z';
      const { count } = await supabaseAdmin
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', m.conversation_id)
        .neq('sender_id', req.user.id)
        .gt('created_at', lastRead);
      totalUnread += count || 0;
    }

    res.json({ count: totalUnread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Équipe du coworking (admin/staff dédiés) visible par le membre / le formateur
async function listTeam(req, res) {
  try {
    const { data: team } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, role, photo_url')
      .in('role', ['super_admin', 'admin', 'staff'])
      .eq('tenant_id', req.tenantId)
      .order('prenom', { ascending: true });

    res.json({ team: team || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listAdminMembers(req, res) {
  try {
    const { search = '' } = req.query;

    let query = supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom, email, telephone, type_membre, role, created_at')
      .in('role', ['member', 'guest', 'formateur'])
      .order('nom', { ascending: true });

    query = applyTenantFilter(query, req);

    if (search.trim()) {
      query = query.or(`nom.ilike.%${search}%,prenom.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, error } = await query.limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ members: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createAdminConversation(req, res) {
  try {
    const { member_id, title } = req.body;
    if (!member_id) return res.status(400).json({ error: 'member_id requis.' });

    const { data: member } = await supabaseAdmin
      .from('profiles')
      .select('id, nom, prenom')
      .eq('id', member_id)
      .single();

    if (!member) return res.status(404).json({ error: 'Membre introuvable.' });

    const { data: existingMemberships } = await supabaseAdmin
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', req.user.id);

    if (existingMemberships && existingMemberships.length > 0) {
      const adminConvIds = existingMemberships.map(m => m.conversation_id);
      const { data: memberInConvs } = await supabaseAdmin
        .from('conversation_members')
        .select('conversation_id')
        .in('conversation_id', adminConvIds)
        .eq('user_id', member_id);

      if (memberInConvs && memberInConvs.length > 0) {
        const convId = memberInConvs[0].conversation_id;
        const { data: conv } = await supabaseAdmin.from('conversations').select('*').eq('id', convId).single();
        return res.json({ conversation: conv, existing: true });
      }
    }

    const convTitle = title || `${member.prenom} ${member.nom}`;
    const { data: conv, error } = await supabaseAdmin
      .from('conversations')
      .insert({ title: convTitle, type: 'support', created_by: req.user.id, tenant_id: req.tenantId })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await supabaseAdmin.from('conversation_members').insert([
      { conversation_id: conv.id, user_id: req.user.id },
      { conversation_id: conv.id, user_id: member_id },
    ]);

    emitToUser(member_id, 'conversation:update', {
      conversation_id: conv.id,
      last_message: null,
      title: convTitle,
    });

    res.status(201).json({ conversation: conv, existing: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listAdminConversations(req, res) {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabaseAdmin
      .from('conversations')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false });

    query = applyTenantFilter(query, req);

    const { data: conversations, error, count } = await query.range(offset, offset + parseInt(limit) - 1);
    if (error) return res.status(500).json({ error: error.message });

    const enriched = await Promise.all((conversations || []).map(async (conv) => {
      const { data: members } = await supabaseAdmin
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conv.id);

      const memberIds = (members || []).map(m => m.user_id);

      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email, role, type_membre')
        .in('id', memberIds);

      const memberProfile = (profiles || []).find(p => !['super_admin', 'admin', 'staff'].includes(p.role));
      const staffProfiles = (profiles || []).filter(p => ['super_admin', 'admin', 'staff'].includes(p.role));

      const { data: lastMsg } = await supabaseAdmin
        .from('messages')
        .select('id, content, sender_id, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: adminMembership } = await supabaseAdmin
        .from('conversation_members')
        .select('last_read_at')
        .eq('conversation_id', conv.id)
        .eq('user_id', req.user.id)
        .maybeSingle();

      const lastRead = adminMembership?.last_read_at || '1970-01-01T00:00:00Z';
      const { count: unreadCount } = await supabaseAdmin
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', req.user.id)
        .gt('created_at', lastRead);

      return {
        ...conv,
        member: memberProfile || null,
        staff: staffProfiles || [],
        last_message: lastMsg,
        unread_count: unreadCount || 0,
      };
    }));

    let result = enriched;
    if (search.trim()) {
      const s = search.toLowerCase();
      result = enriched.filter(c =>
        c.member && (
          (c.member.nom || '').toLowerCase().includes(s) ||
          (c.member.prenom || '').toLowerCase().includes(s) ||
          (c.member.email || '').toLowerCase().includes(s)
        )
      );
    }

    res.json({ conversations: result, pagination: { page: parseInt(page), limit: parseInt(limit), total: count || 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listConversations,
  createConversation,
  getConversation,
  listMessages,
  createMessage,
  markRead,
  getUnreadCount,
  listAdminMembers,
  listTeam,
  createAdminConversation,
  listAdminConversations,
};
