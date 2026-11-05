-- ═══════════════════════════════════════════════════════════════════════════
-- S6 — MULTI-TENANT MIGRATION (VCLOW SaaS Platform)
-- Super Admin (VCLOW) → Coworking Spaces (Tenants) → Members
-- À exécuter dans Supabase SQL Editor après toutes les migrations précédentes
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. TABLE : tenants (Coworking Spaces gérées par Super Admin)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    adresse TEXT,
    ville TEXT,
    pays TEXT DEFAULT 'Tunisie',
    email TEXT,
    telephone TEXT,
    site_web TEXT,
    logo_url TEXT,
    statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'inactif')),
    plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
    tier TEXT NOT NULL DEFAULT 'C' CHECK (tier IN ('A', 'B', 'C')),
    montant_mensuel NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (montant_mensuel >= 0),
    derniere_facture DATE,
    prochaine_echeance DATE,
    limite_membres INTEGER DEFAULT 100,
    limite_espaces INTEGER DEFAULT 10,
    contact_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Super Admin peut tout voir/modifier
DROP POLICY IF EXISTS "Super Admin: full access tenants" ON public.tenants;
CREATE POLICY "Super Admin: full access tenants" ON public.tenants
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'
        )
    );

-- Admin/Staff voient leur propre tenant
DROP POLICY IF EXISTS "Admin: read own tenant" ON public.tenants;
CREATE POLICY "Admin: read own tenant" ON public.tenants
    FOR SELECT USING (
        id IN (
            SELECT tenant_id FROM public.profiles
            WHERE profiles.id = auth.uid()
        )
    );

-- ───────────────────────────────────────────────────────────────────────────
-- 2. TABLE : super_admin_audit_log
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.super_admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    action TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    target_name TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'blocked', 'error')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.super_admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super Admin: audit log access" ON public.super_admin_audit_log;
CREATE POLICY "Super Admin: audit log access" ON public.super_admin_audit_log
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'
        )
    );

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.super_admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON public.super_admin_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.super_admin_audit_log (action);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. AJOUT tenant_id SUR TOUTES LES TABLES EXISTANTES
-- ───────────────────────────────────────────────────────────────────────────

-- Profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;

-- Espaces
ALTER TABLE public.espaces
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Abonnements
ALTER TABLE public.abonnements
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Reservations
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Paiements
ALTER TABLE public.paiements
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Sessions
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Formations
ALTER TABLE public.formations
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Inscriptions formations
ALTER TABLE public.inscriptions_formations
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Rémunérations formateurs
ALTER TABLE public.remuneration_formateurs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Tarifs abonnements
ALTER TABLE public.tarifs_abonnements
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Codes promo
ALTER TABLE public.codes_promo
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Historique tarifs
ALTER TABLE public.historique_tarifs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Politique annulation (singleton par tenant)
ALTER TABLE public.politique_annulation
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. INDEX pour performance multi-tenant
-- ───────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON public.profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_espaces_tenant ON public.espaces (tenant_id);
CREATE INDEX IF NOT EXISTS idx_abonnements_tenant ON public.abonnements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant ON public.reservations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_paiements_tenant ON public.paiements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON public.notifications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON public.sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_formations_tenant ON public.formations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_tenant ON public.inscriptions_formations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_remuneration_tenant ON public.remuneration_formateurs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tarifs_tenant ON public.tarifs_abonnements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_promo_tenant ON public.codes_promo (tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON public.conversations (tenant_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. TENANT PAR DÉFAUT + MIGRATION DES DONNÉES EXISTANTES
-- ───────────────────────────────────────────────────────────────────────────

-- Créer le tenant "Encre & Cobalt" par défaut (données existantes)
INSERT INTO public.tenants (id, nom, slug, description, adresse, ville, pays, email, statut, plan, tier, montant_mensuel, limite_membres, limite_espaces)
VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    'Encre & Cobalt',
    'encre-cobalt',
    'Coworking Premium - Tunis',
    'Avenue Habib Bourguiba',
    'Tunis',
    'Tunisie',
    'bonjour@encrecobalt.tn',
    'actif',
    'pro',
    'A',
    2400.00,
    500,
    20
) ON CONFLICT (slug) DO NOTHING;

-- Migrer tous les espaces existants vers le tenant par défaut
UPDATE public.espaces SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer tous les profils existants (admin/staff/member/formateur) vers le tenant par défaut
UPDATE public.profiles SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer abonnements
UPDATE public.abonnements SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer réservations
UPDATE public.reservations SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer paiements
UPDATE public.paiements SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer notifications
UPDATE public.notifications SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer sessions
UPDATE public.sessions SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer formations
UPDATE public.formations SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer inscriptions
UPDATE public.inscriptions_formations SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer rémunérations
UPDATE public.remuneration_formateurs SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer tarifs
UPDATE public.tarifs_abonnements SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer codes promo
UPDATE public.codes_promo SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer historique tarifs
UPDATE public.historique_tarifs SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer conversations
UPDATE public.conversations SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- Migrer politique annulation
UPDATE public.politique_annulation SET tenant_id = '00000000-0000-0000-0000-000000000001'::UUID WHERE tenant_id IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. MISE À JOUR DU TRIGGER handle_new_user pour inclure tenant_id
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, nom, prenom, email, role, telephone, type_membre, tenant_id)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'nom', ''),
        COALESCE(new.raw_user_meta_data->>'prenom', ''),
        new.email,
        COALESCE(new.raw_user_meta_data->>'role', 'member'),
        COALESCE(new.raw_user_meta_data->>'telephone', ''),
        COALESCE(new.raw_user_meta_data->>'type_membre', 'individuel'),
        CASE
            WHEN new.raw_user_meta_data->>'role' = 'super_admin' THEN NULL
            ELSE (new.raw_user_meta_data->>'tenant_id')::UUID
        END
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. FONCTION utilitaire : obtenir le tenant_id d'un utilisateur
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_tenant_id(user_uuid UUID)
RETURNS UUID AS $$
    SELECT tenant_id FROM public.profiles WHERE id = user_uuid;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. STATUTS COMPLÉMENTAIRES pour les réservations (S6)
-- ───────────────────────────────────────────────────────────────────────────

-- Ajouter 'completed' et 'no_show' aux statuts de réservation si pas déjà présent
DO $$ BEGIN
    ALTER TABLE public.reservations
        DROP CONSTRAINT IF EXISTS reservations_statut_check;
    ALTER TABLE public.reservations
        ADD CONSTRAINT reservations_statut_check
        CHECK (statut IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 9. VÉRIFICATION
-- ───────────────────────────────────────────────────────────────────────────

-- Vérifier que toutes les colonnes tenant_id existent
DO $$
DECLARE
    tbl TEXT;
    cols TEXT[] := ARRAY[
        'profiles', 'espaces', 'abonnements', 'reservations',
        'paiements', 'notifications', 'sessions', 'formations',
        'inscriptions_formations', 'remuneration_formateurs',
        'tarifs_abonnements', 'codes_promo', 'historique_tarifs',
        'conversations', 'politique_annulation'
    ];
BEGIN
    FOREACH tbl IN ARRAY cols LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'tenant_id'
        ) THEN
            RAISE WARNING 'Column tenant_id missing on table %', tbl;
        ELSE
            RAISE NOTICE 'OK: tenant_id exists on %', tbl;
        END IF;
    END LOOP;
END $$;
