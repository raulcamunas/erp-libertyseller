-- ============================================================================
-- 291 · PLAZO DE REPOSICIÓN POR ETAPAS (Remesas a FBA)
-- ============================================================================
--
-- El plazo de reposición de cada cliente (`fba_alertas_config.plazo_reposicion_dias`, migración 267) era UN número a mano. Ahora se puede desglosar en lo que de verdad pasa
-- desde que se avisa al cliente hasta que la mercancía está a la venta en Amazon:
--
--   · dias_preparacion   desde que se le avisa (se propone qué mandar) hasta que el cliente envía a Amazon
--   · dias_transporte    del envío hasta que llega al almacén de Amazon
--   · dias_recepcion     lo que tarda Amazon en procesarlo (check-in, recepción) hasta que se puede vender
--   · margen_dias        margen de error: colchón para retrasos
--
-- `plazo_reposicion_dias` NO cambia de sentido: sigue siendo el plazo TOTAL con el que calculan las alertas. Cuando se guardan las etapas, la aplicación escribe ahí su suma. Las etapas
-- son NULL en los clientes que solo tienen el total (los de ahora): nada cambia para ellos hasta que alguien las rellene.
--
-- El código funciona SIN esta migración: la pantalla de plazos dice que falta lanzarla y guarda solo el total, como hasta ahora.
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Hace falta la migración 267.

ALTER TABLE public.fba_alertas_config ADD COLUMN IF NOT EXISTS dias_preparacion INTEGER;
ALTER TABLE public.fba_alertas_config ADD COLUMN IF NOT EXISTS dias_transporte  INTEGER;
ALTER TABLE public.fba_alertas_config ADD COLUMN IF NOT EXISTS dias_recepcion    INTEGER;
ALTER TABLE public.fba_alertas_config ADD COLUMN IF NOT EXISTS margen_dias       INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fba_alertas_config_etapas_check') THEN
    ALTER TABLE public.fba_alertas_config ADD CONSTRAINT fba_alertas_config_etapas_check CHECK (
      (dias_preparacion IS NULL OR dias_preparacion BETWEEN 0 AND 365)
      AND (dias_transporte IS NULL OR dias_transporte BETWEEN 0 AND 365)
      AND (dias_recepcion IS NULL OR dias_recepcion BETWEEN 0 AND 365)
      AND (margen_dias IS NULL OR margen_dias BETWEEN 0 AND 365)
    );
  END IF;
END $$;

COMMENT ON COLUMN public.fba_alertas_config.dias_preparacion IS 'Días desde que se avisa al cliente hasta que envía a Amazon. NULL = solo hay plazo total.';
COMMENT ON COLUMN public.fba_alertas_config.dias_transporte  IS 'Días del envío hasta el almacén de Amazon.';
COMMENT ON COLUMN public.fba_alertas_config.dias_recepcion   IS 'Días que tarda Amazon en procesar la recepción hasta poder vender.';
COMMENT ON COLUMN public.fba_alertas_config.margen_dias      IS 'Margen de error (colchón) que se suma al plazo.';

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  (SELECT count(*) = 4 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fba_alertas_config' AND column_name IN ('dias_preparacion', 'dias_transporte', 'dias_recepcion', 'margen_dias')) AS tiene_las_cuatro_columnas,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fba_alertas_config_etapas_check') AS tiene_su_limite;
