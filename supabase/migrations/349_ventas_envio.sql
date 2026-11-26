-- VENTAS · COSTO DE ENVÍO (27 nov 2026), como la página «Costo de envío» de Sellerboard: lo que cuesta mandar los pedidos FBM (los que envía el vendedor).
-- Sin perfiles, el coste es lo que pagó el comprador por el envío (la regla por defecto de Sellerboard).

-- Lo cobrado por el envío de cada línea (euros) y, por día y SKU, las unidades, pedidos y envío cobrado de los pedidos FBM
ALTER TABLE public.ventas_lineas ADD COLUMN IF NOT EXISTS envio NUMERIC(12,2);
ALTER TABLE public.ventas_dia
  ADD COLUMN IF NOT EXISTS unidades_fbm INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pedidos_fbm INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS envio_cobrado NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Los perfiles: a qué productos y fechas se aplican y cómo se calcula el coste
CREATE TABLE IF NOT EXISTS public.ventas_envio_perfiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL DEFAULT 'Por defecto',
  prioridad INTEGER NOT NULL DEFAULT 1,
  desde DATE,
  hasta DATE,
  productos_modo TEXT NOT NULL DEFAULT 'todos' CHECK (productos_modo IN ('todos', 'solo', 'excepto')),
  skus TEXT[] NOT NULL DEFAULT '{}',
  -- cobrado = lo que pagó el comprador por el envío · pedido = un importe fijo por pedido · unidad = un importe fijo por unidad
  regla TEXT NOT NULL DEFAULT 'cobrado' CHECK (regla IN ('cobrado', 'pedido', 'unidad')),
  importe NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ventas_envio_perfiles_cuenta_idx ON public.ventas_envio_perfiles (connection_id);

-- El coste real de envío de pedidos concretos (importado de un CSV «pedido;coste»): manda sobre los perfiles
CREATE TABLE IF NOT EXISTS public.ventas_envio_pedidos (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  pedido TEXT NOT NULL,
  coste NUMERIC(10,2) NOT NULL,
  dia DATE,
  sku TEXT,
  marketplace_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, pedido)
);
CREATE INDEX IF NOT EXISTS ventas_envio_pedidos_dia_idx ON public.ventas_envio_pedidos (connection_id, dia);

ALTER TABLE public.ventas_envio_perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_envio_pedidos ENABLE ROW LEVEL SECURITY;
