-- ============================================================
-- SCRIPT : Description complète de toutes les tables
--          colonnes · types · contraintes · relations FK
--          entités · statut RLS · politiques de sécurité
-- Usage   : Supabase → SQL Editor → Run (une requête à la fois)
-- But     : Générer les données pour un diagramme de classes
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. LISTE DES TABLES + statut RLS (public / protégée)
-- ════════════════════════════════════════════════════════════
SELECT
  t.table_name                                        AS "Table",
  CASE WHEN c.relrowsecurity THEN 'RLS ACTIVÉ'
       ELSE 'RLS DÉSACTIVÉ'  END                     AS "Statut RLS",
  CASE WHEN c.relrowsecurity THEN 'Protégée (privée)'
       ELSE 'Publique (pas de RLS)' END               AS "Accès",
  obj_description(c.oid, 'pg_class')                 AS "Description",
  c.reltuples::bigint                                 AS "Nb lignes estimé"
FROM information_schema.tables t
JOIN pg_class c
  ON c.relname   = t.table_name
JOIN pg_namespace n
  ON n.oid       = c.relnamespace
 AND n.nspname   = 'public'
WHERE t.table_schema = 'public'
  AND t.table_type   = 'BASE TABLE'
ORDER BY t.table_name;


-- ════════════════════════════════════════════════════════════
-- 2. ENTITÉS : toutes les colonnes avec leur rôle
--    (PK · FK · UNIQUE · type · nullable · défaut)
-- ════════════════════════════════════════════════════════════
SELECT
  c.table_name                                        AS "Table",
  c.ordinal_position                                  AS "#",
  c.column_name                                       AS "Colonne",
  c.udt_name                                          AS "Type SQL",
  CASE
    WHEN pk.column_name  IS NOT NULL AND fk.column_name IS NOT NULL
         THEN 'PK + FK'
    WHEN pk.column_name  IS NOT NULL THEN 'PK'
    WHEN fk.column_name  IS NOT NULL THEN 'FK'
    WHEN uq.column_name  IS NOT NULL THEN 'UNIQUE'
    ELSE ''
  END                                                 AS "Rôle",
  CASE WHEN c.is_nullable = 'NO' THEN '✗' ELSE '✓' END AS "Nullable",
  c.column_default                                    AS "Valeur par défaut"
FROM information_schema.columns c

-- Clés primaires
LEFT JOIN (
  SELECT ku.table_name, ku.column_name
  FROM information_schema.table_constraints   tc
  JOIN information_schema.key_column_usage    ku
    ON tc.constraint_name = ku.constraint_name
   AND tc.table_schema    = ku.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema    = 'public'
) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name

-- Clés étrangères
LEFT JOIN (
  SELECT DISTINCT kcu.table_name, kcu.column_name
  FROM information_schema.table_constraints   tc
  JOIN information_schema.key_column_usage    kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema    = 'public'
) fk ON fk.table_name = c.table_name AND fk.column_name = c.column_name

-- Contraintes UNIQUE
LEFT JOIN (
  SELECT DISTINCT kcu.table_name, kcu.column_name
  FROM information_schema.table_constraints   tc
  JOIN information_schema.key_column_usage    kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  WHERE tc.constraint_type = 'UNIQUE'
    AND tc.table_schema    = 'public'
) uq ON uq.table_name = c.table_name AND uq.column_name = c.column_name

WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;


-- ════════════════════════════════════════════════════════════
-- 3. RELATIONS FK complètes
--    (table source → table cible + cardinalité estimée)
-- ════════════════════════════════════════════════════════════
SELECT
  kcu.table_name                                      AS "Table source",
  kcu.column_name                                     AS "Colonne FK",
  ccu.table_name                                      AS "Table cible",
  ccu.column_name                                     AS "Colonne cible",
  rc.delete_rule                                      AS "ON DELETE",
  rc.update_rule                                      AS "ON UPDATE",
  tc.constraint_name                                  AS "Nom contrainte",
  CASE
    WHEN pk_src.column_name IS NOT NULL THEN '1'
    ELSE 'N'
  END || ' → ' ||
  CASE
    WHEN uq_tgt.column_name IS NOT NULL
      OR pk_tgt.column_name IS NOT NULL THEN '1'
    ELSE 'N'
  END                                                 AS "Cardinalité"
FROM information_schema.table_constraints        tc
JOIN information_schema.key_column_usage         kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema    = kcu.table_schema
JOIN information_schema.referential_constraints  rc
  ON tc.constraint_name    = rc.constraint_name
 AND tc.table_schema       = rc.constraint_schema
JOIN information_schema.constraint_column_usage  ccu
  ON rc.unique_constraint_name   = ccu.constraint_name
 AND rc.unique_constraint_schema = ccu.table_schema

-- Est-ce que la colonne source est aussi PK ?
LEFT JOIN (
  SELECT ku.table_name, ku.column_name
  FROM information_schema.table_constraints tc2
  JOIN information_schema.key_column_usage  ku
    ON tc2.constraint_name = ku.constraint_name
   AND tc2.table_schema    = ku.table_schema
  WHERE tc2.constraint_type = 'PRIMARY KEY'
    AND tc2.table_schema    = 'public'
) pk_src ON pk_src.table_name = kcu.table_name
         AND pk_src.column_name = kcu.column_name

-- Est-ce que la colonne cible est PK ?
LEFT JOIN (
  SELECT ku.table_name, ku.column_name
  FROM information_schema.table_constraints tc3
  JOIN information_schema.key_column_usage  ku
    ON tc3.constraint_name = ku.constraint_name
   AND tc3.table_schema    = ku.table_schema
  WHERE tc3.constraint_type = 'PRIMARY KEY'
    AND tc3.table_schema    = 'public'
) pk_tgt ON pk_tgt.table_name = ccu.table_name
         AND pk_tgt.column_name = ccu.column_name

-- Est-ce que la colonne cible est UNIQUE ?
LEFT JOIN (
  SELECT ku.table_name, ku.column_name
  FROM information_schema.table_constraints tc4
  JOIN information_schema.key_column_usage  ku
    ON tc4.constraint_name = ku.constraint_name
   AND tc4.table_schema    = ku.table_schema
  WHERE tc4.constraint_type = 'UNIQUE'
    AND tc4.table_schema    = 'public'
) uq_tgt ON uq_tgt.table_name = ccu.table_name
         AND uq_tgt.column_name = ccu.column_name

WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema    = 'public'
ORDER BY kcu.table_name, kcu.column_name;


-- ════════════════════════════════════════════════════════════
-- 4. POLITIQUES RLS : qui peut lire / écrire sur chaque table
-- ════════════════════════════════════════════════════════════
SELECT
  schemaname                                          AS "Schéma",
  tablename                                           AS "Table",
  policyname                                          AS "Politique",
  CASE cmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'w' THEN 'INSERT/UPDATE/DELETE'
    WHEN 'a' THEN 'INSERT'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
    ELSE cmd
  END                                                 AS "Opération",
  CASE WHEN permissive = 'PERMISSIVE' THEN '✓ Permissive'
       ELSE '✗ Restrictive' END                      AS "Mode",
  roles                                               AS "Rôles autorisés",
  qual                                                AS "Condition USING (lecture)",
  with_check                                          AS "Condition WITH CHECK (écriture)"
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;


-- ════════════════════════════════════════════════════════════
-- 5. TRIGGERS actifs sur chaque table
-- ════════════════════════════════════════════════════════════
SELECT
  event_object_table                                  AS "Table",
  trigger_name                                        AS "Trigger",
  event_manipulation                                  AS "Événement",
  action_timing                                       AS "Moment",
  action_statement                                    AS "Action"
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;


-- ════════════════════════════════════════════════════════════
-- 6. RÉSUMÉ COMPLET PAR TABLE
--    (colonnes · FK sortantes · FK entrantes · RLS · triggers)
-- ════════════════════════════════════════════════════════════
SELECT
  cols.table_name                                     AS "Table",
  cols.nb_colonnes                                    AS "Colonnes",
  COALESCE(fk_out.nb,   0)                            AS "FK sortantes",
  COALESCE(fk_in.nb,    0)                            AS "FK entrantes",
  COALESCE(trg.nb,      0)                            AS "Triggers",
  COALESCE(idx.nb,      0)                            AS "Index",
  CASE WHEN rls.relrowsecurity THEN '🔒 Protégée'
       ELSE '🌐 Publique' END                         AS "Statut",
  COALESCE(pol.nb_policies, 0)                        AS "Nb politiques RLS"
FROM (
  SELECT table_name, COUNT(*) AS nb_colonnes
  FROM information_schema.columns
  WHERE table_schema = 'public'
  GROUP BY table_name
) cols

-- RLS actif ?
LEFT JOIN (
  SELECT c.relname AS table_name, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
) rls ON rls.table_name = cols.table_name

-- FK sortantes
LEFT JOIN (
  SELECT kcu.table_name, COUNT(*) AS nb
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage  kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema    = 'public'
  GROUP BY kcu.table_name
) fk_out ON fk_out.table_name = cols.table_name

-- FK entrantes
LEFT JOIN (
  SELECT ccu.table_name, COUNT(*) AS nb
  FROM information_schema.table_constraints        tc
  JOIN information_schema.referential_constraints  rc
    ON tc.constraint_name = rc.constraint_name
  JOIN information_schema.constraint_column_usage  ccu
    ON rc.unique_constraint_name = ccu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema    = 'public'
  GROUP BY ccu.table_name
) fk_in ON fk_in.table_name = cols.table_name

-- Triggers
LEFT JOIN (
  SELECT event_object_table AS table_name, COUNT(*) AS nb
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
  GROUP BY event_object_table
) trg ON trg.table_name = cols.table_name

-- Index
LEFT JOIN (
  SELECT tablename AS table_name, COUNT(*) AS nb
  FROM pg_indexes
  WHERE schemaname = 'public'
  GROUP BY tablename
) idx ON idx.table_name = cols.table_name

-- Politiques RLS
LEFT JOIN (
  SELECT tablename AS table_name, COUNT(*) AS nb_policies
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) pol ON pol.table_name = cols.table_name

ORDER BY cols.table_name;


-- ════════════════════════════════════════════════════════════
-- 7. FORMAT PRÊT POUR DIAGRAMME (dbdiagram.io / draw.io)
--    Une ligne par relation : "Source.col --> Cible.col [cardinalité]"
-- ════════════════════════════════════════════════════════════
SELECT
  kcu.table_name  || '.' || kcu.column_name
    || '  ──►  '
    || ccu.table_name || '.' || ccu.column_name
    || '   [' || rc.delete_rule || ']'              AS "Relation (diagramme)"
FROM information_schema.table_constraints        tc
JOIN information_schema.key_column_usage         kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema    = kcu.table_schema
JOIN information_schema.referential_constraints  rc
  ON tc.constraint_name    = rc.constraint_name
 AND tc.table_schema       = rc.constraint_schema
JOIN information_schema.constraint_column_usage  ccu
  ON rc.unique_constraint_name   = ccu.constraint_name
 AND rc.unique_constraint_schema = ccu.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema    = 'public'
ORDER BY kcu.table_name, kcu.column_name;


-- ════════════════════════════════════════════════════════════
-- 8. ENUMS définis dans la base (valeurs possibles par colonne)
-- ════════════════════════════════════════════════════════════
SELECT
  n.nspname                                           AS "Schéma",
  t.typname                                           AS "Enum",
  string_agg(e.enumlabel, ' | ' ORDER BY e.enumsortorder) AS "Valeurs possibles"
FROM pg_type        t
JOIN pg_namespace   n ON n.oid = t.typnamespace
JOIN pg_enum        e ON e.enumtypid = t.oid
WHERE n.nspname = 'public'
GROUP BY n.nspname, t.typname
ORDER BY t.typname;


-- ════════════════════════════════════════════════════════════
-- 9. FONCTIONS et PROCÉDURES liées aux tables
-- ════════════════════════════════════════════════════════════
SELECT
  routine_name                                        AS "Fonction",
  routine_type                                        AS "Type",
  data_type                                           AS "Retourne",
  security_type                                       AS "Sécurité",
  is_deterministic                                    AS "Déterministe"
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;

