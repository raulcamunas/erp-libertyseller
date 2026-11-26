-- 344 · VENTAS (EL «SELLERBOARD» PROPIO): EL PANEL DE VENTAS Y BENEFICIO DE CADA CLIENTE
-- Raúl (26 nov 2026): sustituir Sellerboard con lo que ya tenemos conectado. Primer cliente: Tapas Party.
--
-- PENSADO PARA OCUPAR POCO (la base es la Nano):
--   · ventas_dia         EL RESUMEN QUE SE QUEDA: una fila por cuenta × país × SKU × día con las cifras ya sumadas. Lo único que crece con el tiempo.
--   · ventas_lineas      las líneas de pedido de los ÚLTIMOS ~62 DÍAS (para «Pedidos» y para casar las comisiones reales). Se podan solas.
--   · ventas_movimientos el dinero que no es una venta (reembolsos, tarifas de la cuenta, ajustes, publicidad por SKU), también ~62 días. Se podan solos.
--   · ventas_cuentas     qué cuentas se leen, su IVA y por dónde va la lectura.
--   · ventas_costes      el coste de cada SKU (COGS), que pone el equipo.
-- Sin nada del comprador: solo pedido, SKU, unidades, importes y fechas. Todo cerrado al navegador: se lee y escribe desde el servidor.

CREATE TABLE IF NOT EXISTS public.ventas_cuentas (
  connection_id UUID PRIMARY KEY REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  activa BOOLEAN NOT NULL DEFAULT true,
  -- El IVA que se descuenta de las ventas (Sellerboard: «IVA»). Por cuenta: un vendedor español aplica el 21 %
  iva_pct NUMERIC(5,2) NOT NULL DEFAULT 21,
  -- Informe de pedidos de Amazon (dos pasos: se pide y se recoge)
  pedidos_informe_id TEXT,
  pedidos_informe_desde TIMESTAMPTZ,
  pedidos_informe_hasta TIMESTAMPTZ,
  pedidos_pedido_at TIMESTAMPTZ,
  pedidos_leido_desde TIMESTAMPTZ,
  pedidos_leido_hasta TIMESTAMPTZ,
  pedidos_leido_at TIMESTAMPTZ,
  -- Movimientos de dinero (Finances API, leído por tramos)
  finanzas_leido_desde TIMESTAMPTZ,
  finanzas_leido_hasta TIMESTAMPTZ,
  finanzas_leido_at TIMESTAMPTZ,
  -- Publicidad por producto (informe spAdvertisedProduct de Amazon Ads): los informes pedidos que faltan por recoger
  ads_informes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ads_leido_hasta DATE,
  ads_leido_at TIMESTAMPTZ,
  resumen_at TIMESTAMPTZ,
  ultimo_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ventas_lineas (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  pedido TEXT NOT NULL,
  sku TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL,
  dia DATE NOT NULL,
  asin TEXT,
  estado TEXT,
  canal TEXT,
  unidades INTEGER NOT NULL DEFAULT 0,
  -- En EUROS (convertido al leer). NULL = Amazon aún no da el precio (pedido pendiente): se estima al resumir
  ventas NUMERIC(12,2),
  promo NUMERIC(12,2) NOT NULL DEFAULT 0,
  tarifa_referral NUMERIC(12,2),
  tarifa_fba NUMERIC(12,2),
  otras_tarifas NUMERIC(12,2),
  -- true = las tarifas son las que Amazon ha cobrado (Finances); false = estimadas
  tarifas_reales BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (connection_id, pedido, sku)
);
CREATE INDEX IF NOT EXISTS ventas_lineas_dia_idx ON public.ventas_lineas (connection_id, dia);

CREATE TABLE IF NOT EXISTS public.ventas_movimientos (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  -- Identidad del movimiento: volver a leerlo no lo duplica
  clave TEXT NOT NULL,
  dia DATE NOT NULL,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL CHECK (tipo IN ('reembolso', 'tarifa_cuenta', 'ajuste', 'tarifa_pedido', 'publicidad')),
  unidades INTEGER NOT NULL DEFAULT 0,
  -- reembolso: lo devuelto al comprador (positivo) · tarifa/ajuste: el importe con su signo · publicidad: el gasto (positivo)
  importe NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- reembolso: las comisiones que devuelve o cobra Amazon por el reembolso, con su signo · publicidad: las ventas del mismo día
  extra NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- publicidad: las unidades vendidas del mismo día
  extra_unidades INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (connection_id, clave)
);
CREATE INDEX IF NOT EXISTS ventas_movimientos_dia_idx ON public.ventas_movimientos (connection_id, dia);

CREATE TABLE IF NOT EXISTS public.ventas_dia (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  -- '' = lo que es de la cuenta y no de un producto (tarifas de almacenamiento, suscripción, ajustes)
  sku TEXT NOT NULL,
  dia DATE NOT NULL,
  asin TEXT,
  unidades INTEGER NOT NULL DEFAULT 0,
  pedidos INTEGER NOT NULL DEFAULT 0,
  ventas NUMERIC(12,2) NOT NULL DEFAULT 0,
  promo NUMERIC(12,2) NOT NULL DEFAULT 0,
  tarifa_referral NUMERIC(12,2) NOT NULL DEFAULT 0,
  tarifa_fba NUMERIC(12,2) NOT NULL DEFAULT 0,
  otras_tarifas NUMERIC(12,2) NOT NULL DEFAULT 0,
  tarifas_estimadas NUMERIC(12,2) NOT NULL DEFAULT 0,
  reembolsos INTEGER NOT NULL DEFAULT 0,
  reembolsado NUMERIC(12,2) NOT NULL DEFAULT 0,
  comision_reembolso NUMERIC(12,2) NOT NULL DEFAULT 0,
  ajustes NUMERIC(12,2) NOT NULL DEFAULT 0,
  publicidad NUMERIC(12,2) NOT NULL DEFAULT 0,
  ventas_ppc NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidades_ppc INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (connection_id, dia, marketplace_id, sku)
);

CREATE TABLE IF NOT EXISTS public.ventas_costes (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  -- Coste por unidad en euros (producto + envío a Amazon, lo que el cliente considere su COGS)
  coste NUMERIC(12,2) NOT NULL CHECK (coste >= 0),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, sku)
);

ALTER TABLE public.ventas_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_dia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_costes ENABLE ROW LEVEL SECURITY;

-- El primer cliente: Tapas Party (conexión «Ham Master»)
INSERT INTO public.ventas_cuentas (connection_id)
VALUES ('66a7f2f3-aa13-4bf3-954f-50a788fa7cba')
ON CONFLICT (connection_id) DO NOTHING;
