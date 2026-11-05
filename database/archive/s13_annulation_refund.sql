-- S13 — Tâche 6 : Politique d'annulation opérationnelle
-- 1) Aligner les valeurs de type_espace de politique_annulation_espaces sur
--    celles de espaces.type (les anciennes valeurs étaient incompatibles).
ALTER TABLE public.politique_annulation_espaces
  DROP CONSTRAINT IF EXISTS politique_annulation_espaces_type_espace_check;
ALTER TABLE public.politique_annulation_espaces
  ADD CONSTRAINT politique_annulation_espaces_type_espace_check
  CHECK (type_espace IN ('open_space', 'private_office', 'meeting_room', 'training_room', 'event_space'));

-- 2) Suivi du montant effectivement remboursé lors d'une annulation.
ALTER TABLE public.paiements
  ADD COLUMN IF NOT EXISTS montant_rembourse NUMERIC(10, 2) NOT NULL DEFAULT 0;