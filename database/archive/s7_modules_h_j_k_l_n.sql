-- ═══════════════════════════════════════════════════════════════════════════
-- MODULES H · J · K · L · N
-- Module H  — Visiteurs & Guests
-- Module J  — Politique d'annulation avancée
-- Module K  — Documents membres & contrats
-- Module L  — Protection des données RGPD
-- Module N  — Gestion multi-sites
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE H — Table guests
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    nom           TEXT NOT NULL,
    prenom        TEXT NOT NULL,
    email         TEXT NOT NULL,
    telephone     TEXT NOT NULL,
    -- Token unique pour liens d'annulation/confirmation sans compte
    token         TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    -- Conversion en membre
    converti_en_membre_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    converti_at   TIMESTAMPTZ,
    -- Métadonnées
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_email_tenant
    ON public.guests(email, tenant_id);
CREATE INDEX IF NOT EXISTS idx_guests_token ON public.guests(token);
CREATE INDEX IF NOT EXISTS idx_guests_tenant ON public.guests(tenant_id);

ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

-- Guests : lecture admin/staff uniquement
CREATE POLICY "guests_read_staff" ON public.guests
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles
                WHERE id = auth.uid() AND role IN ('super_admin','admin','staff'))
    );

CREATE POLICY "guests_insert_public" ON public.guests
    FOR INSERT WITH CHECK (true); -- Accès public pour la création

CREATE POLICY "guests_update_staff" ON public.guests
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles
                WHERE id = auth.uid() AND role IN ('super_admin','admin','staff'))
    );

-- Colonne guest_id sur réservations (nullable)
ALTER TABLE public.reservations
    ALTER COLUMN user_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL;

ALTER TABLE public.inscriptions_formations
    ALTER COLUMN user_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE J — Politique d'annulation avancée
-- ─────────────────────────────────────────────────────────────────────────

-- Règles par type d'espace (complète la table politique_annulation existante)
CREATE TABLE IF NOT EXISTS public.politique_annulation_espaces (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    type_espace   TEXT NOT NULL CHECK (type_espace IN
                      ('open_space','bureau_prive','salle_reunion',
                       'salle_formation','espace_evenementiel')),
    -- Tranches horaires avec pénalités
    tranche_libre_heures    INTEGER NOT NULL DEFAULT 24,  -- Avant : remboursement 100%
    tranche_tardive_heures  INTEGER NOT NULL DEFAULT 12,  -- Entre : pénalité partielle
    penalite_tardive_pct    NUMERIC(5,2) NOT NULL DEFAULT 50,
    penalite_tres_tardive_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
    penalite_noshow_pct     NUMERIC(5,2) NOT NULL DEFAULT 100,
    noshow_note_profil      BOOLEAN NOT NULL DEFAULT TRUE,
    -- Crédit portefeuille
    credit_portefeuille_auto BOOLEAN NOT NULL DEFAULT FALSE,
    credit_portefeuille_pct  NUMERIC(5,2) NOT NULL DEFAULT 100, -- % du montant remboursé converti en crédit
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, type_espace)
);

CREATE INDEX IF NOT EXISTS idx_pol_annul_tenant ON public.politique_annulation_espaces(tenant_id);

ALTER TABLE public.politique_annulation_espaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pol_annul_read" ON public.politique_annulation_espaces
    FOR SELECT USING (true);

CREATE POLICY "pol_annul_manage" ON public.politique_annulation_espaces
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles
                WHERE id = auth.uid() AND role IN ('super_admin','admin'))
    );

-- Portefeuille crédit membre
CREATE TABLE IF NOT EXISTS public.credits_membres (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    montant       NUMERIC(10,2) NOT NULL CHECK (montant >= 0),
    motif         TEXT,                          -- Ex: "Annulation réservation #xxx"
    reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
    expire_at     TIMESTAMPTZ,                   -- NULL = pas d'expiration
    utilise       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_user ON public.credits_membres(user_id);

ALTER TABLE public.credits_membres ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credits_read_own" ON public.credits_membres
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = auth.uid() AND role IN ('super_admin','admin','staff'))
    );

CREATE POLICY "credits_manage_admin" ON public.credits_membres
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles
                WHERE id = auth.uid() AND role IN ('super_admin','admin','staff'))
    );

-- Colonne no_show et credit_utilise sur reservations
ALTER TABLE public.reservations
    ADD COLUMN IF NOT EXISTS no_show      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS penalite_pct NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS credit_id    UUID REFERENCES public.credits_membres(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE K — Documents membres & contrats
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documents_membres (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id       UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    guest_id      UUID REFERENCES public.guests(id) ON DELETE CASCADE,
    type_doc      TEXT NOT NULL CHECK (type_doc IN (
                      'reglement_interieur','politique_confidentialite',
                      'contrat_abonnement','cin_passeport',
                      'justificatif_etudiant','convention_formateur','autre')),
    nom           TEXT NOT NULL,
    url           TEXT,                          -- URL Supabase Storage
    pdf_contenu   TEXT,                          -- Contenu HTML pour génération PDF
    -- Signature électronique
    signe         BOOLEAN NOT NULL DEFAULT FALSE,
    signe_at      TIMESTAMPTZ,
    signature_ip  TEXT,
    signature_token TEXT DEFAULT encode(gen_random_bytes(32), 'hex'),
    -- Acceptation (règlement, politique)
    accepte       BOOLEAN NOT NULL DEFAULT FALSE,
    accepte_at    TIMESTAMPTZ,
    -- Qui a uploadé
    uploade_par   TEXT DEFAULT 'membre',         -- 'membre' | 'admin' | 'staff'
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_docs_user   ON public.documents_membres(user_id);
CREATE INDEX IF NOT EXISTS idx_docs_tenant ON public.documents_membres(tenant_id);
CREATE INDEX IF NOT EXISTS idx_docs_token  ON public.documents_membres(signature_token);

ALTER TABLE public.documents_membres ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs_read_own" ON public.documents_membres
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = auth.uid() AND role IN ('super_admin','admin','staff'))
    );

CREATE POLICY "docs_insert" ON public.documents_membres
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = auth.uid() AND role IN ('super_admin','admin','staff'))
    );

CREATE POLICY "docs_update" ON public.documents_membres
    FOR UPDATE USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = auth.uid() AND role IN ('super_admin','admin','staff'))
    );

-- Contenu règlement intérieur & politique de confidentialité (par tenant)
CREATE TABLE IF NOT EXISTS public.contenu_documents (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    type_doc  TEXT NOT NULL CHECK (type_doc IN ('reglement_interieur','politique_confidentialite')),
    contenu   TEXT NOT NULL,
    version   TEXT NOT NULL DEFAULT '1.0',
    actif     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, type_doc, actif)
);

ALTER TABLE public.contenu_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contenu_docs_read" ON public.contenu_documents FOR SELECT USING (true);
CREATE POLICY "contenu_docs_manage" ON public.contenu_documents FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = auth.uid() AND role IN ('super_admin','admin')));

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE L — Protection des données RGPD
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rgpd_demandes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type_demande TEXT NOT NULL CHECK (type_demande IN (
                     'export','suppression','rectification','opposition_marketing','portabilite')),
    statut     TEXT NOT NULL DEFAULT 'en_attente'
                   CHECK (statut IN ('en_attente','en_cours','traite','refuse')),
    details    TEXT,
    traite_par UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    traite_at  TIMESTAMPTZ,
    export_url TEXT,                             -- URL fichier export si type='export'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rgpd_user   ON public.rgpd_demandes(user_id);
CREATE INDEX IF NOT EXISTS idx_rgpd_statut ON public.rgpd_demandes(statut);

ALTER TABLE public.rgpd_demandes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rgpd_read_own" ON public.rgpd_demandes
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = auth.uid() AND role IN ('super_admin','admin'))
    );

CREATE POLICY "rgpd_insert_own" ON public.rgpd_demandes
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "rgpd_update_admin" ON public.rgpd_demandes
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles
                WHERE id = auth.uid() AND role IN ('super_admin','admin'))
    );

-- Préférences marketing par membre
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS marketing_email   BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS marketing_sms     BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS suppression_demandee BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS suppression_at    TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE N — Multi-sites
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sites (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nom        TEXT NOT NULL,
    adresse    TEXT,
    ville      TEXT,
    telephone  TEXT,
    email      TEXT,
    actif      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_tenant ON public.sites(tenant_id);

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sites_read_authenticated" ON public.sites
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "sites_manage_admin" ON public.sites
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles
                WHERE id = auth.uid() AND role IN ('super_admin','admin'))
    );

-- Colonnes site_id sur espaces et abonnements
ALTER TABLE public.espaces
    ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL;

ALTER TABLE public.abonnements
    ADD COLUMN IF NOT EXISTS site_id      UUID REFERENCES public.sites(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS multi_sites  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.reservations
    ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL;

-- Accès membre multi-sites (quels sites un membre peut utiliser)
CREATE TABLE IF NOT EXISTS public.membres_sites (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    site_id   UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_membres_sites_user ON public.membres_sites(user_id);
CREATE INDEX IF NOT EXISTS idx_membres_sites_site ON public.membres_sites(site_id);

ALTER TABLE public.membres_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "membres_sites_read" ON public.membres_sites
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = auth.uid() AND role IN ('super_admin','admin','staff'))
    );

CREATE POLICY "membres_sites_manage" ON public.membres_sites
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles
                WHERE id = auth.uid() AND role IN ('super_admin','admin'))
    );

-- ─────────────────────────────────────────────────────────────────────────
-- Triggers updated_at
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER guests_updated_at
    BEFORE UPDATE ON public.guests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER pol_annul_espaces_updated_at
    BEFORE UPDATE ON public.politique_annulation_espaces
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER docs_membres_updated_at
    BEFORE UPDATE ON public.documents_membres
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER sites_updated_at
    BEFORE UPDATE ON public.sites
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
