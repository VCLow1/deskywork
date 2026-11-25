-- =========================================================================
-- S20 — PLAN DE SALLE INTERACTIF 2D & OCCUPATION TEMPS RÉEL (DESKYWORK)
-- Multi-tenant strict (tenant_id) + RLS + Données de démonstration
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Table FLOOR_PLANS (Plans d'étage / zones par établissement)
CREATE TABLE IF NOT EXISTS public.floor_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 1200 CHECK (width BETWEEN 400 AND 4000),
  height INTEGER NOT NULL DEFAULT 760 CHECK (height BETWEEN 300 AND 3000),
  grid_size INTEGER NOT NULL DEFAULT 20 CHECK (grid_size BETWEEN 10 AND 100),
  background_image_url TEXT,
  elements_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_floor_plans_tenant ON public.floor_plans(tenant_id, ordre);

-- 2. Table FLOOR_PLAN_ITEMS (Postes et salles positionnés sur le plan)
CREATE TABLE IF NOT EXISTS public.floor_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id UUID NOT NULL REFERENCES public.floor_plans(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  space_id UUID REFERENCES public.espaces(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (
    item_type IN ('desk', 'quiet_desk', 'private_office', 'meeting_room', 'training_room', 'event_space')
  ),
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 60 CHECK (width >= 20),
  height INTEGER NOT NULL DEFAULT 40 CHECK (height >= 20),
  rotation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_floor_plan_items_plan ON public.floor_plan_items(floor_plan_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_items_tenant ON public.floor_plan_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_floor_plan_items_space ON public.floor_plan_items(space_id);

-- 3. Liaison optionnelle sur RESERVATIONS (rétrocompatible)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS floor_plan_item_id UUID REFERENCES public.floor_plan_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_floor_plan_item
  ON public.reservations(floor_plan_item_id)
  WHERE floor_plan_item_id IS NOT NULL;

-- 4. Triggers updated_at
CREATE OR REPLACE FUNCTION public.update_floor_plan_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_floor_plans_updated_at ON public.floor_plans;
CREATE TRIGGER trg_floor_plans_updated_at
  BEFORE UPDATE ON public.floor_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_floor_plan_timestamp();

DROP TRIGGER IF EXISTS trg_floor_plan_items_updated_at ON public.floor_plan_items;
CREATE TRIGGER trg_floor_plan_items_updated_at
  BEFORE UPDATE ON public.floor_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.update_floor_plan_timestamp();

-- 5. Row Level Security (RLS) — Isolation stricte par tenant_id
ALTER TABLE public.floor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS floor_plans_public_select ON public.floor_plans;
CREATE POLICY floor_plans_public_select ON public.floor_plans
  FOR SELECT
  USING (
    is_active = TRUE
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = floor_plans.tenant_id
        AND (t.statut IN ('actif', 'valide', 'approuve') OR t.statut IS NULL)
    )
  );

DROP POLICY IF EXISTS floor_plans_tenant_manage ON public.floor_plans;
CREATE POLICY floor_plans_tenant_manage ON public.floor_plans
  FOR ALL TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS floor_plans_super_admin_all ON public.floor_plans;
CREATE POLICY floor_plans_super_admin_all ON public.floor_plans
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'super_admin' OR p.is_super_admin = TRUE)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'super_admin' OR p.is_super_admin = TRUE)
    )
  );

DROP POLICY IF EXISTS floor_plan_items_public_select ON public.floor_plan_items;
CREATE POLICY floor_plan_items_public_select ON public.floor_plan_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.floor_plans fp
      JOIN public.tenants t ON t.id = fp.tenant_id
      WHERE fp.id = floor_plan_items.floor_plan_id
        AND fp.is_active = TRUE
        AND (t.statut IN ('actif', 'valide', 'approuve') OR t.statut IS NULL)
    )
  );

DROP POLICY IF EXISTS floor_plan_items_tenant_manage ON public.floor_plan_items;
CREATE POLICY floor_plan_items_tenant_manage ON public.floor_plan_items
  FOR ALL TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS floor_plan_items_super_admin_all ON public.floor_plan_items;
CREATE POLICY floor_plan_items_super_admin_all ON public.floor_plan_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'super_admin' OR p.is_super_admin = TRUE)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'super_admin' OR p.is_super_admin = TRUE)
    )
  );

-- 6. Données de démonstration idempotentes (Nero Coworking Space)
DO $$
DECLARE
  v_tenant_id UUID := 'a1111111-1111-4111-8111-111111111111';
  v_plan_id UUID;
  v_open_space UUID;
  v_private_office UUID;
  v_meeting_room UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant_id)
     AND NOT EXISTS (SELECT 1 FROM public.floor_plans WHERE tenant_id = v_tenant_id) THEN

    SELECT id INTO v_open_space FROM public.espaces
      WHERE tenant_id = v_tenant_id AND type IN ('open_space', 'hot_desk')
      ORDER BY created_at LIMIT 1;
    SELECT id INTO v_private_office FROM public.espaces
      WHERE tenant_id = v_tenant_id AND type = 'private_office'
      ORDER BY created_at LIMIT 1;
    SELECT id INTO v_meeting_room FROM public.espaces
      WHERE tenant_id = v_tenant_id AND type = 'meeting_room'
      ORDER BY created_at LIMIT 1;

    INSERT INTO public.floor_plans (
      tenant_id, name, width, height, grid_size, is_active, ordre, elements_json
    ) VALUES (
      v_tenant_id,
      'Rez-de-chaussée — Open Space & Salles',
      1200,
      760,
      20,
      TRUE,
      0,
      '[
        {"id":"zone-accueil","type":"zone","label":"Accueil & Coin Café","x":40,"y":40,"width":220,"height":680,"rotation":0},
        {"id":"zone-openspace","type":"zone","label":"Open Space Nomade","x":280,"y":40,"width":480,"height":420,"rotation":0},
        {"id":"zone-quiet","type":"zone","label":"Zone Calme (Quiet Desks)","x":280,"y":480,"width":480,"height":240,"rotation":0},
        {"id":"zone-salles","type":"zone","label":"Bureaux & Salles Privatives","x":780,"y":40,"width":380,"height":680,"rotation":0},
        {"id":"wall-n","type":"wall","x":20,"y":20,"width":1160,"height":12,"rotation":0},
        {"id":"wall-s-left","type":"wall","x":20,"y":728,"width":120,"height":12,"rotation":0},
        {"id":"door-main","type":"door","label":"Entrée","x":140,"y":700,"width":80,"height":40,"rotation":0},
        {"id":"wall-s-right","type":"wall","x":220,"y":728,"width":960,"height":12,"rotation":0},
        {"id":"wall-w","type":"wall","x":20,"y":20,"width":12,"height":720,"rotation":0},
        {"id":"wall-e","type":"wall","x":1168,"y":20,"width":12,"height":720,"rotation":0},
        {"id":"part-accueil","type":"partition","x":264,"y":40,"width":8,"height":540,"rotation":0},
        {"id":"part-quiet","type":"partition","x":280,"y":468,"width":480,"height":8,"rotation":0},
        {"id":"part-salles","type":"partition","x":768,"y":40,"width":8,"height":680,"rotation":0},
        {"id":"part-between-rooms","type":"partition","x":780,"y":360,"width":380,"height":8,"rotation":0}
      ]'::jsonb
    )
    RETURNING id INTO v_plan_id;

    INSERT INTO public.floor_plan_items (
      floor_plan_id, tenant_id, space_id, label, item_type, x, y, width, height, rotation, status
    ) VALUES
      (v_plan_id, v_tenant_id, v_open_space, 'A1-01', 'desk', 320, 110, 80, 56, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'A1-02', 'desk', 410, 110, 80, 56, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'A1-03', 'desk', 320, 180, 80, 56, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'A1-04', 'desk', 410, 180, 80, 56, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'A2-01', 'desk', 550, 110, 80, 56, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'A2-02', 'desk', 640, 110, 80, 56, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'A2-03', 'desk', 550, 180, 80, 56, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'A2-04', 'desk', 640, 180, 80, 56, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'Q1-01', 'quiet_desk', 310, 540, 84, 60, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'Q1-02', 'quiet_desk', 420, 540, 84, 60, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'Q1-03', 'quiet_desk', 530, 540, 84, 60, 0, 'active'),
      (v_plan_id, v_tenant_id, v_open_space, 'Q1-04', 'quiet_desk', 640, 540, 84, 60, 0, 'maintenance'),
      (v_plan_id, v_tenant_id, v_private_office, 'Bureau B1', 'private_office', 810, 90, 320, 230, 0, 'active'),
      (v_plan_id, v_tenant_id, v_meeting_room, 'Salle Prestige', 'meeting_room', 810, 400, 320, 290, 0, 'active');
  END IF;
END $$;
