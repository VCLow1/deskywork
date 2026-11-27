-- =========================================================================
-- S22 — LOT 2 : MODÈLE DE DONNÉES UNIFIÉ, SOFT-DELETE, AUDIT & TARIFS HT/TTC
-- Idempotent, strictement isolé par etablissement_id (= tenant_id) + RLS
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper RLS sûr (compatibilité ascendante)
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =========================================================================
-- 1. SOFT-DELETE GLOBAL (archived_at, archived_by) — AUCUNE SUPPRESSION PHYSIQUE
-- =========================================================================
ALTER TABLE public.espaces
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.tarifs_abonnements
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prix_ht NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS prix_ttc NUMERIC(12,3);

ALTER TABLE public.codes_promo
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.abonnements
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.formations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill tarifs_abonnements HT/TTC
UPDATE public.tarifs_abonnements
SET
  prix_ht = COALESCE(prix_ht, prix, 0),
  tva_pct = COALESCE(tva_pct, 19),
  prix_ttc = COALESCE(prix_ttc, ROUND((COALESCE(prix, 0) * (1 + COALESCE(tva_pct, 19) / 100.0))::numeric, 3))
WHERE prix_ht IS NULL OR prix_ttc IS NULL;

-- Étendre les statuts d'abonnement autorisés (Actifs, À renouveler, Expirés, Suspendus, Résiliés)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.abonnements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%statut%'
  LOOP
    EXECUTE format('ALTER TABLE public.abonnements DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
  ALTER TABLE public.abonnements
    ADD CONSTRAINT abonnements_statut_check
    CHECK (statut IN ('active', 'actif', 'a_renouveler', 'expired', 'expire', 'suspended', 'suspendu', 'resilie', 'cancelled'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- =========================================================================
-- 2. TABLE UNIFIÉE PERSONNES & VUE SÉPARÉE UTILISATEURS_STAFF
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.personnes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  guest_id UUID UNIQUE REFERENCES public.guests(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'membre' CHECK (type IN ('membre', 'invite', 'prospect')),
  nom TEXT NOT NULL DEFAULT '',
  prenom TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  telephone TEXT,
  type_client TEXT NOT NULL DEFAULT 'particulier' CHECK (type_client IN ('particulier', 'entreprise')),
  entreprise_nom TEXT,
  matricule_fiscal TEXT,
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'en_attente', 'suspendu', 'converti')),
  notes TEXT,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personnes_etab_type ON public.personnes(etablissement_id, type);
CREATE INDEX IF NOT EXISTS idx_personnes_archived ON public.personnes(etablissement_id, archived_at);

-- Backfill non-staff profiles -> personnes
INSERT INTO public.personnes (tenant_id, profile_id, type, nom, prenom, email, telephone, type_client, statut, archived_at, created_at)
SELECT
  p.tenant_id,
  p.id,
  CASE WHEN p.role = 'guest' THEN 'invite' ELSE 'membre' END,
  COALESCE(p.nom, ''),
  COALESCE(p.prenom, ''),
  p.email,
  p.telephone,
  CASE WHEN COALESCE(p.type_membre, 'particulier') = 'entreprise' THEN 'entreprise' ELSE 'particulier' END,
  COALESCE(NULLIF(p.statut_compte, ''), 'actif'),
  p.archived_at,
  COALESCE(p.created_at, NOW())
FROM public.profiles p
WHERE p.tenant_id IS NOT NULL
  AND COALESCE(p.role, 'member') NOT IN ('admin', 'staff', 'super_admin')
ON CONFLICT (profile_id) DO NOTHING;

-- Backfill guests -> personnes
INSERT INTO public.personnes (tenant_id, guest_id, type, nom, prenom, email, telephone, statut, created_at)
SELECT
  g.tenant_id,
  g.id,
  'invite',
  COALESCE(g.nom, ''),
  COALESCE(g.prenom, ''),
  g.email,
  g.telephone,
  CASE WHEN g.converted_user_id IS NOT NULL THEN 'converti' ELSE 'actif' END,
  COALESCE(g.created_at, NOW())
FROM public.guests g
WHERE g.tenant_id IS NOT NULL
ON CONFLICT (guest_id) DO NOTHING;

-- Vue strictement séparée pour Staff & Administrateurs (jamais comptés dans Membres/Top membres)
CREATE OR REPLACE VIEW public.utilisateurs_staff AS
SELECT
  id,
  tenant_id,
  tenant_id AS etablissement_id,
  nom,
  prenom,
  email,
  telephone,
  role,
  statut_compte,
  archived_at,
  created_at,
  updated_at
FROM public.profiles
WHERE role IN ('admin', 'staff', 'super_admin');

-- RLS personnes
ALTER TABLE public.personnes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personnes_tenant_manage ON public.personnes;
CREATE POLICY personnes_tenant_manage ON public.personnes
  FOR ALL TO authenticated
  USING (
    etablissement_id = public.get_user_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff'))
  )
  WITH CHECK (
    etablissement_id = public.get_user_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff'))
  );

DROP POLICY IF EXISTS personnes_super_admin_all ON public.personnes;
CREATE POLICY personnes_super_admin_all ON public.personnes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.role = 'super_admin' OR p.is_super_admin = TRUE)));

-- =========================================================================
-- 3. JOURNAL D'ACTIVITÉ (AUDIT LOG)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.journal_activite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL CHECK (action IN ('creation', 'modification', 'changement_statut', 'encaissement', 'remboursement', 'archivage', 'restauration')),
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  entity_label TEXT,
  before_data JSONB,
  after_data JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_activite_etab_date ON public.journal_activite(etablissement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_activite_entity ON public.journal_activite(entity_type, entity_id);

ALTER TABLE public.journal_activite ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journal_activite_tenant_select ON public.journal_activite;
CREATE POLICY journal_activite_tenant_select ON public.journal_activite
  FOR SELECT TO authenticated
  USING (
    etablissement_id = public.get_user_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff', 'super_admin'))
  );

DROP POLICY IF EXISTS journal_activite_tenant_insert ON public.journal_activite;
CREATE POLICY journal_activite_tenant_insert ON public.journal_activite
  FOR INSERT TO authenticated
  WITH CHECK (etablissement_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS journal_activite_super_admin ON public.journal_activite;
CREATE POLICY journal_activite_super_admin ON public.journal_activite
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.role = 'super_admin' OR p.is_super_admin = TRUE)));

-- =========================================================================
-- 4. TARIFICATION UNIQUE HT / TVA / TTC & HISTORIQUE DATÉ
-- =========================================================================
ALTER TABLE public.espaces
  ADD COLUMN IF NOT EXISTS tarif_horaire_ht NUMERIC(12,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tarif_journalier_ht NUMERIC(12,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tarif_mensuel_ht NUMERIC(12,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tva_pct NUMERIC(5,2) NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS tarifs_actifs JSONB NOT NULL DEFAULT '{"horaire":true,"journalier":false,"mensuel":false}'::jsonb;

UPDATE public.espaces
SET
  tarif_horaire_ht = COALESCE(NULLIF(tarif_horaire_ht, 0), tarif_horaire, 0),
  tarif_journalier_ht = COALESCE(NULLIF(tarif_journalier_ht, 0), tarif_journalier, 0),
  tarif_mensuel_ht = COALESCE(NULLIF(tarif_mensuel_ht, 0), tarif_mensuel, 0),
  tarifs_actifs = jsonb_build_object(
    'horaire', COALESCE(tarif_horaire, 0) >= 0,
    'journalier', COALESCE(tarif_journalier, 0) > 0,
    'mensuel', COALESCE(tarif_mensuel, 0) > 0
  )
WHERE tarif_horaire_ht = 0 OR tarif_journalier_ht = 0 OR tarif_mensuel_ht = 0;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS tarif_applique_ht NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS tva_pct_applique NUMERIC(5,2) DEFAULT 19,
  ADD COLUMN IF NOT EXISTS montant_ht NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS montant_ttc NUMERIC(12,3);

ALTER TABLE public.paiements
  ADD COLUMN IF NOT EXISTS montant_ht NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS tva_pct NUMERIC(5,2) DEFAULT 19,
  ADD COLUMN IF NOT EXISTS montant_ttc NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS montant_rembourse NUMERIC(12,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT;

CREATE TABLE IF NOT EXISTS public.tarif_historique (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  espace_id UUID REFERENCES public.espaces(id) ON DELETE SET NULL,
  tarif_abonnement_id UUID REFERENCES public.tarifs_abonnements(id) ON DELETE SET NULL,
  type_tarif TEXT NOT NULL,
  prix_ht NUMERIC(12,3) NOT NULL DEFAULT 0,
  tva_pct NUMERIC(5,2) NOT NULL DEFAULT 19,
  prix_ttc NUMERIC(12,3) NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tarif_historique_etab ON public.tarif_historique(etablissement_id, effective_from DESC);

ALTER TABLE public.tarif_historique ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarif_historique_tenant_rw ON public.tarif_historique;
CREATE POLICY tarif_historique_tenant_rw ON public.tarif_historique
  FOR ALL TO authenticated
  USING (
    etablissement_id = public.get_user_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff'))
  )
  WITH CHECK (
    etablissement_id = public.get_user_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff'))
  );

-- =========================================================================
-- 5. RESSOURCES, SERVICES, MAINTENANCE/INCIDENTS & FACTURES/DEVIS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.ressources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  nom TEXT NOT NULL,
  categorie TEXT NOT NULL DEFAULT 'Matériel',
  quantite INTEGER NOT NULL DEFAULT 1 CHECK (quantite >= 0),
  tarif_ht NUMERIC(12,3) NOT NULL DEFAULT 0,
  tva_pct NUMERIC(5,2) NOT NULL DEFAULT 19,
  statut TEXT NOT NULL DEFAULT 'disponible' CHECK (statut IN ('disponible', 'indisponible', 'maintenance')),
  description TEXT,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.services_additionnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  nom TEXT NOT NULL,
  unite TEXT NOT NULL DEFAULT 'unité',
  tarif_ht NUMERIC(12,3) NOT NULL DEFAULT 0,
  tva_pct NUMERIC(5,2) NOT NULL DEFAULT 19,
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
  description TEXT,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.incidents_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  espace_id UUID REFERENCES public.espaces(id) ON DELETE SET NULL,
  titre TEXT NOT NULL,
  description TEXT,
  priorite TEXT NOT NULL DEFAULT 'normale' CHECK (priorite IN ('basse', 'normale', 'haute', 'critique')),
  statut TEXT NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'en_cours', 'resolu')),
  bloque_espace BOOLEAN NOT NULL DEFAULT FALSE,
  reported_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.devis_factures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id UUID GENERATED ALWAYS AS (tenant_id) STORED,
  type TEXT NOT NULL DEFAULT 'facture' CHECK (type IN ('facture', 'devis')),
  numero TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  personne_id UUID REFERENCES public.personnes(id) ON DELETE SET NULL,
  client_nom TEXT NOT NULL,
  client_email TEXT,
  montant_ht NUMERIC(12,3) NOT NULL DEFAULT 0,
  tva_pct NUMERIC(5,2) NOT NULL DEFAULT 19,
  montant_ttc NUMERIC(12,3) NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'emise' CHECK (statut IN ('brouillon', 'emise', 'payee', 'accepte', 'refuse', 'annulee')),
  date_emission DATE NOT NULL DEFAULT CURRENT_DATE,
  date_echeance DATE,
  lignes JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ressources', 'services_additionnels', 'incidents_maintenance', 'devis_factures']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_rw ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_rw ON public.%I FOR ALL TO authenticated
       USING (etablissement_id = public.get_user_tenant_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (''admin'', ''staff'')))
       WITH CHECK (etablissement_id = public.get_user_tenant_id() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (''admin'', ''staff'')))',
      tbl, tbl
    );
  END LOOP;
END $$;
