-- 341 · CUMPLIMIENTO: «ELIMINAR DEL SEGUIMIENTO»
-- Raúl (25 nov 2026): hay listings que ni tenemos o no se pueden recuperar; tienen que dejar de salir y de contar.
-- Un listing descartado se queda en la tabla con su marca y, mientras la tenga, cuenta como fuera de Amazon
-- (en_amazon = false): así lo dejan fuera la lista, las cifras, el panel, «Hoy», las tareas automáticas y el
-- conector, que ya filtran por en_amazon. El trigger lo mantiene aunque la revisión horaria lo vuelva a escribir.
-- Se recupera quitando la marca (chip «Descartados» de la pantalla).

ALTER TABLE public.listing_cumplimiento
  ADD COLUMN IF NOT EXISTS descartado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS descartado_por UUID;

CREATE OR REPLACE FUNCTION public.listing_cumplimiento_descartado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.descartado_at IS NOT NULL THEN
    NEW.en_amazon := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listing_cumplimiento_descartado ON public.listing_cumplimiento;
CREATE TRIGGER listing_cumplimiento_descartado
  BEFORE INSERT OR UPDATE ON public.listing_cumplimiento
  FOR EACH ROW EXECUTE FUNCTION public.listing_cumplimiento_descartado();

CREATE INDEX IF NOT EXISTS listing_cumplimiento_descartados_idx
  ON public.listing_cumplimiento (connection_id) WHERE descartado_at IS NOT NULL;
