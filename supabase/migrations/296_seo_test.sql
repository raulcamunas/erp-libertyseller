-- ============================================================================
-- 296 · SEO TEST: BÚSQUEDAS DE BRAND ANALYTICS Y FICHAS DE LOS PRODUCTOS
-- ============================================================================
--
-- La app «SEO Test» sigue el posicionamiento de los productos con datos GRATIS de Amazon (SP-API), por cuenta de vendedor y país (conexión + marketplace):
--
--   · seo_productos   los productos que se siguen (ASIN y SKU), elegidos por una persona.
--   · seo_fichas      el texto de la ficha de cada uno (título, bullets, descripción y palabras clave ocultas), leído de Amazon una vez al día.
--   · seo_consultas   el informe «Search Query Performance» de Brand Analytics: por ASIN y búsqueda, cuántas veces se buscó en todo Amazon y qué parte de las impresiones, clics, añadidos y
--                     compras se llevó el producto. Por MES y por SEMANA (el último periodo cerrado). Es lo que dice si un producto está bien posicionado en una búsqueda.
--   · seo_lecturas    en qué punto está la lectura de cada cuenta y país (pide un informe, lo recoge en la pasada siguiente: nunca espera a Amazon) y si hay ACCESO a Brand Analytics, que exige
--                     el rol en la app de Amazon del ERP y que el cliente tenga Brand Registry.
--
-- Nada de esto lo lee el navegador: RLS encendida y SIN políticas de escritura. Solo entra el servidor con la llave de servicio, y la lectura es solo para administradores.
-- Deja además el reloj del proceso `seo-lecturas` en `cron_config` (cada 3 minutos; casi siempre no hay nada que hacer y contesta enseguida).
--
-- El código funciona SIN esta migración: la app dice que falta lanzarla. Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Hace falta la 118 (`amazon_connections`).

DO $$
BEGIN
  IF to_regclass('public.amazon_connections') IS NULL THEN
    RAISE EXCEPTION 'Falta public.amazon_connections: lanza antes 118_amazon_api.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.seo_productos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  asin TEXT NOT NULL CHECK (asin ~ '^[A-Z0-9]{10}$'),
  sku  TEXT,
  nombre TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, marketplace_id, asin)
);

CREATE TABLE IF NOT EXISTS public.seo_fichas (
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  sku  TEXT,
  titulo TEXT,
  bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  descripcion TEXT,
  backend TEXT,
  leida_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id, asin)
);

CREATE TABLE IF NOT EXISTS public.seo_consultas (
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  periodo TEXT NOT NULL CHECK (periodo IN ('WEEK', 'MONTH')),
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  consulta TEXT NOT NULL,
  puntuacion INTEGER,
  volumen INTEGER,
  impresiones_total BIGINT, impresiones_asin BIGINT, cuota_impresiones NUMERIC(8,6),
  clics_total INTEGER, clics_asin INTEGER, cuota_clics NUMERIC(8,6),
  carritos_total INTEGER, carritos_asin INTEGER, cuota_carritos NUMERIC(8,6),
  compras_total INTEGER, compras_asin INTEGER, cuota_compras NUMERIC(8,6),
  precio_mediano_total NUMERIC(12,2), precio_mediano_asin NUMERIC(12,2),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id, asin, periodo, desde, consulta)
);

CREATE INDEX IF NOT EXISTS idx_seo_consultas_asin ON public.seo_consultas (connection_id, marketplace_id, asin, periodo, desde DESC);

CREATE TABLE IF NOT EXISTS public.seo_lecturas (
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'reposo' CHECK (estado IN ('reposo', 'esperando')),
  -- El informe pedido ahora mismo: su id, el periodo y la tanda de ASIN (como mucho 18 por informe)
  report_id TEXT,
  periodo TEXT,
  desde DATE,
  hasta DATE,
  asins TEXT[] NOT NULL DEFAULT '{}',
  -- Las tandas que quedan por pedir del mismo periodo
  pendientes JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- El inicio del último mes y de la última semana ya leídos enteros
  mes_ok DATE,
  semana_ok DATE,
  ficha_leida_at TIMESTAMPTZ,
  -- desconocido · si · no (sin el rol de Brand Analytics o sin Brand Registry)
  acceso TEXT NOT NULL DEFAULT 'desconocido' CHECK (acceso IN ('desconocido', 'si', 'no')),
  pedido_at TIMESTAMPTZ,
  error TEXT,
  intentos INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id)
);

ALTER TABLE public.seo_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_fichas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_lecturas  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['seo_productos', 'seo_fichas', 'seo_consultas', 'seo_lecturas'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_lectura_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_erp_admin(auth.uid()))', t || '_lectura_admin', t);
    END IF;
  END LOOP;
END $$;

INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('seo-lecturas', 3, true)
ON CONFLICT (tarea) DO UPDATE SET cada_minutos = EXCLUDED.cada_minutos, activo = EXCLUDED.activo, actualizado_at = NOW();

-- Comprobación: tiene que salir UNA fila con las tres cosas en `true`
SELECT
  (SELECT count(*) = 4 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('seo_productos', 'seo_fichas', 'seo_consultas', 'seo_lecturas') AND c.relrowsecurity) AS cuatro_tablas_con_rls,
  (SELECT count(*) = 4 FROM pg_policies WHERE policyname IN ('seo_productos_lectura_admin', 'seo_fichas_lectura_admin', 'seo_consultas_lectura_admin', 'seo_lecturas_lectura_admin')) AS cuatro_politicas_de_lectura,
  EXISTS (SELECT 1 FROM public.cron_config WHERE tarea = 'seo-lecturas') AS reloj_puesto;
