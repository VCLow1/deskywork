-- ==============================================================================
-- MASTER_MIGRATION_NEW_SUPABASE.sql
-- Script complet de configuration pour le NOUVEAU projet Supabase DeskyWork (VC Low)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. SCHEMA INITIAL ─────────────────────────────────────────────────────────
-- Coworking Management System - Supabase PostgreSQL Schema
-- Targets DEV 1 Scope: Members, Bookings, Sessions, Profiles

-- UUID generation (Supabase default)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. Create Tables
-- =========================================================================

-- Spaces Table
CREATE TABLE public.espaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('open_space', 'private_office', 'meeting_room', 'training_room', 'event_space')),
    capacite INTEGER NOT NULL CHECK (capacite > 0),
    tarif_horaire NUMERIC(10, 2) NOT NULL CHECK (tarif_horaire >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles Table (Extends Supabase Auth users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    nom TEXT,
    prenom TEXT,
    email TEXT, -- Added to match UML specs & avoid RLS check constraints bugs
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('super_admin', 'admin', 'staff', 'formateur', 'member', 'guest')),
    telephone TEXT,
    cin TEXT,
    type_membre TEXT CHECK (type_membre IN ('individuel', 'entreprise', 'etudiant')),
    statut_compte TEXT NOT NULL DEFAULT 'actif' CHECK (statut_compte IN ('actif', 'suspendu', 'expire', 'en_attente')),
    specialite TEXT,      -- For trainers
    biographie TEXT,      -- For trainers
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions Table
CREATE TABLE public.abonnements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('day_pass', 'week_pass', 'mensuel', 'trimestriel', 'annuel', 'bureau_prive')),
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    renouvellement_auto BOOLEAN NOT NULL DEFAULT FALSE,
    statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'suspended', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT check_dates CHECK (date_fin >= date_debut)
);

-- Reservations Table
CREATE TABLE public.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    espace_id UUID NOT NULL REFERENCES public.espaces(id) ON DELETE CASCADE,
    date_debut TIMESTAMPTZ NOT NULL,
    date_fin TIMESTAMPTZ NOT NULL,
    statut TEXT NOT NULL DEFAULT 'pending' CHECK (statut IN ('pending', 'confirmed', 'cancelled')),
    mode TEXT NOT NULL DEFAULT 'online' CHECK (mode IN ('online', 'on_site', 'phone')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT check_reservation_dates CHECK (date_fin > date_debut)
);

-- Real-time Sessions Table
CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE UNIQUE,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    statut TEXT NOT NULL DEFAULT 'scheduled' CHECK (statut IN ('scheduled', 'active', 'completed', 'overtime', 'no_show')),
    temps_restant INTEGER, -- in minutes
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications log (Module F — table livrée en S1 pour Dev 2)
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    canal TEXT NOT NULL CHECK (canal IN ('Email', 'SMS', 'Dashboard')),
    message TEXT NOT NULL,
    lu BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments Table (Module C — Dev 2)
CREATE TABLE public.paiements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
    abonnement_id UUID REFERENCES public.abonnements(id) ON DELETE SET NULL,
    montant NUMERIC(10, 2) NOT NULL CHECK (montant >= 0),
    mode TEXT NOT NULL CHECK (mode IN ('cash', 'bank_transfer', 'check', 'online')),
    statut TEXT NOT NULL DEFAULT 'pending' CHECK (statut IN ('pending', 'paid', 'failed', 'refunded')),
    date_paiement TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 2. Setup Automatic Profiles Trigger
-- =========================================================================

-- Trigger function to automatically create a profile when a new user registers in Supabase auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_tenant_id UUID := NULL;
    coworking_name TEXT;
    user_role TEXT;
    initial_statut TEXT;
BEGIN
    user_role := COALESCE(new.raw_user_meta_data->>'role', 'member');
    coworking_name := new.raw_user_meta_data->>'coworking_name';

    -- Règle d'approbation :
    -- Seul le compte Admin Coworking (création d'espace) nécessite l'approbation du Super Admin ('en_attente').
    -- Les autres rôles (membres, formateurs, etc.) sont activés immédiatement ('actif').
    IF user_role = 'admin' THEN
        initial_statut := 'en_attente';
    ELSE
        initial_statut := 'actif';
    END IF;

    -- Si c'est un nouvel admin et qu'un nom de coworking est fourni, créer le tenant (espace de coworking)
    IF user_role = 'admin' AND coworking_name IS NOT NULL THEN
        INSERT INTO public.tenants (nom, slug, email, telephone, statut, settings)
        VALUES (
            coworking_name,
            lower(regexp_replace(coworking_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substring(new.id::text, 1, 8),
            new.email,
            COALESCE(new.raw_user_meta_data->>'telephone', ''),
            'suspendu',
            '{"onboarding_completed": false}'::jsonb
        )
        RETURNING id INTO new_tenant_id;
    END IF;

    INSERT INTO public.profiles (
        id, nom, prenom, email, role, telephone, type_membre,
        specialite, biographie, statut_compte, tenant_id
    )
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'nom', split_part(new.email, '@', 1)),
        COALESCE(new.raw_user_meta_data->>'prenom', ''),
        new.email,
        user_role,
        COALESCE(new.raw_user_meta_data->>'telephone', ''),
        COALESCE(new.raw_user_meta_data->>'type_membre', 'individuel'),
        COALESCE(new.raw_user_meta_data->>'specialite', NULL),
        COALESCE(new.raw_user_meta_data->>'biographie', NULL),
        initial_statut,
        new_tenant_id
    )
    ON CONFLICT (id) DO UPDATE SET
        statut_compte = EXCLUDED.statut_compte,
        nom = COALESCE(NULLIF(EXCLUDED.nom, ''), profiles.nom),
        prenom = COALESCE(NULLIF(EXCLUDED.prenom, ''), profiles.prenom),
        telephone = COALESCE(NULLIF(EXCLUDED.telephone, ''), profiles.telephone),
        role = COALESCE(NULLIF(EXCLUDED.role, ''), profiles.role),
        updated_at = NOW();

    IF new_tenant_id IS NOT NULL THEN
        UPDATE public.tenants SET contact_admin_id = new.id WHERE id = new_tenant_id;
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind the trigger
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- 3. Row Level Security (RLS) Policies
-- =========================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.espaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abonnements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paiements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Allow public read access to profiles" ON public.profiles
    FOR SELECT USING (true);

CREATE POLICY "Allow users to update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- Espaces Policies (Anyone can browse spaces)
CREATE POLICY "Allow public read access to spaces" ON public.espaces
    FOR SELECT USING (true);

CREATE POLICY "Allow admins to manage spaces" ON public.espaces
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin')
        )
    );

-- Abonnements Policies
CREATE POLICY "Allow users to read their own subscriptions" ON public.abonnements
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Allow admins/staff to manage all subscriptions" ON public.abonnements
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

-- Notifications Policies
CREATE POLICY "Allow users to read their own notifications" ON public.notifications
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Allow admins/staff to read all notifications" ON public.notifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

CREATE POLICY "Allow users to mark their own notifications read" ON public.notifications
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reservations Policies
CREATE POLICY "Allow users to read their own reservations" ON public.reservations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Allow users to create reservations" ON public.reservations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to modify/cancel their own reservations" ON public.reservations
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Allow admins/staff to manage all reservations" ON public.reservations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

-- Sessions Policies
CREATE POLICY "Allow users to view sessions associated with their reservations" ON public.sessions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.reservations
            WHERE reservations.id = sessions.reservation_id AND reservations.user_id = auth.uid()
        )
    );

CREATE POLICY "Allow admins/staff to manage all sessions" ON public.sessions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

CREATE POLICY "Allow users to check in to their own reservations" ON public.sessions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reservations
            WHERE reservations.id = reservation_id
              AND reservations.user_id = auth.uid()
              AND reservations.statut IN ('confirmed', 'pending')
        )
    );

CREATE POLICY "Allow users to checkout their own sessions" ON public.sessions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.reservations
            WHERE reservations.id = sessions.reservation_id
              AND reservations.user_id = auth.uid()
        )
    );

-- Paiements & notifications : tables livrées pour Dev 2 (Module C / F)
-- Les politiques RLS seront ajoutées par Dev 2

-- =========================================================================
-- 4. Anti-conflit réservations (Module B)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.check_reservation_overlap()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.reservations r
        WHERE r.espace_id = NEW.espace_id
          AND r.id IS DISTINCT FROM NEW.id
          AND r.statut IN ('confirmed', 'pending')
          AND r.date_debut < NEW.date_fin
          AND r.date_fin > NEW.date_debut
    ) THEN
        RAISE EXCEPTION 'Conflit de réservation : ce créneau est déjà occupé.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reservation_overlap_check ON public.reservations;
CREATE TRIGGER reservation_overlap_check
    BEFORE INSERT OR UPDATE ON public.reservations
    FOR EACH ROW EXECUTE FUNCTION public.check_reservation_overlap();

-- =========================================================================
-- 5. Initial Seed Data
-- =========================================================================

INSERT INTO public.espaces (nom, type, capacite, tarif_horaire) VALUES
('Open Space Central', 'open_space', 50, 5.00),
('Focus Lab (Flex)', 'open_space', 20, 7.50),
('Private Suite 101', 'private_office', 4, 25.00),
('Private Suite 102', 'private_office', 6, 35.00),
('Salle de Réunion Atlas', 'meeting_room', 12, 40.00),
('Salle de Réunion Sahel', 'meeting_room', 8, 30.00),
('Grand Amphi de Formation', 'training_room', 30, 80.00)
ON CONFLICT DO NOTHING;


-- ── 2. ARCHITECTURE MULTI-TENANT & AUTH UNIFIEE (S18) ─────────────────────────
-- =========================================================================
-- S18 — REFONTE AUTHENTIFICATION, ORGANISATIONS MULTI-TENANT & RÔLES
-- DeskyWork : Marketplace Coworking, Centres de formation & Entreprises
-- =========================================================================

-- 1. Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Mise à jour de la table PROFILES (Identité personne unique)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verifie BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS telephone_verifie BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS langue TEXT DEFAULT 'fr';

-- Mettre à jour les super admins existants
UPDATE public.profiles
SET is_super_admin = TRUE
WHERE role = 'super_admin';

-- 3. Table ORGANIZATIONS (Coworkings, Centres de formation, Entreprises)
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('coworking', 'centre_formation', 'entreprise')),
    nom TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    logo_url TEXT,
    cover_url TEXT,
    ville TEXT NOT NULL,
    adresse TEXT NOT NULL,
    pays TEXT DEFAULT 'Tunisie',
    description TEXT,
    horaires JSONB DEFAULT '{"lundi": "08:00 - 20:00", "mardi": "08:00 - 20:00", "mercredi": "08:00 - 20:00", "jeudi": "08:00 - 20:00", "vendredi": "08:00 - 20:00", "samedi": "09:00 - 18:00", "dimanche": "Fermé"}'::jsonb,
    statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'en_validation', 'valide', 'suspendu')),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    matricule_fiscal TEXT,
    telephone TEXT,
    email TEXT,
    settings JSONB DEFAULT '{"onboarding_completed": false}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_type ON public.organizations(type);
CREATE INDEX IF NOT EXISTS idx_organizations_statut ON public.organizations(statut);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON public.organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations(slug);

-- 4. Table MEMBERSHIPS (Lien N-N entre personne et organisation avec rôle)
CREATE TABLE IF NOT EXISTS public.memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('proprietaire', 'admin', 'staff', 'formateur', 'lecture_seule')),
    statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'invite')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_organization UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_role ON public.memberships(role);

-- 5. Table TRAINER_PROFILES (Profils formateurs indépendants avec validation)
CREATE TABLE IF NOT EXISTS public.trainer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    bio TEXT,
    domaines TEXT[] DEFAULT '{}',
    certificats JSONB DEFAULT '[]'::jsonb,
    telephone_pro TEXT,
    statut_validation TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut_validation IN ('brouillon', 'en_validation', 'valide', 'refuse')),
    commentaires_admin TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_profiles_user ON public.trainer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_trainer_profiles_statut ON public.trainer_profiles(statut_validation);

-- 6. Table INVITATIONS (Invitations d'équipe sécurisées)
CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'formateur', 'lecture_seule')),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'acceptee', 'refusee', 'expiree')),
    invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON public.invitations(organization_id);

-- 7. Table PHONE_OTPS (Vérification téléphone SMS / WhatsApp avec expiration)
CREATE TABLE IF NOT EXISTS public.phone_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    channel TEXT DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms')),
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_lookup ON public.phone_otps(phone, code);

-- 8. Synchronisation bidirectionnelle & Rétro-compatibilité avec TENANTS
-- Permet aux tables existantes (espaces, réservations, abonnements) continuant de pointer sur tenants(id)
-- de fonctionner sans interruption avec organizations(id).
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'coworking',
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matricule_fiscal TEXT,
  ADD COLUMN IF NOT EXISTS horaires JSONB DEFAULT '{}'::jsonb;

-- Migrer les tenants existants vers organizations si non présents
INSERT INTO public.organizations (id, type, nom, slug, logo_url, cover_url, ville, adresse, pays, description, statut, owner_id, telephone, email, settings, created_at, updated_at)
SELECT
    t.id,
    COALESCE(t.type, 'coworking'),
    t.nom,
    t.slug,
    t.logo_url,
    t.cover_url,
    COALESCE(t.ville, 'Tunis'),
    COALESCE(t.adresse, 'Centre Urbain'),
    COALESCE(t.pays, 'Tunisie'),
    t.description,
    CASE 
        WHEN t.statut = 'actif' THEN 'valide'
        WHEN t.statut = 'suspendu' THEN 'suspendu'
        ELSE 'valide'
    END,
    COALESCE(t.contact_admin_id, (SELECT id FROM public.profiles WHERE role = 'super_admin' LIMIT 1), '00000000-0000-0000-0000-000000000001'::UUID),
    t.telephone,
    t.email,
    t.settings,
    t.created_at,
    t.updated_at
FROM public.tenants t
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    slug = EXCLUDED.slug,
    logo_url = EXCLUDED.logo_url,
    ville = EXCLUDED.ville,
    adresse = EXCLUDED.adresse;

-- Synchroniser les propriétaires et admins existants dans memberships
INSERT INTO public.memberships (user_id, organization_id, role, statut)
SELECT
    p.id,
    p.tenant_id,
    CASE
        WHEN p.role IN ('admin', 'super_admin') THEN 'proprietaire'
        WHEN p.role = 'staff' THEN 'staff'
        WHEN p.role = 'formateur' THEN 'formateur'
        ELSE 'lecture_seule'
    END,
    'actif'
FROM public.profiles p
WHERE p.tenant_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p.tenant_id)
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- Migrer les formateurs existants dans trainer_profiles
INSERT INTO public.trainer_profiles (user_id, bio, domaines, statut_validation)
SELECT
    p.id,
    p.biographie,
    CASE WHEN p.specialite IS NOT NULL AND p.specialite != '' THEN ARRAY[p.specialite] ELSE '{}'::text[] END,
    'valide'
FROM public.profiles p
WHERE p.role = 'formateur'
ON CONFLICT (user_id) DO NOTHING;

-- Trigger de synchronisation automatique : si une organization est créée, insérer/synchroniser dans tenants
CREATE OR REPLACE FUNCTION public.sync_organization_to_tenant()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.tenants (
        id, nom, slug, description, adresse, ville, pays,
        email, telephone, logo_url, cover_url, statut,
        contact_admin_id, settings, created_at, updated_at
    )
    VALUES (
        NEW.id,
        NEW.nom,
        NEW.slug,
        NEW.description,
        NEW.adresse,
        NEW.ville,
        NEW.pays,
        NEW.email,
        NEW.telephone,
        NEW.logo_url,
        NEW.cover_url,
        CASE
            WHEN NEW.statut = 'valide' THEN 'actif'
            WHEN NEW.statut = 'suspendu' THEN 'suspendu'
            ELSE 'inactif'
        END,
        NEW.owner_id,
        NEW.settings,
        NEW.created_at,
        NEW.updated_at
    )
    ON CONFLICT (id) DO UPDATE SET
        nom = EXCLUDED.nom,
        slug = EXCLUDED.slug,
        description = EXCLUDED.description,
        adresse = EXCLUDED.adresse,
        ville = EXCLUDED.ville,
        email = EXCLUDED.email,
        telephone = EXCLUDED.telephone,
        logo_url = EXCLUDED.logo_url,
        cover_url = EXCLUDED.cover_url,
        statut = EXCLUDED.statut,
        contact_admin_id = EXCLUDED.contact_admin_id,
        settings = EXCLUDED.settings,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_org_to_tenant ON public.organizations;
CREATE TRIGGER trigger_sync_org_to_tenant
    AFTER INSERT OR UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.sync_organization_to_tenant();

-- 9. Trigger d'inscription Supabase Auth unifié
-- Sépare strictement la personne physique de l'organisation.
-- Ne crée plus d'organisation aveugle dans le trigger d'inscription.
-- Rallie automatiquement les réservations d'invité (guests) et accepte les invitations liées.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    clean_email TEXT;
    user_nom TEXT;
    user_prenom TEXT;
    user_tel TEXT;
    pending_inv RECORD;
BEGIN
    clean_email := lower(trim(NEW.email));
    
    -- Extraction nom/prénom/téléphone
    user_nom := COALESCE(
        NULLIF(NEW.raw_user_meta_data->>'nom', ''),
        NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 2), ''),
        split_part(clean_email, '@', 1)
    );
    user_prenom := COALESCE(
        NULLIF(NEW.raw_user_meta_data->>'prenom', ''),
        NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 1), ''),
        ''
    );
    user_tel := COALESCE(NEW.raw_user_meta_data->>'telephone', '');

    -- Création ou mise à jour du profil de la personne physique
    INSERT INTO public.profiles (
        id, email, nom, prenom, telephone,
        email_verifie, telephone_verifie, statut_compte,
        role, is_super_admin, created_at, updated_at
    )
    VALUES (
        NEW.id,
        clean_email,
        user_nom,
        user_prenom,
        user_tel,
        COALESCE((NEW.email_confirmed_at IS NOT NULL), FALSE),
        FALSE,
        'actif',
        COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
        COALESCE((NEW.raw_user_meta_data->>'is_super_admin')::boolean, FALSE),
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        nom = COALESCE(NULLIF(EXCLUDED.nom, ''), profiles.nom),
        prenom = COALESCE(NULLIF(EXCLUDED.prenom, ''), profiles.prenom),
        telephone = COALESCE(NULLIF(EXCLUDED.telephone, ''), profiles.telephone),
        updated_at = NOW();

    -- Rattachement automatique de l'historique guest si même email
    UPDATE public.guests
    SET converti_en_membre_id = NEW.id, converti_at = NOW()
    WHERE lower(email) = clean_email AND converti_en_membre_id IS NULL;

    UPDATE public.reservations
    SET user_id = NEW.id
    WHERE guest_id IN (SELECT id FROM public.guests WHERE lower(email) = clean_email);

    UPDATE public.inscriptions_formations
    SET user_id = NEW.id
    WHERE guest_id IN (SELECT id FROM public.guests WHERE lower(email) = clean_email);

    -- Traitement automatique des invitations en attente pour cet email
    FOR pending_inv IN 
        SELECT id, organization_id, role 
        FROM public.invitations 
        WHERE lower(email) = clean_email 
          AND statut = 'en_attente' 
          AND expires_at > NOW()
    LOOP
        INSERT INTO public.memberships (user_id, organization_id, role, statut)
        VALUES (NEW.id, pending_inv.organization_id, pending_inv.role, 'actif')
        ON CONFLICT (user_id, organization_id) DO UPDATE SET
            role = EXCLUDED.role,
            statut = 'actif',
            updated_at = NOW();

        UPDATE public.invitations
        SET statut = 'acceptee', updated_at = NOW()
        WHERE id = pending_inv.id;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 10. ROW LEVEL SECURITY (RLS) MULTI-TENANT SUR MEMBERSHIPS & ORGANIZATIONS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Helper function: vérifie si un utilisateur a un des rôles requis dans une organisation
CREATE OR REPLACE FUNCTION public.check_user_org_role(org_uuid UUID, user_uuid UUID, required_roles TEXT[])
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.memberships
        WHERE organization_id = org_uuid
          AND user_id = user_uuid
          AND statut = 'actif'
          AND role = ANY(required_roles)
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RLS: Organizations
-- Lecture publique pour les organisations validées (marketplace)
DROP POLICY IF EXISTS "Public: read validated organizations" ON public.organizations;
CREATE POLICY "Public: read validated organizations" ON public.organizations
    FOR SELECT USING (statut = 'valide');

-- Les membres voient leur propre organisation (même en brouillon ou validation)
DROP POLICY IF EXISTS "Members: read own organization" ON public.organizations;
CREATE POLICY "Members: read own organization" ON public.organizations
    FOR SELECT USING (
        auth.uid() = owner_id OR
        EXISTS (
            SELECT 1 FROM public.memberships
            WHERE memberships.organization_id = organizations.id
              AND memberships.user_id = auth.uid()
        )
    );

-- Super admin a tous les droits
DROP POLICY IF EXISTS "SuperAdmin: full access organizations" ON public.organizations;
CREATE POLICY "SuperAdmin: full access organizations" ON public.organizations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND (profiles.role = 'super_admin' OR profiles.is_super_admin = TRUE)
        )
    );

-- Propriétaires et admins d'organisation peuvent modifier leur organisation
DROP POLICY IF EXISTS "Admins: update own organization" ON public.organizations;
CREATE POLICY "Admins: update own organization" ON public.organizations
    FOR UPDATE USING (
        auth.uid() = owner_id OR
        public.check_user_org_role(id, auth.uid(), ARRAY['proprietaire', 'admin'])
    );

-- RLS: Memberships
DROP POLICY IF EXISTS "Users: view own memberships" ON public.memberships;
CREATE POLICY "Users: view own memberships" ON public.memberships
    FOR SELECT USING (
        user_id = auth.uid() OR
        public.check_user_org_role(organization_id, auth.uid(), ARRAY['proprietaire', 'admin', 'staff']) OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND (profiles.role = 'super_admin' OR profiles.is_super_admin = TRUE)
        )
    );

-- RLS: Trainer Profiles
DROP POLICY IF EXISTS "Public: view validated trainer profiles" ON public.trainer_profiles;
CREATE POLICY "Public: view validated trainer profiles" ON public.trainer_profiles
    FOR SELECT USING (statut_validation = 'valide' OR user_id = auth.uid());

DROP POLICY IF EXISTS "Trainers: update own profile" ON public.trainer_profiles;
CREATE POLICY "Trainers: update own profile" ON public.trainer_profiles
    FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "SuperAdmin: manage trainer profiles" ON public.trainer_profiles;
CREATE POLICY "SuperAdmin: manage trainer profiles" ON public.trainer_profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND (profiles.role = 'super_admin' OR profiles.is_super_admin = TRUE)
        )
    );



-- ── 3. RESTAURATION DES DONNEES EXISTANTES (BACKUP) ───────────────────────────

-- ── Restauration tenants (4 lignes) ──
INSERT INTO public.tenants ("id", "nom", "slug", "description", "adresse", "ville", "pays", "email", "telephone", "site_web", "logo_url", "statut", "plan", "tier", "montant_mensuel", "derniere_facture", "prochaine_echeance", "limite_membres", "limite_espaces", "contact_admin_id", "settings", "created_at", "updated_at", "cover_url", "latitude", "longitude") VALUES ('680c786d-a318-4689-a951-b4bdaa46adc6', 'askri coworking ', 'askri-coworking--e3f7112c', '', '12 rue de la liberté ', 'tunis', 'Tunisie', 'medaziz.askri@esprit.tn', '54946396', NULL, NULL, 'actif', 'starter', 'C', 0, NULL, NULL, 100, 10, 'e3f7112c-a07e-475a-a95e-8558890d9b6e', '{"onboarding_completed":true}'::jsonb, '2026-09-08T23:09:11.89277+00:00', '2026-09-08T23:12:01.951+00:00', NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.tenants ("id", "nom", "slug", "description", "adresse", "ville", "pays", "email", "telephone", "site_web", "logo_url", "statut", "plan", "tier", "montant_mensuel", "derniere_facture", "prochaine_echeance", "limite_membres", "limite_espaces", "contact_admin_id", "settings", "created_at", "updated_at", "cover_url", "latitude", "longitude") VALUES ('df870ebf-6ca7-4a96-a3c7-17a4eedc3011', 'Coworking space Amine', 'coworking-space-amine-7c312d82', 'test test test ', 'Monplisir ', 'Tunis', 'Tunisie', 'maradouna321@gmail.com', '99 999 999', NULL, NULL, 'actif', 'starter', 'C', 0, NULL, NULL, 100, 10, '7c312d82-1193-4f5b-87b5-e6b1bbd3e9db', '{"onboarding_completed":true}'::jsonb, '2026-08-26T18:42:21.083166+00:00', '2026-08-26T18:48:04.473+00:00', NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.tenants ("id", "nom", "slug", "description", "adresse", "ville", "pays", "email", "telephone", "site_web", "logo_url", "statut", "plan", "tier", "montant_mensuel", "derniere_facture", "prochaine_echeance", "limite_membres", "limite_espaces", "contact_admin_id", "settings", "created_at", "updated_at", "cover_url", "latitude", "longitude") VALUES ('c76217e0-e27a-46e4-8eba-d9f75bbf4822', 'Coworking', 'coworking-58e60eab', NULL, NULL, NULL, 'Tunisie', 's6a-1788975773953@test.local', '', NULL, NULL, 'actif', 'starter', 'C', 0, NULL, NULL, 100, 10, '58e60eab-3c47-47f3-9927-c1d83dd9f602', '{"onboarding_completed":false}'::jsonb, '2026-10-06T08:38:35.03651+00:00', '2026-10-06T08:38:35.03651+00:00', NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.tenants ("id", "nom", "slug", "description", "adresse", "ville", "pays", "email", "telephone", "site_web", "logo_url", "statut", "plan", "tier", "montant_mensuel", "derniere_facture", "prochaine_echeance", "limite_membres", "limite_espaces", "contact_admin_id", "settings", "created_at", "updated_at", "cover_url", "latitude", "longitude") VALUES ('17ebce1c-2537-430d-a0b2-f2bb57ae6908', 'Ala Coworking', 'ala-coworking-8c56a23b', 'Un coworking-space trés spacieux avec des salles climatisées ', 'Rue de la révolution', 'Nabeul', 'Tunisie', 'alabendawed@gmail.com', '+21698115865', '', 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/logos/1788451095534-hiw5onk1zpp.png', 'actif', 'starter', 'C', 0, NULL, NULL, 100, 10, '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', '{"onboarding_completed":true}'::jsonb, '2026-08-25T22:51:46.941284+00:00', '2026-09-07T11:01:33.371+00:00', 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/covers/1788775661208-49x6fyva4c7.png', NULL, NULL) ON CONFLICT DO NOTHING;

-- ── Restauration profiles (31 lignes) ──
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('dbf43302-061c-4ce3-acc6-1f328126c447', 'Super', 'Admin', 'super_admin', '', NULL, 'individuel', NULL, NULL, '2026-08-25T22:44:27.450552+00:00', '2026-08-25T22:44:27.450552+00:00', 'contact@vclow.com', 'actif', NULL, '[]'::jsonb, NULL, '1dba3eb2-442e-439b-9c8d-f958dfaad5a0', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('100f15db-6e56-49ed-b8ec-9abfce386597', 'mm', 'Selim', 'member', '+2162500000', NULL, 'individuel', NULL, NULL, '2026-11-02T15:55:40.24026+00:00', '2026-11-02T15:56:04.544+00:00', 'salimmzabi33@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '67a686b4-ac24-4423-8455-81b623f91bec', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('0e0d1e8e-d444-4669-a10b-035e1a9f93e3', 'Tlemceni', 'Amira', 'admin', '52882930', NULL, 'individuel', NULL, NULL, '2026-10-06T11:16:23.248155+00:00', '2026-10-06T11:17:51.141+00:00', 'amiratlemceni147@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '349688c6-4470-4aae-b258-8aee0e4f7d41', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('58e60eab-3c47-47f3-9927-c1d83dd9f602', '', '', 'admin', '', NULL, 'individuel', NULL, NULL, '2026-09-09T17:42:56.922924+00:00', '2026-10-06T13:27:30.048+00:00', 's6a-1788975773953@test.local', 'suspendu', NULL, '[]'::jsonb, NULL, '9789ee1a-f14f-4250-9b38-f36894d6712c', 'c76217e0-e27a-46e4-8eba-d9f75bbf4822', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'Staff', 'Test', 'admin', '', NULL, 'individuel', NULL, NULL, '2026-09-09T18:00:31.300703+00:00', '2026-09-09T18:00:31.300703+00:00', 't7staff_1788976827924@test.tn', 'actif', NULL, '[]'::jsonb, NULL, '34bb9ba6-e57d-4fd0-bcdf-fa815f2d539e', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'Staff', 'Test', 'admin', '', NULL, 'individuel', NULL, NULL, '2026-09-09T17:56:25.351405+00:00', '2026-11-03T11:37:57.242+00:00', 't7staff_1788976581816@test.tn', 'suspendu', NULL, '[]'::jsonb, NULL, 'd1c077a9-c26a-44ec-90a5-7b7c5227e438', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('56e0bb8d-3d81-4a3b-abc5-cf3dabb7c437', 'Tlemceni', 'Amira', 'member', '52882930', NULL, 'individuel', NULL, NULL, '2026-10-08T11:30:54.528935+00:00', '2026-10-08T11:30:57.167+00:00', 'tlemceniasma@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '4dc36171-65f6-44b1-9c25-8da5030f75a2', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('c9053acb-1d65-434a-a9f1-1c596aa542d5', 'Leg', 'Test', 'admin', '', NULL, 'individuel', NULL, NULL, '2026-09-09T18:01:25.312837+00:00', '2026-09-09T18:01:25.312837+00:00', 't7legacy_staff_1788976881913@test.tn', 'actif', NULL, '[]'::jsonb, NULL, '0c538d55-d662-4a89-b33f-7d95be5ad225', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('91ff8085-3c82-4139-a283-4be7e82376d1', 'Tlemceni', 'Amira', 'member', '52882930', NULL, 'individuel', NULL, NULL, '2026-10-09T17:14:37.534516+00:00', '2026-10-09T17:14:40.053+00:00', 'amiratlemecni@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, 'cefe6d0f-d6df-45ef-9272-aafeb178ffd9', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('c1d10cd9-330e-45f8-a27a-cb57a193dd3f', 'Tlemceni', 'Amira', 'formateur', '52882930', NULL, 'individuel', NULL, NULL, '2026-10-09T17:29:51.142977+00:00', '2026-10-09T17:29:53.088+00:00', 'amiratlemceni95@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '5605aeba-52b9-4848-abeb-d11c79bfe0eb', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('cc8c3452-38c3-4348-a2ed-39b676704a96', 'Staff', 'Test', 'admin', '', NULL, 'individuel', NULL, NULL, '2026-09-09T17:59:48.798831+00:00', '2026-11-03T11:37:59.982+00:00', 't7staff_1788976785381@test.tn', 'actif', NULL, '[]'::jsonb, NULL, '73e9d445-f021-4035-be8f-26022f7d9b8b', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('b2c48775-660f-4173-add8-48247ccbd6ba', 'abdellaoui', 'Med amine', 'admin', '52882880', NULL, 'individuel', NULL, NULL, '2026-11-02T15:35:47.153993+00:00', '2026-11-03T11:38:06.378+00:00', 'mohamedamineeabdellaouii@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '9b1b2626-a1e2-4376-ae6c-a83b24762e01', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('cae36790-491a-40e8-9ea3-b01c6ce822ed', 'Ben Hamouda', 'Anis', 'member', '29634125', NULL, 'individuel', NULL, NULL, '2026-11-03T11:47:55.793716+00:00', '2026-11-03T11:48:01.969+00:00', 'bh.anisbh@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '56028710-8bc0-4f17-91db-5e5ee0540416', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('81433396-ae14-4548-970d-f23cb1028ead', 'formation', 'Epsylone', 'admin', '', NULL, 'individuel', NULL, NULL, '2026-11-03T14:45:53.533965+00:00', '2026-11-03T15:09:29.444+00:00', 'contact.epsyloneformation@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '2356b4bb-3c1c-49ed-93b2-2aade88d7b20', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('3dafda0b-4df8-493e-8feb-e17fcafff95a', 'AAAAAA', 'AAAAAA', 'admin', '+21652882930', NULL, 'individuel', NULL, NULL, '2026-11-03T15:23:34.061117+00:00', '2026-11-03T15:24:17.714+00:00', 'academiekarate@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, 'c6d02124-e9b0-4840-8f85-4c98bc57ed2e', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('eb753bed-d0fc-4ccb-a129-bf2b9c7c9366', 'tlemceni', 'amira', 'admin', '52882930', NULL, 'individuel', NULL, NULL, '2026-10-06T11:14:35.363912+00:00', '2026-10-09T15:56:23.917+00:00', 'amiratlemceni@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, 'f0cb192d-7287-440d-b68f-bb486385b2f3', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'ben daoud', 'ala', 'admin', '+21698115865', NULL, 'individuel', NULL, NULL, '2026-08-25T22:51:46.941284+00:00', '2026-08-25T22:55:32.103+00:00', 'alabendawed@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '79b494b6-5606-48a5-9143-75bffbdc63c9', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('7c312d82-1193-4f5b-87b5-e6b1bbd3e9db', 'Abdellaoui', 'amine', 'admin', '99 999 999', NULL, 'individuel', NULL, NULL, '2026-08-26T18:42:21.083166+00:00', '2026-08-26T18:43:01.166+00:00', 'maradouna321@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '54f908d6-5b82-45c5-841c-f25595f3422e', 'df870ebf-6ca7-4a96-a3c7-17a4eedc3011', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('9ca45216-63ad-4690-8e8e-a32e4edaa1a7', 'test', 'test', 'formateur', '98888777', NULL, 'individuel', 'test', 'test', '2026-09-04T12:46:48.103278+00:00', '2026-09-04T12:46:48.871+00:00', 'ala.antigravity@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '30660ba1-9aad-47ae-8d39-9f3b0d9fa8bc', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('435e55a4-1060-49f8-afad-2130cb08038a', 'Ayoub', 'Abid', 'member', '', NULL, 'individuel', NULL, NULL, '2026-09-30T19:38:55.923486+00:00', '2026-09-30T19:38:55.923486+00:00', 'ayoubabid421@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, 'fc506b6b-1280-4573-b2da-58afbdd12334', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('569ab266-1445-48dc-8117-55e1e6bf62c6', 'ala', 'ala', 'member', '+21698115865', NULL, 'etudiant', NULL, NULL, '2026-09-07T10:55:24.835806+00:00', '2026-09-07T10:55:25.894+00:00', 'alabendaoud4@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '124686f9-1b61-4833-b83e-a1d73c79f58a', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('60cb8f10-f5de-4922-9177-9c3541762e82', 'askri', 'aziz', 'member', '', '', 'individuel', NULL, NULL, '2026-09-08T22:51:41.721821+00:00', '2026-09-08T22:52:42.85+00:00', 'azizaskri2014@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, '7ad1820b-d5d4-4573-8f29-5f26da015050', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('2388ba72-751f-4975-8faf-03178116bc32', 'test', 'test', 'member', '+21698115865', NULL, 'individuel', NULL, NULL, '2026-09-14T14:27:13.661074+00:00', '2026-09-14T14:27:17.919+00:00', 'contactkmitiyahya@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, 'cd516016-d071-4182-a08d-0b7e360ff8f8', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('100227d9-d851-40cb-affd-533a3b8013cf', '', '', 'super_admin', '', NULL, 'individuel', NULL, NULL, '2026-09-09T23:41:06.265952+00:00', '2026-09-09T23:44:39.349+00:00', 'sa2_1788997262621@test.local', 'suspendu', NULL, '[]'::jsonb, NULL, '9379f3d6-2571-4e9d-8608-c6c4ca4b3184', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('72b3adde-db05-42d5-98a5-766fbb952fb9', '', '', 'super_admin', '', NULL, 'individuel', NULL, NULL, '2026-09-09T23:40:09.151628+00:00', '2026-09-09T23:44:43.557+00:00', 'sa_deletetest_1788997205445@test.local', 'suspendu', NULL, '[]'::jsonb, NULL, 'a8a37289-244c-44a6-8c15-01a5f53ec751', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('a3503615-8bbb-403b-b567-c91382841abd', 'Formateur', 'Test', 'formateur', '', NULL, 'individuel', NULL, NULL, '2026-09-09T18:00:31.560603+00:00', '2026-09-10T21:08:20.998+00:00', 't7trainer_1788976827924@test.tn', 'suspendu', NULL, '[]'::jsonb, NULL, '34cce662-afd9-458b-b969-0aaac4e2adc8', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('703e72e6-7b21-408a-aec5-816899b5ce76', 'Formateur', 'Test', 'formateur', '', NULL, 'individuel', NULL, NULL, '2026-09-09T17:59:49.086834+00:00', '2026-09-10T21:08:24.309+00:00', 't7trainer_1788976785381@test.tn', 'suspendu', NULL, '[]'::jsonb, NULL, '19dfc736-8784-4555-bb68-79c7c39a7aa5', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('9e790424-54e6-46d1-8c21-51f879d88ead', '', '', 'member', '', NULL, 'individuel', NULL, NULL, '2026-09-11T10:21:43.852012+00:00', '2026-09-11T10:21:43.852012+00:00', 'mafia301103@gmail.com', 'actif', NULL, '[]'::jsonb, NULL, 'a3cd0eaa-c5b5-41c2-b519-00fa5c51207c', NULL, TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('1ebfa5c0-02c5-41cc-9f07-4d43a897a96f', 'laanani', 'donia', 'formateur', '99309902', NULL, 'individuel', 'designer', 'testtest', '2026-09-04T12:52:30.030747+00:00', '2026-09-16T01:17:35.082+00:00', 'doniabendaoud123@gmail.com', 'actif', 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/avatars/1789521287808-tkqa964zmx.png', '[]'::jsonb, NULL, '9d191c5f-5730-46ec-b091-c3bbbb6f14f0', NULL, TRUE, TRUE, FALSE, NULL, 'both') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('e3f7112c-a07e-475a-a95e-8558890d9b6e', 'askri', 'aziz', 'admin', '54946396', NULL, 'individuel', NULL, NULL, '2026-09-08T23:09:11.89277+00:00', '2026-09-08T23:09:54.636+00:00', 'medaziz.askri@esprit.tn', 'actif', NULL, '[]'::jsonb, NULL, '7b1f26cf-e28c-4de7-be86-b0164766719f', '680c786d-a318-4689-a951-b4bdaa46adc6', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles ("id", "nom", "prenom", "role", "telephone", "cin", "type_membre", "specialite", "biographie", "created_at", "updated_at", "email", "statut_compte", "photo_url", "documents", "notes_admin", "qr_token", "tenant_id", "marketing_email", "marketing_sms", "suppression_demandee", "suppression_at", "canal_notification") VALUES ('16102adf-c6ba-4826-bebb-174c5f55634e', 'ben daoued', 'alaaa', 'member', '98 115 865', '', 'individuel', NULL, NULL, '2026-08-25T23:20:02.784177+00:00', '2026-09-11T11:03:30.069+00:00', 'alaaabendaoued@gmail.com', 'suspendu', NULL, '[]'::jsonb, NULL, 'e7969c5a-c08a-42e7-92df-65b4e610a50d', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', TRUE, TRUE, FALSE, NULL, 'email') ON CONFLICT DO NOTHING;

-- ── Restauration espaces (10 lignes) ──
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('c3d3fffe-72a5-46dd-911b-940cf9d65889', 'espace 2', 'open_space', 30, 10, '2026-08-25T23:09:41.166351+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/espaces/1790808785905-g2j160i8tz7.jpeg', '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('f88f67ae-85f0-4d11-8460-03209dcdeaa5', 'espace 3', 'event_space', 40, 20, '2026-08-25T23:10:29.476212+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/espaces/1787699511678-w752qxmosig.png', '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('0eb4e7f8-a4c3-412a-93c9-2507dcf247bf', 'espace amine 1', 'open_space', 10, 15, '2026-08-26T18:47:35.127127+00:00', 'df870ebf-6ca7-4a96-a3c7-17a4eedc3011', NULL, 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/espaces/1787770137512-anw119immcs.png', '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('86563f6e-d91d-4f25-a8f3-ad2eac599e30', 'salle de formation ala', 'training_room', 10, 15, '2026-09-07T11:46:59.860404+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/espaces/1788781608249-xpj8sbe8vu.png', '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('3f033c3e-aa5a-4737-87ef-9e3384f54b70', '911', 'event_space', 10, 0, '2026-09-08T23:11:58.340509+00:00', '680c786d-a318-4689-a951-b4bdaa46adc6', NULL, 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/espaces/1788909085670-v0u6zyxtokp.webp', '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('01b04de4-61a5-4e8e-880f-caf83a7eb933', 'TESTS6-OS-1788975596140', 'open_space', 10, 20, '2026-09-09T17:39:59.035395+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, NULL, '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('6e8e1785-4861-4513-bfe8-873f84e943b7', 'TESTS6-BP-1788975596140', 'private_office', 1, 50, '2026-09-09T17:39:59.126131+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, NULL, '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('3bcfe671-0ef8-45dc-a1ce-42668a485083', 'TESTS6-OS-1788975688870', 'open_space', 10, 20, '2026-09-09T17:41:31.772342+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, NULL, '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('455219a4-0c57-4a05-9387-227b9ea3a769', 'TESTS6-BP-1788975688870', 'private_office', 1, 50, '2026-09-09T17:41:31.860793+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, NULL, '[]'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id", "site_id", "photo_url", "photos_urls") VALUES ('32610b97-4571-4c2c-97ea-8e1d6cd43566', 'espace 1', 'open_space', 10, 15, '2026-08-25T23:09:12.81289+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/espaces/1790808812722-sl483iyg77.jpeg', '[]'::jsonb) ON CONFLICT DO NOTHING;

-- ── Restauration formations (2 lignes) ──
INSERT INTO public.formations ("id", "titre", "description", "formateur_id", "espace_id", "date_debut", "date_fin", "capacite_max", "prix_inscription", "statut", "programme", "prerequis", "materiel", "created_at", "updated_at", "tenant_id") VALUES ('dc4ed72a-da6b-4fea-beb0-8182b37b78be', 'test', 'test', '9ca45216-63ad-4690-8e8e-a32e4edaa1a7', '86563f6e-d91d-4f25-a8f3-ad2eac599e30', '2026-09-11T08:00:00+00:00', '2026-09-11T11:00:00+00:00', 14, 40, 'planifiee', 'test', 'test', 'test', '2026-09-10T16:40:45.386961+00:00', '2026-09-10T16:40:45.386961+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.formations ("id", "titre", "description", "formateur_id", "espace_id", "date_debut", "date_fin", "capacite_max", "prix_inscription", "statut", "programme", "prerequis", "materiel", "created_at", "updated_at", "tenant_id") VALUES ('45aee5b3-95ea-4485-9b39-91ef68cdd2d2', 'aaaaaaaaa', 'aaaaaaaaaaaaaaaa', '9ca45216-63ad-4690-8e8e-a32e4edaa1a7', '86563f6e-d91d-4f25-a8f3-ad2eac599e30', '2026-09-12T08:00:00+00:00', '2026-09-12T13:00:00+00:00', 20, 30, 'planifiee', 'aaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaa', 'aaaaaaaaaaa', '2026-09-10T16:49:24.782203+00:00', '2026-09-10T16:49:24.782203+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT DO NOTHING;

-- ── Restauration reservations (22 lignes) ──
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('c829f9d7-c03f-4bbf-af3e-65a98f4b4222', '16102adf-c6ba-4826-bebb-174c5f55634e', '32610b97-4571-4c2c-97ea-8e1d6cd43566', '2026-09-20T08:00:00+00:00', '2026-09-20T16:00:00+00:00', 'cancelled', 'on_site', '2026-09-03T19:02:54.247614+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, 0, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('d83f1d72-3806-4bb3-8645-065ef3b521c1', '435e55a4-1060-49f8-afad-2130cb08038a', '3bcfe671-0ef8-45dc-a1ce-42668a485083', '2026-10-01T08:00:00+00:00', '2026-10-01T16:00:00+00:00', 'pending', 'on_site', '2026-09-30T19:39:37.566781+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('ec071133-6107-4fc1-b7bf-01fcb7af301c', '16102adf-c6ba-4826-bebb-174c5f55634e', 'c3d3fffe-72a5-46dd-911b-940cf9d65889', '2026-09-04T08:00:00+00:00', '2026-09-04T11:00:00+00:00', 'cancelled', 'online', '2026-09-03T18:15:40.266093+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('ed48238b-9054-49cd-9507-6baa992d60b1', '16102adf-c6ba-4826-bebb-174c5f55634e', '32610b97-4571-4c2c-97ea-8e1d6cd43566', '2026-08-26T08:00:00+00:00', '2026-08-26T16:00:00+00:00', 'confirmed', 'online', '2026-08-25T23:25:46.873149+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('9500ba9c-f67c-4134-bc7b-279449926207', '16102adf-c6ba-4826-bebb-174c5f55634e', '32610b97-4571-4c2c-97ea-8e1d6cd43566', '2026-09-04T08:00:00+00:00', '2026-09-04T16:00:00+00:00', 'confirmed', 'online', '2026-09-03T17:59:26.440708+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('b8f3469e-a72f-4b40-8b2a-c14360af9a17', '16102adf-c6ba-4826-bebb-174c5f55634e', '32610b97-4571-4c2c-97ea-8e1d6cd43566', '2026-09-06T08:00:00+00:00', '2026-09-06T16:00:00+00:00', 'confirmed', 'on_site', '2026-09-03T18:45:33.353465+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('31354025-39ae-49fe-804d-54911600f540', '16102adf-c6ba-4826-bebb-174c5f55634e', 'f88f67ae-85f0-4d11-8460-03209dcdeaa5', '2026-08-26T08:00:00+00:00', '2026-08-26T16:00:00+00:00', 'cancelled', 'online', '2026-08-25T23:59:17.098159+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('d5990891-74e2-4e95-8ed5-1540ae391224', '16102adf-c6ba-4826-bebb-174c5f55634e', '0eb4e7f8-a4c3-412a-93c9-2507dcf247bf', '2026-08-29T09:00:00+00:00', '2026-08-29T11:00:00+00:00', 'confirmed', 'online', '2026-08-26T19:24:11.37186+00:00', 'df870ebf-6ca7-4a96-a3c7-17a4eedc3011', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('7a8bb580-fc35-4d97-af6f-4be045b425d5', '16102adf-c6ba-4826-bebb-174c5f55634e', '0eb4e7f8-a4c3-412a-93c9-2507dcf247bf', '2026-08-28T08:00:00+00:00', '2026-08-28T16:00:00+00:00', 'confirmed', 'online', '2026-08-26T19:30:40.315903+00:00', 'df870ebf-6ca7-4a96-a3c7-17a4eedc3011', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('5e9d31bb-3c52-456e-99bf-b24535103dc9', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'c3d3fffe-72a5-46dd-911b-940cf9d65889', '2026-10-02T08:00:00+00:00', '2026-10-02T16:00:00+00:00', 'confirmed', 'online', '2026-09-30T23:05:02.067539+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('740c1324-970d-405f-b89e-c148ed330c1b', '16102adf-c6ba-4826-bebb-174c5f55634e', 'c3d3fffe-72a5-46dd-911b-940cf9d65889', '2026-09-05T08:00:00+00:00', '2026-09-05T16:00:00+00:00', 'confirmed', 'online', '2026-09-03T18:16:26.750833+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('90571ebc-359c-42ac-82a0-0dff83874a76', NULL, '0eb4e7f8-a4c3-412a-93c9-2507dcf247bf', '2026-09-07T11:05:00+00:00', '2026-09-07T12:05:00+00:00', 'confirmed', 'online', '2026-09-07T10:06:43.303202+00:00', 'df870ebf-6ca7-4a96-a3c7-17a4eedc3011', 'e9b4cbe2-14bf-4b6a-be21-1621f31a7049', FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('42a98469-3ec6-4a28-9d93-20acaa0fe7e8', '16102adf-c6ba-4826-bebb-174c5f55634e', 'f88f67ae-85f0-4d11-8460-03209dcdeaa5', '2026-09-04T08:00:00+00:00', '2026-09-04T16:00:00+00:00', 'confirmed', 'on_site', '2026-09-03T19:08:40.241203+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('41a84136-c07d-46db-a860-900f7dc13762', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'c3d3fffe-72a5-46dd-911b-940cf9d65889', '2026-10-01T08:00:00+00:00', '2026-10-01T16:00:00+00:00', 'confirmed', 'online', '2026-09-30T23:03:23.329851+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('daa24098-189e-4612-86d9-2b425087ee00', NULL, 'f88f67ae-85f0-4d11-8460-03209dcdeaa5', '2026-10-01T08:00:00+00:00', '2026-10-01T14:00:00+00:00', 'confirmed', 'online', '2026-09-06T18:50:15.171622+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', '1bf88ffc-cfd4-451d-8620-ed254db5ddfe', FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('d3c88dfe-2d22-4c77-a096-eb4a1962fedd', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'c3d3fffe-72a5-46dd-911b-940cf9d65889', '2026-09-07T12:00:00+00:00', '2026-09-07T16:00:00+00:00', 'confirmed', 'on_site', '2026-09-07T11:07:36.829488+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('48e12a3f-db92-4b66-91c8-47a153453928', '9ca45216-63ad-4690-8e8e-a32e4edaa1a7', '86563f6e-d91d-4f25-a8f3-ad2eac599e30', '2026-09-11T08:00:00+00:00', '2026-09-11T11:00:00+00:00', 'confirmed', 'online', '2026-09-10T16:40:44.440243+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('873fb523-7c1b-4ce8-97cb-493b6c693937', '569ab266-1445-48dc-8117-55e1e6bf62c6', '32610b97-4571-4c2c-97ea-8e1d6cd43566', '2026-09-12T08:00:00+00:00', '2026-09-12T16:00:00+00:00', 'confirmed', 'on_site', '2026-09-10T16:46:48.072798+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('30efea26-a0dc-485c-a892-91c000701c7c', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'f88f67ae-85f0-4d11-8460-03209dcdeaa5', '2026-10-02T08:00:00+00:00', '2026-10-02T16:00:00+00:00', 'confirmed', 'online', '2026-09-30T23:06:19.257662+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('6b6ab20d-eb75-46d0-b385-2437277f77af', NULL, 'f88f67ae-85f0-4d11-8460-03209dcdeaa5', '2026-10-08T13:32:00+00:00', '2026-10-08T17:32:00+00:00', 'pending', 'online', '2026-10-08T11:33:06.609409+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', '69f67ebb-a619-4b9c-9f1f-06ace28f5fcf', FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('60dca201-bf5b-4ea3-9a8d-8d521ce1b15e', '9ca45216-63ad-4690-8e8e-a32e4edaa1a7', '86563f6e-d91d-4f25-a8f3-ad2eac599e30', '2026-09-12T08:00:00+00:00', '2026-09-12T13:00:00+00:00', 'confirmed', 'on_site', '2026-09-10T16:49:24.103377+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908', NULL, FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.reservations ("id", "user_id", "espace_id", "date_debut", "date_fin", "statut", "mode", "created_at", "tenant_id", "guest_id", "no_show", "penalite_pct", "credit_id", "site_id") VALUES ('4616a4be-e48f-4237-a1da-6c0fdfe658ae', NULL, '3f033c3e-aa5a-4737-87ef-9e3384f54b70', '2026-09-21T00:45:00+00:00', '2026-09-22T00:45:00+00:00', 'pending', 'online', '2026-09-20T23:46:18.711485+00:00', '680c786d-a318-4689-a951-b4bdaa46adc6', '2a2f50fa-115a-4b3e-8524-252c7748cae7', FALSE, NULL, NULL, NULL) ON CONFLICT DO NOTHING;

-- ── Restauration inscriptions_formations (1 lignes) ──
INSERT INTO public.inscriptions_formations ("id", "formation_id", "user_id", "statut", "statut_paiement", "paiement_id", "present", "created_at", "updated_at", "tenant_id", "guest_id") VALUES ('175dfa31-b68b-414e-843f-30cd3a897d67', '45aee5b3-95ea-4485-9b39-91ef68cdd2d2', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmee', 'paye', 'cbd98b0a-ef45-4492-876e-19148b7f4e6c', FALSE, '2026-09-10T17:52:57.729368+00:00', '2026-09-10T21:06:41.177065+00:00', NULL, NULL) ON CONFLICT DO NOTHING;

-- ── Restauration abonnements (1 lignes) ──
INSERT INTO public.abonnements ("id", "user_id", "type", "date_debut", "date_fin", "renouvellement_auto", "statut", "created_at", "tenant_id", "site_id", "multi_sites", "type_espace") VALUES ('da46d0c2-0537-4c4a-838d-09b465497c85', '16102adf-c6ba-4826-bebb-174c5f55634e', 'mensuel', '2026-09-09', '2026-10-08', FALSE, 'expired', '2026-09-09T17:13:16.124826+00:00', NULL, NULL, FALSE, 'meeting_room') ON CONFLICT DO NOTHING;

-- ── Restauration notifications (178 lignes) ──
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('cce7ce56-acd2-40df-87bd-c9dc2ede62b2', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 1', FALSE, '2026-08-25T23:25:47.359309+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c7fb575f-4399-401c-8b0c-4c36c60f3e48', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace amine 1', FALSE, '2026-08-26T19:24:11.498854+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('d2c3fc08-b35f-48ae-abaa-75e28854475d', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace amine 1', FALSE, '2026-08-26T19:30:40.459978+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2713ec68-02d7-43c9-a4de-3126d242cf20', '16102adf-c6ba-4826-bebb-174c5f55634e', 'annulation_reservation', 'Email', '🗑️ Réservation annulée — espace 3', FALSE, '2026-09-03T17:53:59.489833+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('6ab689b1-c0b3-4267-b5c0-f2ffb70dbf18', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 1', FALSE, '2026-09-03T17:59:26.519329+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ce7a57ea-2c7c-44fa-b084-a6795e956696', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 2', FALSE, '2026-09-03T18:17:09.347731+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c118225c-6882-4480-a94a-4847a7a181ae', '16102adf-c6ba-4826-bebb-174c5f55634e', 'annulation_reservation', 'Email', '🗑️ Réservation annulée — espace 2', FALSE, '2026-09-03T18:17:22.540509+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('b0d043dc-3a7e-47c5-afb8-492675eeb97e', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 1', FALSE, '2026-09-03T18:46:37.331644+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5bddaf7b-8055-44ef-b4b9-c3e657d0e047', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de alaaa ben daoued pour espace 1 — Paiement : Sur place', TRUE, '2026-09-03T19:02:54.526211+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('fd54f75a-9ee2-4b68-9350-a2b9ed03d62b', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 1', FALSE, '2026-09-03T19:04:26.357066+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('fc3a12ac-9dfd-40ab-86ac-51d21c50f3d0', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Dashboard', '✅ Votre réservation pour espace 1 a été acceptée ! Paiement : 💵 sur place à l''accueil.', FALSE, '2026-09-03T19:04:28.389738+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('fc1c5ccb-8c05-479e-8a77-eedf3fb4cf25', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de alaaa ben daoued pour espace 3 — Paiement : Sur place', TRUE, '2026-09-03T19:08:40.964093+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('674b1132-8a56-4a02-99a1-55db4ea0b32d', '16102adf-c6ba-4826-bebb-174c5f55634e', 'annulation_reservation', 'Email', '🗑️ Réservation annulée — espace 3', FALSE, '2026-09-03T19:09:44.206692+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('da87e276-c62f-42db-a23f-e6e4997b6383', '16102adf-c6ba-4826-bebb-174c5f55634e', 'annulation_reservation', 'Dashboard', '❌ Votre réservation pour espace 3 a été annulée.', FALSE, '2026-09-03T19:09:46.011624+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('78adf600-2619-42c7-a32a-14ef0f0e8b45', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'annulation_reservation', 'Dashboard', '🚫 ala ben daoud a annulé sa réservation pour espace 3.', TRUE, '2026-09-03T19:09:46.170312+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('6b009b89-accb-420f-b4d8-dcef331945bd', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : Sur place', TRUE, '2026-09-07T11:07:37.139142+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('0c83664a-6882-4e0c-acc7-cc1eda3c6035', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 2', FALSE, '2026-09-07T11:08:36.401202+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('f22fe2b7-7e22-4738-a4e8-8b86be092eeb', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Dashboard', '✅ Votre réservation pour espace 2 a été acceptée ! Paiement : 💵 sur place à l''accueil.', FALSE, '2026-09-07T11:08:38.138505+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('e490121b-d67c-4544-ab09-eed2475e6527', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de   pour Bureau privé smoke T5 — Paiement : En ligne', TRUE, '2026-09-09T17:04:43.204039+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2ca98e85-e7a4-40f4-866a-80004b89a07a', '16102adf-c6ba-4826-bebb-174c5f55634e', 'annulation_reservation', 'Email', '🗑️ Réservation annulée — espace 1', FALSE, '2026-09-09T17:32:17.737901+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('e86b5413-ff84-4862-85dc-7798397192f3', '16102adf-c6ba-4826-bebb-174c5f55634e', 'annulation_reservation', 'Dashboard', '❌ Votre réservation pour espace 1 a été annulée.', FALSE, '2026-09-09T17:32:18.669495+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2275226b-3fc5-4963-8ccb-9a2fba59a95a', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T17:59:52.654107+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('a4b76efb-509e-4359-b16f-61f358564029', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T17:59:53.637802+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2c7d2076-7f55-4397-95cf-0b9bc3eb6f6e', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support Formateur', FALSE, '2026-09-09T17:59:59.059905+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c336f078-a7e7-4715-9fd6-41ade8c4acac', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support Formateur', FALSE, '2026-09-09T17:59:59.960772+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5e89664c-f3cb-4b10-a158-b6f7a91a29eb', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:00:34.418324+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('3de52f92-0bd6-4f83-987e-8a481c8683bc', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:00:34.889497+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('57271a6b-4a5f-4490-931f-0a6a68531234', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:00:36.020421+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('99e3f662-9311-4970-9a65-1ba09a15507c', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:00:39.55801+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5f138913-1b2a-475d-9ad1-6f424d5e7917', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:00:41.02858+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('8126fe38-ad1d-492b-bd08-4119bcb75096', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support Formateur', FALSE, '2026-09-09T18:00:45.308529+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('95d838bb-4cf9-45bd-9c69-e108ebb85891', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support Formateur', FALSE, '2026-09-09T18:00:45.847254+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('cf10480a-f61e-499a-a374-5a00fec81d28', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support Formateur', TRUE, '2026-09-09T17:59:59.511217+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('0e5b5f7e-fe63-4c0e-bdca-0f2a73e4f0d2', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Tache6 Test-M pour TESTS6-OS-1788975596140 — Paiement : En ligne', TRUE, '2026-09-09T17:40:01.213935+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('e992bf6a-f719-4740-af59-62e54ad5c924', '16102adf-c6ba-4826-bebb-174c5f55634e', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 3', TRUE, '2026-08-25T23:59:17.358282+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c21436db-d9f0-461b-bbe2-4a9b30d599ff', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:01:27.856462+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('27fc6c76-dfa5-4c4c-b133-b68dc42b78a2', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'nouveau_coworking_en_attente', 'Dashboard', '🏢 Nouvelle demande de compte Admin Coworking : aziz askri (medaziz.askri@esprit.tn) — En attente de validation.', TRUE, '2026-09-08T23:09:13.215338+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('92763bee-8ae9-484d-b6e3-f7c326b33544', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', TRUE, '2026-09-09T18:01:28.912758+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('6f3610ea-7c20-4758-9a5c-fceb36f9910d', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support Formateur', TRUE, '2026-09-09T18:00:46.392165+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('8b9c3fc2-32e9-493e-ba8a-813e370cf3fc', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support Formateur', FALSE, '2026-09-09T18:00:46.823231+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('9fffef58-e25a-4e0d-92b3-56e02cde0d14', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:01:27.244548+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('41fbc412-6dae-4f4d-9d82-99fdc22685ca', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:01:28.393462+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('19ceadce-e476-40a7-8bb5-b0f7605a3533', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:01:29.428634+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('b40b1120-71b9-4941-81bf-96931d38a43f', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Tache6 Test-M pour TESTS6-BP-1788975596140 — Paiement : En ligne', TRUE, '2026-09-09T17:40:04.650036+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('85ba10a3-ddf2-4c62-96be-9118d54f33e3', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'annulation_reservation', 'Dashboard', '🚫 Tache6 Test-M a annulé sa réservation pour TESTS6-BP-1788975596140.', TRUE, '2026-09-09T17:40:07.561115+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('62c023ee-da3e-4613-a1f6-898700e2997a', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Tache6 Test-M pour TESTS6-OS-1788975596140 — Paiement : En ligne', TRUE, '2026-09-09T17:40:09.607837+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('d072c16c-487b-47bf-a3ae-8ddb5241a652', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Tache6 Test-M pour TESTS6-OS-1788975688870 — Paiement : En ligne', TRUE, '2026-09-09T17:41:33.763678+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('eb02c0ef-eb38-4051-a14c-5d38c027bb17', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'annulation_reservation', 'Dashboard', '🚫 Tache6 Test-M a annulé sa réservation pour TESTS6-OS-1788975688870.', TRUE, '2026-09-09T17:41:35.87073+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('d497295c-5e12-4959-916e-e59c12cb5b18', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Tache6 Test-M pour TESTS6-BP-1788975688870 — Paiement : En ligne', TRUE, '2026-09-09T17:41:37.850521+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('88a9c4b2-b055-4880-b299-4664ded88b77', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'annulation_reservation', 'Dashboard', '🚫 Tache6 Test-M a annulé sa réservation pour TESTS6-BP-1788975688870.', TRUE, '2026-09-09T17:41:40.472872+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('17d770bf-03b9-44c5-b8ba-571bccffbc9d', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Tache6 Test-M pour TESTS6-OS-1788975688870 — Paiement : En ligne', TRUE, '2026-09-09T17:41:42.119361+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('f46797ea-1443-490a-ae20-d00e1fd6f80b', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', TRUE, '2026-09-09T17:59:53.215407+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ad15afb9-98b4-4062-a805-4ed4af6c214f', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', TRUE, '2026-09-09T18:00:35.453058+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5426fcb7-ee21-4e09-aed0-87adbde8ba44', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', TRUE, '2026-09-09T18:00:40.541343+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('6559deb1-8c67-4e23-b2d0-b86858fbb51b', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:10.629621+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('84f6d089-19a6-4190-9513-a0e25f48754f', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:11.297748+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('38b1e335-d667-4e6d-b640-c5e56e2f7c37', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:12.025833+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('8a5a845d-f5b2-43ed-a2ea-528235d7fb84', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:13.603564+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('0bf53466-87fc-4430-879b-7d0e09ce7bc6', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:17.416324+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('651227c3-681e-4162-91c5-3d5874c03131', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:18.287546+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('af427aee-6f4f-4bed-bb61-6ff9e8c4e628', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:19.25632+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('0d2e9ebd-65d8-40dd-ba93-6e75106b7b5d', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:21.21169+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('edb9f611-ad7c-49d6-9c16-4a678ec8f3ec', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:57.109212+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('10c98c1a-8d1d-4c74-9e86-8ad84f6dabdc', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:57.733092+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('e21dbcd7-ef88-48d1-b6e3-8cf9dd0c9ee5', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:58.320705+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c0b11edd-aea9-40ab-92b7-d1422e176c7d', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', FALSE, '2026-09-09T18:14:59.73184+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('199fffd6-6965-4a1f-9236-c1a0aea5140e', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', TRUE, '2026-09-09T18:14:59.183317+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('d3ebd2f7-8900-4430-8c51-c9051a4334ac', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:03.046347+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('729daabd-046c-4b0e-a899-210ebc5a5c68', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:03.967193+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2c6890bb-3e0b-4265-b0d0-02ddee60271e', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:04.726511+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('01ff73a0-ce64-430f-894c-5c13bce85ddc', '16102adf-c6ba-4826-bebb-174c5f55634e', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:05.519714+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ae39b58f-785d-4007-b685-6ead1d9b0d3a', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:06.416309+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('8a1cb62d-78b6-40ba-99c3-90f83ebaca66', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:52.262947+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5d3dd6ca-09f3-4416-8e34-13b48e063df4', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:52.862913+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('821fe598-105a-419a-b681-b46e8292544b', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:53.457403+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('a6f2012a-32c1-4ad5-838a-a8bf7191d1b0', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-09T23:31:56.778041+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('06a9b107-0a8d-4ba4-9106-e408fd8975b6', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', TRUE, '2026-09-09T23:31:55.197303+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('6b96285d-3191-4462-bd4e-408c4e8ab74d', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-10T15:12:22.635615+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('27492b92-1479-4b94-bfb4-7b23b4f62ec6', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-10T15:12:25.408512+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('75776d6e-c968-4a79-898e-8288844b5ad9', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-10T15:12:27.620815+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ca10a44f-cece-447a-96d6-a56a6778c47c', '16102adf-c6ba-4826-bebb-174c5f55634e', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-10T15:12:29.568423+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('6408d106-de1b-45e3-9a2c-73c0f967cda2', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-10T15:12:31.77194+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('31f0595a-8ff2-44e0-ae6b-9cc2d6209dab', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation liée à la formation « test » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-10T16:40:44.936245+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('9df12527-3607-437e-9dd6-01bfbbe813b5', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation liée à la formation « test » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-10T16:40:45.00975+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('fc2df0ae-fd40-4cfd-9a39-895b8f887cee', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation liée à la formation « test » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-10T16:40:45.0816+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('a3a38c3f-7741-453d-b233-1738871f5239', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation liée à la formation « test » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-10T16:40:45.219491+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ca92e142-f138-48cc-be75-5c4be89e5b4b', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', TRUE, '2026-09-09T18:14:20.523564+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('a4ac92a9-0721-4676-bddb-6e96441c9577', '9ca45216-63ad-4690-8e8e-a32e4edaa1a7', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — salle de formation ala', TRUE, '2026-09-10T16:41:30.956518+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('632e5959-5734-44ff-948e-cc6532d18ee5', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 1 — Paiement : Sur place', FALSE, '2026-09-10T16:46:48.306983+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('1e48d7f5-5daf-40d2-b6fe-c646c705fbca', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 1 — Paiement : Sur place', FALSE, '2026-09-10T16:46:48.383277+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('3469c339-f3e0-4bf2-b585-9319fcd6b9a9', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 1 — Paiement : Sur place', FALSE, '2026-09-10T16:46:48.445145+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('7d277d4c-6901-4a65-b0f0-9f8b8a65ab28', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 1 — Paiement : Sur place', FALSE, '2026-09-10T16:46:48.579965+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('80df68db-8b6e-4587-bb92-4f7aabfb8b18', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 1 — Paiement : Sur place', TRUE, '2026-09-10T16:46:48.513439+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('937d6865-8605-4766-815b-4ed8e41b02a1', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 1', FALSE, '2026-09-10T16:47:22.482097+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('83cde897-0efb-4af5-8528-920325110825', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Dashboard', '✅ Votre réservation pour espace 1 a été acceptée ! Paiement : 💵 sur place à l''accueil.', FALSE, '2026-09-10T16:47:25.331927+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('9f03c19c-cb3f-4816-840d-6797573e7495', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « aaaaaaaaa » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-10T16:49:24.343097+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('16b50d35-e4ae-466a-9e88-dad7906b7955', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « aaaaaaaaa » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-10T16:49:24.423021+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('f7e3d8b0-829f-40a8-8f9e-2b7a03d4a756', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « aaaaaaaaa » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-10T16:49:24.487775+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('595760b4-322b-4222-ae54-973bb8de8db6', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « aaaaaaaaa » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-10T16:49:24.626146+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('4d2bd6e4-c21f-4433-9407-0bb55fcd46a0', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « test » — salle de formation ala (en attente de confirmation).', TRUE, '2026-09-11T11:08:54.127064+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5c8c9608-5161-46ac-bc2e-d1163837542e', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « aaaaaaaaa » — salle de formation ala (en attente de confirmation).', TRUE, '2026-09-10T16:49:24.5507+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2baa34dd-cfa5-4ea1-8cf6-d35f38e06337', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouveau_message_portail', 'Email', '💬 Nouveau message : Support 33S', TRUE, '2026-09-09T18:14:13.062458+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('8f60e781-87ff-4cd4-9a70-18fd0b0459bd', '16102adf-c6ba-4826-bebb-174c5f55634e', 'inscription_formation', 'Email', '🎓 Inscription confirmée — aaaaaaaaa', FALSE, '2026-09-10T18:05:52.254502+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('daf21047-e6ed-4a0b-8415-82db011ca67f', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation liée à la formation « test » — salle de formation ala (en attente de confirmation).', TRUE, '2026-09-10T16:40:45.152499+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5788ea14-a479-4d0d-b705-f3dc561d0f79', '9ca45216-63ad-4690-8e8e-a32e4edaa1a7', 'rappel_reservation_j1', 'Email', '📅 Rappel : Votre réservation est demain', TRUE, '2026-09-10T16:59:59.90212+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('58217214-655c-43c7-b44b-f9a6d200ece1', '9ca45216-63ad-4690-8e8e-a32e4edaa1a7', 'confirmation_reservation', 'Dashboard', '✅ Votre réservation pour salle de formation ala a été acceptée ! Paiement : 💳 en ligne depuis votre espace membre.', TRUE, '2026-09-10T16:41:33.788288+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('60d99e7b-c4ae-4c47-841c-ca193fcc81ca', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-11T10:40:16.816043+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('9f8d9ad1-2eae-494e-97f1-0f3cf6ba0bd7', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-11T10:40:17.809819+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('564e0d84-d0b4-4772-93ba-e816bd081bb5', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-11T10:40:18.45951+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('3fc5b36b-59c8-45c5-8f22-c572c0a413c3', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-11T10:40:19.854405+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('52cee1c2-558b-4d7f-ac96-8404012ec72d', '16102adf-c6ba-4826-bebb-174c5f55634e', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', TRUE, '2026-09-11T10:40:19.099167+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('1faed540-c27d-4f32-830b-8320edd47934', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « test » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-11T11:08:53.835404+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ee43bbcd-770d-4e0b-8d23-fd2cecbdc490', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « test » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-11T11:08:53.963109+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('662d0e5b-9916-4f13-b501-e13f10d802b2', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « test » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-11T11:08:54.045066+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('7999c9a2-3654-4c40-8b07-625113c5e0c4', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouvelle_demande_reservation', 'Dashboard', '📋 Réservation (sur place) liée à la formation « test » — salle de formation ala (en attente de confirmation).', FALSE, '2026-09-11T11:08:54.207022+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ddb23229-a4b7-4f33-a09b-4a02322c61ae', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'nouvelle_formation', 'Email', '🎓 Nouvelle formation : « test » par Amira Tlemceni le 11 sept. à 12:10. test', FALSE, '2026-09-11T11:08:55.917542+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('90ad6b7d-d96c-42ea-8e4f-e0fba13b7b30', '60cb8f10-f5de-4922-9177-9c3541762e82', 'nouvelle_formation', 'Email', '🎓 Nouvelle formation : « test » par Amira Tlemceni le 11 sept. à 12:10. test', FALSE, '2026-09-11T11:08:55.917542+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('bb44f686-bf07-4061-bf14-1085b00367f4', '9e790424-54e6-46d1-8c21-51f879d88ead', 'nouvelle_formation', 'Email', '🎓 Nouvelle formation : « test » par Amira Tlemceni le 11 sept. à 12:10. test', FALSE, '2026-09-11T11:08:55.917542+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('b3b7733b-c1a8-4b83-9d8c-0c16a071212d', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'test_notification', 'Email', 'test_notification', FALSE, '2026-09-15T12:31:11.836111+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('d6470d14-2bc0-4703-812e-38cf1d808097', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'test_notification', 'Email', 'test_notification', FALSE, '2026-09-15T12:31:55.61911+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('48871e06-531e-429a-ba0a-3d151c60df0f', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'test_notification', 'Email', '✨ Test de Notification — DeskyWork', FALSE, '2026-09-15T12:32:42.202723+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2a963bfc-f25e-4871-bfe7-e6159936a2c6', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'test_notification', 'Email', 'test', FALSE, '2026-09-15T12:33:57.553016+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('0a835eea-c017-4a80-8a0b-158fe0904445', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'test_notification', 'Email', 'test', FALSE, '2026-09-15T12:34:13.190173+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ef9761ac-b2e1-4c0c-b5eb-58f3d799e59a', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'test_notification', 'SMS', 'test', FALSE, '2026-09-15T12:34:14.383396+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('402793fd-e535-4e79-a1b9-f4a45569c5d2', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'test_notification', 'Email', '✨ Test de Notification — DeskyWork', FALSE, '2026-09-15T12:34:51.234608+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('170420cf-4d5f-4202-8805-aba898314011', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'test_notification', 'Email', '✨ Test de Notification — DeskyWork', FALSE, '2026-09-15T12:43:58.597549+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ecad16b1-ecab-4296-a608-9a3373a4dedd', '16102adf-c6ba-4826-bebb-174c5f55634e', 'nouvelle_formation', 'Email', '🎓 Nouvelle formation : « test » par Amira Tlemceni le 11 sept. à 12:10. test', TRUE, '2026-09-11T11:08:55.917542+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('69c16402-38bf-4f7d-9ead-3f2d9bc8567b', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-16T01:21:11.11544+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('7c831146-6398-462f-8195-958b270e39fe', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-16T01:21:11.2461+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('448b6af3-0c49-4588-8730-54639b62738b', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-16T01:21:11.379828+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('afb43e07-7b3b-489e-a422-03bd5995a399', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', FALSE, '2026-09-16T01:21:11.62314+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('6895cb5e-bc14-4a73-8bd1-3deca83f6325', '16102adf-c6ba-4826-bebb-174c5f55634e', 'nouveau_message_portail', 'Email', '💬 Nouveau message : alaaa ben daoued', TRUE, '2026-09-16T01:21:11.502103+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('4f91654c-9e34-4371-8407-67ee2d016800', 'e3f7112c-a07e-475a-a95e-8558890d9b6e', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Amira Tlemecni pour 911 — Paiement : Sur place', FALSE, '2026-09-16T17:08:40.419634+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('b38f13f7-a6ac-4f42-b30f-031aaaee6d21', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Abid Ayoub pour TESTS6-OS-1788975688870 — Paiement : Sur place', FALSE, '2026-09-30T19:39:38.570943+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('3a024f07-60ab-4c84-a8fc-a7615c7fdbd0', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Abid Ayoub pour TESTS6-OS-1788975688870 — Paiement : Sur place', FALSE, '2026-09-30T19:39:38.782404+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ccb3d74d-995e-4a74-af2e-5b8eebdbefe5', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Abid Ayoub pour TESTS6-OS-1788975688870 — Paiement : Sur place', FALSE, '2026-09-30T19:39:38.96331+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('cb2fa989-7e1c-433f-8fbc-40b89c3f4aad', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Abid Ayoub pour TESTS6-OS-1788975688870 — Paiement : Sur place', FALSE, '2026-09-30T19:39:39.369873+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('a9419251-0735-472c-8d8a-ffe7ad48a164', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', FALSE, '2026-09-30T23:03:24.545971+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c99fa1f9-0a21-4d13-bf96-20c933cb21e3', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', FALSE, '2026-09-30T23:03:24.768557+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('fb804883-c03d-4c18-9312-e6ca44bd8995', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', FALSE, '2026-09-30T23:03:24.956762+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('7b3c2505-696c-415a-a389-10642cb421d4', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', FALSE, '2026-09-30T23:03:25.334536+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5a2c5d2b-0643-4702-b1b7-8807c2f5baf3', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', FALSE, '2026-09-30T23:05:02.773488+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('338a0190-8658-40b2-93ab-95b03cbb798e', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', FALSE, '2026-09-30T23:05:02.987945+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c5b6adff-b735-48a0-9779-9c0c213493e6', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', FALSE, '2026-09-30T23:05:03.187086+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('719dcd12-f6d8-4e21-a1c6-c273c02caeb0', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', FALSE, '2026-09-30T23:05:03.917219+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('33e3abf4-5eb4-4034-b276-69dc34e08530', 'cc8c3452-38c3-4348-a2ed-39b676704a96', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 3 — Paiement : En ligne', FALSE, '2026-09-30T23:06:19.902398+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c5dc8cc9-2c4c-48b0-b7a7-ec839abe856c', '89e6d0a7-25e2-46b9-aa8c-77e6594b20b7', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 3 — Paiement : En ligne', FALSE, '2026-09-30T23:06:20.11662+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('b643e66c-ed16-45ff-bf37-17e862a7127b', 'c9053acb-1d65-434a-a9f1-1c596aa542d5', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 3 — Paiement : En ligne', FALSE, '2026-09-30T23:06:20.287442+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ac5f5fd9-81a6-4e98-bbf3-9734a3d64cbe', 'be0d7d5b-e9f6-44ac-b5e3-f470421a1c25', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 3 — Paiement : En ligne', FALSE, '2026-09-30T23:06:20.668242+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('f516e499-a21d-4325-990f-d3f0e5eccece', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 3', FALSE, '2026-09-30T23:06:50.314873+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('dfc6707e-3882-417c-adc2-58b59311ec25', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Dashboard', '✅ Votre réservation pour espace 3 a été acceptée ! Paiement : 💳 en ligne depuis votre espace membre.', FALSE, '2026-09-30T23:06:50.516038+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('8882ccf5-c725-46b5-a11c-af6117d3844a', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 2', FALSE, '2026-09-30T23:06:52.49641+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('f32cc94f-24c3-464b-8302-811c0514605e', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Dashboard', '✅ Votre réservation pour espace 2 a été acceptée ! Paiement : 💳 en ligne depuis votre espace membre.', FALSE, '2026-09-30T23:06:52.682379+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('d9e7f3be-7e7c-4468-b3ce-08cab6ad1611', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Email', '✅ Réservation confirmée — espace 2', FALSE, '2026-09-30T23:07:02.988232+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('214f5289-09e1-4605-bd02-7392a37b5404', '569ab266-1445-48dc-8117-55e1e6bf62c6', 'confirmation_reservation', 'Dashboard', '✅ Votre réservation pour espace 2 a été acceptée ! Paiement : 💳 en ligne depuis votre espace membre.', FALSE, '2026-09-30T23:07:03.207546+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('9c587782-7a48-4d47-83a9-cad3168630c6', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de Abid Ayoub pour TESTS6-OS-1788975688870 — Paiement : Sur place', TRUE, '2026-09-30T19:39:39.170466+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('625fd1d4-1361-4adf-8032-e47b87c21cf4', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', TRUE, '2026-09-30T23:03:25.140351+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('a38c8941-c742-4afd-aa27-a17cd54a3be4', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 2 — Paiement : En ligne', TRUE, '2026-09-30T23:05:03.367786+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('47daeec2-a985-44fa-8fc5-baa269b6dc9c', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'nouvelle_demande_reservation', 'Dashboard', '📋 Nouvelle demande de réservation de ala ala pour espace 3 — Paiement : En ligne', TRUE, '2026-09-30T23:06:20.477379+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('d2370a14-6a19-416f-ace3-fccd3d6a4373', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : med amine abdellaoui (amiratlemceni@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T08:32:53.917275+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('021d57f8-f5bb-459f-8ca2-a139b5c376a9', '100227d9-d851-40cb-affd-533a3b8013cf', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : med amine abdellaoui (amiratlemceni@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T08:32:54.003768+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('7ef56587-7089-4d68-b0b2-bd9337aa8ff6', '72b3adde-db05-42d5-98a5-766fbb952fb9', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : med amine abdellaoui (amiratlemceni@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T08:32:54.089182+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('3c501cb9-1550-48f3-92ca-a5a51a1678af', '16102adf-c6ba-4826-bebb-174c5f55634e', 'abonnement_expirant_j7', 'Email', '📆 Votre abonnement expire dans 7 jours', FALSE, '2026-10-06T09:30:00.638223+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('b122ec5c-b0ce-4338-bf33-5f8679d49f40', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : amira tlemceni (amiratlemceni@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T11:14:38.573698+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2ebb4905-74a2-4839-b213-22db1778575a', '100227d9-d851-40cb-affd-533a3b8013cf', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : amira tlemceni (amiratlemceni@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T11:14:38.782395+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('3fcdd8cc-da21-4ff0-8b25-3d3862c80e95', '72b3adde-db05-42d5-98a5-766fbb952fb9', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : amira tlemceni (amiratlemceni@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T11:14:38.976484+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('2f35fcd1-c1bf-4702-9d17-3e1d41a5f28b', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : Amira Tlemceni (amiratlemceni147@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T11:16:27.183534+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('874da2c4-0db3-4d32-a727-3d48405f4667', '100227d9-d851-40cb-affd-533a3b8013cf', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : Amira Tlemceni (amiratlemceni147@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T11:16:27.386311+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('7078ab6f-ca12-4142-804a-41617fbc9a64', '72b3adde-db05-42d5-98a5-766fbb952fb9', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Admin Coworking) : Amira Tlemceni (amiratlemceni147@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-06T11:16:27.912135+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('79c0eb33-d66a-409d-a785-ab14ddb418ef', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Membre) : Amira Tlemceni (tlemceniasma@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-08T11:30:57.74992+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('ecfeac74-7710-4ee1-8d8a-cd47530569f9', '100227d9-d851-40cb-affd-533a3b8013cf', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Membre) : Amira Tlemceni (tlemceniasma@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-08T11:30:58.291588+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('a0103de9-25fe-46c4-acfd-8dfd5bd40c06', '72b3adde-db05-42d5-98a5-766fbb952fb9', 'nouveau_compte_en_attente', 'Dashboard', '👤 Nouvelle inscription (Membre) : Amira Tlemceni (tlemceniasma@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-10-08T11:30:58.497394+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('c58d54e6-4739-4bcf-8dd4-327f25398a01', '100227d9-d851-40cb-affd-533a3b8013cf', 'nouveau_coworking_en_attente', 'Dashboard', '🏢 Nouvelle demande de coworking : Med amine abdellaoui (mohamedamineeabdellaouii@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-11-02T15:35:51.472242+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('e4df5acf-1828-415f-a144-88863ddc3425', '72b3adde-db05-42d5-98a5-766fbb952fb9', 'nouveau_coworking_en_attente', 'Dashboard', '🏢 Nouvelle demande de coworking : Med amine abdellaoui (mohamedamineeabdellaouii@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-11-02T15:35:52.002055+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('8b5682a9-737e-4e91-9454-c9c82d760972', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'nouveau_coworking_en_attente', 'Dashboard', '🏢 Nouvelle demande de coworking : Med amine abdellaoui (mohamedamineeabdellaouii@gmail.com) — En attente d''approbation Super Admin.', TRUE, '2026-11-02T15:35:51.270039+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('5283266c-aa8d-4711-b457-b6e28de0de67', 'dbf43302-061c-4ce3-acc6-1f328126c447', 'nouveau_coworking_en_attente', 'Dashboard', '🏢 Nouvelle demande de coworking : AAAAAA AAAAAA (academiekarate@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-11-03T15:23:37.206726+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('8d38877d-2991-4965-a9b4-d2c2172063ca', '100227d9-d851-40cb-affd-533a3b8013cf', 'nouveau_coworking_en_attente', 'Dashboard', '🏢 Nouvelle demande de coworking : AAAAAA AAAAAA (academiekarate@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-11-03T15:23:37.831427+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.notifications ("id", "user_id", "type", "canal", "message", "lu", "created_at", "tenant_id") VALUES ('d6cd4b97-eb07-4c83-9699-edcaf61e2fa0', '72b3adde-db05-42d5-98a5-766fbb952fb9', 'nouveau_coworking_en_attente', 'Dashboard', '🏢 Nouvelle demande de coworking : AAAAAA AAAAAA (academiekarate@gmail.com) — En attente d''approbation Super Admin.', FALSE, '2026-11-03T15:23:38.086373+00:00', NULL) ON CONFLICT DO NOTHING;

-- ── Restauration contacts (3 lignes) ──
INSERT INTO public.contacts ("id", "nom", "email", "sujet", "message", "statut", "created_at", "updated_at") VALUES ('6e5028e7-0bc4-461b-93b3-f597c1c1a2e7', 'test', 'test@g.com', 'Autre demande', 'test', 'nouveau', '2026-09-10T23:01:19.865424+00:00', '2026-09-10T23:03:46.649+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.contacts ("id", "nom", "email", "sujet", "message", "statut", "created_at", "updated_at") VALUES ('6e8597b5-2f6a-49c7-923b-2c3516a3eff5', 'aaaaa', 'aaaaa@gmail.com', 'Abonnement mensuel', 'test hahahah', 'nouveau', '2026-09-10T23:17:37.932545+00:00', '2026-09-10T23:17:37.932545+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.contacts ("id", "nom", "email", "sujet", "message", "statut", "created_at", "updated_at") VALUES ('a3a08234-6bf7-489e-bd19-b29f1684281a', 'Test', 't@t.local', 'S', 'Hello', 'nouveau', '2026-09-11T09:42:43.51504+00:00', '2026-09-11T09:42:43.51504+00:00') ON CONFLICT DO NOTHING;

-- ── Restauration conversations (10 lignes) ──
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('2271f5c5-eb50-4c6d-9a65-f2827a8c13f4', 'Support 33S', 'support', '16102adf-c6ba-4826-bebb-174c5f55634e', '2026-09-08T23:06:31.893949+00:00', '2026-09-09T18:23:35.486+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('5564f3ad-b2a6-4836-9064-e17d7e954a74', 'Support 33S', 'support', '16102adf-c6ba-4826-bebb-174c5f55634e', '2026-09-08T23:06:32.176999+00:00', '2026-09-09T18:46:01.034+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('3d49d961-4289-49ab-b93b-4803d47a1dd5', 'alaaa ben daoued', 'support', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', '2026-09-09T23:30:44.743869+00:00', '2026-09-16T01:21:10.445+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('9dca8b31-1305-47db-969b-b2279702962e', 'Support 33S', 'support', '1ebfa5c0-02c5-41cc-9f07-4d43a897a96f', '2026-09-30T23:25:20.61233+00:00', '2026-09-30T23:25:20.61233+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('95bf6a72-d975-41f6-9bc7-13e66b02ccf8', 'Support 33S', 'support', '1ebfa5c0-02c5-41cc-9f07-4d43a897a96f', '2026-09-30T23:25:20.705291+00:00', '2026-09-30T23:25:20.705291+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('c78cb623-00cd-42da-9915-97032d2f36d2', 'Support 33S', 'support', '569ab266-1445-48dc-8117-55e1e6bf62c6', '2026-09-30T23:25:48.002485+00:00', '2026-09-30T23:25:48.002485+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('a525a0c7-09f9-40ba-8b5c-2f4469114178', 'Support 33S', 'support', '569ab266-1445-48dc-8117-55e1e6bf62c6', '2026-09-30T23:25:48.07393+00:00', '2026-09-30T23:25:48.07393+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('f803f010-ecc5-4064-9c68-31703209b44b', 'Support 33S', 'support', '91ff8085-3c82-4139-a283-4be7e82376d1', '2026-10-09T17:24:57.290781+00:00', '2026-10-09T17:24:57.290781+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('3d9cc9d5-e438-4226-8f9c-2b5be4e3c18a', 'Support 33S', 'support', 'c1d10cd9-330e-45f8-a27a-cb57a193dd3f', '2026-10-09T17:31:54.78497+00:00', '2026-10-09T17:31:54.78497+00:00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.conversations ("id", "title", "type", "created_by", "created_at", "updated_at", "tenant_id") VALUES ('07ba0164-2606-4b55-b860-ea3fcd744b8d', 'Support 33S', 'support', '100f15db-6e56-49ed-b8ec-9abfce386597', '2026-11-03T10:27:17.635333+00:00', '2026-11-03T14:12:22.367+00:00', NULL) ON CONFLICT DO NOTHING;

-- ── Restauration messages (9 lignes) ──
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('4beadfe9-4fd5-4fad-98ff-7974b16de072', '2271f5c5-eb50-4c6d-9a65-f2827a8c13f4', '16102adf-c6ba-4826-bebb-174c5f55634e', 'hi', '[]'::jsonb, '2026-09-09T18:23:38.301873+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('817100fd-da7e-4c83-9475-c11cf1f85ce2', '5564f3ad-b2a6-4836-9064-e17d7e954a74', '16102adf-c6ba-4826-bebb-174c5f55634e', 'hi', '[]'::jsonb, '2026-09-09T18:46:03.830709+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('e034e0f3-fa8b-428b-974d-f30210fab1db', '3d49d961-4289-49ab-b93b-4803d47a1dd5', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'hello member', '[]'::jsonb, '2026-09-09T23:31:01.525721+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('a887f8ff-0ddd-4164-b7e7-d103ea3912ea', '3d49d961-4289-49ab-b93b-4803d47a1dd5', '16102adf-c6ba-4826-bebb-174c5f55634e', 'hi admin', '[]'::jsonb, '2026-09-09T23:31:51.231333+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('8250a01e-810c-497f-8550-20ed88ee49a2', '3d49d961-4289-49ab-b93b-4803d47a1dd5', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'comment cv', '[]'::jsonb, '2026-09-10T15:12:21.831931+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('13eae64c-c098-4132-9e40-7a707a6d65a1', '3d49d961-4289-49ab-b93b-4803d47a1dd5', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'BONJOUR', '[]'::jsonb, '2026-09-11T10:40:15.090338+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('b6b13161-0234-4e62-a9ff-197d3e7ab653', '3d49d961-4289-49ab-b93b-4803d47a1dd5', '8c56a23b-9f87-43d0-ac2a-db1aa054d7b8', 'salut', '[]'::jsonb, '2026-09-16T01:21:10.389699+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('fa49394a-8b16-4c52-9da2-749300371c6a', '07ba0164-2606-4b55-b860-ea3fcd744b8d', '100f15db-6e56-49ed-b8ec-9abfce386597', 'hello support', '[]'::jsonb, '2026-11-03T13:56:21.289642+00:00') ON CONFLICT DO NOTHING;
INSERT INTO public.messages ("id", "conversation_id", "sender_id", "content", "read_by", "created_at") VALUES ('85aabf45-a8c8-4ba6-8d48-3e9e930c5c17', '07ba0164-2606-4b55-b860-ea3fcd744b8d', '100f15db-6e56-49ed-b8ec-9abfce386597', 'HEEO SSUPPORT', '[]'::jsonb, '2026-11-03T14:12:22.278413+00:00') ON CONFLICT DO NOTHING;

-- ── 4. SYNCHRONISATION FINALE TENANTS -> ORGANIZATIONS ───────────────────────
INSERT INTO public.organizations (id, type, nom, email, telephone, adresse, description, statut, owner_id)
SELECT 
  t.id,
  'coworking',
  t.nom,
  COALESCE(t.email, 'contact@deskywork.tn'),
  t.telephone,
  t.adresse,
  t.description,
  'validé',
  t.owner_id
FROM public.tenants t
ON CONFLICT (id) DO UPDATE SET
  nom = EXCLUDED.nom,
  statut = 'validé';
