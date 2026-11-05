-- ============================================================
-- database/create_super_admin.sql
-- Script SQL pour créer directement le compte Super Admin dans Supabase
-- sans passer par le formulaire ou la double authentification
--
-- Email : contact@vclow.com
-- Mot de passe : 12345678
-- Rôle : super_admin
-- Statut : actif
-- ============================================================

-- Activer pgcrypto pour le hachage des mots de passe
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
  user_email TEXT := 'contact@vclow.com';
  user_pass  TEXT := '12345678';
  existing_id UUID;
BEGIN
  -- Vérifier si l'utilisateur existe déjà
  SELECT id INTO existing_id FROM auth.users WHERE email = user_email;

  IF existing_id IS NULL THEN
    -- 1. Insérer dans auth.users (sans OTP, email confirmé automatiquement)
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud
    ) VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      user_email,
      extensions.crypt(user_pass, extensions.gen_salt('bf')),
      NOW(),
      '{"provider": "email", "providers": ["email"]}',
      '{"nom": "Super", "prenom": "Admin", "role": "super_admin"}',
      NOW(),
      NOW(),
      'authenticated',
      'authenticated'
    );
    existing_id := new_user_id;
    RAISE NOTICE '✅ Compte auth.users créé avec succès';
  ELSE
    -- Mettre à jour le mot de passe si l'utilisateur existe déjà
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(user_pass, extensions.gen_salt('bf')),
        email_confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = existing_id;
    RAISE NOTICE '✅ Mot de passe mis à jour pour auth.users';
  END IF;

  -- 2. Insérer ou mettre à jour dans public.profiles (actif + super_admin)
  INSERT INTO public.profiles (
    id,
    email,
    nom,
    prenom,
    role,
    statut_compte,
    created_at
  ) VALUES (
    existing_id,
    user_email,
    'Super',
    'Admin',
    'super_admin',
    'actif',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    role = 'super_admin',
    statut_compte = 'actif';

  RAISE NOTICE '✅ Profil super_admin (statut: actif) créé dans public.profiles';
END $$;

-- Vérification du compte créé
SELECT id, email, role, statut_compte, created_at
FROM public.profiles
WHERE email = 'contact@vclow.com';
