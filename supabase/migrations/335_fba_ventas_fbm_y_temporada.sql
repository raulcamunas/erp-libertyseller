-- ============================================================================
-- 335 · REPOSICIÓN FBA: LAS VENTAS FBM CUENTAN Y LA TEMPORADA DE CADA PRODUCTO
-- ============================================================================
--
-- 1) Las ventas por canal (FBA y FBM) de cada cuenta, por día y SKU, leídas del informe de pedidos de Amazon
--    (GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL). El plan solo contaba el libro mayor de FBA: un ASIN que vende 4 pares al día por
--    FBM y 0 por FBA (porque no hay stock en Amazon) salía «sin ventas». Solo se guardan día, SKU, ASIN, canal y unidades: nada del comprador.
--      · fba_ventas_canal            las unidades por (cuenta, mercado, día, SKU, canal)
--      · fba_ventas_canal_lecturas   hasta dónde se ha leído cada cuenta y el informe que está pendiente de recoger
-- 2) La temporada de cada producto (verano, invierno o todo el año), para no mandar sandalias en diciembre ni botas en julio:
--      · fba_temporadas              por cliente y modelo (o SKU si no tiene modelo); la pone una regla por palabras, la IA o una persona
--
-- Tablas con RLS y SIN políticas: solo las lee y escribe el servidor (como seo_*). IDEMPOTENTE. Sin esta migración todo funciona igual que antes:
-- el plan no cuenta FBM ni temporada.

CREATE TABLE IF NOT EXISTS public.fba_ventas_canal (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  fecha DATE NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,
  canal TEXT NOT NULL CHECK (canal IN ('fba', 'fbm')),
  unidades INTEGER NOT NULL CHECK (unidades >= 0),
  PRIMARY KEY (connection_id, marketplace_id, fecha, sku, canal)
);
CREATE INDEX IF NOT EXISTS fba_ventas_canal_asin ON public.fba_ventas_canal (connection_id, marketplace_id, asin, fecha);
ALTER TABLE public.fba_ventas_canal ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fba_ventas_canal_lecturas (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  leido_desde DATE,
  leido_hasta DATE,
  leido_at TIMESTAMPTZ,
  informe_id TEXT,
  informe_desde TIMESTAMPTZ,
  informe_hasta TIMESTAMPTZ,
  informe_pedido_at TIMESTAMPTZ,
  ultimo_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, marketplace_id)
);
ALTER TABLE public.fba_ventas_canal_lecturas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fba_temporadas (
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  -- El modelo («F0047 BURDEOS») o, si la referencia no tiene modelo, el SKU
  clave TEXT NOT NULL CHECK (length(clave) BETWEEN 1 AND 200),
  temporada TEXT NOT NULL CHECK (temporada IN ('verano', 'invierno', 'todo')),
  origen TEXT NOT NULL CHECK (origen IN ('regla', 'ia', 'manual')),
  motivo TEXT CHECK (motivo IS NULL OR length(motivo) <= 300),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, clave)
);
ALTER TABLE public.fba_temporadas ENABLE ROW LEVEL SECURITY;

-- Comprobación: tiene que salir UNA fila con todo en `true`
SELECT
  to_regclass('public.fba_ventas_canal') IS NOT NULL AS ventas_canal,
  to_regclass('public.fba_ventas_canal_lecturas') IS NOT NULL AS lecturas,
  to_regclass('public.fba_temporadas') IS NOT NULL AS temporadas,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('fba_ventas_canal', 'fba_ventas_canal_lecturas', 'fba_temporadas')) AS con_rls;
