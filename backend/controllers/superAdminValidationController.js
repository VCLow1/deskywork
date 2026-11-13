// controllers/superAdminValidationController.js — Validation Super Admin des Organisations et Formateurs
'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { auditLog } = require('../middleware/guards');
const { sendEmailUniversal } = require('../utils/sendEmail');

// CDC v3.0 — CONSTANTES PACKS SAAS POUR CONTRÔLE SERVEUR & LIMITES
const SAAS_PACKS = {
  essentiel: {
    key: 'essentiel',
    name: 'Essentiel',
    prix: 90,
    max_espaces: 10,
    max_membres: 20,
    max_staff: 1,
    multi_sites: false,
    export_excel: false,
    export_pdf: true,
    stats_marketplace: false,
    features: ['10 ressources max', '20 membres actifs', '1 compte staff', 'Réservations & Planning', 'Check-in & minuteur temps réel', 'Reçus PDF'],
  },
  standard: {
    key: 'standard',
    name: 'Standard',
    prix: 150,
    max_espaces: 30,
    max_membres: 100,
    max_staff: 3,
    multi_sites: false,
    export_excel: true,
    export_pdf: true,
    stats_marketplace: false,
    features: ['30 ressources max', '100 membres actifs', '3 comptes staff', 'Exports Excel & PDF', 'Codes promotionnels', 'Facturation & rapports avancés'],
  },
  premium: {
    key: 'premium',
    name: 'Premium',
    prix: 220,
    max_espaces: null,
    max_membres: null,
    max_staff: 10,
    multi_sites: true,
    export_excel: true,
    export_pdf: true,
    stats_marketplace: true,
    features: ['Ressources & membres illimités', '10 comptes staff', 'Statistiques Marketplace détaillées', 'Support prioritaire dédié'],
  },
};

// ── Liste des validations en attente ─────────────────────────────────────────
async function getPendingValidations(req, res) {
  try {
    // 1. Organisations en attente de validation (coworking ou centre de formation)
    const { data: orgs, error: orgsErr } = await supabaseAdmin
      .from('organizations')
      .select(`
        id, type, nom, slug, ville, adresse, description, logo_url, cover_url,
        statut, created_at, telephone, email, owner_id, settings,
        profiles!owner_id ( id, nom, prenom, email, telephone )
      `)
      .in('statut', ['en_validation', 'brouillon'])
      .order('created_at', { ascending: false });

    if (orgsErr) return res.status(500).json({ error: orgsErr.message });

    // Récupérer les détails tenant associés (pack, limites, prix)
    const orgIds = (orgs || []).map((o) => o.id);
    let tenantsMap = {};
    if (orgIds.length > 0) {
      const { data: tenantRows } = await supabaseAdmin
        .from('tenants')
        .select('id, plan, tier, montant_mensuel, limite_membres, limite_espaces, settings')
        .in('id', orgIds);
      (tenantRows || []).forEach((t) => {
        tenantsMap[t.id] = t;
      });
    }

    const enrichedOrgs = (orgs || []).map((org) => {
      const t = tenantsMap[org.id] || {};
      const rawPack = String(org.settings?.saas_pack || t.settings?.saas_pack || t.plan || 'standard').toLowerCase().trim();
      const packKey = rawPack.includes('prem') ? 'premium' : (rawPack.includes('essen') ? 'essentiel' : 'standard');
      const packCfg = SAAS_PACKS[packKey] || SAAS_PACKS.standard;
      const activite = org.settings?.activite || (org.type === 'centre_formation' ? 'formation' : 'coworking');

      return {
        ...org,
        pack_details: {
          key: packCfg.key,
          name: `Pack ${packCfg.name}`,
          prix_mensuel: packCfg.prix,
          prix_label: `${Number(packCfg.prix).toFixed(3)} DT/mois HT`,
          max_espaces: packCfg.max_espaces ? `${packCfg.max_espaces} ressources` : 'Ressources illimitées',
          max_membres: packCfg.max_membres ? `${packCfg.max_membres} membres` : 'Membres illimités',
          max_staff: `${packCfg.max_staff} compte${packCfg.max_staff > 1 ? 's' : ''} staff`,
          activite,
          activite_label: activite === 'mixte' ? 'Coworking & Formation (Mixte)' : (activite === 'formation' || org.type === 'centre_formation' ? 'Centre de formation' : 'Espace Coworking'),
          features: packCfg.features,
        },
      };
    });

    // 2. Profils formateurs en attente de validation
    const { data: trainers, error: trainersErr } = await supabaseAdmin
      .from('trainer_profiles')
      .select(`
        id, user_id, bio, domaines, certificats, telephone_pro,
        statut_validation, created_at,
        profiles!user_id ( id, nom, prenom, email, telephone )
      `)
      .eq('statut_validation', 'en_validation')
      .order('created_at', { ascending: false });

    if (trainersErr) return res.status(500).json({ error: trainersErr.message });

    // 3. Demandes de changement de pack des établissements existants
    const { data: allTenants } = await supabaseAdmin
      .from('tenants')
      .select('id, nom, plan, settings, owner_id, profiles!owner_id ( id, nom, prenom, email, telephone )');

    const pendingPackUpgrades = [];
    (allTenants || []).forEach((t) => {
      const curSettings = t.settings || {};
      const reqs = Array.isArray(curSettings.upgrade_requests) ? curSettings.upgrade_requests : [];
      reqs.forEach((r) => {
        if (r.statut === 'en_attente') {
          const curPackKey = String(curSettings.saas_pack || t.plan || 'essentiel').toLowerCase();
          const curCfg = SAAS_PACKS[curPackKey] || SAAS_PACKS.essentiel;
          const tgtPackKey = String(r.target_pack || 'standard').toLowerCase();
          const tgtCfg = SAAS_PACKS[tgtPackKey] || SAAS_PACKS.standard;

          pendingPackUpgrades.push({
            request_id: r.id,
            tenant_id: t.id,
            tenant_nom: t.nom,
            current_pack_key: curCfg.key,
            current_pack_name: curCfg.name,
            current_prix_label: `${Number(curCfg.prix).toFixed(3)} DT`,
            target_pack_key: tgtCfg.key,
            target_pack_name: tgtCfg.name,
            target_prix_label: `${Number(tgtCfg.prix).toFixed(3)} DT/mois HT`,
            target_limits: `${tgtCfg.max_espaces ? tgtCfg.max_espaces + ' ressources' : 'Ressources illimitées'} · ${tgtCfg.max_membres ? tgtCfg.max_membres + ' membres' : 'Membres illimités'} · ${tgtCfg.max_staff} staff`,
            note: r.note || '',
            requested_by: r.requested_by,
            created_at: r.created_at,
            owner: t.profiles,
          });
        }
      });
    });

    res.json({
      pendingOrganizations: enrichedOrgs,
      pendingTrainers: trainers || [],
      pendingPackUpgrades,
      totalPending: enrichedOrgs.length + (trainers?.length || 0) + pendingPackUpgrades.length,
    });
  } catch (err) {
    console.error('❌ Erreur getPendingValidations:', err);
    res.status(500).json({ error: err.message || 'Erreur lors du chargement des demandes.' });
  }
}

// ── Valider ou refuser une organisation ──────────────────────────────────────
async function validateOrganization(req, res) {
  try {
    const { id } = req.params;
    const { action, notes } = req.body; // action: 'approve' | 'reject'
    const adminId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action invalide ("approve" ou "reject").' });
    }

    const nextStatut = action === 'approve' ? 'valide' : 'suspendu';

    // 1. Mettre à jour l'organisation
    const { data: org, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .update({
        statut: nextStatut,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*, profiles!owner_id(id, email, nom, prenom)')
      .single();

    if (orgErr || !org) {
      return res.status(404).json({ error: 'Organisation introuvable.' });
    }

    // 2. Mettre à jour la table tenants synchronisée
    await supabaseAdmin
      .from('tenants')
      .update({
        statut: action === 'approve' ? 'actif' : 'suspendu',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // 2b. Activer ou suspendre le compte gérant propriétaire dans profiles
    if (org.owner_id) {
      await supabaseAdmin
        .from('profiles')
        .update({
          statut_compte: action === 'approve' ? 'actif' : 'suspendu',
          updated_at: new Date().toISOString(),
        })
        .eq('id', org.owner_id);
    }

    // 3. Notifier le propriétaire par notification et email
    const owner = org.profiles;
    if (owner?.id) {
      const message = action === 'approve'
        ? `🎉 Félicitations ! Votre espace "${org.nom}" a été validé par le Super Admin et est maintenant visible sur la marketplace.`
        : `⚠️ Votre demande pour l'espace "${org.nom}" a été refusée. Motif : ${notes || 'Non renseigné'}.`;

      await supabaseAdmin.from('notifications').insert({
        user_id: owner.id,
        type: action === 'approve' ? 'organisation_approuvee' : 'organisation_refusee',
        canal: 'Dashboard',
        message,
      });

      if (owner.email) {
        try {
          await sendEmailUniversal({
            to: owner.email,
            subject: action === 'approve' ? `Validation de votre espace "${org.nom}"` : `Information concernant "${org.nom}"`,
            text: message,
          });
        } catch (_) {}
      }
    }

    // 4. Audit Log
    await auditLog(
      adminId,
      action === 'approve' ? 'organization_approved' : 'organization_rejected',
      'organization',
      org.id,
      org.nom,
      { notes, action },
      req.ip
    );

    res.json({
      success: true,
      organization: org,
      message: action === 'approve'
        ? `L'espace "${org.nom}" a été approuvé avec succès.`
        : `L'espace "${org.nom}" a été rejeté.`,
    });
  } catch (err) {
    console.error('❌ Erreur validateOrganization:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la validation de l\'organisation.' });
  }
}

// ── Valider ou refuser un profil formateur ────────────────────────────────────
async function validateTrainer(req, res) {
  try {
    const { id } = req.params; // trainer_profile id ou user_id
    const { action, notes } = req.body;
    const adminId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action invalide ("approve" ou "reject").' });
    }

    const nextStatut = action === 'approve' ? 'valide' : 'refuse';

    // 1. Mettre à jour trainer_profiles
    const { data: tp, error: tpErr } = await supabaseAdmin
      .from('trainer_profiles')
      .update({
        statut_validation: nextStatut,
        commentaires_admin: notes || null,
        updated_at: new Date().toISOString(),
      })
      .or(`id.eq.${id},user_id.eq.${id}`)
      .select('*, profiles!user_id(id, email, nom, prenom)')
      .single();

    if (tpErr || !tp) {
      return res.status(404).json({ error: 'Profil formateur introuvable.' });
    }

    // 2. Mettre à jour le rôle formateur dans profiles si approuvé
    if (action === 'approve') {
      await supabaseAdmin
        .from('profiles')
        .update({ role: 'formateur', updated_at: new Date().toISOString() })
        .eq('id', tp.user_id);
    }

    // 3. Notifier le formateur
    const trainerUser = tp.profiles;
    if (trainerUser?.id) {
      const message = action === 'approve'
        ? '🎓 Votre profil formateur a été validé avec succès ! Vous pouvez dès à présent créer et publier des formations sur la marketplace.'
        : `⚠️ Votre profil formateur n'a pas été validé. Motif : ${notes || 'Non renseigné'}.`;

      await supabaseAdmin.from('notifications').insert({
        user_id: trainerUser.id,
        type: action === 'approve' ? 'formateur_approuve' : 'formateur_refuse',
        canal: 'Dashboard',
        message,
      });

      if (trainerUser.email) {
        try {
          await sendEmailUniversal({
            to: trainerUser.email,
            subject: action === 'approve' ? 'Félicitations, votre profil formateur est validé !' : 'Mise à jour concernant votre profil formateur',
            text: message,
          });
        } catch (_) {}
      }
    }

    // 4. Audit Log
    await auditLog(
      adminId,
      action === 'approve' ? 'trainer_approved' : 'trainer_rejected',
      'trainer_profile',
      tp.id,
      trainerUser ? `${trainerUser.prenom} ${trainerUser.nom}` : tp.user_id,
      { notes, action },
      req.ip
    );

    res.json({
      success: true,
      trainerProfile: tp,
      message: action === 'approve'
        ? 'Profil formateur validé avec succès.'
        : 'Profil formateur refusé.',
    });
  } catch (err) {
    console.error('❌ Erreur validateTrainer:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la validation du formateur.' });
  }
}

// ── Valider ou refuser une demande de changement de pack (CDC v3.0 §4.5) ──────
async function validatePackUpgrade(req, res) {
  try {
    const { tenantId, requestId } = req.params;
    const { action, notes } = req.body; // 'approve' | 'reject'
    const adminId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action invalide ("approve" ou "reject").' });
    }

    const { data: tenant, error: tErr } = await supabaseAdmin
      .from('tenants')
      .select('*, profiles!owner_id(id, email, nom, prenom)')
      .eq('id', tenantId)
      .single();

    if (tErr || !tenant) {
      return res.status(404).json({ error: 'Établissement introuvable.' });
    }

    const curSettings = tenant.settings || {};
    const reqs = Array.isArray(curSettings.upgrade_requests) ? curSettings.upgrade_requests : [];
    const targetReqIdx = reqs.findIndex((r) => r.id === requestId);
    if (targetReqIdx === -1) {
      return res.status(404).json({ error: 'Demande de changement de pack introuvable.' });
    }

    const reqItem = reqs[targetReqIdx];
    const targetPackKey = String(reqItem.target_pack || 'standard').toLowerCase();
    const targetPack = SAAS_PACKS[targetPackKey] || SAAS_PACKS.standard;

    if (action === 'approve') {
      // CDC §4.5 : Montée immédiate ; descente en conservant les données existantes en lecture
      const nextSettings = {
        ...curSettings,
        saas_pack: targetPack.key,
        upgrade_requests: reqs.map((r, i) => i === targetReqIdx ? {
          ...r,
          statut: 'approuve',
          notes: notes || null,
          processed_at: new Date().toISOString(),
          processed_by: req.user.email || 'Super Admin',
        } : r),
      };

      await supabaseAdmin
        .from('tenants')
        .update({
          plan: targetPack.key,
          tier: targetPack.key === 'premium' ? 'A' : (targetPack.key === 'standard' ? 'B' : 'C'),
          montant_mensuel: targetPack.prix,
          limite_membres: targetPack.max_membres || 999999,
          limite_espaces: targetPack.max_espaces || 999999,
          settings: nextSettings,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenantId);

      // Sync organization settings
      try {
        await supabaseAdmin
          .from('organizations')
          .update({
            settings: {
              ...(tenant.settings || {}),
              saas_pack: targetPack.key,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);
      } catch (_) {}

      // Notification In-App + Email au gérant de l'établissement
      const owner = tenant.profiles;
      const notifMsg = `🎉 Votre demande de passage au Pack ${targetPack.name} (${Number(targetPack.prix).toFixed(3)} DT/mois HT) a été approuvée par le Super Admin ! Vos droits et limites sont immédiatement actifs.`;

      if (owner?.id) {
        await supabaseAdmin.from('notifications').insert({
          user_id: owner.id,
          type: 'pack_changement_approuve',
          canal: 'Dashboard',
          message: notifMsg,
        });

        if (owner.email) {
          try {
            await sendEmailUniversal({
              to: owner.email,
              subject: `Validation de votre Pack ${targetPack.name} — DeskyWork`,
              text: notifMsg,
            });
          } catch (_) {}
        }
      }

      await auditLog(adminId, 'pack_upgrade_approved', 'tenant', tenant.id, tenant.nom, { targetPack: targetPack.key, notes }, req.ip);

      return res.json({
        success: true,
        message: `Demande approuvée. L'établissement "${tenant.nom}" est désormais sur le Pack ${targetPack.name}.`,
      });
    } else {
      // Refus de la demande
      const nextSettings = {
        ...curSettings,
        upgrade_requests: reqs.map((r, i) => i === targetReqIdx ? {
          ...r,
          statut: 'refuse',
          notes: notes || 'Demande non validée par le Super Admin.',
          processed_at: new Date().toISOString(),
          processed_by: req.user.email || 'Super Admin',
        } : r),
      };

      await supabaseAdmin
        .from('tenants')
        .update({ settings: nextSettings, updated_at: new Date().toISOString() })
        .eq('id', tenantId);

      const owner = tenant.profiles;
      const notifMsg = `⚠️ Votre demande de passage au Pack ${targetPack.name} n'a pas été retenue. Motif : ${notes || 'Non renseigné'}.`;

      if (owner?.id) {
        await supabaseAdmin.from('notifications').insert({
          user_id: owner.id,
          type: 'pack_changement_refuse',
          canal: 'Dashboard',
          message: notifMsg,
        });

        if (owner.email) {
          try {
            await sendEmailUniversal({
              to: owner.email,
              subject: `Mise à jour de votre demande d'abonnement — DeskyWork`,
              text: notifMsg,
            });
          } catch (_) {}
        }
      }

      await auditLog(adminId, 'pack_upgrade_rejected', 'tenant', tenant.id, tenant.nom, { targetPack: targetPack.key, notes }, req.ip);

      return res.json({
        success: true,
        message: `Demande de changement de pack refusée pour l'établissement "${tenant.nom}".`,
      });
    }
  } catch (err) {
    console.error('❌ Erreur validatePackUpgrade:', err);
    res.status(500).json({ error: err.message || 'Erreur lors du traitement de la demande de pack.' });
  }
}

module.exports = {
  getPendingValidations,
  validateOrganization,
  validateTrainer,
  validatePackUpgrade,
};

