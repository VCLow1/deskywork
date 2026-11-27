-- ============================================================================
-- DESKYWORK — LOT 2 Espace Membre :
--   - Motif de refus sur reservations
--   - Workflow demandes d'abonnement (en_attente_paiement) + tarifs HT/TTC & quotas
--   - Numérotation continue des reçus sur 6 chiffres : REC-AAAA-NNNNNN
-- À exécuter dans l'éditeur SQL Supabase (idempotent).
-- ============================================================================

-- 1. Motif de refus explicite saisi par l'Admin sur reservations
ALTER TABLE IF EXISTS public.reservations
  ADD COLUMN IF NOT EXISTS motif_refus text;

-- 2. Demandes d'abonnement, montants HT/TTC, code promo, paiement lié & résiliation membre
ALTER TABLE IF EXISTS public.abonnements
  ADD COLUMN IF NOT EXISTS montant_ht numeric(12, 3),
  ADD COLUMN IF NOT EXISTS montant_ttc numeric(12, 3),
  ADD COLUMN IF NOT EXISTS tva_pct numeric(5, 2),
  ADD COLUMN IF NOT EXISTS code_promo text,
  ADD COLUMN IF NOT EXISTS paiement_id uuid REFERENCES public.paiements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motif_resiliation text,
  ADD COLUMN IF NOT EXISTS demande_resiliation_at timestamptz;

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

  IF to_regclass('public.abonnements') IS NOT NULL THEN
    ALTER TABLE public.abonnements
      ADD CONSTRAINT abonnements_statut_check
      CHECK (statut IN (
        'en_attente_paiement',
        'active',
        'actif',
        'a_renouveler',
        'expired',
        'suspended',
        'resilie',
        'refuse'
      ));
  END IF;
END $$;

-- 3. Détails de contenu sur tarifs_abonnements (quotas, description, avantages)
ALTER TABLE IF EXISTS public.tarifs_abonnements
  ADD COLUMN IF NOT EXISTS quota_type text DEFAULT 'illimite',
  ADD COLUMN IF NOT EXISTS quota_total numeric(10, 2),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS avantages jsonb DEFAULT '[]'::jsonb;

-- 4. RPC PostgreSQL de numérotation continue : REC-AAAA-NNNNNN (6 chiffres pour les reçus)
CREATE OR REPLACE FUNCTION public.next_document_number(
  p_etablissement_id uuid,
  p_doc_type text,
  p_prefix text DEFAULT NULL,
  p_fiscal_year integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_year integer;
  v_default_prefix text;
  v_effective_prefix text;
  v_next integer;
  v_pad integer;
BEGIN
  v_year := COALESCE(p_fiscal_year, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Africa/Tunis'))::integer);
  v_default_prefix := CASE p_doc_type
    WHEN 'receipt' THEN 'REC'
    WHEN 'invoice' THEN 'FAC'
    WHEN 'quote' THEN 'DEV'
    WHEN 'credit_note' THEN 'AV'
    ELSE 'DOC'
  END;
  v_effective_prefix := COALESCE(NULLIF(trim(upper(p_prefix)), ''), v_default_prefix);
  v_pad := CASE WHEN p_doc_type = 'receipt' THEN 6 ELSE 4 END;

  INSERT INTO public.document_counters (tenant_id, doc_type, fiscal_year, prefix, last_number)
  VALUES (p_etablissement_id, p_doc_type, v_year, v_effective_prefix, 1)
  ON CONFLICT (tenant_id, doc_type, fiscal_year)
  DO UPDATE SET
    last_number = public.document_counters.last_number + 1,
    prefix = COALESCE(NULLIF(trim(upper(p_prefix)), ''), public.document_counters.prefix),
    updated_at = now()
  RETURNING last_number INTO v_next;

  RETURN v_effective_prefix || '-' || v_year::text || '-' || LPAD(v_next::text, v_pad, '0');
END;
$$;
