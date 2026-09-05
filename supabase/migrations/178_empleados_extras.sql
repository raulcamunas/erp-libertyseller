-- ==================================================================
-- 178 · PAGOS SUELTOS A UN EMPLEADO: COMISIONES Y ENCARGOS
-- ==================================================================
--
-- Lo que no cabía en ningún sitio: «a Carla le hemos encargado unas
-- creatividades por 80 $, aparte de su sueldo». No es su sueldo fijo, no son
-- horas apuntadas en «Mis Horas» y no es un escalón nuevo — es un encargo
-- concreto, con su concepto y su importe, que se paga una vez.
--
-- Hasta ahora eso solo podía apuntarse subiéndole el sueldo del mes en
-- `employee_month_records`, que tiene UN solo importe por persona y mes. Con
-- eso se pierde el porqué: al mes siguiente nadie sabe si aquel mes cobró más
-- por un encargo, por una comisión o porque alguien se equivocó tecleando.
--
--
-- ============ POR QUÉ UNA TABLA Y NO UNA COLUMNA MÁS ============
--
-- Porque en un mes puede haber varios: dos encargos y una comisión. Una
-- columna «extra» obligaría a sumarlos a mano antes de escribirlos, que es
-- exactamente donde se pierde el detalle. Una fila por concepto se lee después.
CREATE TABLE IF NOT EXISTS public.employee_extras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  /** Día 1 del mes al que se imputa, igual que employee_month_records */
  period DATE NOT NULL,
  /** Qué se le paga. Obligatorio: un importe sin concepto es el problema que
      esta tabla viene a resolver, no se puede permitir guardarlo vacío. */
  concept TEXT NOT NULL CHECK (btrim(concept) <> ''),
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('EUR', 'USD')),
  /**
   * Para qué se le paga. Solo cambia cómo se agrupa y se lee; el importe suma
   * igual en los tres casos.
   */
  kind TEXT NOT NULL DEFAULT 'encargo'
    CHECK (kind IN ('encargo', 'comision', 'bonus', 'otro')),
  paid BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT employee_extras_period_is_first_day
    CHECK (EXTRACT(DAY FROM period) = 1)
);

-- SIN clave única por (employee_id, period): es justamente lo contrario de lo
-- que hace falta. Varios encargos en el mismo mes son normales.
CREATE INDEX IF NOT EXISTS idx_employee_extras_employee_period
  ON public.employee_extras(employee_id, period);
CREATE INDEX IF NOT EXISTS idx_employee_extras_period
  ON public.employee_extras(period);

-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.touch_employee_extras()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employee_extras_updated_at ON public.employee_extras;
CREATE TRIGGER trg_employee_extras_updated_at
  BEFORE UPDATE ON public.employee_extras
  FOR EACH ROW EXECUTE FUNCTION public.touch_employee_extras();

-- ---------- RLS ----------
-- El mismo listón que el resto del módulo: esto son sueldos.
ALTER TABLE public.employee_extras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage employee extras" ON public.employee_extras;
CREATE POLICY "Admins manage employee extras"
  ON public.employee_extras FOR ALL TO authenticated
  USING (public.is_erp_admin(auth.uid()))
  WITH CHECK (public.is_erp_admin(auth.uid()));

DO $$
BEGIN
  RAISE NOTICE 'Listo: ya se pueden apuntar encargos y comisiones sueltas desde la ficha de cada persona.';
END $$;
