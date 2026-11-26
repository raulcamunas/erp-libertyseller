-- RESEÑAS (Sellerboard propio, 26 nov 2026): las automatizaciones de «Solicitar una reseña» de Amazon por cliente, y la cola de pedidos.
-- Se pide la reseña con la API oficial de Amazon (Solicitations: el mismo correo que el botón «Solicitar una reseña» de Seller Central).
-- Solo la usa el servidor (service role): RLS activado y sin políticas, como las tablas de ventas.

CREATE TABLE IF NOT EXISTS public.resenas_campanas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL DEFAULT 'Reseñas',
  prioridad INTEGER NOT NULL DEFAULT 1,
  -- Nace pausada: se enciende a mano
  activa BOOLEAN NOT NULL DEFAULT false,
  desde DATE NOT NULL DEFAULT CURRENT_DATE,
  hasta DATE,
  -- Días tras la entrega (estimada: compra + 2 días) y hora de Madrid a la que se pide. Amazon solo deja pedirla de 5 a 30 días tras la entrega
  dias_tras_entrega INTEGER NOT NULL DEFAULT 5 CHECK (dias_tras_entrega BETWEEN 0 AND 25),
  hora INTEGER NOT NULL DEFAULT 20 CHECK (hora BETWEEN 0 AND 23),
  excluir_fbm BOOLEAN NOT NULL DEFAULT true,
  excluir_promo BOOLEAN NOT NULL DEFAULT false,
  -- NULL = todos los países de la cuenta
  mercados TEXT[],
  productos_modo TEXT NOT NULL DEFAULT 'todos' CHECK (productos_modo IN ('todos', 'solo', 'excepto')),
  skus TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS resenas_campanas_cuenta_idx ON public.resenas_campanas (connection_id);

CREATE TABLE IF NOT EXISTS public.resenas_envios (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  pedido TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,
  campana_id UUID REFERENCES public.resenas_campanas(id) ON DELETE SET NULL,
  compra_at TIMESTAMPTZ NOT NULL,
  programado_at TIMESTAMPTZ NOT NULL,
  -- en_cola · enviada · no_disponible (Amazon no la ofrece: ya pedida o fuera de plazo) · caducada · error · descartada
  estado TEXT NOT NULL DEFAULT 'en_cola',
  intentos INTEGER NOT NULL DEFAULT 0,
  ultimo_intento_at TIMESTAMPTZ,
  enviada_at TIMESTAMPTZ,
  detalle TEXT,
  skus TEXT[] NOT NULL DEFAULT '{}',
  importe NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, pedido)
);
CREATE INDEX IF NOT EXISTS resenas_envios_cola_idx ON public.resenas_envios (estado, programado_at);
CREATE INDEX IF NOT EXISTS resenas_envios_enviadas_idx ON public.resenas_envios (connection_id, enviada_at);
CREATE INDEX IF NOT EXISTS resenas_envios_compra_idx ON public.resenas_envios (connection_id, compra_at);

ALTER TABLE public.resenas_campanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resenas_envios ENABLE ROW LEVEL SECURITY;
