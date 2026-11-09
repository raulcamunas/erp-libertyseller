-- ============================================================================
-- 288 · RINKEL: UNA CUENTA QUE CAMBIA DE MANOS «EMPIEZA AQUÍ»
-- ============================================================================
--
-- La línea de Rinkel de María Fernanda pasa a Sharon (9 nov 2026) y el rendimiento de Sharon tiene que EMPEZAR EN CERO ese día. La sincronización relee siempre los
-- últimos tres días de la cuenta (el solape sirve para que una grabación que llega tarde se guarde), así que sin un corte volvería a leer las llamadas de María Fernanda
-- de esos días y se las atribuiría a Sharon, otra vez cada pasada.
--
-- `rinkel_vinculos.solo_desde`: si tiene fecha, la sincronización NO pide ni guarda ninguna llamada anterior. NULL (lo normal, todas las cuentas de hoy) = sin corte.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni borrar nada. El código funciona sin esta migración
-- (lee sin corte, como siempre), pero el traspaso de la línea a Sharon NO debe hacerse antes de lanzarla.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.rinkel_vinculos') IS NULL THEN
    RAISE EXCEPTION 'Falta la tabla rinkel_vinculos: lanza antes la migración 234_rendimiento_rinkel.sql.';
  END IF;
END $$;

ALTER TABLE public.rinkel_vinculos
  ADD COLUMN IF NOT EXISTS solo_desde TIMESTAMPTZ;

COMMENT ON COLUMN public.rinkel_vinculos.solo_desde IS
  'Si tiene fecha, la sincronizacion de Rinkel ignora toda llamada anterior (la cuenta cambio de manos y la persona nueva empieza en cero). NULL = sin corte.';

-- Comprobación
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'rinkel_vinculos' AND column_name = 'solo_desde';
