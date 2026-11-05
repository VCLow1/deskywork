// services/messagingService.js — Tâche 7 : aide à la messagerie
// Garantit que chaque conversation est liée au bon coworking (tenant_id)
// et à l'équipe staff, et notifie chaque destinataire d'un nouveau message.
const { notifyNouveauMessagePortail } = require('./notificationService');

const LEGACY_DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

async function fetchTenantStaff(supabase, tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['super_admin', 'admin', 'staff'])
    .eq('tenant_id', tenantId);
  if (error) {
    console.error('⚠️ Messagerie: lecture staff tenant:', error.message);
    return [];
  }
  return (data || []).map(p => p.id);
}

// Rattache la conversation au coworking du créateur et ajoute l'équipe staff.
async function ensureConversationLinks(supabase, conversationId, tenantId) {
  try {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, tenant_id')
      .eq('id', conversationId)
      .single();

    if (!conv) return { added: [] };

    if (tenantId && (!conv.tenant_id || conv.tenant_id === LEGACY_DEFAULT_TENANT)) {
      const { error: upErr } = await supabase
        .from('conversations')
        .update({ tenant_id: tenantId })
        .eq('id', conversationId);
      if (upErr) console.error('⚠️ Messagerie: maj tenant_id conversation:', upErr.message);
    }

    const { data: existing } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId);
    const existingIds = (existing || []).map(m => m.user_id);

    const staffIds = await fetchTenantStaff(supabase, tenantId || conv.tenant_id);
    const toAdd = staffIds.filter(id => !existingIds.includes(id));

    if (toAdd.length > 0) {
      const rows = toAdd.map(user_id => ({ conversation_id: conversationId, user_id }));
      const { error: insErr } = await supabase.from('conversation_members').insert(rows);
      if (insErr) console.error('⚠️ Messagerie: ajout membres staff:', insErr.message);
    }

    return { added: toAdd };
  } catch (err) {
    console.error('⚠️ Messagerie: ensureConversationLinks:', err.message);
    return { added: [] };
  }
}

// Notification de chaque message reçu pour tous les autres membres.
async function notifyNewMessage(supabase, conversationId, message, senderId) {
  try {
    const { data: conv } = await supabase
      .from('conversations')
      .select('title')
      .eq('id', conversationId)
      .single();

    const { data: memberRows } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .neq('user_id', senderId);

    const memberIds = (memberRows || []).map(r => r.user_id);
    if (memberIds.length === 0) return;

    const { data: recipients } = await supabase
      .from('profiles')
      .select('id, email, prenom, nom')
      .in('id', memberIds);

    const { data: sender } = await supabase
      .from('profiles')
      .select('id, email, prenom, nom')
      .eq('id', senderId)
      .single();

    for (const recipient of (recipients || [])) {
      if (!recipient?.email || !recipient?.id) continue;
      await notifyNouveauMessagePortail(
        supabase,
        { ...message, contenu: message.content, sujet: conv?.title || 'Nouveau message' },
        sender || { prenom: '', nom: '' },
        recipient.email,
        recipient.id
      );
    }
  } catch (err) {
    console.error('⚠️ Messagerie: notifyNewMessage:', err.message);
  }
}

module.exports = { ensureConversationLinks, notifyNewMessage };