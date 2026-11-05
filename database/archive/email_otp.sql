-- ============================================================
-- database/email_otp.sql
-- Table pour stocker les codes OTP temporaires lors de l'inscription
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_otp (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL,
  code       TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour accélérer les recherches par email
CREATE INDEX IF NOT EXISTS idx_email_otp_email ON public.email_otp(email);

-- Pas de RLS : accessible uniquement via service_role (backend)
ALTER TABLE public.email_otp ENABLE ROW LEVEL SECURITY;

-- Aucune politique RLS publique → seul le backend (service_role) peut lire/écrire
-- Le backend utilise supabaseAdmin (service_role_key) qui bypass le RLS

-- Vérification
SELECT 'Table email_otp créée ✅' AS statut
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'email_otp'
);
