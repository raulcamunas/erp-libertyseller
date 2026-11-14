-- ============================================================================
-- 295 · AMAZON ADS: EL ACoS OBJETIVO SE ELIGE EN CADA PRODUCTO
-- ============================================================================
--
-- Antes el ACoS objetivo salía de la ficha de cuenta (fase de la cuenta × ACoS de equilibrio × un factor). Ahora lo FIJA una persona en cada producto (pestaña «Productos» de Marketing Test): es el
-- número que usa el motor para decidir cuánto puede gastar un término sin vender (2 × el CPA objetivo = precio × ACoS objetivo) y cuándo un término rinde lo bastante para subir de escalón.
--
-- Una sola columna nueva en `ads_productos`. NULL = todavía sin fijar, y a un producto sin ACoS objetivo el motor no le propone nada. Las columnas de la ficha que ya no se usan (`fase`,
-- `acos_lanzamiento_x`, `acos_maduro_x`) NO se borran: no estorban y así no se pierde nada.
--
-- El código funciona SIN esta migración (el campo se ve pero no se puede guardar y lo dice). Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Hace falta la 292.

DO $$
BEGIN
  IF to_regclass('public.ads_productos') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_productos: lanza antes 292_ads_cuenta_ficha_productos_estructura_log.sql.';
  END IF;
END $$;

ALTER TABLE public.ads_productos ADD COLUMN IF NOT EXISTS acos_objetivo_pct NUMERIC(5,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ads_productos_acos_objetivo_check') THEN
    ALTER TABLE public.ads_productos ADD CONSTRAINT ads_productos_acos_objetivo_check CHECK (acos_objetivo_pct IS NULL OR (acos_objetivo_pct > 0 AND acos_objetivo_pct <= 100));
  END IF;
END $$;

COMMENT ON COLUMN public.ads_productos.acos_objetivo_pct IS 'ACoS objetivo del producto, en %, elegido por una persona. NULL = sin fijar (el motor no le propone nada).';

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ads_productos' AND column_name = 'acos_objetivo_pct') AS tiene_la_columna,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ads_productos_acos_objetivo_check') AS tiene_su_limite;
