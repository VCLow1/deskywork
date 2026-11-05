-- =========================================================================
-- MIGRATION S2 — Dev 2 — Module C — Étape 2
-- Numérotation automatique des reçus (numero_recu)
-- Format : REC-{ANNÉE}-{SÉQUENCE 6 CHIFFRES}
-- Exemple : REC-2026-000001, REC-2026-000002 ...
-- À exécuter dans Supabase → SQL Editor
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Séquence globale par année (réinitialisée chaque année)
-- -------------------------------------------------------------------------
-- On utilise une table compteur plutôt qu'une séquence PostgreSQL
-- pour pouvoir réinitialiser facilement chaque année.

CREATE TABLE IF NOT EXISTS public.recu_compteur (
    annee INTEGER PRIMARY KEY,
    dernier_numero INTEGER NOT NULL DEFAULT 0
);

-- Seed : année courante à 0
INSERT INTO public.recu_compteur (annee, dernier_numero)
VALUES (EXTRACT(YEAR FROM NOW())::INTEGER, 0)
ON CONFLICT (annee) DO NOTHING;

-- -------------------------------------------------------------------------
-- 2. Fonction de génération du numéro de reçu
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generer_numero_recu()
RETURNS TRIGGER AS $$
DECLARE
    annee_courante INTEGER;
    nouveau_numero INTEGER;
    code_recu TEXT;
BEGIN
    -- Ne générer que si le numero_recu n'est pas déjà défini
    IF NEW.numero_recu IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Récupérer l'année en cours
    annee_courante := EXTRACT(YEAR FROM NOW())::INTEGER;

    -- Insérer l'année si elle n'existe pas encore (changement d'année)
    INSERT INTO public.recu_compteur (annee, dernier_numero)
    VALUES (annee_courante, 0)
    ON CONFLICT (annee) DO NOTHING;

    -- Incrémenter le compteur de manière atomique et récupérer la nouvelle valeur
    UPDATE public.recu_compteur
    SET dernier_numero = dernier_numero + 1
    WHERE annee = annee_courante
    RETURNING dernier_numero INTO nouveau_numero;

    -- Formater : REC-2026-000001
    code_recu := 'REC-' || annee_courante || '-' || LPAD(nouveau_numero::TEXT, 6, '0');

    -- Assigner le numéro de reçu au paiement
    NEW.numero_recu := code_recu;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------------------
-- 3. Trigger : s'active AVANT chaque INSERT sur paiements
-- -------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_numerotation_recu ON public.paiements;

CREATE TRIGGER trigger_numerotation_recu
    BEFORE INSERT ON public.paiements
    FOR EACH ROW
    EXECUTE FUNCTION public.generer_numero_recu();

-- -------------------------------------------------------------------------
-- 4. RLS sur la table recu_compteur
--    (seul le backend service_role peut y accéder)
-- -------------------------------------------------------------------------

ALTER TABLE public.recu_compteur ENABLE ROW LEVEL SECURITY;

-- Seuls les super_admin peuvent lire le compteur (pour vérification)
DO $$ BEGIN
  CREATE POLICY "Super Admin : lecture compteur reçus"
    ON public.recu_compteur
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy compteur reçus déjà existante, ignorée.';
END $$;

-- -------------------------------------------------------------------------
-- 5. Test de vérification (optionnel — commenter en production)
-- -------------------------------------------------------------------------

-- Pour tester manuellement le générateur, vous pouvez exécuter :
-- SELECT public.generer_numero_recu(); -- Ne marche pas directement (trigger only)

-- Vérifier la structure de la table compteur :
-- SELECT * FROM public.recu_compteur;

-- Vérifier les paiements existants (pas de numéro car ajoutés avant ce trigger) :
-- SELECT id, numero_recu, montant, statut FROM public.paiements ORDER BY created_at;

-- Pour numéroter rétroactivement les paiements existants sans numéro :
-- (À exécuter manuellement si besoin — ne pas inclure dans le déploiement auto)
/*
DO $$
DECLARE
    rec RECORD;
    annee_courante INTEGER;
    nouveau_numero INTEGER;
BEGIN
    annee_courante := EXTRACT(YEAR FROM NOW())::INTEGER;
    
    INSERT INTO public.recu_compteur (annee, dernier_numero)
    VALUES (annee_courante, 0)
    ON CONFLICT (annee) DO NOTHING;

    FOR rec IN
        SELECT id FROM public.paiements
        WHERE numero_recu IS NULL
        ORDER BY created_at ASC
    LOOP
        UPDATE public.recu_compteur
        SET dernier_numero = dernier_numero + 1
        WHERE annee = annee_courante
        RETURNING dernier_numero INTO nouveau_numero;

        UPDATE public.paiements
        SET numero_recu = 'REC-' || annee_courante || '-' || LPAD(nouveau_numero::TEXT, 6, '0')
        WHERE id = rec.id;
    END LOOP;
    
    RAISE NOTICE 'Numérotation rétroactive terminée.';
END $$;
*/
