-- VENTAS · FLUJO DE CAJA (27 nov 2026): los pagos de Amazon (cada liquidación: financialEventGroups de la Finances API) y los apuntes a mano
-- (inversiones, gastos, compra de bienes, dividendos, IVA) de cada cuenta, para la página «Flujo de caja» como la de Sellerboard.
ALTER TABLE public.ventas_cuentas ADD COLUMN IF NOT EXISTS pagos_leido_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.ventas_pagos (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  grupo TEXT NOT NULL,                       -- FinancialEventGroupId
  inicio TIMESTAMPTZ,
  fin TIMESTAMPTZ,                           -- vacío mientras la liquidación está abierta
  fecha_pago TIMESTAMPTZ,                    -- FundTransferDate
  estado TEXT,                               -- Open / Closed
  estado_pago TEXT,                          -- Succeeded / Processing / Failed / Unknown
  importe NUMERIC(14,2) NOT NULL DEFAULT 0,  -- en su moneda
  moneda TEXT,
  importe_eur NUMERIC(14,2) NOT NULL DEFAULT 0,
  cuenta_banco TEXT,                         -- los últimos dígitos (AccountTail)
  oculto BOOLEAN NOT NULL DEFAULT false,     -- «Borrar» en la página: no cuenta, pero no se vuelve a crear
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, grupo)
);
CREATE INDEX IF NOT EXISTS ventas_pagos_fin_idx ON public.ventas_pagos (connection_id, fin);
ALTER TABLE public.ventas_pagos ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ventas_flujo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL CHECK (tipo IN ('pago', 'inversion', 'gasto', 'compra', 'dividendo', 'iva')),
  importe NUMERIC(14,2) NOT NULL,            -- con su signo: + entra dinero, − sale
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ventas_flujo_fecha_idx ON public.ventas_flujo (connection_id, fecha);
ALTER TABLE public.ventas_flujo ENABLE ROW LEVEL SECURITY;
