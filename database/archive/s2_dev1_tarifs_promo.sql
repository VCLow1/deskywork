-- S2 Dev 1 — Module A : Tarification flexible & codes promo (CDC A3)
-- À exécuter dans Supabase SQL Editor

-- =========================================================================
-- 1. Tables tarification
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tarifs_abonnements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_abonnement TEXT NOT NULL CHECK (type_abonnement IN (
        'day_pass', 'week_pass', 'mensuel', 'trimestriel', 'annuel', 'bureau_prive'
    )),
    plan_tarifaire TEXT NOT NULL DEFAULT 'standard' CHECK (plan_tarifaire IN (
        'standard', 'etudiant', 'entreprise'
    )),
    prix NUMERIC(10, 2) NOT NULL CHECK (prix >= 0),
    tva_pct NUMERIC(5, 2) NOT NULL DEFAULT 19.00 CHECK (tva_pct >= 0),
    date_debut DATE NOT NULL DEFAULT CURRENT_DATE,
    date_fin DATE,
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT check_tarif_dates CHECK (date_fin IS NULL OR date_fin >= date_debut)
);

CREATE TABLE IF NOT EXISTS public.codes_promo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    type_reduction TEXT NOT NULL CHECK (type_reduction IN ('percent', 'fixed')),
    valeur NUMERIC(10, 2) NOT NULL CHECK (valeur > 0),
    date_debut DATE NOT NULL DEFAULT CURRENT_DATE,
    date_fin DATE,
    utilisations_max INTEGER CHECK (utilisations_max IS NULL OR utilisations_max > 0),
    utilisations_count INTEGER NOT NULL DEFAULT 0 CHECK (utilisations_count >= 0),
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT check_promo_dates CHECK (date_fin IS NULL OR date_fin >= date_debut)
);

CREATE TABLE IF NOT EXISTS public.historique_tarifs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    abonnement_id UUID REFERENCES public.abonnements(id) ON DELETE SET NULL,
    type_abonnement TEXT NOT NULL,
    plan_tarifaire TEXT NOT NULL,
    prix_initial NUMERIC(10, 2) NOT NULL,
    prix_final NUMERIC(10, 2) NOT NULL,
    code_promo_id UUID REFERENCES public.codes_promo(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 2. RLS
-- =========================================================================

ALTER TABLE public.tarifs_abonnements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codes_promo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historique_tarifs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture tarifs actifs" ON public.tarifs_abonnements;
CREATE POLICY "Lecture tarifs actifs" ON public.tarifs_abonnements
    FOR SELECT USING (actif = TRUE);

DROP POLICY IF EXISTS "Admin manage tarifs" ON public.tarifs_abonnements;
CREATE POLICY "Admin manage tarifs" ON public.tarifs_abonnements
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

DROP POLICY IF EXISTS "Lecture codes promo actifs" ON public.codes_promo;
CREATE POLICY "Lecture codes promo actifs" ON public.codes_promo
    FOR SELECT USING (actif = TRUE);

DROP POLICY IF EXISTS "Admin manage codes promo" ON public.codes_promo;
CREATE POLICY "Admin manage codes promo" ON public.codes_promo
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

DROP POLICY IF EXISTS "Users read own historique tarifs" ON public.historique_tarifs;
CREATE POLICY "Users read own historique tarifs" ON public.historique_tarifs
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin manage historique tarifs" ON public.historique_tarifs;
CREATE POLICY "Admin manage historique tarifs" ON public.historique_tarifs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'admin', 'staff')
        )
    );

-- =========================================================================
-- 3. Données initiales (CDC A2/A3)
-- =========================================================================

INSERT INTO public.tarifs_abonnements (type_abonnement, plan_tarifaire, prix, tva_pct) VALUES
    ('day_pass',     'standard',   35.00, 19),
    ('day_pass',     'etudiant',   25.00, 19),
    ('day_pass',     'entreprise', 45.00, 19),
    ('week_pass',    'standard',  180.00, 19),
    ('week_pass',    'etudiant',  130.00, 19),
    ('week_pass',    'entreprise', 220.00, 19),
    ('mensuel',      'standard',  450.00, 19),
    ('mensuel',      'etudiant',  320.00, 19),
    ('mensuel',      'entreprise', 600.00, 19),
    ('trimestriel',  'standard', 1200.00, 19),
    ('trimestriel',  'etudiant',  850.00, 19),
    ('trimestriel',  'entreprise', 1600.00, 19),
    ('annuel',       'standard', 4200.00, 19),
    ('annuel',       'etudiant',  3000.00, 19),
    ('annuel',       'entreprise', 5500.00, 19),
    ('bureau_prive', 'standard',  900.00, 19),
    ('bureau_prive', 'entreprise', 1200.00, 19)
ON CONFLICT DO NOTHING;

INSERT INTO public.codes_promo (code, type_reduction, valeur, date_fin, utilisations_max) VALUES
    ('WELCOME10', 'percent', 10, CURRENT_DATE + INTERVAL '90 days', 100),
    ('ETUDIANT20', 'percent', 20, CURRENT_DATE + INTERVAL '180 days', 50),
    ('33SPACE50', 'fixed', 50, CURRENT_DATE + INTERVAL '30 days', 20)
ON CONFLICT (code) DO NOTHING;
