-- =========================================================================
-- MIGRATION S2 — Dev 2 — Module C
-- RLS Policies : paiements + notifications
-- À exécuter dans Supabase → SQL Editor
-- =========================================================================

-- -------------------------------------------------------------------------
-- TABLE : paiements
-- -------------------------------------------------------------------------
-- RLS déjà activé dans schema.sql (ligne 135)
-- On ajoute ici les politiques manquantes

-- Politique 1 : Un membre peut lire ses propres paiements
DO $$ BEGIN
  CREATE POLICY "Membres : lecture de ses propres paiements"
    ON public.paiements
    FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy "Membres : lecture de ses propres paiements" déjà existante, ignorée.';
END $$;

-- Politique 2 : Admin / Staff / Super Admin voient TOUS les paiements
DO $$ BEGIN
  CREATE POLICY "Admin/Staff : lecture de tous les paiements"
    ON public.paiements
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'admin', 'staff')
      )
    );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy "Admin/Staff : lecture de tous les paiements" déjà existante, ignorée.';
END $$;

-- Politique 3 : Seuls Admin / Staff / Super Admin peuvent CRÉER un paiement
DO $$ BEGIN
  CREATE POLICY "Admin/Staff : création de paiements"
    ON public.paiements
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'admin', 'staff')
      )
    );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy "Admin/Staff : création de paiements" déjà existante, ignorée.';
END $$;

-- Politique 4 : Seuls Admin / Staff / Super Admin peuvent MODIFIER un paiement
DO $$ BEGIN
  CREATE POLICY "Admin/Staff : modification de paiements"
    ON public.paiements
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'admin', 'staff')
      )
    );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy "Admin/Staff : modification de paiements" déjà existante, ignorée.';
END $$;

-- Politique 5 : Seuls Super Admin peuvent SUPPRIMER un paiement (jamais supprimé en prod normale)
DO $$ BEGIN
  CREATE POLICY "Super Admin : suppression de paiements"
    ON public.paiements
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy "Super Admin : suppression de paiements" déjà existante, ignorée.';
END $$;

-- -------------------------------------------------------------------------
-- TABLE : notifications
-- -------------------------------------------------------------------------
-- RLS déjà activé dans schema.sql (ligne 136)

-- Politique 1 : Un membre voit uniquement ses propres notifications
DO $$ BEGIN
  CREATE POLICY "Membres : lecture de ses propres notifications"
    ON public.notifications
    FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy "Membres : lecture de ses propres notifications" déjà existante, ignorée.';
END $$;

-- Politique 2 : Admin / Staff voient TOUTES les notifications
DO $$ BEGIN
  CREATE POLICY "Admin/Staff : lecture de toutes les notifications"
    ON public.notifications
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'admin', 'staff')
      )
    );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy "Admin/Staff : lecture de toutes les notifications" déjà existante, ignorée.';
END $$;

-- Politique 3 : Le système backend (service_role) peut créer des notifications
-- Note : Le backend utilise supabaseAdmin (service_role key) qui bypass RLS automatiquement.
-- Cette policy permet aussi aux admins de créer des notifications manuellement si besoin.
DO $$ BEGIN
  CREATE POLICY "Admin/Staff : création de notifications"
    ON public.notifications
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'admin', 'staff')
      )
    );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy "Admin/Staff : création de notifications" déjà existante, ignorée.';
END $$;

-- =========================================================================
-- Colonne numero_recu : ajout sur paiements (pour numérotation automatique)
-- Préparation Étape 2 (numérotation des reçus)
-- =========================================================================

ALTER TABLE public.paiements
  ADD COLUMN IF NOT EXISTS numero_recu TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS reference_externe TEXT; -- Flouci / virement / chèque

-- =========================================================================
-- Vérification finale
-- =========================================================================

-- Après exécution, vérifiez avec :
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename IN ('paiements', 'notifications');
