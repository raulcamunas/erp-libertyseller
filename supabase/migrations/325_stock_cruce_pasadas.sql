-- ============================================================================
-- 325 · LA FOTO DEL CRUCE AMAZON ↔ PRESTASHOP DE CADA REVISIÓN (los últimos 7 días)
-- ============================================================================
-- Para que en la página del cliente se pueda pulsar una revisión y ver la tabla de ese momento (Stock Amazon y Stock PrestaShop de cada SKU).
-- Una fila por auditoría; el auditor borra solo lo de más de 7 días (~25 KB por fila: unos 12 MB en régimen).
-- NO TOCA NI BORRA NADA QUE YA EXISTA. IDEMPOTENTE. Cerrada al navegador (RLS sin políticas).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stock_cruce_pasadas (
  auditoria_id   UUID PRIMARY KEY,
  connection_id  UUID NOT NULL,
  marketplace_id TEXT NOT NULL,
  creada_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filas          JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS stock_cruce_pasadas_cuenta_idx ON public.stock_cruce_pasadas (connection_id, marketplace_id, creada_at DESC);
ALTER TABLE public.stock_cruce_pasadas ENABLE ROW LEVEL SECURITY;

-- Tiene que salir «true»
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_cruce_pasadas') AS tiene_la_tabla;
