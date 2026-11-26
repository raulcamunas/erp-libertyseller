-- VENTAS · LOS MOTIVOS DE LOS REEMBOLSOS (27 nov 2026): las devoluciones de FBA de cada cuenta con su motivo y el comentario del comprador
-- (informe GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA). Sin nombre ni dirección del comprador: solo pedido, SKU, motivo y comentario.
ALTER TABLE public.ventas_cuentas
  ADD COLUMN IF NOT EXISTS devoluciones_informe_id TEXT,
  ADD COLUMN IF NOT EXISTS devoluciones_pedido_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS devoluciones_leido_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.ventas_devoluciones (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  pedido TEXT NOT NULL,
  sku TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL,
  -- La matrícula de la devolución (license plate): distingue dos devoluciones del mismo pedido y SKU el mismo día
  lpn TEXT NOT NULL DEFAULT '',
  unidades INTEGER NOT NULL DEFAULT 1,
  motivo TEXT,
  comentario TEXT,
  estado TEXT,
  disposicion TEXT,
  PRIMARY KEY (connection_id, pedido, sku, fecha, lpn)
);
CREATE INDEX IF NOT EXISTS ventas_devoluciones_pedido_idx ON public.ventas_devoluciones (connection_id, pedido);
ALTER TABLE public.ventas_devoluciones ENABLE ROW LEVEL SECURITY;
