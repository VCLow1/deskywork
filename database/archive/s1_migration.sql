-- S1 Dev 1 — Migration incrémentale (à exécuter dans Supabase SQL Editor)
-- Applique les colonnes et règles manquantes sans supprimer les données existantes.

-- Colonnes profil (CDC Module A)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS statut_compte TEXT NOT NULL DEFAULT 'actif'
    CHECK (statut_compte IN ('actif', 'suspendu', 'expire'));

-- Synchroniser l'email depuis auth.users pour les profils existants
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- Trigger profil à l'inscription (mise à jour avec email + statut)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, nom, prenom, email, role, telephone, type_membre, statut_compte)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'nom', ''),
        COALESCE(new.raw_user_meta_data->>'prenom', ''),
        new.email,
        COALESCE(new.raw_user_meta_data->>'role', 'member'),
        COALESCE(new.raw_user_meta_data->>'telephone', ''),
        COALESCE(new.raw_user_meta_data->>'type_membre', 'individuel'),
        'actif'
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sessions : check-in / check-out membre (Module B — préparation S2)
DO $$ BEGIN
  CREATE POLICY "Allow users to check in to their own reservations" ON public.sessions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reservations
            WHERE reservations.id = reservation_id
              AND reservations.user_id = auth.uid()
              AND reservations.statut IN ('confirmed', 'pending')
        )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow users to checkout their own sessions" ON public.sessions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.reservations
            WHERE reservations.id = sessions.reservation_id
              AND reservations.user_id = auth.uid()
        )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Anti-conflit réservations (Module B)
CREATE OR REPLACE FUNCTION public.check_reservation_overlap()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.reservations r
        WHERE r.espace_id = NEW.espace_id
          AND r.id IS DISTINCT FROM NEW.id
          AND r.statut IN ('confirmed', 'pending')
          AND r.date_debut < NEW.date_fin
          AND r.date_fin > NEW.date_debut
    ) THEN
        RAISE EXCEPTION 'Conflit de réservation : ce créneau est déjà occupé.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reservation_overlap_check ON public.reservations;
CREATE TRIGGER reservation_overlap_check
    BEFORE INSERT OR UPDATE ON public.reservations
    FOR EACH ROW EXECUTE FUNCTION public.check_reservation_overlap();
