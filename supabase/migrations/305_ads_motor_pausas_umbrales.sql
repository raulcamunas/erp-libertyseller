-- ============================================================================
-- 305 · MARKETING TEST: EL MOTOR PROPONE PAUSAS Y GUARDA SUS UMBRALES ESTIMADOS POR CUENTA
-- ============================================================================
--
--   · ads_propuestas      admite el tipo «pausar» (pausar una keyword o un ASIN que ha pasado el tope sin venta de la ficha sin un solo pedido). Va en `objetivo_id` / `objetivo_tipo`, como las
--                         de puja; deshacer = volver a activarla.
--   · ads_motor_config    columna `umbrales` (JSONB): los cortes que el SOP NO fija con número (subir puja si el ACoS < 0,7× objetivo, bajarla si > 1,15×, «se queda corta» al 90 % del
--                         presupuesto…). Vacía = los valores de partida del código (lib/ads/umbrales.ts). Se cambian desde la pestaña «Propuestas».
--
-- SIN ESTA MIGRACIÓN el código funciona igual: el motor calcula las pausas pero no las guarda (y lo dice en «Qué hacer hoy»), y usa los umbrales de partida sin poder cambiarlos.
-- Nada nuevo lo lee el navegador: RLS ya encendida en las dos tablas (294), sin políticas de escritura. IDEMPOTENTE. Hacen falta la 294 y la 298.

DO $$
BEGIN
  IF to_regclass('public.ads_propuestas') IS NULL OR to_regclass('public.ads_motor_config') IS NULL THEN
    RAISE EXCEPTION 'Faltan las tablas del motor: lanza antes 294_ads_motor.sql y 298_ads_segmentaciones_pujas_tacos.sql.';
  END IF;
END $$;

ALTER TABLE public.ads_propuestas DROP CONSTRAINT IF EXISTS ads_propuestas_tipo_check;
ALTER TABLE public.ads_propuestas ADD CONSTRAINT ads_propuestas_tipo_check CHECK (tipo IN ('negativizar', 'promover', 'puja', 'presupuesto', 'pausar'));

ALTER TABLE public.ads_motor_config ADD COLUMN IF NOT EXISTS umbrales JSONB;

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%pausar%' FROM pg_constraint WHERE conname = 'ads_propuestas_tipo_check') AS tipo_pausar_admitido,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ads_motor_config' AND column_name = 'umbrales') AS columna_umbrales;
