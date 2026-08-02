-- =====================================================
-- CRM: fecha de cierre del cliente
-- =====================================================
-- Para poder decir "esto es lo que facturamos este mes" hace falta saber
-- CUÁNDO se cerró cada cliente: el set up se cobra una sola vez, el mes
-- que entra, mientras que el mantenimiento se cobra todos los meses.

ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Se sella solo al pasar a "ganado" y se limpia si se saca de ahí, para
-- que nadie tenga que acordarse de rellenar una fecha.
CREATE OR REPLACE FUNCTION public.stamp_crm_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage = 'ganado' AND NEW.closed_at IS NULL THEN
    NEW.closed_at = NOW();
  ELSIF NEW.stage <> 'ganado' THEN
    NEW.closed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_closed_at ON public.crm_clients;
CREATE TRIGGER trg_crm_closed_at
  BEFORE INSERT OR UPDATE OF stage ON public.crm_clients
  FOR EACH ROW EXECUTE FUNCTION public.stamp_crm_closed_at();

-- Los que ya estuvieran cerrados antes de existir esta columna: se toma
-- la última modificación como aproximación de la fecha de cierre.
UPDATE public.crm_clients
SET closed_at = updated_at
WHERE stage = 'ganado' AND closed_at IS NULL;
