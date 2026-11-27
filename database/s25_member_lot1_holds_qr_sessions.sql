-- ============================================================================
-- Migration s25 : Espace Membre LOT 1 — Verrous temporaires 5 min (booking_holds),
--                 QR dynamique 5 min + code court (member_qr_tokens),
--                 et traçabilité correction session membre (sessions)
-- Idempotent : exécutable sans erreur sur une base déjà migrée ou partielle.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Verrous temporaires de créneau (5 min à l'entrée en étape 3)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  espace_id uuid NOT NULL REFERENCES public.espaces(id) ON DELETE CASCADE,
  unite_id uuid NULL,
  floor_plan_item_id text NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_debut timestamptz NOT NULL,
  date_fin timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_holds_espace_exp
  ON public.booking_holds (espace_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_booking_holds_tenant_exp
  ON public.booking_holds (tenant_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_booking_holds_user_exp
  ON public.booking_holds (user_id, expires_at);

ALTER TABLE public.booking_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_holds_member_manage_own" ON public.booking_holds;
CREATE POLICY "booking_holds_member_manage_own"
  ON public.booking_holds
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "booking_holds_staff_select_tenant" ON public.booking_holds;
CREATE POLICY "booking_holds_staff_select_tenant"
  ON public.booking_holds
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'staff')
        AND (p.role = 'super_admin' OR p.tenant_id = booking_holds.tenant_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Jetons QR dynamiques (TTL 5 min) + code court de secours (XXX-XXX)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_qr_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  short_code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_qr_tokens_short_exp
  ON public.member_qr_tokens (short_code, expires_at);

CREATE INDEX IF NOT EXISTS idx_member_qr_tokens_user_exp
  ON public.member_qr_tokens (user_id, expires_at);

ALTER TABLE public.member_qr_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_qr_tokens_member_select_own" ON public.member_qr_tokens;
CREATE POLICY "member_qr_tokens_member_select_own"
  ON public.member_qr_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "member_qr_tokens_staff_select_tenant" ON public.member_qr_tokens;
CREATE POLICY "member_qr_tokens_staff_select_tenant"
  ON public.member_qr_tokens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'staff')
        AND (p.role = 'super_admin' OR p.tenant_id = member_qr_tokens.tenant_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Colonnes additionnelles sur public.sessions (arrêt membre & correction staff tracée)
-- ----------------------------------------------------------------------------
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS ended_by_member boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_adjusted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS staff_adjusted_by uuid NULL,
  ADD COLUMN IF NOT EXISTS staff_adjustment_reason text NULL;
