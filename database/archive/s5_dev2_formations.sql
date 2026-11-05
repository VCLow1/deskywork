-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE G — FORMATEURS & FORMATIONS (Dev 2 — S5-S6)
-- ═══════════════════════════════════════════════════════════════════════════
-- Tables : formations, inscriptions_formations
-- Dépendances : profiles (formateur_id), espaces (salle_id)
-- Date : S5 (03-07 août 2026)
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Table formations
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.formations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titre TEXT NOT NULL,
    description TEXT,
    formateur_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    espace_id UUID REFERENCES public.espaces(id) ON DELETE SET NULL,
    
    -- Dates et horaires
    date_debut TIMESTAMPTZ NOT NULL,
    date_fin TIMESTAMPTZ NOT NULL,
    
    -- Capacité et prix
    capacite_max INTEGER NOT NULL CHECK (capacite_max > 0),
    prix_inscription NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (prix_inscription >= 0),
    
    -- Statut de la formation
    statut TEXT NOT NULL DEFAULT 'planifiee' CHECK (
        statut IN ('planifiee', 'en_cours', 'terminee', 'annulee')
    ),
    
    -- Métadonnées
    programme TEXT,                     -- Contenu détaillé de la formation
    prerequis TEXT,                     -- Prérequis nécessaires
    materiel TEXT,                      -- Matériel à apporter
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Contraintes
    CONSTRAINT check_formation_dates CHECK (date_fin > date_debut)
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_formations_formateur ON public.formations(formateur_id);
CREATE INDEX IF NOT EXISTS idx_formations_date_debut ON public.formations(date_debut);
CREATE INDEX IF NOT EXISTS idx_formations_statut ON public.formations(statut);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Table inscriptions_formations
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inscriptions_formations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formation_id UUID NOT NULL REFERENCES public.formations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL,
    
    -- Statut de l'inscription
    statut TEXT NOT NULL DEFAULT 'confirmee' CHECK (
        statut IN ('confirmee', 'en_attente', 'annulee')
    ),
    
    -- Paiement
    statut_paiement TEXT NOT NULL DEFAULT 'gratuit' CHECK (
        statut_paiement IN ('gratuit', 'en_attente', 'paye', 'rembourse')
    ),
    paiement_id UUID REFERENCES public.paiements(id) ON DELETE SET NULL,
    
    -- Présence (émargement)
    present BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Un membre ne peut s'inscrire qu'une fois par formation
    UNIQUE (formation_id, user_id)
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_inscriptions_formation ON public.inscriptions_formations(formation_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_user ON public.inscriptions_formations(user_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_statut ON public.inscriptions_formations(statut);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Table remuneration_formateurs (Module G4 — optionnel)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.remuneration_formateurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formateur_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    formation_id UUID NOT NULL REFERENCES public.formations(id) ON DELETE CASCADE,
    montant NUMERIC(10, 2) NOT NULL CHECK (montant >= 0),
    statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'paye')),
    date_versement TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (formateur_id, formation_id)
);

CREATE INDEX IF NOT EXISTS idx_remuneration_formateur ON public.remuneration_formateurs(formateur_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. RLS — Row Level Security
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.formations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inscriptions_formations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remuneration_formateurs ENABLE ROW LEVEL SECURITY;

-- ── Formations : lecture publique, écriture admin/formateur ────────────────
CREATE POLICY "formations_read_all" ON public.formations
    FOR SELECT USING (true);

CREATE POLICY "formations_insert_admin" ON public.formations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin', 'staff', 'formateur')
        )
    );

CREATE POLICY "formations_update_admin" ON public.formations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin', 'staff')
        )
        OR formateur_id = auth.uid()
    );

CREATE POLICY "formations_delete_admin" ON public.formations
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin')
        )
    );

-- ── Inscriptions : membre voit les siennes, admin voit tout ───────────────
CREATE POLICY "inscriptions_read_own" ON public.inscriptions_formations
    FOR SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin', 'staff', 'formateur')
        )
    );

CREATE POLICY "inscriptions_insert_self" ON public.inscriptions_formations
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "inscriptions_update_admin" ON public.inscriptions_formations
    FOR UPDATE USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin', 'staff')
        )
    );

CREATE POLICY "inscriptions_delete_admin" ON public.inscriptions_formations
    FOR DELETE USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin')
        )
    );

-- ── Rémunérations : formateur voit les siennes, admin gère tout ───────────
CREATE POLICY "remuneration_read" ON public.remuneration_formateurs
    FOR SELECT USING (
        formateur_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin')
        )
    );

CREATE POLICY "remuneration_manage_admin" ON public.remuneration_formateurs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin')
        )
    );

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Trigger : updated_at automatique
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER formations_updated_at
    BEFORE UPDATE ON public.formations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER inscriptions_updated_at
    BEFORE UPDATE ON public.inscriptions_formations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Données de test
-- ───────────────────────────────────────────────────────────────────────────
-- Note : formateur_id doit être remplacé par un UUID valide depuis profiles
-- Ces inserts sont commentés — les activer après avoir les bons IDs

-- INSERT INTO public.formations (titre, description, formateur_id, capacite_max, prix_inscription, date_debut, date_fin, statut)
-- VALUES
-- ('Introduction au Design Thinking', 'Atelier pratique sur la méthode Design Thinking', '<FORMATEUR_UUID>', 15, 50.00, NOW() + INTERVAL '7 days', NOW() + INTERVAL '7 days' + INTERVAL '3 hours', 'planifiee'),
-- ('Formation Excel Avancé', 'Maîtrisez les fonctions avancées d''Excel', '<FORMATEUR_UUID>', 10, 80.00, NOW() + INTERVAL '14 days', NOW() + INTERVAL '14 days' + INTERVAL '6 hours', 'planifiee');
