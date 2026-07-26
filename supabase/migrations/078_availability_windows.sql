-- =====================================================
-- FRANJAS DE DISPONIBILIDAD (banda visual en el calendario)
-- =====================================================
-- Ej: Raúl disponible para llamadas de 10:00-13:00 y 15:00-17:00,
-- lunes a viernes. Puramente informativo: no bloquea la creación de
-- citas, solo se pinta en el calendario como referencia para el equipo.

CREATE TABLE IF NOT EXISTS public.availability_windows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  days_of_week SMALLINT[] NOT NULL, -- 0=domingo .. 6=sábado (igual que Date.getDay())
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_availability_windows_owner
  ON public.availability_windows(owner_id);

ALTER TABLE public.availability_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team can view availability" ON public.availability_windows;
CREATE POLICY "Team can view availability"
  ON public.availability_windows FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Owner or admin can insert availability" ON public.availability_windows;
CREATE POLICY "Owner or admin can insert availability"
  ON public.availability_windows FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Owner or admin can update availability" ON public.availability_windows;
CREATE POLICY "Owner or admin can update availability"
  ON public.availability_windows FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Owner or admin can delete availability" ON public.availability_windows;
CREATE POLICY "Owner or admin can delete availability"
  ON public.availability_windows FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));
