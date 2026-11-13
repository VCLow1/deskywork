-- ==============================================================================
-- MIGRATION_CDC_V3_COMPLETE.sql
-- Migration complète & idempotente pour DeskyWork (CDC v3.0 — Novembre 2026)
-- À exécuter dans Supabase Dashboard -> SQL Editor (idempotent : sans perte de données)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Fonction générique updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 1. PROFILES & TENANTS
-- ==============================================================================
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS photo_url TEXT,
    ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS notes_admin TEXT,
    ADD COLUMN IF NOT EXISTS qr_token UUID DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS tenant_id UUID,
    ADD COLUMN IF NOT EXISTS marketing_email BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS marketing_sms BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS suppression_demandee BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS suppression_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS canal_notification TEXT DEFAULT 'email',
    ADD COLUMN IF NOT EXISTS email_verifie BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS telephone_verifie BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS langue TEXT DEFAULT 'fr';

UPDATE public.profiles
SET
    qr_token = gen_random_uuid ()
WHERE
    qr_token IS NULL;

UPDATE public.profiles
SET
    is_super_admin = TRUE
WHERE
    role = 'super_admin'
    AND (
        is_super_admin IS NULL
        OR is_super_admin = FALSE
    );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_qr_token_idx ON public.profiles (qr_token);

CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON public.profiles (tenant_id);

-- Nettoyage éventuel des tenant_id orphelins avant FK
UPDATE public.profiles p
SET
    tenant_id = NULL
WHERE
    p.tenant_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE
            t.id = p.tenant_id
    );

DO $$ BEGIN
    ALTER TABLE public.profiles
        ADD CONSTRAINT fk_profiles_tenant_id
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

EXCEPTION WHEN duplicate_object THEN NULL;

END $$;

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'coworking',
    ADD COLUMN IF NOT EXISTS owner_id UUID,
    ADD COLUMN IF NOT EXISTS contact_admin_id UUID,
    ADD COLUMN IF NOT EXISTS matricule_fiscal TEXT,
    ADD COLUMN IF NOT EXISTS horaires JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS tarif_depassement_heure NUMERIC(12, 3) NOT NULL DEFAULT 0;

ALTER TABLE public.tenants
ALTER COLUMN montant_mensuel TYPE NUMERIC(12, 3);

DO $$ BEGIN
    ALTER TABLE public.tenants
        ADD CONSTRAINT fk_tenants_owner_id FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.tenants
        ADD CONSTRAINT fk_tenants_contact_admin_id FOREIGN KEY (contact_admin_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ==============================================================================
-- 2. MULTI-SITES (Module N) & ESPACES (7 typologies officielles CDC v3.0)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    adresse TEXT,
    ville TEXT,
    telephone TEXT,
    email TEXT,
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_tenant ON public.sites (tenant_id);

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sites_read_authenticated" ON public.sites;

CREATE POLICY "sites_read_authenticated" ON public.sites FOR
SELECT USING (auth.uid () IS NOT NULL);

DROP POLICY IF EXISTS "sites_manage_admin" ON public.sites;

CREATE POLICY "sites_manage_admin" ON public.sites FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN ('super_admin', 'admin')
    )
);

DROP TRIGGER IF EXISTS sites_updated_at ON public.sites;

CREATE TRIGGER sites_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.membres_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_membres_sites_user ON public.membres_sites (user_id);

CREATE INDEX IF NOT EXISTS idx_membres_sites_site ON public.membres_sites (site_id);

ALTER TABLE public.membres_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membres_sites_read" ON public.membres_sites;

CREATE POLICY "membres_sites_read" ON public.membres_sites FOR
SELECT USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN (
                    'super_admin', 'admin', 'staff'
                )
        )
    );

DROP POLICY IF EXISTS "membres_sites_manage" ON public.membres_sites;

CREATE POLICY "membres_sites_manage" ON public.membres_sites FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN ('super_admin', 'admin')
    )
);

ALTER TABLE public.espaces
    ADD COLUMN IF NOT EXISTS photo_url TEXT,
    ADD COLUMN IF NOT EXISTS photos_urls JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS equipements TEXT[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS actif BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tarif_journalier NUMERIC(12, 3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tarif_mensuel NUMERIC(12, 3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS horaires TEXT DEFAULT '08:00 - 20:00',
    ADD COLUMN IF NOT EXISTS statut TEXT DEFAULT 'actif';

ALTER TABLE public.espaces
ALTER COLUMN tarif_horaire TYPE NUMERIC(12, 3);

UPDATE public.espaces
SET photo_url = images[1]
WHERE photo_url IS NULL AND images IS NOT NULL AND array_length(images, 1) >= 1;

ALTER TABLE public.espaces
DROP CONSTRAINT IF EXISTS espaces_type_check;

ALTER TABLE public.espaces
ADD CONSTRAINT espaces_type_check CHECK (
    type IN (
        'private_office',
        'open_space',
        'meeting_room',
        'training_room',
        'event_space',
        'hot_desk',
        'dedicated_desk'
    )
);

CREATE INDEX IF NOT EXISTS idx_espaces_tenant ON public.espaces (tenant_id);

-- ==============================================================================
-- 3. GUESTS (Module H)
-- ==============================================================================
ALTER TABLE public.guests
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS prenom TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS token TEXT NOT NULL DEFAULT encode (gen_random_bytes (32), 'hex'),
ADD COLUMN IF NOT EXISTS converti_en_membre_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS converti_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.guests ALTER COLUMN telephone DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_email_tenant ON public.guests (email, tenant_id);

CREATE INDEX IF NOT EXISTS idx_guests_token ON public.guests (token);

CREATE INDEX IF NOT EXISTS idx_guests_tenant ON public.guests (tenant_id);

ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guests_read_staff" ON public.guests;

CREATE POLICY "guests_read_staff" ON public.guests FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN (
                    'super_admin', 'admin', 'staff'
                )
        )
    );

DROP POLICY IF EXISTS "guests_insert_public" ON public.guests;

CREATE POLICY "guests_insert_public" ON public.guests FOR
INSERT
WITH
    CHECK (true);

DROP POLICY IF EXISTS "guests_update_staff" ON public.guests;

CREATE POLICY "guests_update_staff" ON public.guests FOR
UPDATE USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN (
                'super_admin',
                'admin',
                'staff'
            )
    )
);

DROP TRIGGER IF EXISTS guests_updated_at ON public.guests;

CREATE TRIGGER guests_updated_at BEFORE UPDATE ON public.guests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==============================================================================
-- 4. POLITIQUES D'ANNULATION & CRÉDITS (Module J)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.politique_annulation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    delai_heures INTEGER NOT NULL DEFAULT 24 CHECK (delai_heures >= 0),
    penalite_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (
        penalite_pct >= 0
        AND penalite_pct <= 100
    ),
    annulation_membre_autorisee BOOLEAN NOT NULL DEFAULT TRUE,
    remboursement_auto BOOLEAN NOT NULL DEFAULT FALSE,
    message_membre TEXT DEFAULT 'Annulation gratuite jusqu''à 24 h avant le début du créneau.',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO
    public.politique_annulation (
        delai_heures,
        penalite_pct,
        message_membre
    )
SELECT 24, 0, 'Annulation gratuite jusqu''à 24 h avant le début du créneau.'
WHERE
    NOT EXISTS (
        SELECT 1
        FROM public.politique_annulation
        LIMIT 1
    );

ALTER TABLE public.politique_annulation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture politique annulation" ON public.politique_annulation;

CREATE POLICY "Lecture politique annulation" ON public.politique_annulation FOR
SELECT USING (auth.uid () IS NOT NULL);

DROP POLICY IF EXISTS "Admin manage politique annulation" ON public.politique_annulation;

CREATE POLICY "Admin manage politique annulation" ON public.politique_annulation FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN (
                'super_admin',
                'admin',
                'staff'
            )
    )
);

CREATE TABLE IF NOT EXISTS public.politique_annulation_espaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    type_espace TEXT NOT NULL CHECK (
        type_espace IN (
            'private_office',
            'open_space',
            'meeting_room',
            'training_room',
            'event_space',
            'hot_desk',
            'dedicated_desk'
        )
    ),
    tranche_libre_heures INTEGER NOT NULL DEFAULT 24,
    tranche_tardive_heures INTEGER NOT NULL DEFAULT 12,
    penalite_tardive_pct NUMERIC(5, 2) NOT NULL DEFAULT 50,
    penalite_tres_tardive_pct NUMERIC(5, 2) NOT NULL DEFAULT 100,
    penalite_noshow_pct NUMERIC(5, 2) NOT NULL DEFAULT 100,
    noshow_note_profil BOOLEAN NOT NULL DEFAULT TRUE,
    credit_portefeuille_auto BOOLEAN NOT NULL DEFAULT FALSE,
    credit_portefeuille_pct NUMERIC(5, 2) NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, type_espace)
);

CREATE INDEX IF NOT EXISTS idx_pol_annul_tenant ON public.politique_annulation_espaces (tenant_id);

ALTER TABLE public.politique_annulation_espaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pol_annul_read" ON public.politique_annulation_espaces;

CREATE POLICY "pol_annul_read" ON public.politique_annulation_espaces FOR
SELECT USING (true);

DROP POLICY IF EXISTS "pol_annul_manage" ON public.politique_annulation_espaces;

CREATE POLICY "pol_annul_manage" ON public.politique_annulation_espaces FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN ('super_admin', 'admin')
    )
);

DROP TRIGGER IF EXISTS pol_annul_espaces_updated_at ON public.politique_annulation_espaces;

CREATE TRIGGER pol_annul_espaces_updated_at BEFORE UPDATE ON public.politique_annulation_espaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.credits_membres (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    montant NUMERIC(12, 3) NOT NULL CHECK (montant >= 0),
    motif TEXT,
    reservation_id UUID REFERENCES public.reservations (id) ON DELETE SET NULL,
    expire_at TIMESTAMPTZ,
    utilise BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_user ON public.credits_membres (user_id);

ALTER TABLE public.credits_membres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credits_read_own" ON public.credits_membres;

CREATE POLICY "credits_read_own" ON public.credits_membres FOR
SELECT USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN (
                    'super_admin', 'admin', 'staff'
                )
        )
    );

DROP POLICY IF EXISTS "credits_manage_admin" ON public.credits_membres;

CREATE POLICY "credits_manage_admin" ON public.credits_membres FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN (
                'super_admin',
                'admin',
                'staff'
            )
    )
);

-- ==============================================================================
-- 5. RÉSERVATIONS (FK profiles, champs Entreprise, statuts normalisés CDC v3.0)
-- ==============================================================================
ALTER TABLE public.reservations
ADD COLUMN IF NOT EXISTS user_id UUID,
ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'on_site',
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS no_show BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS penalite_pct NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS credit_id UUID REFERENCES public.credits_membres (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS raison_sociale TEXT,
ADD COLUMN IF NOT EXISTS contact_nom TEXT,
ADD COLUMN IF NOT EXISTS contact_telephone TEXT,
ADD COLUMN IF NOT EXISTS email_facturation TEXT,
ADD COLUMN IF NOT EXISTS description_besoin TEXT;

ALTER TABLE public.reservations
ALTER COLUMN prix_total TYPE NUMERIC(12, 3),
ALTER COLUMN statut
SET DEFAULT 'pending';

-- Nettoyage / synchronisation user_id <-> membre_id
UPDATE public.reservations
SET
    user_id = COALESCE(user_id, membre_id),
    membre_id = COALESCE(membre_id, user_id);

UPDATE public.reservations r
SET
    user_id = NULL,
    membre_id = NULL
WHERE (
        r.user_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE
                p.id = r.user_id
        )
    );

-- Nettoyage : on ne conserve qu'une seule FK vers profiles(id) sur reservations (via user_id)
-- afin d'éviter l'ambiguïté PostgREST ("more than one relationship found")
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS fk_reservations_membre_profiles;
DO $$ BEGIN
    ALTER TABLE public.reservations
        ADD CONSTRAINT fk_reservations_user_profiles
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.reservations
DROP CONSTRAINT IF EXISTS reservations_statut_check;

ALTER TABLE public.reservations
ADD CONSTRAINT reservations_statut_check CHECK (
    statut IN (
        'pending',
        'confirmed',
        'refused',
        'cancelled',
        'completed',
        'no_show',
        'waitlisted',
        'confirmee'
    )
);

ALTER TABLE public.reservations
DROP CONSTRAINT IF EXISTS reservations_mode_check;

ALTER TABLE public.reservations
ADD CONSTRAINT reservations_mode_check CHECK (
    mode IN (
        'online',
        'on_site',
        'sur_place',
        'phone',
        'cash',
        'check',
        'bank_transfer'
    )
);

CREATE OR REPLACE FUNCTION public.sync_reservation_user_cols()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_id := COALESCE(NEW.user_id, NEW.membre_id);
    NEW.membre_id := COALESCE(NEW.membre_id, NEW.user_id);
    IF NEW.mode IS NULL OR NEW.mode = '' THEN
        NEW.mode := 'on_site';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_reservation_user_cols ON public.reservations;

CREATE TRIGGER trg_sync_reservation_user_cols
    BEFORE INSERT OR UPDATE ON public.reservations
    FOR EACH ROW EXECUTE FUNCTION public.sync_reservation_user_cols();

CREATE INDEX IF NOT EXISTS idx_reservations_user ON public.reservations (user_id);

CREATE INDEX IF NOT EXISTS idx_reservations_tenant ON public.reservations (tenant_id);

CREATE INDEX IF NOT EXISTS idx_reservations_espace ON public.reservations (espace_id);

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to read their own reservations" ON public.reservations;

CREATE POLICY "Allow users to read their own reservations" ON public.reservations FOR
SELECT USING (
        auth.uid () = COALESCE(user_id, membre_id)
    );

DROP POLICY IF EXISTS "Allow users to create reservations" ON public.reservations;

CREATE POLICY "Allow users to create reservations" ON public.reservations FOR
INSERT
WITH
    CHECK (
        auth.uid () = COALESCE(user_id, membre_id)
    );

DROP POLICY IF EXISTS "Allow users to modify/cancel their own reservations" ON public.reservations;

CREATE POLICY "Allow users to modify/cancel their own reservations" ON public.reservations FOR
UPDATE USING (
    auth.uid () = COALESCE(user_id, membre_id)
);

DROP POLICY IF EXISTS "Allow admins/staff to manage all reservations" ON public.reservations;

CREATE POLICY "Allow admins/staff to manage all reservations" ON public.reservations FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN (
                'super_admin',
                'admin',
                'staff'
            )
    )
);

-- ==============================================================================
-- 6. SESSIONS DE TRAVAIL (D3/D4 — Libération manuelle & overtime)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    reservation_id UUID NOT NULL REFERENCES public.reservations (id) ON DELETE CASCADE UNIQUE,
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    statut TEXT NOT NULL DEFAULT 'scheduled' CHECK (
        statut IN (
            'scheduled',
            'active',
            'completed',
            'overtime',
            'no_show'
        )
    ),
    temps_restant INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON public.sessions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_sessions_statut ON public.sessions (statut);

CREATE INDEX IF NOT EXISTS idx_sessions_reservation ON public.sessions (reservation_id);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to view sessions associated with their reservations" ON public.sessions;

CREATE POLICY "Allow users to view sessions associated with their reservations" ON public.sessions FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.reservations r
            WHERE
                r.id = sessions.reservation_id
                AND COALESCE(r.user_id, r.membre_id) = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "Allow admins/staff to manage all sessions" ON public.sessions;

CREATE POLICY "Allow admins/staff to manage all sessions" ON public.sessions FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN (
                'super_admin',
                'admin',
                'staff'
            )
    )
);

DROP POLICY IF EXISTS "Allow users to check in to their own reservations" ON public.sessions;

CREATE POLICY "Allow users to check in to their own reservations" ON public.sessions FOR
INSERT
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM public.reservations r
            WHERE
                r.id = reservation_id
                AND COALESCE(r.user_id, r.membre_id) = auth.uid ()
                AND r.statut IN ('confirmed', 'pending')
        )
    );

DROP POLICY IF EXISTS "Allow users to checkout their own sessions" ON public.sessions;

CREATE POLICY "Allow users to checkout their own sessions" ON public.sessions FOR
UPDATE USING (
    EXISTS (
        SELECT 1
        FROM public.reservations r
        WHERE
            r.id = sessions.reservation_id
            AND COALESCE(r.user_id, r.membre_id) = auth.uid ()
    )
);

-- ==============================================================================
-- 7. ABONNEMENTS, TARIFS & PROMOS
-- ==============================================================================
ALTER TABLE public.tarifs_abonnements
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS type_espace TEXT;

ALTER TABLE public.tarifs_abonnements
ALTER COLUMN prix TYPE NUMERIC(12, 3);

CREATE INDEX IF NOT EXISTS idx_tarifs_tenant ON public.tarifs_abonnements (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tarifs_type_espace ON public.tarifs_abonnements (type_espace);

ALTER TABLE public.codes_promo
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE;

ALTER TABLE public.codes_promo
ALTER COLUMN valeur TYPE NUMERIC(12, 3);

CREATE INDEX IF NOT EXISTS idx_promo_tenant ON public.codes_promo (tenant_id);

ALTER TABLE public.abonnements
ADD COLUMN IF NOT EXISTS user_id UUID,
ADD COLUMN IF NOT EXISTS type TEXT,
ADD COLUMN IF NOT EXISTS renouvellement_auto BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS type_espace TEXT,
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS multi_sites BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS prix_paye NUMERIC(12, 3),
ADD COLUMN IF NOT EXISTS code_promo_id UUID REFERENCES public.codes_promo (id) ON DELETE SET NULL;

UPDATE public.abonnements
SET
    user_id = COALESCE(user_id, membre_id),
    membre_id = COALESCE(membre_id, user_id),
    type = COALESCE(type, plan_id),
    plan_id = COALESCE(plan_id, type);

UPDATE public.abonnements a
SET
    user_id = NULL,
    membre_id = NULL
WHERE (
        a.user_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE
                p.id = a.user_id
        )
    );

DO $$ BEGIN
    ALTER TABLE public.abonnements
        ADD CONSTRAINT fk_abonnements_user_profiles
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.sync_abonnement_cols()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_id := COALESCE(NEW.user_id, NEW.membre_id);
    NEW.membre_id := COALESCE(NEW.membre_id, NEW.user_id);
    NEW.type := COALESCE(NEW.type, NEW.plan_id);
    NEW.plan_id := COALESCE(NEW.plan_id, NEW.type);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_abonnement_cols ON public.abonnements;

CREATE TRIGGER trg_sync_abonnement_cols
    BEFORE INSERT OR UPDATE ON public.abonnements
    FOR EACH ROW EXECUTE FUNCTION public.sync_abonnement_cols();

ALTER TABLE public.abonnements
DROP CONSTRAINT IF EXISTS abonnements_statut_check;

ALTER TABLE public.abonnements
ADD CONSTRAINT abonnements_statut_check CHECK (
    statut IN (
        'active',
        'actif',
        'suspended',
        'expired'
    )
);

CREATE INDEX IF NOT EXISTS idx_abonnements_tenant ON public.abonnements (tenant_id);

CREATE INDEX IF NOT EXISTS idx_abonnements_user ON public.abonnements (user_id);

CREATE INDEX IF NOT EXISTS idx_abonnements_type_espace ON public.abonnements (type_espace);

ALTER TABLE public.historique_tarifs
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE;

ALTER TABLE public.historique_tarifs
ALTER COLUMN prix_initial TYPE NUMERIC(12, 3),
ALTER COLUMN prix_final TYPE NUMERIC(12, 3);

CREATE INDEX IF NOT EXISTS idx_hist_tarifs_tenant ON public.historique_tarifs (tenant_id);

-- ==============================================================================
-- 8. PAIEMENTS (Montant dû + Encaissement sur place) & REÇUS NUMÉROTÉS (D1/D7)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.paiements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
    guest_id UUID REFERENCES public.guests (id) ON DELETE SET NULL,
    reservation_id UUID REFERENCES public.reservations (id) ON DELETE SET NULL,
    abonnement_id UUID REFERENCES public.abonnements (id) ON DELETE SET NULL,
    montant NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (montant >= 0),
    montant_paye NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (montant_paye >= 0),
    montant_rembourse NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (montant_rembourse >= 0),
    mode TEXT NOT NULL DEFAULT 'cash' CHECK (
        mode IN (
            'cash',
            'bank_transfer',
            'check',
            'online'
        )
    ),
    statut TEXT NOT NULL DEFAULT 'pending' CHECK (
        statut IN (
            'pending',
            'partial',
            'paid',
            'failed',
            'refunded'
        )
    ),
    numero_recu TEXT UNIQUE,
    reference_externe TEXT,
    date_paiement TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paiements_tenant ON public.paiements (tenant_id);

CREATE INDEX IF NOT EXISTS idx_paiements_user ON public.paiements (user_id);

CREATE INDEX IF NOT EXISTS idx_paiements_statut ON public.paiements (statut);

CREATE INDEX IF NOT EXISTS idx_paiements_reservation ON public.paiements (reservation_id);

ALTER TABLE public.paiements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membres : lecture de ses propres paiements" ON public.paiements;

CREATE POLICY "Membres : lecture de ses propres paiements" ON public.paiements FOR
SELECT USING (auth.uid () = user_id);

DROP POLICY IF EXISTS "Admin/Staff : lecture de tous les paiements" ON public.paiements;

CREATE POLICY "Admin/Staff : lecture de tous les paiements" ON public.paiements FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN (
                    'super_admin', 'admin', 'staff'
                )
        )
    );

DROP POLICY IF EXISTS "Admin/Staff : création de paiements" ON public.paiements;

CREATE POLICY "Admin/Staff : création de paiements" ON public.paiements FOR
INSERT
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN (
                    'super_admin',
                    'admin',
                    'staff'
                )
        )
    );

DROP POLICY IF EXISTS "Admin/Staff : modification de paiements" ON public.paiements;

CREATE POLICY "Admin/Staff : modification de paiements" ON public.paiements FOR
UPDATE USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN (
                'super_admin',
                'admin',
                'staff'
            )
    )
);

DROP POLICY IF EXISTS "Super Admin : suppression de paiements" ON public.paiements;

CREATE POLICY "Super Admin : suppression de paiements" ON public.paiements FOR DELETE USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role = 'super_admin'
    )
);

CREATE TABLE IF NOT EXISTS public.recu_compteur (
    annee INTEGER PRIMARY KEY,
    dernier_numero INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.recu_compteur (annee, dernier_numero)
VALUES (EXTRACT(YEAR FROM NOW())::INTEGER, 0)
ON CONFLICT (annee) DO NOTHING;

ALTER TABLE public.recu_compteur ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super Admin : lecture compteur reçus" ON public.recu_compteur;

CREATE POLICY "Super Admin : lecture compteur reçus" ON public.recu_compteur FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role = 'super_admin'
        )
    );

CREATE OR REPLACE FUNCTION public.generer_numero_recu()
RETURNS TRIGGER AS $$
DECLARE
    annee_courante INTEGER;
    nouveau_numero INTEGER;
BEGIN
    -- Générer un numéro officiel uniquement lorsqu'un règlement est soldé sans numéro existant
    IF NEW.numero_recu IS NOT NULL OR NEW.statut <> 'paid' THEN
        RETURN NEW;
    END IF;

    annee_courante := EXTRACT(YEAR FROM NOW())::INTEGER;
    INSERT INTO public.recu_compteur (annee, dernier_numero)
    VALUES (annee_courante, 0)
    ON CONFLICT (annee) DO NOTHING;

    UPDATE public.recu_compteur
    SET dernier_numero = dernier_numero + 1
    WHERE annee = annee_courante
    RETURNING dernier_numero INTO nouveau_numero;

    NEW.numero_recu := 'REC-' || annee_courante || '-' || LPAD(nouveau_numero::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_numerotation_recu ON public.paiements;

CREATE TRIGGER trigger_numerotation_recu
    BEFORE INSERT OR UPDATE ON public.paiements
    FOR EACH ROW EXECUTE FUNCTION public.generer_numero_recu();

-- ==============================================================================
-- 9. FORMATIONS, INSCRIPTIONS & RÉMUNÉRATIONS FORMATEURS (D5)
-- ==============================================================================
ALTER TABLE public.formations
ADD COLUMN IF NOT EXISTS espace_id UUID REFERENCES public.espaces (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS capacite_max INTEGER NOT NULL DEFAULT 20,
ADD COLUMN IF NOT EXISTS prix_inscription NUMERIC(12, 3) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS programme TEXT,
ADD COLUMN IF NOT EXISTS prerequis TEXT,
ADD COLUMN IF NOT EXISTS materiel TEXT,
ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES public.reservations (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.formations ALTER COLUMN prix TYPE NUMERIC(12, 3);

ALTER TABLE public.formations
ALTER COLUMN formateur_id
DROP NOT NULL;

UPDATE public.formations
SET
    capacite_max = COALESCE(
        NULLIF(capacite_max, 0),
        places_max,
        20
    ),
    places_max = COALESCE(places_max, capacite_max, 20),
    prix_inscription = COALESCE(prix_inscription, prix, 0),
    prix = COALESCE(prix, prix_inscription, 0);

UPDATE public.formations f
SET
    formateur_id = NULL
WHERE
    f.formateur_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE
            p.id = f.formateur_id
    );

DO $$ BEGIN
    ALTER TABLE public.formations
        ADD CONSTRAINT fk_formations_formateur_profiles
        FOREIGN KEY (formateur_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.formations
DROP CONSTRAINT IF EXISTS formations_statut_check;

ALTER TABLE public.formations
ADD CONSTRAINT formations_statut_check CHECK (
    statut IN (
        'planifiee',
        'publiee',
        'en_cours',
        'terminee',
        'annulee'
    )
);

CREATE OR REPLACE FUNCTION public.sync_formation_cols()
RETURNS TRIGGER AS $$
BEGIN
    NEW.capacite_max := COALESCE(NEW.capacite_max, NEW.places_max, 20);
    NEW.places_max := COALESCE(NEW.places_max, NEW.capacite_max, 20);
    NEW.prix_inscription := COALESCE(NEW.prix_inscription, NEW.prix, 0);
    NEW.prix := COALESCE(NEW.prix, NEW.prix_inscription, 0);
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS formations_sync_and_updated_at ON public.formations;

CREATE TRIGGER formations_sync_and_updated_at
    BEFORE INSERT OR UPDATE ON public.formations
    FOR EACH ROW EXECUTE FUNCTION public.sync_formation_cols();

CREATE INDEX IF NOT EXISTS idx_formations_tenant ON public.formations (tenant_id);

CREATE INDEX IF NOT EXISTS idx_formations_formateur ON public.formations (formateur_id);

CREATE INDEX IF NOT EXISTS idx_formations_reservation ON public.formations (reservation_id);

ALTER TABLE public.inscriptions_formations
ADD COLUMN IF NOT EXISTS user_id UUID,
ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES public.guests (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS statut_paiement TEXT NOT NULL DEFAULT 'gratuit',
ADD COLUMN IF NOT EXISTS paiement_id UUID REFERENCES public.paiements (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS present BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.inscriptions_formations
SET
    user_id = COALESCE(user_id, membre_id),
    membre_id = COALESCE(membre_id, user_id);

UPDATE public.inscriptions_formations i
SET
    user_id = NULL,
    membre_id = NULL
WHERE
    i.user_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE
            p.id = i.user_id
    );

DO $$ BEGIN
    ALTER TABLE public.inscriptions_formations
        ADD CONSTRAINT fk_inscriptions_user_profiles
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.inscriptions_formations
        ADD CONSTRAINT uq_inscriptions_formation_user UNIQUE (formation_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.inscriptions_formations
DROP CONSTRAINT IF EXISTS inscriptions_formations_statut_check;

ALTER TABLE public.inscriptions_formations
ADD CONSTRAINT inscriptions_formations_statut_check CHECK (
    statut IN (
        'confirmee',
        'en_attente',
        'annulee'
    )
);

ALTER TABLE public.inscriptions_formations
DROP CONSTRAINT IF EXISTS inscriptions_formations_statut_paiement_check;

ALTER TABLE public.inscriptions_formations
ADD CONSTRAINT inscriptions_formations_statut_paiement_check CHECK (
    statut_paiement IN (
        'gratuit',
        'en_attente',
        'paye',
        'rembourse'
    )
);

CREATE OR REPLACE FUNCTION public.sync_inscription_cols()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_id := COALESCE(NEW.user_id, NEW.membre_id);
    NEW.membre_id := COALESCE(NEW.membre_id, NEW.user_id);
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inscriptions_sync_cols ON public.inscriptions_formations;

CREATE TRIGGER inscriptions_sync_cols
    BEFORE INSERT OR UPDATE ON public.inscriptions_formations
    FOR EACH ROW EXECUTE FUNCTION public.sync_inscription_cols();

CREATE INDEX IF NOT EXISTS idx_inscriptions_formation ON public.inscriptions_formations (formation_id);

CREATE INDEX IF NOT EXISTS idx_inscriptions_user ON public.inscriptions_formations (user_id);

CREATE INDEX IF NOT EXISTS idx_inscriptions_tenant ON public.inscriptions_formations (tenant_id);

CREATE TABLE IF NOT EXISTS public.remuneration_formateurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    formateur_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    formation_id UUID NOT NULL REFERENCES public.formations (id) ON DELETE CASCADE,
    montant NUMERIC(12, 3) NOT NULL CHECK (montant >= 0),
    statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (
        statut IN ('en_attente', 'paye')
    ),
    date_versement TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (formateur_id, formation_id)
);

CREATE INDEX IF NOT EXISTS idx_remuneration_formateur ON public.remuneration_formateurs (formateur_id);

CREATE INDEX IF NOT EXISTS idx_remuneration_tenant ON public.remuneration_formateurs (tenant_id);

ALTER TABLE public.remuneration_formateurs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "remuneration_read" ON public.remuneration_formateurs;

CREATE POLICY "remuneration_read" ON public.remuneration_formateurs FOR
SELECT USING (
        formateur_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN ('super_admin', 'admin')
        )
    );

DROP POLICY IF EXISTS "remuneration_manage_admin" ON public.remuneration_formateurs;

CREATE POLICY "remuneration_manage_admin" ON public.remuneration_formateurs FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN ('super_admin', 'admin')
    )
);

-- ==============================================================================
-- 10. NOTIFICATIONS (D2 : Email & Dashboard uniquement)
-- ==============================================================================
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS user_id UUID,
ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'Dashboard',
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.notifications
ALTER COLUMN titre
DROP NOT NULL,
ALTER COLUMN titre
SET DEFAULT '';

UPDATE public.notifications
SET
    user_id = COALESCE(user_id, membre_id),
    membre_id = COALESCE(membre_id, user_id),
    created_at = COALESCE(
        created_at,
        date_creation,
        NOW()
    );

UPDATE public.notifications n
SET
    user_id = NULL,
    membre_id = NULL
WHERE
    n.user_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE
            p.id = n.user_id
    );

DO $$ BEGIN
    ALTER TABLE public.notifications
        ADD CONSTRAINT fk_notifications_user_profiles
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_canal_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_canal_check CHECK (
    canal IN ('Email', 'SMS', 'Dashboard')
);

CREATE OR REPLACE FUNCTION public.sync_notification_cols()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_id := COALESCE(NEW.user_id, NEW.membre_id);
    NEW.membre_id := COALESCE(NEW.membre_id, NEW.user_id);
    NEW.created_at := COALESCE(NEW.created_at, NEW.date_creation, NOW());
    NEW.date_creation := COALESCE(NEW.date_creation, NEW.created_at, NOW());
    IF NEW.titre IS NULL OR NEW.titre = '' THEN
        NEW.titre := COALESCE(NEW.type, 'Notification');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_notification_cols ON public.notifications;

CREATE TRIGGER trg_sync_notification_cols
    BEFORE INSERT OR UPDATE ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.sync_notification_cols();

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON public.notifications (tenant_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membres : lecture de ses propres notifications" ON public.notifications;

CREATE POLICY "Membres : lecture de ses propres notifications" ON public.notifications FOR
SELECT USING (
        auth.uid () = COALESCE(user_id, membre_id)
    );

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;

CREATE POLICY "Users mark own notifications read" ON public.notifications FOR
UPDATE USING (
    auth.uid () = COALESCE(user_id, membre_id)
);

DROP POLICY IF EXISTS "Admin/Staff : lecture de toutes les notifications" ON public.notifications;

CREATE POLICY "Admin/Staff : lecture de toutes les notifications" ON public.notifications FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN (
                    'super_admin', 'admin', 'staff'
                )
        )
    );

-- ==============================================================================
-- 11. TRAINER PROFILES, DOCUMENTS, RGPD, MESSAGERIE & AUDIT LOG
-- ==============================================================================
ALTER TABLE public.trainer_profiles
ADD COLUMN IF NOT EXISTS telephone_pro TEXT,
ADD COLUMN IF NOT EXISTS commentaires_admin TEXT;

DO $$ BEGIN
    ALTER TABLE public.trainer_profiles
        ADD CONSTRAINT fk_trainer_profiles_user_profiles
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.documents_membres (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
    guest_id UUID REFERENCES public.guests (id) ON DELETE CASCADE,
    type_doc TEXT NOT NULL CHECK (
        type_doc IN (
            'reglement_interieur',
            'politique_confidentialite',
            'contrat_abonnement',
            'cin_passeport',
            'justificatif_etudiant',
            'convention_formateur',
            'autre'
        )
    ),
    nom TEXT NOT NULL,
    url TEXT,
    pdf_contenu TEXT,
    signe BOOLEAN NOT NULL DEFAULT FALSE,
    signe_at TIMESTAMPTZ,
    signature_ip TEXT,
    signature_token TEXT DEFAULT encode (gen_random_bytes (32), 'hex'),
    accepte BOOLEAN NOT NULL DEFAULT FALSE,
    accepte_at TIMESTAMPTZ,
    uploade_par TEXT DEFAULT 'membre',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (
        user_id IS NOT NULL
        OR guest_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_docs_user ON public.documents_membres (user_id);

CREATE INDEX IF NOT EXISTS idx_docs_tenant ON public.documents_membres (tenant_id);

CREATE INDEX IF NOT EXISTS idx_docs_token ON public.documents_membres (signature_token);

ALTER TABLE public.documents_membres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "docs_read_own" ON public.documents_membres;

CREATE POLICY "docs_read_own" ON public.documents_membres FOR
SELECT USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN (
                    'super_admin', 'admin', 'staff'
                )
        )
    );

DROP POLICY IF EXISTS "docs_insert" ON public.documents_membres;

CREATE POLICY "docs_insert" ON public.documents_membres FOR
INSERT
WITH
    CHECK (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN (
                    'super_admin',
                    'admin',
                    'staff'
                )
        )
    );

DROP POLICY IF EXISTS "docs_update" ON public.documents_membres;

CREATE POLICY "docs_update" ON public.documents_membres FOR
UPDATE USING (
    user_id = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN (
                'super_admin',
                'admin',
                'staff'
            )
    )
);

CREATE TABLE IF NOT EXISTS public.contenu_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    type_doc TEXT NOT NULL CHECK (
        type_doc IN (
            'reglement_interieur',
            'politique_confidentialite'
        )
    ),
    contenu TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0',
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, type_doc, actif)
);

ALTER TABLE public.contenu_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contenu_docs_read" ON public.contenu_documents;

CREATE POLICY "contenu_docs_read" ON public.contenu_documents FOR
SELECT USING (true);

DROP POLICY IF EXISTS "contenu_docs_manage" ON public.contenu_documents;

CREATE POLICY "contenu_docs_manage" ON public.contenu_documents FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN ('super_admin', 'admin')
    )
);

CREATE TABLE IF NOT EXISTS public.rgpd_demandes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    type_demande TEXT NOT NULL CHECK (
        type_demande IN (
            'export',
            'suppression',
            'rectification',
            'opposition_marketing',
            'portabilite'
        )
    ),
    statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (
        statut IN (
            'en_attente',
            'en_cours',
            'traite',
            'refuse'
        )
    ),
    details TEXT,
    traite_par UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
    traite_at TIMESTAMPTZ,
    export_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rgpd_user ON public.rgpd_demandes (user_id);

ALTER TABLE public.rgpd_demandes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rgpd_read_own" ON public.rgpd_demandes;

CREATE POLICY "rgpd_read_own" ON public.rgpd_demandes FOR
SELECT USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE
                id = auth.uid ()
                AND role IN ('super_admin', 'admin')
        )
    );

DROP POLICY IF EXISTS "rgpd_insert_own" ON public.rgpd_demandes;

CREATE POLICY "rgpd_insert_own" ON public.rgpd_demandes FOR
INSERT
WITH
    CHECK (user_id = auth.uid ());

DROP POLICY IF EXISTS "rgpd_update_admin" ON public.rgpd_demandes;

CREATE POLICY "rgpd_update_admin" ON public.rgpd_demandes FOR
UPDATE USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE
            id = auth.uid ()
            AND role IN ('super_admin', 'admin')
    )
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON public.conversation_members (user_id);

CREATE INDEX IF NOT EXISTS idx_conv_members_conv ON public.conversation_members (conversation_id);

DO $$ BEGIN
    ALTER TABLE public.messages
        ADD CONSTRAINT fk_messages_sender_profiles
        FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

EXCEPTION WHEN duplicate_object THEN NULL;

END $$;

DO $$ BEGIN
    ALTER TABLE public.conversations
        ADD CONSTRAINT fk_conversations_created_by_profiles
        FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.memberships m
SET
    user_id = NULL
WHERE
    m.user_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE
            p.id = m.user_id
    );

DO $$ BEGIN
    ALTER TABLE public.memberships
        ADD CONSTRAINT fk_memberships_user_profiles
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.organizations o
SET
    owner_id = NULL
WHERE
    o.owner_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE
            p.id = o.owner_id
    );

DO $$ BEGIN
    ALTER TABLE public.organizations ALTER COLUMN owner_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_owner_id_fkey;

DO $$ BEGIN
    ALTER TABLE public.organizations
        ADD CONSTRAINT fk_organizations_owner_profiles
        FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Unicité stricte insensible à la casse : 1 adresse e-mail = 1 seul compte profil
DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_unique_email_lower
        ON public.profiles (LOWER(TRIM(email)))
        WHERE email IS NOT NULL AND TRIM(email) <> '';
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'idx_profiles_unique_email_lower ignoré : des doublons historiques existent dans public.profiles.';
END $$;

-- Trigger d'inscription Supabase Auth unifié (avec support type_membre Entreprise/Individuel)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    clean_email TEXT;
    user_nom TEXT;
    user_prenom TEXT;
    user_tel TEXT;
    user_type TEXT;
    pending_inv RECORD;
BEGIN
    clean_email := LOWER(TRIM(NEW.email));
    user_nom := COALESCE(NULLIF(NEW.raw_user_meta_data->>'nom', ''), NULLIF(NEW.raw_user_meta_data->>'last_name', ''), split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 2), '');
    user_prenom := COALESCE(NULLIF(NEW.raw_user_meta_data->>'prenom', ''), NULLIF(NEW.raw_user_meta_data->>'first_name', ''), split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 1), '');
    user_tel := COALESCE(NEW.raw_user_meta_data->>'telephone', NEW.raw_user_meta_data->>'phone', '');
    user_type := CASE
        WHEN NEW.raw_user_meta_data->>'type_membre' IN ('individuel', 'entreprise', 'etudiant')
        THEN NEW.raw_user_meta_data->>'type_membre'
        WHEN NEW.raw_user_meta_data->>'account_type' = 'entreprise' THEN 'entreprise'
        ELSE 'individuel'
    END;

    INSERT INTO public.profiles (
        id, email, nom, prenom, telephone, role, type_membre, statut_compte,
        email_verifie, is_super_admin, langue
    )
    VALUES (
        NEW.id,
        clean_email,
        user_nom,
        user_prenom,
        user_tel,
        CASE WHEN clean_email = 'contact@vclow.com' THEN 'super_admin' ELSE COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'member') END,
        user_type,
        'actif',
        COALESCE((NEW.email_confirmed_at IS NOT NULL), FALSE),
        CASE WHEN clean_email = 'contact@vclow.com' THEN TRUE ELSE FALSE END,
        COALESCE(NEW.raw_user_meta_data->>'langue', 'fr')
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        type_membre = COALESCE(profiles.type_membre, EXCLUDED.type_membre),
        email_verifie = COALESCE(profiles.email_verifie, EXCLUDED.email_verifie),
        updated_at = NOW();

    UPDATE public.guests
    SET converti_en_membre_id = NEW.id, converti_at = NOW()
    WHERE LOWER(TRIM(email)) = clean_email AND converti_en_membre_id IS NULL;

    UPDATE public.reservations r
    SET user_id = NEW.id, membre_id = NEW.id
    WHERE COALESCE(r.user_id, r.membre_id) IS NULL
      AND r.guest_id IN (SELECT g.id FROM public.guests g WHERE LOWER(TRIM(g.email)) = clean_email);

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

CREATE TABLE IF NOT EXISTS public.super_admin_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   UUID,
    target_name TEXT,
    details     JSONB DEFAULT '{}'::jsonb,
    ip_address  TEXT,
    status      TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'blocked', 'error')),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.super_admin_audit_log (created_at DESC);

-- ==============================================================================
-- 12. RECHARGER LE CACHE SCHÉMA POSTGREST (CRITIQUE SUPABASE API)
-- ==============================================================================
NOTIFY pgrst, 'reload schema';