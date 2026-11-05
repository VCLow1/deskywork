-- ============================================================
-- TESTS S1 DEV 2 — Module C Paiements
-- Coworking VC LOW — Pilote 33S
-- À exécuter dans Supabase > SQL Editor
-- Exécuter bloc par bloc (sélectionner + Run)
-- ============================================================


-- ============================================================
-- TEST 1 — Vérifier que toutes les tables S1 existent
-- ============================================================
-- Résultat attendu : 7 lignes (profiles, espaces, abonnements,
--                    reservations, sessions, paiements, notifications)

SELECT table_name, 
       pg_size_pretty(pg_total_relation_size('public.' || table_name)) AS taille
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles', 'espaces', 'abonnements',
    'reservations', 'sessions', 'paiements', 'notifications'
  )
ORDER BY table_name;


-- ============================================================
-- TEST 2 — Vérifier la structure de la table paiements
-- ============================================================
-- Résultat attendu : 9 colonnes (id, user_id, reservation_id,
--   abonnement_id, montant, mode, statut, date_paiement, created_at)

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'paiements'
ORDER BY ordinal_position;


-- ============================================================
-- TEST 3 — Vérifier les contraintes CHECK de la table paiements
-- ============================================================
-- Résultat attendu : contraintes sur mode (cash/bank_transfer/check/online)
--                    et statut (pending/paid/failed/refunded)

SELECT con.conname AS contrainte,
       con.contype AS type,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'paiements';


-- ============================================================
-- TEST 4 — Vérifier les politiques RLS sur paiements
-- ============================================================
-- Résultat attendu : 2 politiques
--   1. members_read_own_payments
--   2. admin_manage_payments

SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'paiements';


-- ============================================================
-- TEST 5 — Vérifier que RLS est activée sur paiements
-- ============================================================
-- Résultat attendu : rowsecurity = true

SELECT relname AS table_name, relrowsecurity AS rls_activee
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('paiements', 'profiles', 'abonnements', 'reservations', 'sessions')
ORDER BY relname;


-- ============================================================
-- TEST 6 — Compter les données de seed (espaces)
-- ============================================================
-- Résultat attendu : 7 espaces (Open Space, Bureaux, Salles...)

SELECT type, COUNT(*) AS nombre, 
       MIN(tarif_horaire) AS tarif_min, 
       MAX(tarif_horaire) AS tarif_max
FROM public.espaces
GROUP BY type
ORDER BY type;


-- ============================================================
-- TEST 7 — Voir tous les membres inscrits
-- ============================================================
-- Résultat attendu : profils des utilisateurs enregistrés

SELECT id, 
       CONCAT(prenom, ' ', nom) AS nom_complet,
       email, role, type_membre, statut_compte, created_at
FROM public.profiles
ORDER BY created_at DESC;


-- ============================================================
-- TEST 8 — Voir tous les abonnements existants
-- ============================================================
-- Résultat attendu : liste des abonnements avec infos membre

SELECT a.id,
       CONCAT(p.prenom, ' ', p.nom) AS membre,
       p.email,
       a.type,
       a.date_debut,
       a.date_fin,
       a.statut,
       a.renouvellement_auto
FROM public.abonnements a
JOIN public.profiles p ON p.id = a.user_id
ORDER BY a.created_at DESC;


-- ============================================================
-- TEST 9 — Insérer un paiement de test (simulation backend)
-- ============================================================
-- ⚠️ Remplacer les UUID par des vrais IDs de ta BDD
--    Récupérer un user_id depuis TEST 7
--    Récupérer un abonnement_id depuis TEST 8

-- D'abord récupérer les IDs disponibles :
SELECT 
  p.id AS user_id,
  p.email,
  a.id AS abonnement_id,
  a.type AS abonnement_type
FROM public.profiles p
JOIN public.abonnements a ON a.user_id = p.id
WHERE a.statut = 'active'
LIMIT 3;


-- ============================================================
-- TEST 10 — Insérer un vrai paiement de test
-- ============================================================
-- ⚠️ APRÈS avoir récupéré les IDs du TEST 9
--    Remplacer <USER_ID> et <ABONNEMENT_ID> par les vrais UUID

/*
INSERT INTO public.paiements (
  user_id,
  abonnement_id,
  montant,
  mode,
  statut,
  date_paiement
)
VALUES (
  '<USER_ID>',        -- copier depuis TEST 9
  '<ABONNEMENT_ID>',  -- copier depuis TEST 9
  150.00,
  'cash',
  'pending',
  NULL
)
RETURNING *;
*/


-- ============================================================
-- TEST 11 — Voir tous les paiements (vue admin)
-- ============================================================
-- Résultat attendu : liste avec infos membre + abonnement

SELECT 
  pai.id,
  pai.montant,
  pai.mode,
  pai.statut,
  pai.date_paiement,
  pai.created_at,
  CONCAT(p.prenom, ' ', p.nom) AS membre,
  p.email,
  a.type AS type_abonnement,
  r.date_debut AS reservation_debut
FROM public.paiements pai
JOIN public.profiles p ON p.id = pai.user_id
LEFT JOIN public.abonnements a ON a.id = pai.abonnement_id
LEFT JOIN public.reservations r ON r.id = pai.reservation_id
ORDER BY pai.created_at DESC;


-- ============================================================
-- TEST 12 — Paiements en attente (impayés)
-- ============================================================
-- Simule GET /api/payments/pending
-- Résultat attendu : paiements avec statut 'pending'

SELECT 
  pai.id,
  pai.montant,
  pai.mode,
  pai.created_at,
  EXTRACT(DAY FROM NOW() - pai.created_at) AS jours_en_attente,
  CASE 
    WHEN EXTRACT(DAY FROM NOW() - pai.created_at) > 15 THEN '🔴 Retard J+15'
    WHEN EXTRACT(DAY FROM NOW() - pai.created_at) > 7  THEN '🟠 Retard J+7'
    WHEN EXTRACT(DAY FROM NOW() - pai.created_at) > 3  THEN '🟡 Retard J+3'
    ELSE '⚪ Normal'
  END AS niveau_retard,
  CONCAT(p.prenom, ' ', p.nom) AS membre,
  p.email,
  p.telephone
FROM public.paiements pai
JOIN public.profiles p ON p.id = pai.user_id
WHERE pai.statut = 'pending'
ORDER BY pai.created_at ASC;


-- ============================================================
-- TEST 13 — Statistiques paiements (simulation KPI S2)
-- ============================================================
-- Aperçu des données pour le Module D (prochain sprint)

SELECT
  COUNT(*) AS total_paiements,
  COUNT(*) FILTER (WHERE statut = 'pending')  AS en_attente,
  COUNT(*) FILTER (WHERE statut = 'paid')     AS payés,
  COUNT(*) FILTER (WHERE statut = 'failed')   AS échoués,
  COUNT(*) FILTER (WHERE statut = 'refunded') AS remboursés,
  COALESCE(SUM(montant) FILTER (WHERE statut = 'paid'), 0)    AS ca_total,
  COALESCE(SUM(montant) FILTER (WHERE statut = 'pending'), 0) AS impayés_total
FROM public.paiements;


-- ============================================================
-- TEST 14 — Vérifier les modes de paiement acceptés
-- ============================================================
-- Simule la validation du backend

SELECT 
  'cash'          AS mode, 'Espèces'          AS label UNION ALL
SELECT 'bank_transfer', 'Virement bancaire'              UNION ALL
SELECT 'check',         'Chèque'                         UNION ALL
SELECT 'online',        'Paiement en ligne (Flouci)';


-- ============================================================
-- TEST 15 — Vérifier le trigger anti-conflit réservations
-- ============================================================
-- Le trigger doit empêcher deux réservations sur le même créneau

SELECT trigger_name, event_manipulation, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'reservations';


-- ============================================================
-- TEST 16 — Vérifier le trigger création automatique de profil
-- ============================================================
-- Doit exister : on_auth_user_created

SELECT trigger_name, event_object_schema, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';


-- ============================================================
-- BILAN FINAL S1 DEV 2
-- ============================================================
-- Résumé en une seule requête

SELECT
  '1. Tables créées'       AS verification,
  COUNT(*)::text || '/7'   AS resultat
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('profiles','espaces','abonnements','reservations','sessions','paiements','notifications')

UNION ALL

SELECT
  '2. Espaces seed',
  COUNT(*)::text || ' espaces'
FROM public.espaces

UNION ALL

SELECT
  '3. Membres inscrits',
  COUNT(*)::text || ' membres'
FROM public.profiles

UNION ALL

SELECT
  '4. RLS paiements',
  COUNT(*)::text || '/2 politiques'
FROM pg_policies
WHERE tablename = 'paiements' AND schemaname = 'public'

UNION ALL

SELECT
  '5. Paiements enregistrés',
  COUNT(*)::text || ' paiements'
FROM public.paiements

UNION ALL

SELECT
  '6. Abonnements actifs',
  COUNT(*)::text || ' abonnements'
FROM public.abonnements
WHERE statut = 'active';
