-- S12 — Tâche 5 : Type d'espace lié à la tarification et à la réservation
-- Une formule tarifaire peut être restreinte à un type d'espace (open_space,
-- private_office, meeting_room, training_room, event_space).
-- NULL ou vide = formule valable pour tous les types d'espaces.

ALTER TABLE public.tarifs_abonnements
  ADD COLUMN IF NOT EXISTS type_espace TEXT;

ALTER TABLE public.abonnements
  ADD COLUMN IF NOT EXISTS type_espace TEXT;

CREATE INDEX IF NOT EXISTS idx_tarifs_type_espace ON public.tarifs_abonnements (type_espace);
CREATE INDEX IF NOT EXISTS idx_abonnements_type_espace ON public.abonnements (type_espace);