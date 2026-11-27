-- ============================================================================
-- DESKYWORK — LOT 3 : Unités/Postes, Contrôle Atomique (RPC), Chrono Serveur
-- & Parcours Client sur place (Walk-in)
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE)
-- ============================================================================

-- 1. Table unifiée des unités / postes (Bureaux privés B-01/B-02, Postes Open Space, Salles)
CREATE TABLE IF NOT EXISTS public.unites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  etablissement_id uuid GENERATED ALWAYS AS (tenant_id) STORED,
  espace_id uuid NOT NULL REFERENCES public.espaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  nom text NOT NULL,
  type_unite text NOT NULL DEFAULT 'poste_open_space'
    CHECK (type_unite IN ('bureau_prive', 'poste_open_space', 'poste_fixe', 'salle')),
  capacite integer NOT NULL DEFAULT 1 CHECK (capacite >= 1),
  statut text NOT NULL DEFAULT 'disponible'
    CHECK (statut IN ('disponible', 'non_disponible', 'en_maintenance')),
  motif_interne text,
  date_retour_auto timestamptz,
  floor_plan_item_id uuid,
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unites_tenant_espace_statut
  ON public.unites (tenant_id, espace_id, statut)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_unites_tenant_espace_code
  ON public.unites (tenant_id, espace_id, lower(code))
  WHERE archived_at IS NULL;

ALTER TABLE public.unites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unites_admin_staff_all ON public.unites;
CREATE POLICY unites_admin_staff_all ON public.unites
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR (p.role IN ('admin', 'staff') AND p.tenant_id = unites.etablissement_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR (p.role IN ('admin', 'staff') AND p.tenant_id = unites.etablissement_id))
    )
  );

-- Vue publique sécurisée : OMET STRICTEMENT motif_interne (jamais exposé au public / membres)
CREATE OR REPLACE VIEW public.unites_publiques AS
SELECT
  id,
  tenant_id,
  etablissement_id,
  espace_id,
  code,
  nom,
  type_unite,
  capacite,
  statut,
  date_retour_auto,
  floor_plan_item_id,
  created_at,
  updated_at
FROM public.unites
WHERE archived_at IS NULL;

-- 2. Extension de la table reservations (LOT 3)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS unite_id uuid REFERENCES public.unites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'en_ligne',
  ADD COLUMN IF NOT EXISTS services_additionnels_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ressources_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS telephone_contact text,
  ADD COLUMN IF NOT EXISTS confirmation_manuelle boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS motif_annulation text,
  ADD COLUMN IF NOT EXISTS motif_retroactif text,
  ADD COLUMN IF NOT EXISTS override_conflit boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tampon_minutes integer DEFAULT 15,
  ADD COLUMN IF NOT EXISTS quota_abonnement_deduit numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

-- Mettre à jour la contrainte statut si présente pour autoriser en_attente_confirmation
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reservations'::regclass
      AND conname = 'reservations_statut_check'
  ) THEN
    ALTER TABLE public.reservations DROP CONSTRAINT reservations_statut_check;
  END IF;
  ALTER TABLE public.reservations
    ADD CONSTRAINT reservations_statut_check
    CHECK (statut IN ('pending', 'confirmed', 'en_attente_confirmation', 'refused', 'cancelled', 'completed', 'no_show', 'waitlisted'));
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservations_unite_dates
  ON public.reservations (unite_id, date_debut, date_fin)
  WHERE archived_at IS NULL;

-- 3. Extension de la table sessions (Chrono synchronisé serveur & Client sur place Walk-in)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS espace_id uuid REFERENCES public.espaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unite_id uuid REFERENCES public.unites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS stopped_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_walkin boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_nom text,
  ADD COLUMN IF NOT EXISTS client_telephone text,
  ADD COLUMN IF NOT EXISTS personne_id uuid,
  ADD COLUMN IF NOT EXISTS tranches_15min integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_calcule_ht numeric(12, 3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_calcule_ttc numeric(12, 3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_tranches_15min integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_montant_ttc numeric(12, 3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_close_alert boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

DO $$
BEGIN
  ALTER TABLE public.sessions ALTER COLUMN reservation_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_tenant_idempotency
  ON public.sessions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. Notes internes Fiche Membre 360°
DO $$
BEGIN
  IF to_regclass('public.personnes') IS NOT NULL THEN
    ALTER TABLE public.personnes ADD COLUMN IF NOT EXISTS notes_internes text;
  END IF;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notes_internes text;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 5. Restauration automatique des unités dont date_retour_auto est dépassée
CREATE OR REPLACE FUNCTION public.auto_restore_expired_unites(p_tenant_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.unites
  SET
    statut = 'disponible',
    date_retour_auto = NULL,
    updated_at = now()
  WHERE archived_at IS NULL
    AND statut IN ('non_disponible', 'en_maintenance')
    AND date_retour_auto IS NOT NULL
    AND date_retour_auto <= now()
    AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 6. RPC Transactionnelle Atomique : Création ou Modification de réservation avec tampon et capacité
CREATE OR REPLACE FUNCTION public.book_reservation_atomic(
  p_tenant_id uuid,
  p_espace_id uuid,
  p_unite_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_guest_id uuid DEFAULT NULL,
  p_date_debut timestamptz DEFAULT NULL,
  p_date_fin timestamptz DEFAULT NULL,
  p_nb_participants integer DEFAULT 1,
  p_tampon_minutes integer DEFAULT 15,
  p_reservation_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT 'member',
  p_override_conflit boolean DEFAULT false,
  p_motif_retroactif text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_espace record;
  v_unite record;
  v_existing record;
  v_is_manager boolean := p_actor_role IN ('admin', 'super_admin');
  v_has_paid boolean := false;
  v_has_checkin boolean := false;
  v_buf interval := make_interval(mins => GREATEST(0, COALESCE(p_tampon_minutes, 15)));
  v_is_shared boolean := false;
  v_overlap_count integer := 0;
  v_overlap_pax integer := 0;
  v_max_cap integer := 1;
  v_statut text;
  v_res_id uuid;
  v_mode text;
  v_source text;
  v_conf_exp timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR p_espace_id IS NULL OR p_date_debut IS NULL OR p_date_fin IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 400, 'reason', 'Paramètres de réservation incomplets.');
  END IF;

  IF p_date_debut >= p_date_fin THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 400, 'reason', 'L''heure de fin doit être postérieure à l''heure de début.');
  END IF;

  -- Verrou transactionnel par établissement + espace pour éliminer toute double réservation simultanée
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || p_espace_id::text));

  PERFORM public.auto_restore_expired_unites(p_tenant_id);

  SELECT id, tenant_id, nom, type, capacite, actif
  INTO v_espace
  FROM public.espaces
  WHERE id = p_espace_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 404, 'reason', 'Espace introuvable.');
  END IF;

  IF v_espace.actif IS FALSE THEN
    RETURN jsonb_build_object('ok', false, 'conflict', true, 'status', 409, 'reason', 'Cet espace est actuellement désactivé.');
  END IF;

  -- Contrôles réservés au rôle Responsable uniquement
  IF p_date_debut < (now() - interval '5 minutes') THEN
    IF NOT v_is_manager THEN
      RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 403, 'reason', 'Seul un Responsable peut effectuer une saisie rétroactive.');
    END IF;
    IF COALESCE(trim(p_motif_retroactif), '') = '' THEN
      RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 400, 'reason', 'Un motif obligatoire est requis pour toute saisie rétroactive.');
    END IF;
  END IF;

  IF p_override_conflit AND NOT v_is_manager THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 403, 'reason', 'Seul un Responsable peut déroger à un conflit horaire.');
  END IF;

  IF p_reservation_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.reservations WHERE id = p_reservation_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 404, 'reason', 'Réservation introuvable.');
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.paiements
      WHERE reservation_id = p_reservation_id
        AND (lower(statut) IN ('paid', 'succeeded', 'partial') OR COALESCE(montant_encaisse, 0) > 0)
    ) INTO v_has_paid;

    SELECT EXISTS(
      SELECT 1 FROM public.sessions
      WHERE reservation_id = p_reservation_id AND check_in IS NOT NULL
    ) INTO v_has_checkin;

    IF (v_has_paid OR v_has_checkin) AND NOT v_is_manager THEN
      RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 403, 'reason', 'Seul un Responsable peut modifier une réservation déjà payée ou ayant un check-in validé.');
    END IF;
  END IF;

  -- Vérification de l'unité si précisée
  IF p_unite_id IS NOT NULL THEN
    SELECT * INTO v_unite
    FROM public.unites
    WHERE id = p_unite_id AND tenant_id = p_tenant_id AND archived_at IS NULL;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 404, 'reason', 'Unité ou poste introuvable.');
    END IF;

    IF v_unite.statut <> 'disponible' THEN
      RETURN jsonb_build_object('ok', false, 'conflict', true, 'status', 409, 'reason', 'Cette unité n''est pas disponible actuellement (' || v_unite.statut || ').');
    END IF;

    v_max_cap := GREATEST(1, COALESCE(v_unite.capacite, v_espace.capacite, 1));
  ELSE
    v_max_cap := GREATEST(1, COALESCE(v_espace.capacite, 1));
  END IF;

  IF GREATEST(1, COALESCE(p_nb_participants, 1)) > v_max_cap THEN
    RETURN jsonb_build_object('ok', false, 'conflict', false, 'status', 400, 'reason', 'Le nombre de participants dépasse la capacité maximale (' || v_max_cap || ').');
  END IF;

  v_is_shared := v_espace.type IN ('open_space', 'hot_desk', 'dedicated_desk') AND p_unite_id IS NULL;

  -- Vérification des chevauchements avec tampon configurable
  SELECT
    COUNT(*),
    COALESCE(SUM(GREATEST(1, COALESCE((NULLIF(notes::text, '')::jsonb ->> 'nb_participants')::integer, 1))), 0)
  INTO v_overlap_count, v_overlap_pax
  FROM public.reservations
  WHERE tenant_id = p_tenant_id
    AND espace_id = p_espace_id
    AND archived_at IS NULL
    AND (p_reservation_id IS NULL OR id <> p_reservation_id)
    AND statut IN ('pending', 'confirmed', 'en_attente_confirmation')
    AND (confirmation_expires_at IS NULL OR confirmation_expires_at > now() OR statut <> 'en_attente_confirmation')
    AND date_debut < (p_date_fin + v_buf)
    AND date_fin > (p_date_debut - v_buf)
    AND (p_unite_id IS NULL OR unite_id = p_unite_id OR unite_id IS NULL);

  IF NOT p_override_conflit THEN
    IF NOT v_is_shared AND v_overlap_count > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'status', 409,
        'reason', 'Conflit horaire détecté (incluant le tampon de ' || COALESCE(p_tampon_minutes, 15) || ' min).'
      );
    END IF;

    IF v_is_shared AND (v_overlap_count + GREATEST(1, COALESCE(p_nb_participants, 1))) > v_max_cap THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'status', 409,
        'reason', 'Capacité maximale de l''espace atteinte sur ce créneau (' || v_overlap_count || '/' || v_max_cap || ').'
      );
    END IF;
  END IF;

  v_statut := COALESCE(p_payload ->> 'statut', 'pending');
  v_mode := COALESCE(p_payload ->> 'mode', 'on_site');
  v_source := COALESCE(p_payload ->> 'source', 'en_ligne');
  v_conf_exp := NULLIF(p_payload ->> 'confirmation_expires_at', '')::timestamptz;

  IF p_reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET
      espace_id = p_espace_id,
      unite_id = p_unite_id,
      date_debut = p_date_debut,
      date_fin = p_date_fin,
      tampon_minutes = COALESCE(p_tampon_minutes, 15),
      override_conflit = p_override_conflit,
      motif_retroactif = COALESCE(p_motif_retroactif, motif_retroactif),
      updated_at = now()
    WHERE id = p_reservation_id
    RETURNING id INTO v_res_id;
  ELSE
    INSERT INTO public.reservations (
      tenant_id,
      user_id,
      guest_id,
      espace_id,
      unite_id,
      date_debut,
      date_fin,
      statut,
      mode,
      source,
      telephone_contact,
      services_additionnels_json,
      ressources_json,
      confirmation_manuelle,
      confirmation_expires_at,
      motif_retroactif,
      override_conflit,
      tampon_minutes,
      quota_abonnement_deduit,
      tarif_applique_ht,
      tva_pct_applique,
      montant_ht,
      montant_ttc,
      montant_total,
      floor_plan_item_id,
      notes
    ) VALUES (
      p_tenant_id,
      p_user_id,
      p_guest_id,
      p_espace_id,
      p_unite_id,
      p_date_debut,
      p_date_fin,
      v_statut,
      v_mode,
      v_source,
      NULLIF(p_payload ->> 'telephone_contact', ''),
      COALESCE(p_payload -> 'services_additionnels_json', '[]'::jsonb),
      COALESCE(p_payload -> 'ressources_json', '[]'::jsonb),
      COALESCE((p_payload ->> 'confirmation_manuelle')::boolean, false),
      v_conf_exp,
      NULLIF(p_motif_retroactif, ''),
      p_override_conflit,
      COALESCE(p_tampon_minutes, 15),
      COALESCE((p_payload ->> 'quota_abonnement_deduit')::numeric, 0),
      COALESCE((p_payload ->> 'tarif_applique_ht')::numeric, 0),
      COALESCE((p_payload ->> 'tva_pct_applique')::numeric, 19),
      COALESCE((p_payload ->> 'montant_ht')::numeric, 0),
      COALESCE((p_payload ->> 'montant_ttc')::numeric, 0),
      COALESCE((p_payload ->> 'montant_total')::numeric, 0),
      NULLIF(p_payload ->> 'floor_plan_item_id', '')::uuid,
      NULLIF(p_payload ->> 'notes', '')
    )
    RETURNING id INTO v_res_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'conflict', false,
    'status', 200,
    'reservation_id', v_res_id
  );
END;
$$;
