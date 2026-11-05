-- ═══════════════════════════════════════════════════════════════════════════
-- SCRIPT COMPLET — Description générale de la base de données
-- + Données prêtes pour diagramme de classes UML
--
-- Usage    : Supabase → SQL Editor → exécuter chaque bloc séparément
-- Projet   : DeskyWork — Plateforme SaaS Coworking Multi-Tenant
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 1 ── VUE D'ENSEMBLE : toutes les tables
--           avec statut RLS, nb colonnes, nb relations
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  t.table_name                                        AS "Table",
  CASE WHEN c.relrowsecurity THEN '🔒 Protégée (RLS ON)'
       ELSE '🌐 Publique (RLS OFF)' END               AS "Statut sécurité",
  (
    SELECT COUNT(*) FROM information_schema.columns col
    WHERE col.table_schema = 'public' AND col.table_name = t.table_name
  )::INT                                              AS "Nb colonnes",
  COALESCE((
    SELECT COUNT(*) FROM information_schema.table_constraints tc2
    JOIN information_schema.key_column_usage kcu2
      ON tc2.constraint_name = kcu2.constraint_name
     AND tc2.table_schema    = kcu2.table_schema
    WHERE tc2.constraint_type = 'FOREIGN KEY'
      AND tc2.table_schema    = 'public'
      AND kcu2.table_name     = t.table_name
  ), 0)::INT                                          AS "FK sortantes",
  COALESCE((
    SELECT COUNT(*) FROM information_schema.table_constraints tc3
    JOIN information_schema.referential_constraints rc3
      ON tc3.constraint_name = rc3.constraint_name
    JOIN information_schema.constraint_column_usage ccu3
      ON rc3.unique_constraint_name = ccu3.constraint_name
    WHERE tc3.constraint_type = 'FOREIGN KEY'
      AND tc3.table_schema    = 'public'
      AND ccu3.table_name     = t.table_name
  ), 0)::INT                                          AS "FK entrantes",
  c.reltuples::BIGINT                                 AS "Nb lignes (estimé)"
FROM information_schema.tables t
JOIN pg_class     c ON c.relname   = t.table_name
JOIN pg_namespace n ON n.oid       = c.relnamespace AND n.nspname = 'public'
WHERE t.table_schema = 'public'
  AND t.table_type   = 'BASE TABLE'
ORDER BY t.table_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 2 ── ENTITÉS COMPLÈTES : chaque colonne avec son rôle exact
--           PK · FK · UNIQUE · type · nullable · défaut
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  c.table_name                                        AS "Table",
  c.ordinal_position                                  AS "#",
  c.column_name                                       AS "Colonne",

  -- Type complet avec précision si numéric/varchar
  CASE
    WHEN c.data_type = 'numeric'   THEN 'NUMERIC(' || c.numeric_precision || ',' || c.numeric_scale || ')'
    WHEN c.data_type = 'character varying' THEN 'VARCHAR(' || COALESCE(c.character_maximum_length::TEXT,'∞') || ')'
    WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
    ELSE UPPER(c.udt_name)
  END                                                 AS "Type",

  -- Rôle de la colonne
  CASE
    WHEN pk.column_name IS NOT NULL AND fk.column_name IS NOT NULL THEN '🔑 PK + FK'
    WHEN pk.column_name IS NOT NULL THEN '🔑 PK'
    WHEN fk.column_name IS NOT NULL THEN '🔗 FK'
    WHEN uq.column_name IS NOT NULL THEN '◈ UNIQUE'
    ELSE '·'
  END                                                 AS "Rôle",

  CASE WHEN c.is_nullable = 'NO' THEN 'NON NULL' ELSE 'NULL ok' END AS "Nullable",

  CASE
    WHEN c.column_default IS NULL THEN '—'
    WHEN c.column_default LIKE 'gen_random_uuid%' THEN 'uuid auto'
    WHEN c.column_default LIKE 'now()%' THEN 'NOW()'
    WHEN c.column_default LIKE 'true'   THEN 'true'
    WHEN c.column_default LIKE 'false'  THEN 'false'
    ELSE LEFT(c.column_default, 30)
  END                                                 AS "Défaut"

FROM information_schema.columns c

LEFT JOIN (                                           -- PK
  SELECT ku.table_name, ku.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage  ku
    ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name

LEFT JOIN (                                           -- FK
  SELECT DISTINCT kcu.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage  kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
) fk ON fk.table_name = c.table_name AND fk.column_name = c.column_name

LEFT JOIN (                                           -- UNIQUE
  SELECT DISTINCT kcu.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage  kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
) uq ON uq.table_name = c.table_name AND uq.column_name = c.column_name

WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 3 ── TOUTES LES RELATIONS FK
--           table source → table cible · cardinalité · ON DELETE
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  kcu.table_name                                      AS "Table source",
  kcu.column_name                                     AS "Colonne FK",
  ccu.table_name                                      AS "Table cible",
  ccu.column_name                                     AS "Colonne cible",

  -- Cardinalité estimée
  CASE
    WHEN pk_src.column_name IS NOT NULL THEN '1'
    ELSE 'N'
  END || ' ──► ' ||
  CASE
    WHEN pk_tgt.column_name IS NOT NULL
      OR uq_tgt.column_name IS NOT NULL THEN '1'
    ELSE 'N'
  END                                                 AS "Cardinalité",

  rc.delete_rule                                      AS "ON DELETE",
  rc.update_rule                                      AS "ON UPDATE",
  tc.constraint_name                                  AS "Contrainte"

FROM information_schema.table_constraints        tc
JOIN information_schema.key_column_usage         kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints  rc
  ON tc.constraint_name = rc.constraint_name    AND tc.table_schema = rc.constraint_schema
JOIN information_schema.constraint_column_usage  ccu
  ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.table_schema

LEFT JOIN (   -- colonne source = PK ?
  SELECT ku.table_name, ku.column_name
  FROM information_schema.table_constraints tc2
  JOIN information_schema.key_column_usage  ku
    ON tc2.constraint_name = ku.constraint_name AND tc2.table_schema = ku.table_schema
  WHERE tc2.constraint_type = 'PRIMARY KEY' AND tc2.table_schema = 'public'
) pk_src ON pk_src.table_name = kcu.table_name AND pk_src.column_name = kcu.column_name

LEFT JOIN (   -- colonne cible = PK ?
  SELECT ku.table_name, ku.column_name
  FROM information_schema.table_constraints tc3
  JOIN information_schema.key_column_usage  ku
    ON tc3.constraint_name = ku.constraint_name AND tc3.table_schema = ku.table_schema
  WHERE tc3.constraint_type = 'PRIMARY KEY' AND tc3.table_schema = 'public'
) pk_tgt ON pk_tgt.table_name = ccu.table_name AND pk_tgt.column_name = ccu.column_name

LEFT JOIN (   -- colonne cible = UNIQUE ?
  SELECT ku.table_name, ku.column_name
  FROM information_schema.table_constraints tc4
  JOIN information_schema.key_column_usage  ku
    ON tc4.constraint_name = ku.constraint_name AND tc4.table_schema = ku.table_schema
  WHERE tc4.constraint_type = 'UNIQUE' AND tc4.table_schema = 'public'
) uq_tgt ON uq_tgt.table_name = ccu.table_name AND uq_tgt.column_name = ccu.column_name

WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY kcu.table_name, kcu.column_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 4 ── POLITIQUES RLS par table
--           qui peut lire / écrire et sous quelle condition
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  p.tablename                                         AS "Table",
  p.policyname                                        AS "Politique",
  CASE p.cmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL (CRUD)'
    ELSE p.cmd
  END                                                 AS "Opération",
  CASE WHEN p.permissive = 'PERMISSIVE'
       THEN '✅ Permissive' ELSE '🚫 Restrictive' END AS "Mode",
  p.roles                                             AS "Rôles",
  LEFT(COALESCE(p.qual, '—'), 120)                    AS "Condition USING",
  LEFT(COALESCE(p.with_check, '—'), 120)              AS "WITH CHECK"
FROM pg_policies p
WHERE p.schemaname = 'public'
ORDER BY p.tablename, p.policyname;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 5 ── CONTRAINTES CHECK et VALEURS AUTORISÉES par colonne
--           (statuts, types, modes…)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  tc.table_name                                       AS "Table",
  tc.constraint_name                                  AS "Contrainte",
  LEFT(cc.check_clause, 200)                          AS "Valeurs / règle"
FROM information_schema.table_constraints    tc
JOIN information_schema.check_constraints    cc
  ON cc.constraint_name   = tc.constraint_name
 AND cc.constraint_schema = tc.table_schema
WHERE tc.table_schema    = 'public'
  AND tc.constraint_type = 'CHECK'
  AND cc.check_clause NOT LIKE '%IS NOT NULL%'
ORDER BY tc.table_name, tc.constraint_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 6 ── TRIGGERS actifs sur chaque table
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  trg.event_object_table                              AS "Table",
  trg.trigger_name                                    AS "Trigger",
  trg.event_manipulation                              AS "Événement",
  trg.action_timing                                   AS "Moment (BEFORE/AFTER)",
  trg.action_orientation                              AS "Niveau (ROW/STMT)",
  LEFT(trg.action_statement, 80)                      AS "Fonction appelée"
FROM information_schema.triggers trg
WHERE trg.trigger_schema = 'public'
ORDER BY trg.event_object_table, trg.trigger_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 7 ── INDEX par table (performance et unicité)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  i.tablename                                         AS "Table",
  i.indexname                                         AS "Index",
  CASE WHEN ix.indisunique THEN '◈ UNIQUE' ELSE '·' END AS "Unique",
  CASE WHEN ix.indisprimary THEN '🔑 PK'   ELSE '·' END AS "PK",
  i.indexdef                                          AS "Définition"
FROM pg_indexes i
JOIN pg_class   c  ON c.relname = i.indexname
JOIN pg_index   ix ON ix.indexrelid = c.oid
WHERE i.schemaname = 'public'
ORDER BY i.tablename, i.indexname;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 8 ── FONCTIONS et PROCÉDURES stockées
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  r.routine_name                                      AS "Fonction",
  r.routine_type                                      AS "Type",
  r.data_type                                         AS "Retourne",
  r.security_type                                     AS "Sécurité (DEFINER/INVOKER)",
  r.is_deterministic                                  AS "Déterministe"
FROM information_schema.routines r
WHERE r.routine_schema = 'public'
ORDER BY r.routine_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 9 ── FORMAT DIAGRAMME UML (dbdiagram.io / draw.io)
--           Prêt à copier-coller : une ligne = une flèche
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  '  ' || kcu.table_name
    || ' ──[' ||
    CASE WHEN pk_s.column_name IS NOT NULL THEN '1' ELSE 'N' END
    || ']──► ['
    || CASE WHEN pk_t.column_name IS NOT NULL OR uq_t.column_name IS NOT NULL THEN '1' ELSE 'N' END
    || '] '
    || ccu.table_name
    || '   via: ' || kcu.column_name || ' → ' || ccu.column_name
    || '   (' || rc.delete_rule || ')'               AS "── Relation UML ──"

FROM information_schema.table_constraints        tc
JOIN information_schema.key_column_usage         kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints  rc
  ON tc.constraint_name = rc.constraint_name    AND tc.table_schema = rc.constraint_schema
JOIN information_schema.constraint_column_usage  ccu
  ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.table_schema

LEFT JOIN (
  SELECT ku.table_name, ku.column_name FROM information_schema.table_constraints tc2
  JOIN information_schema.key_column_usage ku
    ON tc2.constraint_name = ku.constraint_name AND tc2.table_schema = ku.table_schema
  WHERE tc2.constraint_type = 'PRIMARY KEY' AND tc2.table_schema = 'public'
) pk_s ON pk_s.table_name = kcu.table_name AND pk_s.column_name = kcu.column_name

LEFT JOIN (
  SELECT ku.table_name, ku.column_name FROM information_schema.table_constraints tc3
  JOIN information_schema.key_column_usage ku
    ON tc3.constraint_name = ku.constraint_name AND tc3.table_schema = ku.table_schema
  WHERE tc3.constraint_type = 'PRIMARY KEY' AND tc3.table_schema = 'public'
) pk_t ON pk_t.table_name = ccu.table_name AND pk_t.column_name = ccu.column_name

LEFT JOIN (
  SELECT ku.table_name, ku.column_name FROM information_schema.table_constraints tc4
  JOIN information_schema.key_column_usage ku
    ON tc4.constraint_name = ku.constraint_name AND tc4.table_schema = ku.table_schema
  WHERE tc4.constraint_type = 'UNIQUE' AND tc4.table_schema = 'public'
) uq_t ON uq_t.table_name = ccu.table_name AND uq_t.column_name = ccu.column_name

WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY kcu.table_name, kcu.column_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- BLOC 10 ── DESCRIPTION NARRATIVE COMPLÈTE (catalogue de la base)
--            Toutes les tables avec rôle métier, module et accès
-- ═══════════════════════════════════════════════════════════════════════════
SELECT *
FROM (VALUES

  -- ── COEUR MULTI-TENANT ────────────────────────────────────────────────
  ('tenants',
   'SaaS / Multi-Tenant',
   'Coworking Spaces gérés par le Super Admin. Chaque tenant est un espace de coworking indépendant avec son plan, ses limites et ses paramètres.',
   'Super Admin (CRUD) · Admin (lecture)',
   '🔒 RLS ON',
   'tenant_id est la clé de voûte de toute l''isolation des données'),

  -- ── UTILISATEURS ─────────────────────────────────────────────────────
  ('profiles',
   'Module A — Utilisateurs',
   'Extension de auth.users (Supabase). Stocke les données métier de chaque utilisateur : rôle, type de membre, statut du compte, préférences de notification, QR token.',
   'Tous (lecture) · Propriétaire (mise à jour) · Admin (gestion)',
   '🔒 RLS ON',
   'Rôles possibles : super_admin · admin · staff · formateur · member · guest'),

  -- ── ESPACES ───────────────────────────────────────────────────────────
  ('espaces',
   'Module B — Réservations',
   'Espaces physiques du coworking : open space, bureau privé, salle de réunion, salle de formation, espace événementiel. Chaque espace a un tarif horaire et une capacité.',
   'Tous (lecture) · Admin (gestion)',
   '🔒 RLS ON',
   'Types : open_space · private_office · meeting_room · training_room · event_space'),

  -- ── RÉSERVATIONS ─────────────────────────────────────────────────────
  ('reservations',
   'Module B — Réservations',
   'Réservations de créneaux sur les espaces. Gère les conflits de créneaux (trigger check_reservation_overlap). Liée aux paiements et aux sessions de check-in.',
   'Membre (ses propres) · Admin/Staff (toutes du tenant)',
   '🔒 RLS ON',
   'Statuts : pending → confirmed / cancelled / completed / no_show'),

  -- ── SESSIONS ─────────────────────────────────────────────────────────
  ('sessions',
   'Module B — Check-in temps réel',
   'Sessions de présence physique dans l''espace. Démarre au check-in QR Code, se termine au check-out ou automatiquement. Gère le timer et les alertes de dépassement.',
   'Membre (ses sessions) · Admin/Staff (toutes)',
   '🔒 RLS ON',
   'Statuts : scheduled · active · completed · overtime · no_show'),

  -- ── ABONNEMENTS ──────────────────────────────────────────────────────
  ('abonnements',
   'Module A — Abonnements',
   'Forfaits souscrits par les membres. Détermine les droits de réservation et le plan tarifaire applicable. Supporte le renouvellement automatique et le multi-sites.',
   'Membre (ses abonnements) · Admin/Staff (tous du tenant)',
   '🔒 RLS ON',
   'Types : day_pass · week_pass · mensuel · trimestriel · annuel · bureau_prive'),

  -- ── PAIEMENTS ────────────────────────────────────────────────────────
  ('paiements',
   'Module C — Paiements',
   'Transactions financières liées aux réservations et abonnements. Supporte les paiements en ligne (Stripe), espèces, virement et chèque. Génère des reçus PDF numérotés.',
   'Membre (ses paiements) · Admin/Staff (tous du tenant)',
   '🔒 RLS ON',
   'Modes : cash · bank_transfer · check · online | Statuts : pending · paid · failed · refunded'),

  -- ── TARIFS ───────────────────────────────────────────────────────────
  ('tarifs_abonnements',
   'Module A — Tarification',
   'Grille tarifaire configurable par l''admin. Prix différenciés par type d''abonnement et plan (standard / étudiant / entreprise). Peut être restreint à un type d''espace.',
   'Tous (lecture tarifs actifs) · Admin/Staff (gestion)',
   '🔒 RLS ON',
   'Plan tarifaire : standard · etudiant · entreprise'),

  -- ── CODES PROMO ──────────────────────────────────────────────────────
  ('codes_promo',
   'Module A — Tarification',
   'Codes de réduction applicables à l''abonnement (pourcentage ou montant fixe). Avec date d''expiration et compteur d''utilisations.',
   'Tous (lecture codes actifs) · Admin/Staff (gestion)',
   '🔒 RLS ON',
   'Type de réduction : percent · fixed'),

  -- ── HISTORIQUE TARIFS ─────────────────────────────────────────────────
  ('historique_tarifs',
   'Module A — Tarification',
   'Trace chaque abonnement souscrit avec le prix initial, le prix final et le code promo utilisé. Sert d''audit tarifaire.',
   'Membre (son historique) · Admin/Staff (tout)',
   '🔒 RLS ON',
   'Relation vers : profiles · abonnements · codes_promo'),

  -- ── NOTIFICATIONS ─────────────────────────────────────────────────────
  ('notifications',
   'Module F — Notifications',
   'Centre de notifications en temps réel (Supabase Realtime activé). Chaque notification a un canal (Email · SMS · Dashboard) et un statut lu/non lu.',
   'Membre (ses notifications) · Admin/Staff (toutes)',
   '🔒 RLS ON',
   'Canaux : Email · SMS · Dashboard | Realtime : REPLICA IDENTITY FULL'),

  -- ── FORMATIONS ────────────────────────────────────────────────────────
  ('formations',
   'Module G — Formations',
   'Formations et workshops créés par les formateurs. Liées à un espace (salle), avec capacité max, prix d''inscription, programme et prérequis.',
   'Tous (lecture) · Formateur (ses formations) · Admin (gestion)',
   '🔒 RLS ON',
   'Statuts : planifiee · en_cours · terminee · annulee'),

  -- ── INSCRIPTIONS FORMATIONS ───────────────────────────────────────────
  ('inscriptions_formations',
   'Module G — Formations',
   'Table de liaison membre ↔ formation. Gère le statut de l''inscription, le paiement et la présence (émargement).',
   'Membre (ses inscriptions) · Formateur + Admin (toutes)',
   '🔒 RLS ON',
   'Statuts inscription : confirmee · en_attente · annulee | Statuts paiement : gratuit · en_attente · paye · rembourse'),

  -- ── RÉMUNÉRATIONS ─────────────────────────────────────────────────────
  ('remuneration_formateurs',
   'Module G — Formations',
   'Suivi des rémunérations dues aux formateurs par formation. Géré par l''admin.',
   'Formateur (ses rémunérations) · Admin (gestion)',
   '🔒 RLS ON',
   'Statuts : en_attente · paye'),

  -- ── MESSAGERIE ────────────────────────────────────────────────────────
  ('conversations',
   'Module E — Messagerie',
   'Fils de discussion entre membres/formateurs et l''équipe du coworking. Types : support · group · direct.',
   'Membre (ses conversations) · Admin/Staff (toutes)',
   '🔒 RLS ON',
   'Types : support · group · direct'),

  ('messages',
   'Module E — Messagerie',
   'Messages individuels dans une conversation. Envoyés en temps réel via Socket.io.',
   'Membres de la conversation · Admin/Staff',
   '🔒 RLS ON',
   'Temps réel via Socket.io côté backend'),

  ('conversation_members',
   'Module E — Messagerie',
   'Table de liaison utilisateur ↔ conversation. Stocke la date de dernière lecture pour le compteur de messages non lus.',
   'Membre (ses participations) · Admin/Staff',
   '🔒 RLS ON',
   'Contrainte UNIQUE (conversation_id, user_id)'),

  -- ── POLITIQUE ANNULATION ──────────────────────────────────────────────
  ('politique_annulation',
   'Module J — Annulation',
   'Règle d''annulation globale du tenant (singleton par tenant). Délai minimum, pénalité, remboursement automatique.',
   'Authentifiés (lecture) · Admin/Staff (gestion)',
   '🔒 RLS ON',
   'Singleton : une seule règle globale par tenant'),

  ('politique_annulation_espaces',
   'Module J — Annulation',
   'Règles d''annulation spécifiques par type d''espace : tranches horaires, pénalités graduées, crédit portefeuille.',
   'Tous (lecture) · Admin (gestion)',
   '🔒 RLS ON',
   'Contrainte UNIQUE (tenant_id, type_espace)'),

  ('credits_membres',
   'Module J — Annulation',
   'Crédits portefeuille générés lors d''annulations remboursées sous forme de crédit. Utilisables pour de futures réservations.',
   'Membre (ses crédits) · Admin/Staff',
   '🔒 RLS ON',
   'Peut avoir une date d''expiration'),

  -- ── GUESTS ────────────────────────────────────────────────────────────
  ('guests',
   'Module H — Invités',
   'Visiteurs occasionnels sans compte Supabase. Peuvent réserver via un lien public (token). Convertibles en membres.',
   'Admin/Staff (lecture) · Public (création)',
   '🔒 RLS ON',
   'Token unique pour liens d''annulation/confirmation sans authentification'),

  -- ── DOCUMENTS ─────────────────────────────────────────────────────────
  ('documents_membres',
   'Module K — Documents',
   'Documents des membres : justificatifs, contrats, règlement intérieur signé. Supporte la signature électronique avec IP et timestamp.',
   'Membre (ses documents) · Admin/Staff',
   '🔒 RLS ON',
   'Types : reglement_interieur · politique_confidentialite · contrat_abonnement · cin_passeport · justificatif_etudiant · convention_formateur · autre'),

  ('contenu_documents',
   'Module K — Documents',
   'Contenu HTML des documents types (règlement intérieur, politique de confidentialité) par tenant. Versionnés.',
   'Tous (lecture) · Admin (gestion)',
   '🔒 RLS ON',
   'Versionné avec flag actif · Contrainte UNIQUE (tenant_id, type_doc, actif)'),

  -- ── RGPD ──────────────────────────────────────────────────────────────
  ('rgpd_demandes',
   'Module L — RGPD',
   'Demandes RGPD des membres : export des données, suppression, rectification, opposition marketing, portabilité.',
   'Membre (ses demandes) · Admin (traitement)',
   '🔒 RLS ON',
   'Types : export · suppression · rectification · opposition_marketing · portabilite | Statuts : en_attente · en_cours · traite · refuse'),

  -- ── MULTI-SITES ───────────────────────────────────────────────────────
  ('sites',
   'Module N — Multi-sites',
   'Sites/antennes d''un même coworking (tenant). Permet à un espace de coworking d''avoir plusieurs adresses physiques.',
   'Authentifiés (lecture) · Admin (gestion)',
   '🔒 RLS ON',
   'Un tenant peut avoir plusieurs sites'),

  ('membres_sites',
   'Module N — Multi-sites',
   'Accès multi-sites d''un membre : quels sites ce membre peut utiliser avec son abonnement.',
   'Membre (ses accès) · Admin/Staff',
   '🔒 RLS ON',
   'Contrainte UNIQUE (user_id, site_id)'),

  -- ── SUPER ADMIN ───────────────────────────────────────────────────────
  ('super_admin_audit_log',
   'Module SA — Super Admin',
   'Journal d''audit de toutes les actions du Super Admin sur la plateforme : création/modification/suppression de tenants et utilisateurs.',
   'Super Admin uniquement',
   '🔒 RLS ON',
   'Traçabilité complète : qui · quoi · quand · depuis quelle IP · statut'),

  -- ── OTP ───────────────────────────────────────────────────────────────
  ('email_otp',
   'Authentification',
   'Codes OTP 6 chiffres envoyés par email lors de l''inscription. Expiration 10 minutes, usage unique.',
   'Backend service_role uniquement',
   '🔒 RLS ON',
   'Champ used = true après vérification · expires_at pour expiration automatique'),

  -- ── CONTACTS ──────────────────────────────────────────────────────────
  ('contacts',
   'Landing Page',
   'Demandes de contact envoyées depuis le formulaire public de la landing page. Accessibles uniquement aux Super Admins.',
   'Public (création) · Super Admin (lecture/gestion)',
   '🔒 RLS ON',
   'Statuts : nouveau · lu · traite | SELECT/UPDATE/DELETE révoqués pour anon et authenticated')

) AS data(
  "Table",
  "Module / Domaine",
  "Description",
  "Accès (résumé)",
  "Statut RLS",
  "Notes importantes"
)
ORDER BY "Module / Domaine", "Table";
