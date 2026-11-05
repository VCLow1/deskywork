-- Lie une formation à la réservation d'espace créée en parallèle
ALTER TABLE public.formations
  ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_formations_reservation ON public.formations(reservation_id);
