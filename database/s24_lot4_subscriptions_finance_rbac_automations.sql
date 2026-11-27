-- ============================================================================
-- DESKYWORK — LOT 4 : Abonnements, Finance, Numérotation continue, RBAC & Automatisations P1
-- À exécuter dans l'éditeur SQL Supabase (idempotent, isolation tenant_id / etablissement_id).
-- ============================================================================

-- 1. Abonnements : quotas, unité de bureau privé long terme et motif de suspension humaine
ALTER TABLE IF EXISTS public.abonnements
  ADD COLUMN IF NOT EXISTS unite_id UUID REFERENCES public.unites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quota_type TEXT NOT NULL DEFAULT 'illimite',
  ADD COLUMN IF NOT EXISTS quota_total NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS quota_consomme NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motif_suspension TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_abonnements_tenant_unite
  ON public.abonnements (tenant_id, unite_id)
  WHERE unite_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.abonnement_consommations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  abonnement_id UUID NOT NULL REFERENCES public.abonnements(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
  quota_delta NUMERIC(10, 2) NOT NULL DEFAULT 0,
  quota_type TEXT NOT NULL DEFAULT 'heures',
  montant_economise_ttc NUMERIC(12, 3) NOT NULL DEFAULT 0,
  description TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abonnement_conso_sub
  ON public.abonnement_consommations (tenant_id, abonnement_id, created_at DESC);

-- 2. Réservations : liaison quota abonnement & expiration confirmation téléphone
ALTER TABLE IF EXISTS public.reservations
  ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES public.abonnements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quota_deduit NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_couvert_abonnement NUMERIC(12, 3) NOT NULL DEFAULT 0;

-- 3. Paiements : paiements partiels, relances, promesses et référence avoir
ALTER TABLE IF EXISTS public.paiements
  ADD COLUMN IF NOT EXISTS parent_payment_id UUID REFERENCES public.paiements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total_du NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS montant_paye NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reste_a_payer NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promesse_paiement_date DATE,
  ADD COLUMN IF NOT EXISTS promesse_paiement_note TEXT,
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reminder_channel TEXT,
  ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avoir_document_id UUID,
  ADD COLUMN IF NOT EXISTS motif_remboursement TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Autoriser le statut 'partial' sur paiements
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.paiements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%statut%'
  LOOP
    EXECUTE format('ALTER TABLE public.paiements DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
  ALTER TABLE public.paiements
    ADD CONSTRAINT paiements_statut_check
    CHECK (statut IN ('pending', 'partial', 'paid', 'failed', 'refunded', 'cancelled'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- 4. Compteurs de numérotation continue et sans trou (Reçus, Factures, Devis, Avoirs)
CREATE TABLE IF NOT EXISTS public.document_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('receipt', 'invoice', 'quote', 'credit_note')),
  fiscal_year INTEGER NOT NULL,
  prefix TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, doc_type, fiscal_year)
);

CREATE OR REPLACE FUNCTION public.next_document_number(
  p_etablissement_id UUID,
  p_doc_type TEXT,
  p_prefix TEXT DEFAULT NULL,
  p_fiscal_year INTEGER DEFAULT EXTRACT(YEAR FROM timezone('Africa/Tunis', now()))::integer
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_default_prefix TEXT;
  v_effective_prefix TEXT;
  v_next INTEGER;
BEGIN
  v_default_prefix := CASE p_doc_type
    WHEN 'receipt' THEN 'REC'
    WHEN 'invoice' THEN 'FAC'
    WHEN 'quote' THEN 'DEV'
    WHEN 'credit_note' THEN 'AV'
    ELSE 'DOC'
  END;
  v_effective_prefix := COALESCE(NULLIF(TRIM(p_prefix), ''), v_default_prefix);

  INSERT INTO public.document_counters (tenant_id, doc_type, fiscal_year, prefix, last_number)
  VALUES (p_etablissement_id, p_doc_type, p_fiscal_year, v_effective_prefix, 1)
  ON CONFLICT (tenant_id, doc_type, fiscal_year)
  DO UPDATE SET
    last_number = public.document_counters.last_number + 1,
    prefix = COALESCE(NULLIF(TRIM(p_prefix), ''), public.document_counters.prefix),
    updated_at = now()
  RETURNING last_number, prefix INTO v_next, v_effective_prefix;

  RETURN v_effective_prefix || '-' || p_fiscal_year::text || '-' || LPAD(v_next::text, 4, '0');
END;
$$;

-- 5. Documents comptables (Factures, Devis, Avoirs) avec verrouillage d'émission
ALTER TABLE IF EXISTS public.devis_factures
  ADD COLUMN IF NOT EXISTS client_telephone TEXT,
  ADD COLUMN IF NOT EXISTS client_matricule_fiscal TEXT,
  ADD COLUMN IF NOT EXISTS client_adresse TEXT,
  ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS abonnement_id UUID REFERENCES public.abonnements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paiement_id UUID REFERENCES public.paiements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_facture_id UUID REFERENCES public.devis_factures(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total_tva NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timbre_fiscal NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motif_avoir TEXT,
  ADD COLUMN IF NOT EXISTS mentions_legales TEXT,
  ADD COLUMN IF NOT EXISTS emetteur_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.devis_factures'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%type%' OR pg_get_constraintdef(oid) ILIKE '%statut%')
  LOOP
    EXECUTE format('ALTER TABLE public.devis_factures DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
  ALTER TABLE public.devis_factures
    ADD CONSTRAINT devis_factures_type_check CHECK (type IN ('devis', 'facture', 'avoir'));
  ALTER TABLE public.devis_factures
    ADD CONSTRAINT devis_factures_statut_check CHECK (statut IN ('brouillon', 'emise', 'partielle', 'payee', 'accepte', 'refuse', 'annulee', 'avoir_emis'));
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devis_factures_tenant_numero
  ON public.devis_factures (tenant_id, numero);

-- 6. Notifications : déduplication et lien direct cible
ALTER TABLE IF EXISTS public.notifications
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS target_url TEXT,
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup_key
  ON public.notifications (user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- 7. Permissions de rôles personnalisables par établissement
CREATE TABLE IF NOT EXISTS public.roles_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  role_code TEXT NOT NULL,
  role_label TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role_code)
);

-- 8. Row Level Security (isolation stricte par tenant_id / etablissement_id)
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['abonnement_consommations', 'document_counters', 'roles_permissions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_rw ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_rw ON public.%I FOR ALL TO authenticated
       USING (tenant_id = public.get_user_tenant_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (''super_admin'', ''admin'')))
       WITH CHECK (tenant_id = public.get_user_tenant_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (''super_admin'', ''admin'')))',
      tbl, tbl
    );
  END LOOP;
END $$;
