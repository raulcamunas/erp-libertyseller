-- =====================================================
-- HORAS Y SALARIO DE LOS COMERCIALES
-- =====================================================
-- Sustituye los Excel «Horas Nombre.xlsx». Mismo cálculo que allí:
--   Salario     = horas del periodo × precio/hora (por defecto 3,5 $)
--   Comisiones  = citas cualificadas del periodo × comisión por cita
--   Total       = salario + comisiones
-- El periodo es el mismo ciclo de comisiones que ya usa la agenda:
-- del día 15 de un mes al 14 del siguiente, ambos incluidos.

-- ---------- Horas apuntadas, un registro por persona y día ----------
CREATE TABLE IF NOT EXISTS public.work_hours (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  hours NUMERIC NOT NULL CHECK (hours >= 0 AND hours <= 24),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_work_hours_user_date
  ON public.work_hours(user_id, work_date);

CREATE OR REPLACE FUNCTION public.update_work_hours_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_hours_updated_at ON public.work_hours;
CREATE TRIGGER trg_work_hours_updated_at
  BEFORE UPDATE ON public.work_hours
  FOR EACH ROW EXECUTE FUNCTION public.update_work_hours_updated_at();

-- ---------- Tarifas por periodo ----------
-- period_start es el día 15 que abre el ciclo. user_id NULL = tarifa
-- general de ese periodo para todo el equipo; con user_id, excepción
-- para esa persona (en julio Alejandro y José cobraron 20 $ por cita
-- mientras Yamila y Maoli seguían a 15 $).
CREATE TABLE IF NOT EXISTS public.payroll_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period_start DATE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  hourly_rate NUMERIC NOT NULL DEFAULT 3.5,
  commission_per_appointment NUMERIC NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Un índice único por rama: Postgres no considera iguales dos NULL, así
-- que hacen falta dos índices parciales para evitar duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_rates_period_user
  ON public.payroll_rates(period_start, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_rates_period_global
  ON public.payroll_rates(period_start)
  WHERE user_id IS NULL;

DROP TRIGGER IF EXISTS trg_payroll_rates_updated_at ON public.payroll_rates;
CREATE TRIGGER trg_payroll_rates_updated_at
  BEFORE UPDATE ON public.payroll_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_work_hours_updated_at();

-- ---------- RLS ----------
ALTER TABLE public.work_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_rates ENABLE ROW LEVEL SECURITY;

-- Cada uno ve y apunta lo suyo; los admins ven y corrigen las de todos.
DROP POLICY IF EXISTS "Own hours or admin can view" ON public.work_hours;
CREATE POLICY "Own hours or admin can view"
  ON public.work_hours FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Own hours or admin can insert" ON public.work_hours;
CREATE POLICY "Own hours or admin can insert"
  ON public.work_hours FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Own hours or admin can update" ON public.work_hours;
CREATE POLICY "Own hours or admin can update"
  ON public.work_hours FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_partner(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Own hours or admin can delete" ON public.work_hours;
CREATE POLICY "Own hours or admin can delete"
  ON public.work_hours FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

-- Las tarifas las ve todo el mundo (cada uno necesita saber a cuánto le
-- pagan) pero solo las tocan los admins.
DROP POLICY IF EXISTS "Team can view rates" ON public.payroll_rates;
CREATE POLICY "Team can view rates"
  ON public.payroll_rates FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage rates" ON public.payroll_rates;
CREATE POLICY "Admins manage rates"
  ON public.payroll_rates FOR ALL
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

-- Realtime: el salario tiene que moverse solo cuando un admin marca una
-- cita como cualificada o cambia la comisión del periodo.
ALTER PUBLICATION supabase_realtime ADD TABLE public.work_hours;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payroll_rates;

-- ---------- Tarifas históricas (las de los Excel) ----------
-- Marzo, abril y mayo a 15 $; junio a 20 $ para todos; julio a 15 $
-- general, con Alejandro y José a 20 $ (excepciones que se cargan desde
-- la propia app si hace falta).
INSERT INTO public.payroll_rates (period_start, user_id, hourly_rate, commission_per_appointment)
VALUES
  ('2026-03-15', NULL, 3.5, 15),
  ('2026-04-15', NULL, 3.5, 15),
  ('2026-05-15', NULL, 3.5, 15),
  ('2026-06-15', NULL, 3.5, 20),
  ('2026-07-15', NULL, 3.5, 15),
  ('2026-08-15', NULL, 3.5, 15)
ON CONFLICT DO NOTHING;
