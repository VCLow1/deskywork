-- S3 Dev 1 — Agenda admin, profils A1, politique annulation, check-in/out, QR
-- À exécuter dans Supabase SQL Editor (après s1_migration.sql et s2_dev1_tarifs_promo.sql)

-- =========================================================================
-- A1 — Extensions profil membre
-- =========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes_admin TEXT,
  ADD COLUMN IF NOT EXISTS qr_token UUID DEFAULT gen_random_uuid();

UPDATE public.profiles SET qr_token = gen_random_uuid() WHERE qr_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_qr_token_idx ON public.profiles (qr_token);

-- =========================================================================
-- B2 — Politique d'annulation paramétrable (singleton)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.politique_annulation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delai_heures INTEGER NOT NULL DEFAULT 24 CHECK (delai_heures >= 0),
    penalite_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (penalite_pct >= 0 AND penalite_pct <= 100),
    annulation_membre_autorisee BOOLEAN NOT NULL DEFAULT TRUE,
    remboursement_auto BOOLEAN NOT NULL DEFAULT FALSE,
    message_membre TEXT DEFAULT 'Annulation gratuite jusqu''à 24 h avant le début du créneau.',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.politique_annulation (delai_heures, penalite_pct, message_membre)
SELECT 24, 0, 'Annulation gratuite jusqu''à 24 h avant le début du créneau.'
WHERE NOT EXISTS (SELECT 1 FROM public.politique_annulation LIMIT 1);

ALTER TABLE public.politique_annulation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture politique annulation" ON public.politique_annulation;
CREATE POLICY "Lecture politique annulation" ON public.politique_annulation
    FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin manage politique annulation" ON public.politique_annulation;
CREATE POLICY "Admin manage politique annulation" ON public.politique_annulation
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

-- =========================================================================
-- Storage bucket profils (optionnel — créer via Dashboard si absent)
-- Dashboard Supabase → Storage → New bucket : profile-assets (public)
-- =========================================================================
