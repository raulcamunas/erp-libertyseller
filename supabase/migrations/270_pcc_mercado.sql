-- ============================================================================
-- 270 · ENTRAIS · PCCOMPONENTES: EL MERCADO DE CADA PRODUCTO (PRECIO MÁS BAJO, TIENDAS Y CATEGORÍA)
-- ============================================================================
--
-- El panel «Mercado y margen» cruza el coste de cada producto del proveedor (la tabla `entrais_precios`, que ya alimenta el ciclo de stock) con lo que
-- hay HOY en el catálogo de PcComponentes: si el producto existe, en qué categoría (de la que sale la comisión), cuántas tiendas lo venden y a qué precio
-- el más barato. Preguntarlo son unas 63 llamadas a PcComponentes y cerca de dos minutos, así que se guarda: la pantalla lee de aquí y un botón lo refresca.
--
-- UNA FILA POR EAN, también los que NO existen (`existe = false`): así se sabe que ya se preguntó y la cobertura sale de contar filas.
-- TABLA NUEVA, NO TOCA NADA. Cerrada al navegador: se lee y escribe desde el servidor, y solo para administradores.
-- El código funciona SIN esta migración: la pestaña dice que falta lanzarla.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pcc_mercado (
  ean              TEXT PRIMARY KEY,
  existe           BOOLEAN NOT NULL,
  producto_id      TEXT,
  titulo           TEXT,
  marca            TEXT,
  categoria        TEXT,
  -- Tiendas que lo venden ahora (activas y con stock) y el precio más bajo CON IVA y quién lo tiene
  ofertas          INTEGER NOT NULL DEFAULT 0,
  precio_min       NUMERIC,
  tienda_min       TEXT,
  actualizado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pcc_mercado IS
  'Lo que hay en el catálogo de PcComponentes para cada EAN del proveedor de Entrais: existencia, categoría, tiendas y precio más bajo. Lo escribe el botón «Actualizar mercado» del panel Entrais · PcComponentes.';

CREATE INDEX IF NOT EXISTS idx_pcc_mercado_existe ON public.pcc_mercado (existe);

ALTER TABLE public.pcc_mercado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pcc_mercado FROM authenticated, anon;

-- COMPROBACIÓN: las dos columnas tienen que decir «true».
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pcc_mercado') AS tiene_la_tabla,
  EXISTS (SELECT 1 FROM pg_class WHERE relname = 'pcc_mercado' AND relrowsecurity) AS esta_cerrada_al_navegador;
