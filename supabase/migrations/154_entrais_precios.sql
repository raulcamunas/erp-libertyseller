-- ==================================================================
-- 154 · EL MOTOR DE PRECIOS DE ENTRAIS
-- ==================================================================
--
-- Cuatro tablas para un cliente que no vende a precio fijo: su proveedor mueve
-- los costes y el precio de Amazon tiene que moverse detrás, calculado y no a
-- ojo.
--
--   entrais_config        la configuracion del motor. UNA fila.
--   entrais_margenes_sku  el margen propio de una referencia suelta
--   entrais_precios       el ULTIMO precio calculado de cada SKU
--   entrais_ejecuciones   el resumen de cada pasada
--
--
-- POR QUE `entrais_precios` NO ES UN HISTORICO
-- --------------------------------------------
-- Son 6.900 referencias y el calculo va a correr una o dos veces al dia. Con
-- una fila por SKU y pasada, eso son ~5 millones de filas al año para consultar
-- siempre la ultima. Esta base ya se salio de cuota una vez por escribir series
-- que nadie leia (el monitor de Buy Box, 140 MB al dia), asi que aqui se guarda
-- el ESTADO —una fila por SKU, actualizada— y del historico se guarda solo el
-- RESUMEN de cada pasada, que es lo que de verdad se mira: cuantos cambiaron,
-- cuanto margen medio, cuantos quedaron sin precio.
--
-- El dia que haga falta la serie completa se añade aparte y con retencion, no
-- rellenando esta.
--
--
-- POR QUE LA CONFIGURACION ES UNA SOLA FILA
-- -----------------------------------------
-- Porque es de UN cliente. Meter `client_id` aqui seria fingir que esto vale
-- para todos cuando el conector, el porte de 4 € y hasta la lista de tramos
-- salen de una conversacion concreta con Entrais. El dia que un segundo cliente
-- necesite lo mismo, se generaliza con su caso delante y no con uno inventado.
-- La restriccion `unica` es lo que impide que se cuelen dos filas y nadie sepa
-- cual manda.

-- ---------- 1. La configuración ----------
CREATE TABLE IF NOT EXISTS public.entrais_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- El truco de la fila unica: la columna solo admite `true` y es UNIQUE, asi
  -- que una segunda fila choca. Mas claro que un trigger y no se puede saltar.
  unica BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (unica),

  -- A que cuenta de Amazon se contrasta. Sin esto no hay PVP, ni tarifa, ni
  -- FOEP: solo se podria calcular el precio objetivo a ciegas.
  connection_id UUID REFERENCES public.amazon_connections(id) ON DELETE SET NULL,
  marketplace_id TEXT,

  -- Contra que entorno de Entrais se piden los costes
  entorno TEXT NOT NULL DEFAULT 'pruebas' CHECK (entorno IN ('pruebas', 'real')),

  -- ---- Los márgenes ----
  margen_global NUMERIC NOT NULL DEFAULT 0.07 CHECK (margen_global > 0 AND margen_global < 1),
  usar_tramos BOOLEAN NOT NULL DEFAULT true,
  -- [{"desde": 0, "margen": 0.15}, ...] — el primero tiene que empezar en 0
  tramos JSONB NOT NULL DEFAULT '[
    {"desde": 0,    "margen": 0.15},
    {"desde": 30,   "margen": 0.12},
    {"desde": 90,   "margen": 0.10},
    {"desde": 300,  "margen": 0.08},
    {"desde": 500,  "margen": 0.07},
    {"desde": 1000, "margen": 0.06},
    {"desde": 2000, "margen": 0.05}
  ]'::jsonb,
  decidir_tramo_por TEXT NOT NULL DEFAULT 'coste' CHECK (decidir_tramo_por IN ('coste', 'pvp')),

  -- ---- Lo que se lleva cada uno ----
  iva_venta NUMERIC NOT NULL DEFAULT 0.21 CHECK (iva_venta >= 0 AND iva_venta < 1),
  porte NUMERIC NOT NULL DEFAULT 4 CHECK (porte >= 0),
  tasa_digital NUMERIC NOT NULL DEFAULT 0.03 CHECK (tasa_digital >= 0 AND tasa_digital < 1),
  tarifa_por_defecto NUMERIC NOT NULL DEFAULT 0.15 CHECK (tarifa_por_defecto > 0 AND tarifa_por_defecto < 1),

  redondeo TEXT NOT NULL DEFAULT 'centimo'
    CHECK (redondeo IN ('centimo', 'noventa_y_nueve', 'cinco_centimos')),

  -- NULL = no se persigue la oferta destacada. Ver la nota del motor: solo se
  -- baja al FOEP cuando la Buy Box la tiene OTRO y el margen aguanta esto.
  margen_suelo NUMERIC CHECK (margen_suelo IS NULL OR (margen_suelo > 0 AND margen_suelo < 1)),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.entrais_config IS
  'Configuración del motor de precios de Entrais. Una sola fila: ver la cabecera de la migración 154.';
COMMENT ON COLUMN public.entrais_config.margen_suelo IS
  'Margen mínimo al que se acepta bajar para ganar la oferta destacada. NULL = no se persigue la Buy Box.';

-- ---------- 2. El margen propio de una referencia ----------
-- Manda sobre el tramo, y el tramo sobre el global. Es lo que permite afinar un
-- producto suelto —uno que se vende solo, uno que hay que liquidar— sin tocar la
-- escalera entera y sin que se pierda al recalcular.
CREATE TABLE IF NOT EXISTS public.entrais_margenes_sku (
  sku TEXT PRIMARY KEY,
  margen NUMERIC NOT NULL CHECK (margen > 0 AND margen < 1),
  motivo TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

-- ---------- 3. El último precio calculado de cada SKU ----------
CREATE TABLE IF NOT EXISTS public.entrais_precios (
  sku TEXT PRIMARY KEY,

  -- Lo que entró al cálculo, para que una propuesta se pueda auditar sin
  -- reconstruir el día que se hizo
  precio_proveedor NUMERIC,
  canon NUMERIC,
  coste NUMERIC,
  tarifa_aplicada NUMERIC,
  tarifa_estimada BOOLEAN NOT NULL DEFAULT true,
  margen_aplicado NUMERIC,
  de_donde_el_margen TEXT,

  -- Lo que salió
  precio_objetivo NUMERIC,
  precio NUMERIC,
  origen TEXT CHECK (origen IN ('margen', 'buybox')),
  beneficio NUMERIC,
  margen_real NUMERIC,

  -- Contra lo que hay hoy en Amazon
  pvp_actual NUMERIC,
  dif_euros NUMERIC,
  dif_porcentaje NUMERIC,
  foep NUMERIC,
  buybox TEXT,

  aviso TEXT,
  calculado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entrais_precios_aviso ON public.entrais_precios (aviso);
-- Para la vista de «qué cambiaría»: lo que más se filtra es por diferencia
CREATE INDEX IF NOT EXISTS idx_entrais_precios_dif ON public.entrais_precios (dif_porcentaje);

-- ---------- 4. El resumen de cada pasada ----------
CREATE TABLE IF NOT EXISTS public.entrais_ejecuciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empezado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminado_at TIMESTAMPTZ,

  productos INTEGER NOT NULL DEFAULT 0,
  con_precio INTEGER NOT NULL DEFAULT 0,
  imposibles INTEGER NOT NULL DEFAULT 0,
  con_tarifa_real INTEGER NOT NULL DEFAULT 0,
  por_buybox INTEGER NOT NULL DEFAULT 0,

  -- Cuántos cambiarían respecto a lo publicado hoy, y en qué sentido
  subirian INTEGER NOT NULL DEFAULT 0,
  bajarian INTEGER NOT NULL DEFAULT 0,
  sin_cambio INTEGER NOT NULL DEFAULT 0,

  margen_medio NUMERIC,
  error TEXT,
  lanzado_por UUID REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_entrais_ejecuciones_fecha
  ON public.entrais_ejecuciones (empezado_at DESC);

-- ---------- RLS ----------
-- Aquí se ven los precios de COMPRA de un cliente, que es de lo más sensible que
-- hay en su negocio, y se decide a qué precio se publica su catálogo. Solo
-- admin/socio, igual que el resto del módulo de Amazon.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'entrais_config', 'entrais_margenes_sku', 'entrais_precios', 'entrais_ejecuciones'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.is_admin_or_partner(auth.uid())) WITH CHECK (public.is_admin_or_partner(auth.uid()))',
      t || '_admin', t
    );
  END LOOP;
END $$;

-- ---------- La fila de configuración ----------
INSERT INTO public.entrais_config (unica) VALUES (true)
ON CONFLICT (unica) DO NOTHING;

-- ---------- Comprobación ----------
DO $$
DECLARE
  faltan TEXT;
  cuantas INTEGER;
BEGIN
  SELECT string_agg(t, ', ') INTO faltan
    FROM unnest(ARRAY['entrais_config','entrais_margenes_sku','entrais_precios','entrais_ejecuciones']) AS t
   WHERE to_regclass('public.' || t) IS NULL;
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'No se han creado: %', faltan;
  END IF;

  SELECT count(*) INTO cuantas FROM public.entrais_config;
  IF cuantas <> 1 THEN
    RAISE EXCEPTION 'entrais_config tiene % filas y tiene que tener exactamente una.', cuantas;
  END IF;

  RAISE NOTICE 'Motor de precios de Entrais: cuatro tablas y una fila de configuración.';
END $$;
