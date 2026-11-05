-- ═══════════════════════════════════════════════════════════════════════════
-- S10 — IMAGES : Logo/Couverture Tenant + Photos Espaces
-- À exécuter dans Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ajouter cover_url dans la table tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- 2. Ajouter photo_url dans la table espaces
ALTER TABLE public.espaces
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 3. Ajouter photos_urls (tableau de plusieurs photos) dans espaces (optionnel)
ALTER TABLE public.espaces
  ADD COLUMN IF NOT EXISTS photos_urls JSONB DEFAULT '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE : Créer le bucket Supabase Storage "coworking-images"
-- Aller dans Supabase > Storage > New bucket > nom: coworking-images > Public: true
-- ─────────────────────────────────────────────────────────────────────────────

-- Politique RLS pour que les admins puissent lire les infos de leur tenant avec les nouvelles colonnes
-- (Les politiques existantes couvrent déjà les nouveaux champs car elles s'appliquent à toute la ligne)

-- Vérification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('tenants', 'espaces')
  AND column_name IN ('cover_url', 'photo_url', 'photos_urls')
ORDER BY table_name, column_name;
