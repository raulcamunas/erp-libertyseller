-- ============================================================================
-- 329 · PANEL DE PCCOMPONENTES PARA ENTRAIS (ENLACE CON CLAVE) Y EL STOCK EN EL REGISTRO DE CAMBIOS
-- ============================================================================
--   · trafico_enlaces  admite un tercer tipo, 'pccomponentes': la página /pcc/<token> con sus ventas, pedidos, cambios de precio y de stock en PcComponentes.
--   · pcc_precios_log  guarda también el stock de antes y el de después de cada cambio (hasta ahora solo el precio).
-- NO TOCA NI BORRA NADA QUE YA EXISTA. IDEMPOTENTE. Hacen falta la 321, la 322 y la 323.
-- ============================================================================
ALTER TABLE public.trafico_enlaces DROP CONSTRAINT IF EXISTS trafico_enlaces_tipo_check;
ALTER TABLE public.trafico_enlaces ADD CONSTRAINT trafico_enlaces_tipo_check CHECK (tipo IN ('trafico', 'stock', 'pccomponentes'));

ALTER TABLE public.pcc_precios_log ADD COLUMN IF NOT EXISTS stock_antes INTEGER;
ALTER TABLE public.pcc_precios_log ADD COLUMN IF NOT EXISTS stock_nuevo INTEGER;
CREATE INDEX IF NOT EXISTS pcc_precios_log_enviado_idx ON public.pcc_precios_log (pasada_at DESC) WHERE enviado;

-- Tiene que salir «true» dos veces
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pcc_precios_log' AND column_name = 'stock_nuevo') AS tiene_el_stock,
       pg_get_constraintdef(oid) LIKE '%pccomponentes%' AS admite_el_panel
FROM pg_constraint WHERE conname = 'trafico_enlaces_tipo_check';
