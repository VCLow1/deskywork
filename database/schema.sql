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
