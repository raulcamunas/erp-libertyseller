-- ============================================================================
-- 223 · EL AUDITOR DE STOCK TAMBIÉN APUNTA LOS CAMBIOS DE PRECIO
-- ============================================================================
--
-- Cada pasada del auditor lee ya el listing de cada SKU. Si además se lee su
-- precio, se puede decir qué SKU han cambiado de precio desde la pasada anterior,
-- cuánto valía antes y cuánto vale ahora.
--
-- stock_precios      el ÚLTIMO precio visto de cada SKU (una fila por SKU, unas
--                    14.000). Es con lo que se compara la pasada siguiente. Solo
--                    se escribe lo que ha cambiado, no las 14.000 filas cada vez.
-- stock_auditorias   cuántos precios se leyeron, cuántos cambiaron (suben/bajan)
--                    y la lista de cambios [sku, asin, antes, ahora] en CÉNTIMOS.
--
-- NULL en `precio_cambios` = no se pudo comparar (primera pasada con precios, o
-- no hay migración). Un 0 es «se compararon y no cambió ninguno».
--
-- Los precios van en céntimos enteros: sin decimales que se descuadren.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stock_precios (
  connection_id    UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id   TEXT NOT NULL,
  sku              TEXT NOT NULL,
  precio_centimos  INTEGER NOT NULL CHECK (precio_centimos >= 0),
  visto_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id, sku)
);

COMMENT ON TABLE public.stock_precios IS
  'Auditor de stock: último precio visto de cada SKU, para detectar cambios entre pasadas.';

-- Tabla cerrada: solo el servidor (service role) la toca.
ALTER TABLE public.stock_precios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_precios FROM authenticated, anon;

ALTER TABLE public.stock_auditorias
  ADD COLUMN IF NOT EXISTS precios_leidos  INTEGER CHECK (precios_leidos IS NULL OR precios_leidos >= 0),
  ADD COLUMN IF NOT EXISTS precio_cambios  INTEGER CHECK (precio_cambios IS NULL OR precio_cambios >= 0),
  ADD COLUMN IF NOT EXISTS precio_suben    INTEGER CHECK (precio_suben IS NULL OR precio_suben >= 0),
  ADD COLUMN IF NOT EXISTS precio_bajan    INTEGER CHECK (precio_bajan IS NULL OR precio_bajan >= 0),
  ADD COLUMN IF NOT EXISTS cambios_precio  JSONB;
