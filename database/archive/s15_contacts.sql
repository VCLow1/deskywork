-- Table des demandes envoyees depuis le formulaire Contact public.
CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    email TEXT NOT NULL,
    sujet TEXT NOT NULL,
    message TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'nouveau' CHECK (statut IN ('nouveau', 'lu', 'traite')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON public.contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_statut ON public.contacts (statut);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_create_contacts" ON public.contacts;
CREATE POLICY "public_create_contacts" ON public.contacts
    FOR INSERT TO anon, authenticated WITH CHECK (true);

REVOKE SELECT, UPDATE, DELETE ON public.contacts FROM anon, authenticated;
GRANT INSERT ON public.contacts TO anon, authenticated;
