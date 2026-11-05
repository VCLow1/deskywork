-- =========================================================================
-- S9 — Onboarding coworking (configuration par l'admin après approbation)
-- =========================================================================
-- Marque les tenants existants (avec espaces déjà configurés) comme onboardés.

UPDATE public.tenants t
SET settings = COALESCE(t.settings, '{}'::jsonb) || '{"onboarding_completed": true}'::jsonb
WHERE EXISTS (
    SELECT 1 FROM public.espaces e WHERE e.tenant_id = t.id
);

-- Tenants sans espaces : laisser onboarding_completed à false (ou absent)
UPDATE public.tenants t
SET settings = COALESCE(t.settings, '{}'::jsonb) || '{"onboarding_completed": false}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM public.espaces e WHERE e.tenant_id = t.id
)
AND (t.settings->>'onboarding_completed') IS NULL;
