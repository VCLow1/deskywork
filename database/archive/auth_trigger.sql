-- ============================================================
-- TRIGGER : Création automatique du profil après auth.users
-- À exécuter une seule fois dans Supabase > SQL Editor
-- ============================================================

-- 1. Fonction déclenchée à chaque nouvel utilisateur
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  user_role   text;
  user_status text;
  user_nom    text;
  user_prenom text;
BEGIN
  -- Rôle depuis les métadonnées (inscription email) ou 'member' par défaut (Google OAuth)
  user_role := COALESCE(
    NEW.raw_user_meta_data->>'role',
    'member'
  );

  -- Statut : admins coworking en attente de validation, tous les autres actifs
  user_status := CASE
    WHEN user_role = 'admin' THEN 'en_attente'
    ELSE 'actif'
  END;

  -- Nom : metadata explicite > partie "Nom" du full_name Google > partie avant @ de l'email
  user_nom := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'nom', ''),
    NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 2), ''),
    split_part(NEW.email, '@', 1)
  );

  -- Prénom : metadata explicite > première partie du full_name Google > chaîne vide
  user_prenom := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'prenom', ''),
    NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 1), ''),
    ''
  );

  INSERT INTO public.profiles (
    id,
    email,
    nom,
    prenom,
    role,
    statut_compte,
    telephone,
    type_membre,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    user_nom,
    user_prenom,
    user_role,
    user_status,
    COALESCE(NEW.raw_user_meta_data->>'telephone', ''),
    COALESCE(NEW.raw_user_meta_data->>'type_membre', 'individuel'),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING; -- sécurité : pas de doublon si trigger appelé 2x

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attacher le trigger sur auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- VÉRIFICATION : pour confirmer que le trigger est actif
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'on_auth_user_created';
-- ============================================================
