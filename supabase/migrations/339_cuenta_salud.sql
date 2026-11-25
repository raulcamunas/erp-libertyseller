-- ============================================================================
-- 339 · LA SALUD DE LA CUENTA DE VENDEDOR (Cumplimiento → «No se venden»)
--
-- Una fila por cuenta y país: el último informe de rendimiento de Amazon (GET_V2_SELLER_PERFORMANCE_REPORT) ya interpretado
-- (lib/cumplimiento/salud.ts): estado de la cuenta, pedidos defectuosos, envíos retrasados, cancelaciones, seguimiento, entregas
-- a tiempo, facturas y los recuentos de incidencias de políticas. Se pide una vez al día desde el proceso horario `cumplimiento`
-- (pedir → esperar → descargar, en pasadas distintas: `report_id` y `estado` guardan por dónde va).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Sin ella, la pantalla dice que falta y lo demás sigue igual.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cuenta_salud (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  report_id TEXT,
  estado TEXT NOT NULL DEFAULT 'pedido' CHECK (estado IN ('pedido', 'listo', 'error')),
  pedido_at TIMESTAMPTZ,
  leido_at TIMESTAMPTZ,
  datos JSONB,
  error TEXT,
  PRIMARY KEY (connection_id, marketplace_id)
);
ALTER TABLE public.cuenta_salud ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo el servidor (clave de servicio)
