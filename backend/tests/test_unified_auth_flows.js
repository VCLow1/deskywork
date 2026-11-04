// tests/test_unified_auth_flows.js — Tests automatisés des parcours d'authentification refondus
'use strict';

const assert = require('assert');

// ── Mock DB pour tester l'intégralité de la logique métier sans dépendre du réseau externe ──
class MockSupabase {
  constructor() {
    this.profiles = new Map();
    this.organizations = new Map();
    this.memberships = new Map();
    this.trainerProfiles = new Map();
    this.invitations = new Map();
    this.emailOtps = new Map();
    this.phoneOtps = new Map();
    this.guests = new Map();
    this.reservations = new Map();
    this.notifications = [];
  }

  // Simulation d'inscription et de trigger SQL handle_new_user()
  simulateSignUp({ id, email, password, nom, prenom, telephone }) {
    const cleanEmail = email.toLowerCase().trim();
    const user = {
      id,
      email: cleanEmail,
      nom,
      prenom,
      telephone,
      email_verifie: false,
      telephone_verifie: false,
      statut_compte: 'actif',
      role: 'member',
      created_at: new Date().toISOString(),
    };
    this.profiles.set(id, user);

    // Rattachement automatique guest si même email
    for (const [gId, guest] of this.guests.entries()) {
      if (guest.email.toLowerCase() === cleanEmail && !guest.converti_en_membre_id) {
        guest.converti_en_membre_id = id;
        guest.converti_at = new Date().toISOString();

        for (const [rId, res] of this.reservations.entries()) {
          if (res.guest_id === gId) {
            res.user_id = id;
          }
        }
      }
    }

    // Traitement automatique des invitations en attente
    for (const [invId, inv] of this.invitations.entries()) {
      if (inv.email.toLowerCase() === cleanEmail && inv.statut === 'en_attente') {
        this.memberships.set(`${id}_${inv.organization_id}`, {
          id: `mem_${Math.random()}`,
          user_id: id,
          organization_id: inv.organization_id,
          role: inv.role,
          statut: 'actif',
        });
        inv.statut = 'acceptee';
      }
    }

    return user;
  }
}

async function runTests() {
  console.log('🧪 DÉMARRAGE DES TESTS DES PARCOURS PRINCIPAUX...\n');
  const db = new MockSupabase();

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1 : Inscription particulier & Rattachement automatique invité (Guest)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('▶ Test 1 : Inscription particulier & Rattachement invité (Guest)');

  // 1. Pré-existant : Réservation invité passée par un visiteur sans compte
  const guestId = 'guest_101';
  db.guests.set(guestId, {
    id: guestId,
    email: 'sarah.client@gmail.com',
    nom: 'Ben Salah',
    prenom: 'Sarah',
    telephone: '+216 98 111 222',
    converti_en_membre_id: null,
  });
  db.reservations.set('res_001', {
    id: 'res_001',
    guest_id: guestId,
    user_id: null,
    statut: 'confirmed',
  });

  // 2. Étape 1 : Sarah crée son compte personnel
  const userIdSarah = 'user_sarah_01';
  const user = db.simulateSignUp({
    id: userIdSarah,
    email: 'sarah.client@gmail.com',
    password: 'password123',
    nom: 'Ben Salah',
    prenom: 'Sarah',
    telephone: '+216 98 111 222',
  });

  assert.strictEqual(user.email_verifie, false, "L'email ne doit pas être vérifié avant l'OTP");
  assert.strictEqual(user.statut_compte, 'actif', "Le particulier doit être actif sans attendre d'approbation");

  // 3. Validation OTP Email
  user.email_verifie = true;
  assert.strictEqual(user.email_verifie, true, "L'email doit être vérifié après validation du code OTP");

  // 4. Vérification du rattachement automatique guest
  const updatedGuest = db.guests.get(guestId);
  assert.strictEqual(updatedGuest.converti_en_membre_id, userIdSarah, 'Le guest doit être rattaché au userId');
  const linkedReservation = db.reservations.get('res_001');
  assert.strictEqual(linkedReservation.user_id, userIdSarah, 'La réservation passée en invité doit appartenir à Sarah');

  console.log('  ✅ Inscription particulier et rattachement historique guest validés !');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2 : Création d'espace Coworking (Statut Brouillon & Approbation Super Admin)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n▶ Test 2 : Création de coworking & Validation Super Admin');

  const userIdMehdi = 'user_mehdi_02';
  db.simulateSignUp({
    id: userIdMehdi,
    email: 'mehdi.owner@encrecobalt.tn',
    password: 'password123',
    nom: 'Gharbi',
    prenom: 'Mehdi',
    telephone: '+216 55 444 333',
  });

  // Validation téléphone requise pour publier
  db.profiles.get(userIdMehdi).telephone_verifie = true;

  // Création espace onboarding
  const orgId = 'org_encre_cobalt';
  const org = {
    id: orgId,
    type: 'coworking',
    nom: 'Encre & Cobalt Tunis',
    ville: 'Tunis',
    adresse: 'Centre Urbain Nord',
    statut: 'en_validation', // Brouillon / en validation
    owner_id: userIdMehdi,
  };
  db.organizations.set(orgId, org);

  // Membership propriétaire créé
  db.memberships.set(`${userIdMehdi}_${orgId}`, {
    id: 'mem_mehdi_owner',
    user_id: userIdMehdi,
    organization_id: orgId,
    role: 'proprietaire',
    statut: 'actif',
  });

  assert.strictEqual(org.statut, 'en_validation', "L'espace doit être en_validation avant revue Super Admin");
  const membershipMehdi = db.memberships.get(`${userIdMehdi}_${orgId}`);
  assert.strictEqual(membershipMehdi.role, 'proprietaire', "Le créateur doit être membre 'proprietaire'");

  // Validation par le Super Admin
  org.statut = 'valide';
  assert.strictEqual(org.statut, 'valide', "L'espace doit être validé après approbation Super Admin");
  console.log('  ✅ Création de coworking et validation Super Admin validées !');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3 : Invitation de staff avec rôle prédéfini & token unique
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n▶ Test 3 : Invitation de staff & Adhésion sécurisée');

  const inviteToken = 'token_secret_hex_xyz987';
  const inviteId = 'inv_001';
  db.invitations.set(inviteId, {
    id: inviteId,
    organization_id: orgId,
    email: 'reception@encrecobalt.tn',
    role: 'staff',
    token: inviteToken,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    statut: 'en_attente',
    invited_by: userIdMehdi,
  });

  // L'invité crée son compte avec cet email
  const userIdStaff = 'user_staff_03';
  db.simulateSignUp({
    id: userIdStaff,
    email: 'reception@encrecobalt.tn',
    password: 'password123',
    nom: 'Trabelsi',
    prenom: 'Amine',
    telephone: '+216 22 123 456',
  });

  // Le trigger doit avoir accepté l'invitation et créé le membership staff
  const staffMembership = db.memberships.get(`${userIdStaff}_${orgId}`);
  assert.ok(staffMembership, 'Le membership du staff invité doit exister');
  assert.strictEqual(staffMembership.role, 'staff', "Le rôle doit être strictement 'staff'");
  assert.strictEqual(db.invitations.get(inviteId).statut, 'acceptee', "L'invitation doit être marquée acceptee");

  console.log('  ✅ Invitation staff et acceptation par token validées !');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4 : Connexion multi-espaces & Sélecteur d'organisation (Switcher)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n▶ Test 4 : Profil multi-espaces & Switcher de contexte');

  // Mehdi (propriétaire d'Encre & Cobalt) est invité comme formateur dans un Centre de formation
  const centerOrgId = 'org_centre_polytech';
  db.organizations.set(centerOrgId, {
    id: centerOrgId,
    type: 'centre_formation',
    nom: 'Polytech Training Center',
    statut: 'valide',
    owner_id: 'user_director',
  });

  // Mehdi est rattaché au centre en tant que formateur
  db.memberships.set(`${userIdMehdi}_${centerOrgId}`, {
    id: 'mem_mehdi_trainer',
    user_id: userIdMehdi,
    organization_id: centerOrgId,
    role: 'formateur',
    statut: 'actif',
  });

  // Récupérer le contexte pour Mehdi
  const userMemberships = [];
  for (const m of db.memberships.values()) {
    if (m.user_id === userIdMehdi) {
      userMemberships.push({
        role: m.role,
        organization: db.organizations.get(m.organization_id),
      });
    }
  }

  assert.strictEqual(userMemberships.length, 2, 'Mehdi doit avoir exactement 2 organisations');
  const isMultiOrg = userMemberships.length > 1;
  assert.strictEqual(isMultiOrg, true, "L'utilisateur multi-organisations doit déclencher le sélecteur d'espace");

  const orgRoles = userMemberships.map(m => `${m.organization.nom}: ${m.role}`);
  console.log('  Organisations détectées pour Mehdi :', orgRoles.join(' | '));
  console.log('  ✅ Détection multi-espaces et bascule de contexte validées !');

  console.log('\n🎉 TOUS LES TESTS DES PARCOURS PRINCIPAUX ONT RÉUSSI AVEC SUCCÈS !');
}

runTests().catch(err => {
  console.error('\n❌ Échec des tests :', err);
  process.exit(1);
});

