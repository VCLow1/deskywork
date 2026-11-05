-- ═══════════════════════════════════════════════════════════════════════════
-- S11 — COORDONNÉES GPS : Coworkings sur la landing page & parcours invité
-- À exécuter dans Supabase SQL Editor après s6_multi_tenant.sql et s10_images
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Coordonnées GPS du coworking (pour affichage carte / "Voir plus")
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6);

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6);

-- 2. Vérification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tenants'
  AND column_name IN ('latitude', 'longitude')
ORDER BY column_name;