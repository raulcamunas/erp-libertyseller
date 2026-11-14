-- ============================================================================
-- 312 · SEO TEST: EDITOR DE FICHA CON REGISTRO, VERIFICACIÓN, HELIUM 10 Y SEGUIMIENTO DIARIO DE LA COMPETENCIA
-- ============================================================================
-- 14 nov 2026. Lo que pidió Raúl para SEO Test:
--
--   · seo_ediciones           CADA cambio de texto que el ERP manda a una ficha de Amazon (a mano desde el editor o la propuesta de la IA): antes,
--                             después, qué campos, quién lo validó y quién lo mandó, qué contestó Amazon y si DE VERDAD ha quedado en la ficha
--                             (verificación al releerla: aplicada / no aplicada / parcial). Pueden validar y aplicar los administradores y quien
--                             tenga la casilla de SEO Test, siempre con validación previa en Amazon (VALIDATION_PREVIEW) y confirmación.
--                             amazon_submissions NO sirve para esto: su campo solo admite precio y cantidad numéricos (migración 118).
--   · seo_fichas              + highlights (Item Highlights, si el tipo de producto los tiene), product_type e issues (lo que Amazon dice
--                             que le pasa al listing: includedData=issues).
--   · seo_helium_importaciones / seo_helium_keywords
--                             los CSV de Helium 10 (Cerebro, Magnet y Keyword Tracker) por producto, guardados con su fecha, para cruzarlos con
--                             Brand Analytics (lo que está en H10 y no en BA = oportunidad) y pasarlos a la propuesta con IA.
--   · seo_competidores / seo_competidores_fotos / seo_competidores_cambios
--                             los ASIN rivales que se siguen por producto, su foto diaria (Catalog Items: título, viñetas, imágenes, BSR; y
--                             precio/Buy Box si Amazon lo da) y los cambios detectados entre una foto y la anterior.
--   · cron_config 'seo-competencia' cada 60 minutos: cada pasada fotografía a los rivales que aún no tienen la foto de hoy, con presupuesto.
--
-- NO toca el CHECK de notifications.type. Todo cerrado al navegador salvo lectura para administradores (como 296 y 299): escribe solo el servidor
-- con el cliente de servicio, después de comprobar el acceso (lib/seo/ruta.ts). Se puede lanzar dos veces.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.seo_fichas') IS NULL OR to_regclass('public.seo_propuestas') IS NULL THEN
    RAISE EXCEPTION 'Faltan las tablas de SEO Test: lanza antes 296_seo_test.sql y 299_seo_mejoras.sql.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) La ficha leída: Item Highlights, tipo de producto e incidencias de Amazon
-- ---------------------------------------------------------------------------
ALTER TABLE public.seo_fichas ADD COLUMN IF NOT EXISTS highlights   TEXT;
ALTER TABLE public.seo_fichas ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE public.seo_fichas ADD COLUMN IF NOT EXISTS issues       JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2) Las ediciones de ficha (a mano o de la IA) y su verificación
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_ediciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  sku  TEXT NOT NULL,
  product_type TEXT,
  origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'ia')),
  propuesta_id UUID REFERENCES public.seo_propuestas(id) ON DELETE SET NULL,
  -- {titulo, highlights, bullets[], descripcion, backend}: lo que había y lo que se manda
  antes   JSONB NOT NULL,
  despues JSONB NOT NULL,
  -- Los campos que se mandan de verdad ('titulo','highlights','bullets','descripcion','backend')
  campos TEXT[] NOT NULL DEFAULT '{}',
  -- El atributo de Amazon con el que se mandaron los Item Highlights (sale de la definición del tipo de producto)
  atributo_highlights TEXT,
  estado TEXT NOT NULL DEFAULT 'validada' CHECK (estado IN ('validada', 'rechazada', 'enviada', 'aplicada', 'no_aplicada', 'parcial', 'error')),
  -- Lo que dijo Amazon al validar y al mandar
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  submission_id TEXT,
  -- {campos: {titulo: 'igual'|'distinto'|'sin_leer'}, issues: [...], leida_at}: la comparación con la ficha releída
  verificacion JSONB,
  -- Se mandó saltándose la ventana de 30 días del SOP (lo confirma la persona)
  fuera_de_ventana BOOLEAN NOT NULL DEFAULT false,
  avisos TEXT[] NOT NULL DEFAULT '{}',
  error TEXT,
  creado_por  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  enviado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validada_at  TIMESTAMPTZ,
  enviada_at   TIMESTAMPTZ,
  verificada_at TIMESTAMPTZ,
  -- Cuántas veces se ha mirado la ficha para verificarla (se deja de mirar a las 24 h)
  comprobaciones INTEGER NOT NULL DEFAULT 0,
  comprobada_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_seo_ediciones_producto ON public.seo_ediciones (connection_id, marketplace_id, asin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_ediciones_por_verificar ON public.seo_ediciones (connection_id, marketplace_id) WHERE estado = 'enviada';

-- ---------------------------------------------------------------------------
-- 3) Helium 10
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_helium_importaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('cerebro', 'magnet', 'keyword_tracker')),
  fichero TEXT,
  filas INTEGER NOT NULL DEFAULT 0,
  -- Los ASIN rivales que traía el Cerebro multi-ASIN (una columna de rango orgánico por cada uno)
  asins_rivales TEXT[] NOT NULL DEFAULT '{}',
  subido_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subido_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seo_helium_importaciones_producto ON public.seo_helium_importaciones (connection_id, marketplace_id, asin, subido_at DESC);

CREATE TABLE IF NOT EXISTS public.seo_helium_keywords (
  importacion_id UUID NOT NULL REFERENCES public.seo_helium_importaciones(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  volumen INTEGER,
  cerebro_iq NUMERIC,
  tendencia NUMERIC,
  competidores INTEGER,
  densidad INTEGER,
  puja_sugerida NUMERIC,
  rango_organico INTEGER,
  rango_patrocinado INTEGER,
  -- {asin: rango orgánico} del Cerebro multi-ASIN
  rangos_rivales JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (importacion_id, keyword)
);

-- ---------------------------------------------------------------------------
-- 4) La competencia que se sigue cada día
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_competidores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  -- El producto propio contra el que compite (NULL = de la cuenta entera)
  asin_propio TEXT,
  asin_rival TEXT NOT NULL CHECK (asin_rival ~ '^[A-Z0-9]{10}$'),
  nombre TEXT,
  origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'top_terms', 'cerebro')),
  activo BOOLEAN NOT NULL DEFAULT true,
  foto_at TIMESTAMPTZ,
  error TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, marketplace_id, asin_rival)
);
CREATE INDEX IF NOT EXISTS idx_seo_competidores_foto ON public.seo_competidores (activo, foto_at);

CREATE TABLE IF NOT EXISTS public.seo_competidores_fotos (
  competidor_id UUID NOT NULL REFERENCES public.seo_competidores(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  titulo TEXT,
  bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  imagenes JSONB NOT NULL DEFAULT '[]'::jsonb,
  marca TEXT,
  -- [{tipo:'grupo'|'categoria', categoria, rank}]
  bsr JSONB NOT NULL DEFAULT '[]'::jsonb,
  precio NUMERIC,
  moneda TEXT,
  buybox_vendedor TEXT,
  ofertas INTEGER,
  fuente TEXT NOT NULL DEFAULT 'sp-api',
  hash TEXT NOT NULL,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (competidor_id, fecha)
);

CREATE TABLE IF NOT EXISTS public.seo_competidores_cambios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  competidor_id UUID NOT NULL REFERENCES public.seo_competidores(id) ON DELETE CASCADE,
  detectado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha DATE NOT NULL,
  campo TEXT NOT NULL CHECK (campo IN ('titulo', 'bullets', 'imagenes', 'precio', 'bsr', 'marca', 'buybox')),
  antes JSONB,
  despues JSONB,
  -- Cuánto ha cambiado (el % del precio, las posiciones del BSR, las palabras del título…): ordena el feed
  magnitud NUMERIC,
  resumen TEXT,
  UNIQUE (competidor_id, fecha, campo)
);
CREATE INDEX IF NOT EXISTS idx_seo_competidores_cambios_fecha ON public.seo_competidores_cambios (detectado_at DESC);

-- ---------------------------------------------------------------------------
-- 5) Cerradas al navegador; solo lectura para administradores (como 296 y 299)
-- ---------------------------------------------------------------------------
ALTER TABLE public.seo_ediciones            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_helium_importaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_helium_keywords      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_competidores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_competidores_fotos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_competidores_cambios ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['seo_ediciones', 'seo_helium_importaciones', 'seo_helium_keywords', 'seo_competidores', 'seo_competidores_fotos', 'seo_competidores_cambios'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_lectura_admin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_erp_admin(auth.uid()))', t || '_lectura_admin', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) El reloj del seguimiento diario de la competencia
-- ---------------------------------------------------------------------------
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('seo-competencia', 60, true)
ON CONFLICT (tarea) DO NOTHING;

-- ============================================================================
-- COMPROBACIÓN · tiene que salir UNA fila con todo en «true»
-- ============================================================================
SELECT
  (SELECT count(*) = 3 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'seo_fichas' AND column_name IN ('highlights', 'product_type', 'issues')) AS ficha_ampliada,
  (SELECT count(*) = 6 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relrowsecurity
       AND c.relname IN ('seo_ediciones', 'seo_helium_importaciones', 'seo_helium_keywords', 'seo_competidores', 'seo_competidores_fotos', 'seo_competidores_cambios')) AS seis_tablas_con_rls,
  (SELECT count(*) = 6 FROM pg_policies
     WHERE policyname IN ('seo_ediciones_lectura_admin', 'seo_helium_importaciones_lectura_admin', 'seo_helium_keywords_lectura_admin',
                          'seo_competidores_lectura_admin', 'seo_competidores_fotos_lectura_admin', 'seo_competidores_cambios_lectura_admin')) AS seis_politicas_de_lectura,
  EXISTS (SELECT 1 FROM public.cron_config WHERE tarea = 'seo-competencia') AS reloj_puesto;
