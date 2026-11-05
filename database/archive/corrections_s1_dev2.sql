-- ============================================================
-- CORRECTIONS S1 DEV 2 — 3 problèmes détectés
-- À exécuter dans Supabase > SQL Editor
-- Exécuter bloc par bloc dans l'ordre (1 → 2 → 3 → 4)
-- ============================================================


-- ============================================================
-- CORRECTION 1 — Créer la table notifications manquante
-- ============================================================
-- Problème : 6/7 tables → notifications absente
-- Exécuter ce bloc seul d'abord

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    canal TEXT NOT NULL CHECK (canal IN ('Email', 'SMS', 'Dashboard')),
    message TEXT NOT NULL,
    lu BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activer RLS sur notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Politique RLS : chaque membre voit ses propres notifications
DO $$ BEGIN
  CREATE POLICY "members_read_own_notifications" ON public.notifications
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Politique RLS : admin/staff peuvent tout gérer
DO $$ BEGIN
  CREATE POLICY "admin_manage_notifications" ON public.notifications
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'admin', 'staff')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Vérification :
SELECT 'Table notifications créée ✅' AS statut
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'notifications'
);


-- ============================================================
-- CORRECTION 2 — Nettoyer les doublons RLS sur paiements
-- ============================================================
-- Problème : 7 politiques au lieu de 2
-- D'abord voir toutes les politiques existantes :

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'paiements'
ORDER BY policyname;


-- ============================================================
-- CORRECTION 2b — Supprimer TOUTES les politiques paiements
--                 et les recréer proprement
-- ============================================================
-- Exécuter ce bloc après avoir vu la liste du bloc précédent

-- Supprimer toutes les politiques existantes sur paiements
DO $$
DECLARE
    pol_name TEXT;
BEGIN
    FOR pol_name IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'paiements'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.paiements', pol_name);
    END LOOP;
END $$;

-- Recréer les 2 politiques correctes
CREATE POLICY "members_read_own_payments" ON public.paiements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "admin_manage_payments" ON public.paiements
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin', 'admin', 'staff')
    )
  );

-- Vérification : doit retourner exactement 2 lignes
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'paiements'
ORDER BY policyname;


-- ============================================================
-- CORRECTION 3 — Créer des abonnements actifs de test
-- ============================================================
-- Problème : 0 abonnements actifs → impossible de tester Module C
-- Cette requête crée un abonnement actif pour chaque membre inscrit

INSERT INTO public.abonnements (user_id, type, date_debut, date_fin, statut, renouvellement_auto)
SELECT
  p.id AS user_id,
  CASE ROW_NUMBER() OVER (ORDER BY p.created_at)
    WHEN 1 THEN 'mensuel'
    WHEN 2 THEN 'week_pass'
    ELSE 'day_pass'
  END AS type,
  CURRENT_DATE AS date_debut,
  CASE ROW_NUMBER() OVER (ORDER BY p.created_at)
    WHEN 1 THEN CURRENT_DATE + INTERVAL '30 days'
    WHEN 2 THEN CURRENT_DATE + INTERVAL '7 days'
    ELSE CURRENT_DATE + INTERVAL '1 day'
  END AS date_fin,
  'active' AS statut,
  FALSE AS renouvellement_auto
FROM public.profiles p
WHERE p.role = 'member'
  AND NOT EXISTS (
    -- Ne pas créer si l'abonnement existe déjà
    SELECT 1 FROM public.abonnements a
    WHERE a.user_id = p.id AND a.statut = 'active'
      AND a.date_fin >= CURRENT_DATE
  )
RETURNING user_id, type, date_debut, date_fin, statut;


-- ============================================================
-- CORRECTION 4 — Créer un paiement de test lié à un abonnement
-- ============================================================
-- Simule exactement ce que fait POST /api/payments du backend

INSERT INTO public.paiements (user_id, abonnement_id, montant, mode, statut)
SELECT
  a.user_id,
  a.id AS abonnement_id,
  CASE a.type
    WHEN 'day_pass'     THEN 15.00
    WHEN 'week_pass'    THEN 80.00
    WHEN 'mensuel'      THEN 250.00
    WHEN 'trimestriel'  THEN 650.00
    WHEN 'annuel'       THEN 2200.00
    ELSE 150.00
  END AS montant,   
  'cash' AS mode,
  'pending' AS statut
FROM public.abonnements a
WHERE a.statut = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.paiements p
    WHERE p.abonnement_id = a.id
  )
LIMIT 3
RETURNING *;


-- ============================================================
-- BILAN FINAL — Relancer après les 4 corrections
-- ============================================================
-- Résultat attendu : 7/7, 7 espaces, X membres, 2/2, X paiements, X abonnements

SELECT
  '1. Tables créées'       AS verification,
  COUNT(*)::text || '/7'   AS resultat,
  CASE WHEN COUNT(*) = 7 THEN '✅' ELSE '❌ manquante : notifications ?' END AS statut
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('profiles','espaces','abonnements','reservations','sessions','paiements','notifications')

UNION ALL

SELECT
  '2. Espaces seed',
  COUNT(*)::text || ' espaces',
  CASE WHEN COUNT(*) >= 7 THEN '✅' ELSE '❌ seed manquante' END
FROM public.espaces

UNION ALL

SELECT
  '3. Membres inscrits',
  COUNT(*)::text || ' membres',
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '❌ aucun membre' END
FROM public.profiles

UNION ALL

SELECT
  '4. RLS paiements',
  COUNT(*)::text || '/2 politiques',
  CASE WHEN COUNT(*) = 2 THEN '✅' ELSE '❌ nettoyage nécessaire' END
FROM pg_policies
WHERE tablename = 'paiements' AND schemaname = 'public'

UNION ALL

SELECT
  '5. Paiements enregistrés',
  COUNT(*)::text || ' paiements',
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ aucun paiement' END
FROM public.paiements

UNION ALL

SELECT
  '6. Abonnements actifs',
  COUNT(*)::text || ' abonnements',
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '❌ aucun abonnement actif' END
FROM public.abonnements
WHERE statut = 'active' AND date_fin >= CURRENT_DATE

UNION ALL

SELECT
  '7. Table notifications',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) THEN 'créée' ELSE 'MANQUANTE' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) THEN '✅' ELSE '❌' END;
