-- =========================================================================
-- S17 — Approbation requise UNIQUEMENT pour la création d'espace de Coworking
-- =========================================================================
-- Règle métier :
-- 1. Seule la création d'un espace de coworking (rôle 'admin') nécessite
--    l'approbation du Super Admin (statut_compte = 'en_attente', tenant = 'suspendu').
-- 2. Tous les autres comptes (membres, formateurs, etc.) sont activés
--    immédiatement (statut_compte = 'actif') sans dépendre de l'administrateur.
-- =========================================================================

-- 1. Contrainte CHECK sur statut_compte
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_statut_compte_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_statut_compte_check
    CHECK (statut_compte IN ('actif', 'suspendu', 'expire', 'en_attente'));

-- 2. Le DEFAULT est 'actif' pour les utilisateurs normaux
ALTER TABLE public.profiles
  ALTER COLUMN statut_compte SET DEFAULT 'actif';

-- 3. Mettre à jour la fonction trigger handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_tenant_id UUID := NULL;
    coworking_name TEXT;
    user_role TEXT;
    initial_statut TEXT;
BEGIN
    user_role := COALESCE(new.raw_user_meta_data->>'role', 'member');
    coworking_name := new.raw_user_meta_data->>'coworking_name';

    -- Règle d'approbation :
    -- Seul le compte Admin Coworking (création d'espace) nécessite l'approbation du Super Admin ('en_attente').
    -- Les autres rôles (membres, formateurs, etc.) sont activés immédiatement ('actif').
    IF user_role = 'admin' THEN
        initial_statut := 'en_attente';
    ELSE
        initial_statut := 'actif';
    END IF;

    -- Si c'est un nouvel admin et qu'un nom de coworking est fourni, créer le tenant (espace de coworking)
    IF user_role = 'admin' AND coworking_name IS NOT NULL THEN
        INSERT INTO public.tenants (nom, slug, email, telephone, statut, settings)
        VALUES (
            coworking_name,
            lower(regexp_replace(coworking_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substring(new.id::text, 1, 8),
            new.email,
            COALESCE(new.raw_user_meta_data->>'telephone', ''),
            'suspendu', -- Le tenant commence suspendu jusqu'à l'approbation du Super Admin
            '{"onboarding_completed": false}'::jsonb
        )
        RETURNING id INTO new_tenant_id;
    END IF;

    -- Création du profil utilisateur
    INSERT INTO public.profiles (
        id, nom, prenom, email, role, telephone, type_membre,
        specialite, biographie, statut_compte, tenant_id, created_at, updated_at
    )
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'nom', split_part(new.email, '@', 1)),
        COALESCE(new.raw_user_meta_data->>'prenom', ''),
        new.email,
        user_role,
        COALESCE(new.raw_user_meta_data->>'telephone', ''),
        COALESCE(new.raw_user_meta_data->>'type_membre', 'individuel'),
        COALESCE(new.raw_user_meta_data->>'specialite', NULL),
        COALESCE(new.raw_user_meta_data->>'biographie', NULL),
        initial_statut,
        new_tenant_id,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        statut_compte = EXCLUDED.statut_compte,
        nom = COALESCE(NULLIF(EXCLUDED.nom, ''), profiles.nom),
        prenom = COALESCE(NULLIF(EXCLUDED.prenom, ''), profiles.prenom),
        telephone = COALESCE(NULLIF(EXCLUDED.telephone, ''), profiles.telephone),
        role = COALESCE(NULLIF(EXCLUDED.role, ''), profiles.role),
        updated_at = NOW();

    -- Associer le contact_admin_id du tenant créé au profil de l'admin
    IF new_tenant_id IS NOT NULL THEN
        UPDATE public.tenants SET contact_admin_id = new.id WHERE id = new_tenant_id;
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Reconnecter le trigger sur auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 5. Débloquer tous les comptes membres / formateurs existants qui étaient restés en_attente
UPDATE public.profiles
SET statut_compte = 'actif', updated_at = NOW()
WHERE role != 'admin' AND statut_compte = 'en_attente';
