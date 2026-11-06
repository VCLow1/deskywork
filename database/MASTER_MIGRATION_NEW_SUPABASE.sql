-- ==============================================================================
-- MASTER_MIGRATION_NEW_SUPABASE.sql
-- Configuration complète et autonome pour le NOUVEAU projet Supabase DeskyWork
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABLE PROFILES (Personnes physiques / Utilisateurs)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nom TEXT,
    prenom TEXT,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('super_admin', 'admin', 'staff', 'formateur', 'member', 'guest')),
    telephone TEXT,
    cin TEXT,
    type_membre TEXT CHECK (type_membre IN ('individuel', 'entreprise', 'etudiant')),
    specialite TEXT,
    biographie TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    statut_compte TEXT NOT NULL DEFAULT 'actif' CHECK (statut_compte IN ('actif', 'suspendu', 'expire', 'en_attente')),
    photo_url TEXT,
    documents JSONB DEFAULT '[]'::jsonb,
    notes_admin TEXT,
    qr_token UUID DEFAULT gen_random_uuid(),
    tenant_id UUID,
    marketing_email BOOLEAN DEFAULT TRUE,
    marketing_sms BOOLEAN DEFAULT TRUE,
    suppression_demandee BOOLEAN DEFAULT FALSE,
    suppression_at TIMESTAMPTZ,
    canal_notification TEXT DEFAULT 'email',
    email_verifie BOOLEAN DEFAULT FALSE,
    telephone_verifie BOOLEAN DEFAULT FALSE,
    is_super_admin BOOLEAN DEFAULT FALSE,
    langue TEXT DEFAULT 'fr'
);

-- 3. TABLE TENANTS (Espaces / Organisations pour rétro-compatibilité)
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
    cover_url TEXT,
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'inactif')),
    plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
    tier TEXT NOT NULL DEFAULT 'C' CHECK (tier IN ('A', 'B', 'C')),
    montant_mensuel NUMERIC(10, 2) NOT NULL DEFAULT 0,
    derniere_facture DATE,
    prochaine_echeance DATE,
    limite_membres INTEGER DEFAULT 100,
    limite_espaces INTEGER DEFAULT 10,
    contact_admin_id UUID,
    owner_id UUID,
    stripe_account_id TEXT,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABLE ORGANIZATIONS (Coworkings, Centres de formation, Entreprises)
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
    owner_id UUID,
    matricule_fiscal TEXT,
    telephone TEXT,
    email TEXT,
    settings JSONB DEFAULT '{"onboarding_completed": false}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABLE MEMBERSHIPS (Rôles par organisation)
CREATE TABLE IF NOT EXISTS public.memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('proprietaire', 'admin', 'staff', 'formateur', 'lecture_seule')),
    statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'invite')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_organization UNIQUE (user_id, organization_id)
);

-- 6. TABLE TRAINER_PROFILES
CREATE TABLE IF NOT EXISTS public.trainer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE,
    bio TEXT,
    domaines TEXT[] DEFAULT '{}'::text[],
    certificats JSONB DEFAULT '[]'::jsonb,
    statut_validation TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut_validation IN ('brouillon', 'en_validation', 'valide', 'refuse')),
    motif_refus TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABLE INVITATIONS
CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'formateur', 'lecture_seule')),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,
    accepted_by UUID,
    statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'acceptee', 'expiree', 'annulee')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TABLE PHONE_OTPS
CREATE TABLE IF NOT EXISTS public.phone_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    verified BOOLEAN DEFAULT FALSE,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8b. TABLE EMAIL_OTP
CREATE TABLE IF NOT EXISTS public.email_otp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_otp_email ON public.email_otp(email);
ALTER TABLE public.email_otp ENABLE ROW LEVEL SECURITY;

-- 9. TABLE ESPACES (Salles et postes de travail)
CREATE TABLE IF NOT EXISTS public.espaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    type TEXT NOT NULL,
    capacite INTEGER NOT NULL DEFAULT 1,
    tarif_horaire NUMERIC(10, 2) NOT NULL DEFAULT 0,
    photo_url TEXT,
    photos_urls JSONB DEFAULT '[]'::jsonb,
    images TEXT[] DEFAULT '{}'::text[],
    equipements TEXT[] DEFAULT '{}'::text[],
    description TEXT,
    actif BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. TABLE GUESTS
CREATE TABLE IF NOT EXISTS public.guests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    email TEXT NOT NULL,
    telephone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. TABLE RESERVATIONS
CREATE TABLE IF NOT EXISTS public.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membre_id UUID,
    espace_id UUID REFERENCES public.espaces(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    date_debut TIMESTAMPTZ NOT NULL,
    date_fin TIMESTAMPTZ NOT NULL,
    statut TEXT NOT NULL DEFAULT 'confirmee',
    prix_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
    reference TEXT,
    mode_reservation TEXT DEFAULT 'membre',
    guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL,
    notes TEXT,
    source TEXT DEFAULT 'direct',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. TABLE ABONNEMENTS
CREATE TABLE IF NOT EXISTS public.abonnements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membre_id UUID,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan_id TEXT,
    date_debut DATE,
    date_fin DATE,
    statut TEXT DEFAULT 'actif',
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- 12b. TARIFS ET CODES PROMO
-- S2 Dev 1 — Module A : Tarification flexible & codes promo (CDC A3)
-- À exécuter dans Supabase SQL Editor

-- =========================================================================
-- 1. Tables tarification
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tarifs_abonnements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_abonnement TEXT NOT NULL CHECK (type_abonnement IN (
        'day_pass', 'week_pass', 'mensuel', 'trimestriel', 'annuel', 'bureau_prive'
    )),
    plan_tarifaire TEXT NOT NULL DEFAULT 'standard' CHECK (plan_tarifaire IN (
        'standard', 'etudiant', 'entreprise'
    )),
    prix NUMERIC(10, 2) NOT NULL CHECK (prix >= 0),
    tva_pct NUMERIC(5, 2) NOT NULL DEFAULT 19.00 CHECK (tva_pct >= 0),
    date_debut DATE NOT NULL DEFAULT CURRENT_DATE,
    date_fin DATE,
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT check_tarif_dates CHECK (date_fin IS NULL OR date_fin >= date_debut)
);

CREATE TABLE IF NOT EXISTS public.codes_promo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    type_reduction TEXT NOT NULL CHECK (type_reduction IN ('percent', 'fixed')),
    valeur NUMERIC(10, 2) NOT NULL CHECK (valeur > 0),
    date_debut DATE NOT NULL DEFAULT CURRENT_DATE,
    date_fin DATE,
    utilisations_max INTEGER CHECK (utilisations_max IS NULL OR utilisations_max > 0),
    utilisations_count INTEGER NOT NULL DEFAULT 0 CHECK (utilisations_count >= 0),
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT check_promo_dates CHECK (date_fin IS NULL OR date_fin >= date_debut)
);

CREATE TABLE IF NOT EXISTS public.historique_tarifs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    abonnement_id UUID REFERENCES public.abonnements(id) ON DELETE SET NULL,
    type_abonnement TEXT NOT NULL,
    plan_tarifaire TEXT NOT NULL,
    prix_initial NUMERIC(10, 2) NOT NULL,
    prix_final NUMERIC(10, 2) NOT NULL,
    code_promo_id UUID REFERENCES public.codes_promo(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 2. RLS
-- =========================================================================

ALTER TABLE public.tarifs_abonnements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codes_promo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historique_tarifs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture tarifs actifs" ON public.tarifs_abonnements;
CREATE POLICY "Lecture tarifs actifs" ON public.tarifs_abonnements
    FOR SELECT USING (actif = TRUE);

DROP POLICY IF EXISTS "Admin manage tarifs" ON public.tarifs_abonnements;
CREATE POLICY "Admin manage tarifs" ON public.tarifs_abonnements
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

DROP POLICY IF EXISTS "Lecture codes promo actifs" ON public.codes_promo;
CREATE POLICY "Lecture codes promo actifs" ON public.codes_promo
    FOR SELECT USING (actif = TRUE);

DROP POLICY IF EXISTS "Admin manage codes promo" ON public.codes_promo;
CREATE POLICY "Admin manage codes promo" ON public.codes_promo
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

DROP POLICY IF EXISTS "Users read own historique tarifs" ON public.historique_tarifs;
CREATE POLICY "Users read own historique tarifs" ON public.historique_tarifs
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin manage historique tarifs" ON public.historique_tarifs;
CREATE POLICY "Admin manage historique tarifs" ON public.historique_tarifs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

-- =========================================================================
-- 3. Données initiales (CDC A2/A3)
-- =========================================================================

INSERT INTO public.tarifs_abonnements (type_abonnement, plan_tarifaire, prix, tva_pct) VALUES
    ('day_pass',     'standard',   35.00, 19),
    ('day_pass',     'etudiant',   25.00, 19),
    ('day_pass',     'entreprise', 45.00, 19),
    ('week_pass',    'standard',  180.00, 19),
    ('week_pass',    'etudiant',  130.00, 19),
    ('week_pass',    'entreprise', 220.00, 19),
    ('mensuel',      'standard',  450.00, 19),
    ('mensuel',      'etudiant',  320.00, 19),
    ('mensuel',      'entreprise', 600.00, 19),
    ('trimestriel',  'standard', 1200.00, 19),
    ('trimestriel',  'etudiant',  850.00, 19),
    ('trimestriel',  'entreprise', 1600.00, 19),
    ('annuel',       'standard', 4200.00, 19),
    ('annuel',       'etudiant',  3000.00, 19),
    ('annuel',       'entreprise', 5500.00, 19),
    ('bureau_prive', 'standard',  900.00, 19),
    ('bureau_prive', 'entreprise', 1200.00, 19)
ON CONFLICT DO NOTHING;

INSERT INTO public.codes_promo (code, type_reduction, valeur, date_fin, utilisations_max) VALUES
    ('WELCOME10', 'percent', 10, CURRENT_DATE + INTERVAL '90 days', 100),
    ('ETUDIANT20', 'percent', 20, CURRENT_DATE + INTERVAL '180 days', 50),
    ('33SPACE50', 'fixed', 50, CURRENT_DATE + INTERVAL '30 days', 20)
ON CONFLICT (code) DO NOTHING;


-- 13. TABLE FORMATIONS
CREATE TABLE IF NOT EXISTS public.formations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titre TEXT NOT NULL,
    description TEXT,
    formateur_id UUID,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    date_debut TIMESTAMPTZ,
    date_fin TIMESTAMPTZ,
    prix NUMERIC(10, 2) DEFAULT 0,
    places_max INTEGER DEFAULT 20,
    statut TEXT DEFAULT 'publiee',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inscriptions_formations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formation_id UUID REFERENCES public.formations(id) ON DELETE CASCADE,
    membre_id UUID,
    statut TEXT DEFAULT 'confirmee',
    date_inscription TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. TABLE CONTACTS
CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    email TEXT NOT NULL,
    sujet TEXT,
    message TEXT NOT NULL,
    statut TEXT DEFAULT 'nouveau',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. TABLE NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membre_id UUID,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    titre TEXT NOT NULL,
    message TEXT NOT NULL,
    lu BOOLEAN DEFAULT FALSE,
    date_creation TIMESTAMPTZ DEFAULT NOW()
);

-- 16. TABLE CONVERSATIONS & MESSAGES
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    title TEXT,
    type TEXT DEFAULT 'support',
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID,
    content TEXT NOT NULL,
    read_by JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. TRIGGER ET FONCTIONS MULTI-TENANT & AUTH

CREATE OR REPLACE FUNCTION public.check_user_org_role(org_id UUID, required_roles TEXT[])
RETURNS BOOLEAN AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND (role = 'super_admin' OR is_super_admin = TRUE)
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.memberships
        WHERE organization_id = org_id
          AND user_id = auth.uid()
          AND statut = 'actif'
          AND role = ANY(required_roles)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID AS $$
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

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

-- Trigger automatique de création de profil lors de l'inscription Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    clean_email TEXT;
    user_nom TEXT;
    user_prenom TEXT;
    user_tel TEXT;
    pending_inv RECORD;
BEGIN
    clean_email := LOWER(TRIM(NEW.email));
    user_nom := COALESCE(NEW.raw_user_meta_data->>'nom', NEW.raw_user_meta_data->>'last_name', split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 2), '');
    user_prenom := COALESCE(NEW.raw_user_meta_data->>'prenom', NEW.raw_user_meta_data->>'first_name', split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 1), '');
    user_tel := COALESCE(NEW.raw_user_meta_data->>'telephone', NEW.raw_user_meta_data->>'phone', '');

    INSERT INTO public.profiles (
        id, email, nom, prenom, telephone, role, statut_compte,
        email_verifie, is_super_admin, langue
    )
    VALUES (
        NEW.id,
        clean_email,
        user_nom,
        user_prenom,
        user_tel,
        CASE WHEN clean_email = 'contact@vclow.com' THEN 'super_admin' ELSE 'member' END,
        'actif',
        COALESCE((NEW.email_confirmed_at IS NOT NULL), FALSE),
        CASE WHEN clean_email = 'contact@vclow.com' THEN TRUE ELSE FALSE END,
        COALESCE(NEW.raw_user_meta_data->>'langue', 'fr')
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        email_verifie = EXCLUDED.email_verifie,
        updated_at = NOW();

    -- Rattachement automatique de l'historique guest
    UPDATE public.reservations r
    SET membre_id = NEW.id
    WHERE r.membre_id IS NULL
      AND r.guest_id IN (
          SELECT g.id FROM public.guests g WHERE LOWER(TRIM(g.email)) = clean_email
      );

    -- Acceptation automatique des invitations en attente
    FOR pending_inv IN 
        SELECT id, organization_id, role 
        FROM public.invitations 
        WHERE LOWER(TRIM(email)) = clean_email 
          AND statut = 'en_attente' 
          AND expires_at > NOW()
    LOOP
        INSERT INTO public.memberships (user_id, organization_id, role, statut)
        VALUES (NEW.id, pending_inv.organization_id, pending_inv.role, 'actif')
        ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role, statut = 'actif';

        UPDATE public.invitations
        SET statut = 'acceptee', accepted_at = NOW(), accepted_by = NEW.id
        WHERE id = pending_inv.id;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 18. RESTAURATION DES CATALOGUES EXISTANTS (ESPACES & COWORKINGS)

-- ── Catalog Data: tenants (4 rows) ──
INSERT INTO public.tenants ("id", "nom", "slug", "description", "adresse", "ville", "pays", "email", "telephone", "logo_url", "statut", "plan", "tier", "montant_mensuel", "limite_membres", "limite_espaces", "settings", "created_at", "updated_at") VALUES ('680c786d-a318-4689-a951-b4bdaa46adc6', 'askri coworking ', 'askri-coworking--e3f7112c', '', '12 rue de la liberté ', 'tunis', 'Tunisie', 'medaziz.askri@esprit.tn', '54946396', NULL, 'actif', 'starter', 'C', 0, 100, 10, '{"onboarding_completed":true}'::jsonb, '2026-09-08T23:09:11.89277+00:00', '2026-09-08T23:12:01.951+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants ("id", "nom", "slug", "description", "adresse", "ville", "pays", "email", "telephone", "logo_url", "statut", "plan", "tier", "montant_mensuel", "limite_membres", "limite_espaces", "settings", "created_at", "updated_at") VALUES ('df870ebf-6ca7-4a96-a3c7-17a4eedc3011', 'Coworking space Amine', 'coworking-space-amine-7c312d82', 'test test test ', 'Monplisir ', 'Tunis', 'Tunisie', 'maradouna321@gmail.com', '99 999 999', NULL, 'actif', 'starter', 'C', 0, 100, 10, '{"onboarding_completed":true}'::jsonb, '2026-08-26T18:42:21.083166+00:00', '2026-08-26T18:48:04.473+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants ("id", "nom", "slug", "description", "adresse", "ville", "pays", "email", "telephone", "logo_url", "statut", "plan", "tier", "montant_mensuel", "limite_membres", "limite_espaces", "settings", "created_at", "updated_at") VALUES ('c76217e0-e27a-46e4-8eba-d9f75bbf4822', 'Coworking', 'coworking-58e60eab', NULL, NULL, NULL, 'Tunisie', 's6a-1788975773953@test.local', '', NULL, 'actif', 'starter', 'C', 0, 100, 10, '{"onboarding_completed":false}'::jsonb, '2026-10-06T08:38:35.03651+00:00', '2026-10-06T08:38:35.03651+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants ("id", "nom", "slug", "description", "adresse", "ville", "pays", "email", "telephone", "logo_url", "statut", "plan", "tier", "montant_mensuel", "limite_membres", "limite_espaces", "settings", "created_at", "updated_at") VALUES ('17ebce1c-2537-430d-a0b2-f2bb57ae6908', 'Ala Coworking', 'ala-coworking-8c56a23b', 'Un coworking-space trés spacieux avec des salles climatisées ', 'Rue de la révolution', 'Nabeul', 'Tunisie', 'alabendawed@gmail.com', '+21698115865', 'https://fgqwtbbxtgvnpxtmauua.supabase.co/storage/v1/object/public/coworking-images/logos/1788451095534-hiw5onk1zpp.png', 'actif', 'starter', 'C', 0, 100, 10, '{"onboarding_completed":true}'::jsonb, '2026-08-25T22:51:46.941284+00:00', '2026-09-07T11:01:33.371+00:00') ON CONFLICT (id) DO NOTHING;

-- ── Restauration Organizations (synchronisées avec les 4 coworkings) ──
INSERT INTO public.organizations (id, type, nom, slug, email, telephone, adresse, ville, description, statut, logo_url)
SELECT
    t.id,
    'coworking',
    t.nom,
    t.slug,
    COALESCE(t.email, 'contact@deskywork.tn'),
    t.telephone,
    COALESCE(t.adresse, 'Tunis, Tunisie'),
    COALESCE(t.ville, 'Tunis'),
    t.description,
    'valide',
    t.logo_url
FROM public.tenants t
ON CONFLICT (id) DO NOTHING;

-- ── Catalog Data: espaces (10 rows) ──
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('c3d3fffe-72a5-46dd-911b-940cf9d65889', 'espace 2', 'open_space', 30, 10, '2026-08-25T23:09:41.166351+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('f88f67ae-85f0-4d11-8460-03209dcdeaa5', 'espace 3', 'event_space', 40, 20, '2026-08-25T23:10:29.476212+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('0eb4e7f8-a4c3-412a-93c9-2507dcf247bf', 'espace amine 1', 'open_space', 10, 15, '2026-08-26T18:47:35.127127+00:00', 'df870ebf-6ca7-4a96-a3c7-17a4eedc3011') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('86563f6e-d91d-4f25-a8f3-ad2eac599e30', 'salle de formation ala', 'training_room', 10, 15, '2026-09-07T11:46:59.860404+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('3f033c3e-aa5a-4737-87ef-9e3384f54b70', '911', 'event_space', 10, 0, '2026-09-08T23:11:58.340509+00:00', '680c786d-a318-4689-a951-b4bdaa46adc6') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('01b04de4-61a5-4e8e-880f-caf83a7eb933', 'TESTS6-OS-1788975596140', 'open_space', 10, 20, '2026-09-09T17:39:59.035395+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('6e8e1785-4861-4513-bfe8-873f84e943b7', 'TESTS6-BP-1788975596140', 'private_office', 1, 50, '2026-09-09T17:39:59.126131+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('3bcfe671-0ef8-45dc-a1ce-42668a485083', 'TESTS6-OS-1788975688870', 'open_space', 10, 20, '2026-09-09T17:41:31.772342+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('455219a4-0c57-4a05-9387-227b9ea3a769', 'TESTS6-BP-1788975688870', 'private_office', 1, 50, '2026-09-09T17:41:31.860793+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.espaces ("id", "nom", "type", "capacite", "tarif_horaire", "created_at", "tenant_id") VALUES ('32610b97-4571-4c2c-97ea-8e1d6cd43566', 'espace 1', 'open_space', 10, 15, '2026-08-25T23:09:12.81289+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;

-- ── Catalog Data: contacts (3 rows) ──
INSERT INTO public.contacts ("id", "nom", "email", "sujet", "message", "statut", "created_at", "updated_at") VALUES ('6e5028e7-0bc4-461b-93b3-f597c1c1a2e7', 'test', 'test@g.com', 'Autre demande', 'test', 'nouveau', '2026-09-10T23:01:19.865424+00:00', '2026-09-10T23:03:46.649+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.contacts ("id", "nom", "email", "sujet", "message", "statut", "created_at", "updated_at") VALUES ('6e8597b5-2f6a-49c7-923b-2c3516a3eff5', 'aaaaa', 'aaaaa@gmail.com', 'Abonnement mensuel', 'test hahahah', 'nouveau', '2026-09-10T23:17:37.932545+00:00', '2026-09-10T23:17:37.932545+00:00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.contacts ("id", "nom", "email", "sujet", "message", "statut", "created_at", "updated_at") VALUES ('a3a08234-6bf7-489e-bd19-b29f1684281a', 'Test', 't@t.local', 'S', 'Hello', 'nouveau', '2026-09-11T09:42:43.51504+00:00', '2026-09-11T09:42:43.51504+00:00') ON CONFLICT (id) DO NOTHING;

-- ── Catalog Data: formations (2 rows) ──
INSERT INTO public.formations ("id", "titre", "description", "date_debut", "date_fin", "statut", "created_at", "tenant_id") VALUES ('dc4ed72a-da6b-4fea-beb0-8182b37b78be', 'test', 'test', '2026-09-11T08:00:00+00:00', '2026-09-11T11:00:00+00:00', 'planifiee', '2026-09-10T16:40:45.386961+00:00', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.formations ("id", "titre", "description", "date_debut", "date_fin", "statut", "created_at", "tenant_id") VALUES ('45aee5b3-95ea-4485-9b39-91ef68cdd2d2', 'aaaaaaaaa', 'aaaaaaaaaaaaaaaa', '2026-09-12T08:00:00+00:00', '2026-09-12T13:00:00+00:00', 'planifiee', '2026-09-10T16:49:24.782203+00:00', '17ebce1c-2537-430d-a0b2-f2bb57ae6908') ON CONFLICT (id) DO NOTHING;

-- 19. SÉCURITÉ ROW LEVEL SECURITY (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.espaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- Lecture publique des espaces actifs et organisations validées
DROP POLICY IF EXISTS "Public read espaces" ON public.espaces;
CREATE POLICY "Public read espaces" ON public.espaces FOR SELECT USING (actif = TRUE);

DROP POLICY IF EXISTS "Public read organisations validées" ON public.organizations;
CREATE POLICY "Public read organisations validées" ON public.organizations FOR SELECT USING (statut = 'valide');

-- Profils
DROP POLICY IF EXISTS "Profiles read access" ON public.profiles;
CREATE POLICY "Profiles read access" ON public.profiles FOR SELECT USING (auth.uid() = id OR is_super_admin = TRUE);

DROP POLICY IF EXISTS "Profiles update own" ON public.profiles;
CREATE POLICY "Profiles update own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Super Admin accès total
DROP POLICY IF EXISTS "Super Admin full orgs" ON public.organizations;
CREATE POLICY "Super Admin full orgs" ON public.organizations FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'super_admin' OR is_super_admin = TRUE))
);
