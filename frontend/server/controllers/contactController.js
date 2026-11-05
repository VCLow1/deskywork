const { supabaseAdmin } = require('../config/supabase');

async function createContact(req, res) {
  const { nom, email, sujet, message } = req.body;
  if (!nom?.trim() || !email?.trim() || !sujet?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Tous les champs du formulaire sont requis.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }

  const { data, error } = await supabaseAdmin.from('contacts').insert({
    nom: nom.trim(), email: email.trim().toLowerCase(), sujet: sujet.trim(), message: message.trim(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ contact: data, message: 'Votre message a bien été envoyé.' });
}

async function listContacts(req, res) {
  const { statut, search } = req.query;
  let query = supabaseAdmin.from('contacts').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (statut) query = query.eq('statut', statut);
  if (search) query = query.or(`nom.ilike.%${search}%,email.ilike.%${search}%,sujet.ilike.%${search}%,message.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ contacts: data || [], total: count || 0 });
}

async function updateContact(req, res) {
  const { statut } = req.body;
  if (!['nouveau', 'lu', 'traite'].includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });
  const { data, error } = await supabaseAdmin.from('contacts').update({ statut, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: error?.message || 'Contact introuvable.' });
  res.json({ contact: data });
}

module.exports = { createContact, listContacts, updateContact };
