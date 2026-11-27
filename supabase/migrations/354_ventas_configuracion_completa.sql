-- VENTAS · CONFIGURACIÓN COMPLETA COMO SELLERBOARD (27 nov 2026). Todo es nuevo y opcional: sin esta migración el panel calcula como antes.
--   · ventas_dia: las tarifas de la cuenta por tipo (transporte entrante, almacenamiento, suscripción) para «Ignorar costes de envíos entrantes»,
--     «Almacenamiento al mes al que corresponde» y «Amortizar diariamente»; líneas FBM (envío de pedidos con varios productos); devoluciones
--     vendibles e inservibles (coste de lo devuelto); el IVA que calcula Amazon (servicio VCS).
--   · ventas_lineas / ventas_movimientos: el IVA que Amazon cobró en cada venta y devolvió en cada reembolso.
--   · ventas_costes_lotes: los lotes de compra de cada SKU (COGS FIFO).
--   · ventas_cuentas: el día del último informe diario enviado por correo.
ALTER TABLE public.ventas_dia
  ADD COLUMN IF NOT EXISTS tarifa_entrante NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tarifa_almacenamiento NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tarifa_suscripcion NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lineas_fbm INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devueltas_vendibles INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devueltas_inservibles INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_amazon NUMERIC(14,2);

ALTER TABLE public.ventas_lineas ADD COLUMN IF NOT EXISTS iva_amazon NUMERIC(14,2);
ALTER TABLE public.ventas_movimientos ADD COLUMN IF NOT EXISTS iva NUMERIC(14,2);

CREATE TABLE IF NOT EXISTS public.ventas_costes_lotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  fecha DATE NOT NULL,                          -- desde cuándo se vende este lote
  unidades INTEGER NOT NULL CHECK (unidades > 0),
  coste NUMERIC(12,2) NOT NULL CHECK (coste >= 0), -- por unidad, en euros
  nota TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ventas_costes_lotes_sku_idx ON public.ventas_costes_lotes (connection_id, sku, fecha);
ALTER TABLE public.ventas_costes_lotes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ventas_cuentas ADD COLUMN IF NOT EXISTS informe_enviado_dia DATE;
