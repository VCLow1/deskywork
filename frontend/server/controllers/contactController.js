const { supabaseAdmin } = require('../config/supabase');
const { sendEmailUniversal } = require('../utils/sendEmail');

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

async function createDomiciliationRequest(req, res) {
  try {
    const {
      partner_id,
      partner_name,
      pack_name,
      price,
      raison_sociale,
      matricule_fiscal,
      telephone_pro,
      date_souhaitee,
      message,
    } = req.body || {};

    if (
      !String(partner_name || '').trim() ||
      !String(raison_sociale || '').trim() ||
      !String(matricule_fiscal || '').trim() ||
      !String(telephone_pro || '').trim()
    ) {
      return res.status(400).json({
        error: 'Établissement partenaire, raison sociale, matricule fiscal et téléphone professionnel sont requis.',
      });
    }

    const { data: requester } = await supabaseAdmin
      .from('profiles')
      .select('id, email, nom, prenom')
      .eq('id', req.user.id)
      .maybeSingle();

    const requesterEmail = (requester?.email || req.user.email || '').trim().toLowerCase();
    const contactPerson = `${requester?.prenom || ''} ${requester?.nom || ''}`.trim() || requesterEmail;
    const cleanPartnerName = String(partner_name).trim();
    const cleanRaison = String(raison_sociale).trim();
    const cleanMF = String(matricule_fiscal).trim();
    const cleanTel = String(telephone_pro).trim();

    const formattedMsg = [
      `Partenaire : ${cleanPartnerName}`,
      pack_name ? `Offre : ${pack_name}${price != null ? ` (${Number(price).toFixed(3)} DT HT/mois)` : ''}` : null,
      `Raison sociale : ${cleanRaison}`,
      `Matricule fiscal : ${cleanMF}`,
      `Interlocuteur : ${contactPerson}`,
      `Téléphone pro : ${cleanTel}`,
      `E-mail : ${requesterEmail}`,
      date_souhaitee ? `Date souhaitée : ${date_souhaitee}` : null,
      message ? `Précisions : ${String(message).trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const { data: contactRow, error: insertErr } = await supabaseAdmin
      .from('contacts')
      .insert({
        nom: cleanRaison,
        email: requesterEmail || 'contact@deskywork.tn',
        sujet: `Demande de domiciliation — ${cleanPartnerName}`,
        message: formattedMsg,
      })
      .select()
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    // Notifier les administrateurs du partenaire (si UUID valide) et les Super Admins
    const notifUserIds = new Set();
    let partnerEmail = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(partner_id || ''));

    if (isUuid) {
      const { data: tenantRow } = await supabaseAdmin
        .from('tenants')
        .select('email')
        .eq('id', partner_id)
        .maybeSingle();
      if (tenantRow?.email) partnerEmail = tenantRow.email;

      const { data: partnerAdmins } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('tenant_id', partner_id)
        .in('role', ['admin', 'staff']);
      (partnerAdmins || []).forEach((u) => notifUserIds.add(u.id));
    }

    const { data: superAdmins } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or('role.eq.super_admin,is_super_admin.eq.true');
    (superAdmins || []).forEach((u) => notifUserIds.add(u.id));

    if (notifUserIds.size > 0) {
      const notifMsg = `🏢 Nouvelle demande de domiciliation pour ${cleanPartnerName} — ${cleanRaison} (MF: ${cleanMF}).`;
      await supabaseAdmin.from('notifications').insert(
        Array.from(notifUserIds).map((uid) => ({
          user_id: uid,
          type: 'demande_domiciliation',
          canal: 'Dashboard',
          message: notifMsg,
        }))
      );
    }

    if (partnerEmail) {
      try {
        await sendEmailUniversal({
          to: partnerEmail,
          subject: `Nouvelle demande de domiciliation — ${cleanRaison}`,
          text: `Bonjour,\n\nVous avez reçu une nouvelle demande de domiciliation via DeskyWork :\n\n${formattedMsg}`,
        });
      } catch (_) {}
    }

    return res.status(201).json({
      success: true,
      contact: contactRow,
      message: 'Votre demande de domiciliation a été transmise avec succès.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur lors de l\'envoi de la demande.' });
  }
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

module.exports = { createContact, createDomiciliationRequest, listContacts, updateContact };
