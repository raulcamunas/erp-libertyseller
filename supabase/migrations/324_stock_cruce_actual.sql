-- ============================================================================
-- 324 · LA FOTO COMPLETA DEL CRUCE AMAZON ↔ PRESTASHOP (para la página del cliente del auditor de stock)
-- ============================================================================
-- Cada auditoría guarda solo los SKU que NO cuadran. La página del cliente enseña TODOS los que tienen stock en algún lado con «Stock Amazon» y «Stock PrestaShop»:
-- esa lista se guarda aquí, UNA fila por cuenta que se sustituye en cada pasada (no crece). filas = [[sku, asin, amazon, tienda|null, estado], …]
-- NO TOCA NI BORRA NADA. IDEMPOTENTE. Cerrada al navegador (RLS sin políticas).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stock_cruce_actual (
  connection_id  UUID NOT NULL,
  marketplace_id TEXT NOT NULL,
  auditoria_id   UUID,
  creada_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filas          JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (connection_id, marketplace_id)
);
ALTER TABLE public.stock_cruce_actual ENABLE ROW LEVEL SECURITY;

-- Tiene que salir «true»
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_cruce_actual') AS tiene_la_tabla;
