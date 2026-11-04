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

