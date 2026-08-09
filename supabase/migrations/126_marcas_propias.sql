-- ==================================================================
-- 126 · LAS MARCAS PROPIAS DEL CLIENTE
-- ==================================================================
--
-- Para qué es
-- -----------
-- Un cliente MIXTO revende marcas de terceros y además tiene la suya. La
-- diferencia decide dos cosas: de qué productos tiene sentido medir el BSR
-- —el ranking de un producto ajeno mide el producto, no la cuenta del
-- cliente— y sobre cuáles se hace marketing.
--
-- Y se marca POR MARCA, no por referencia. Un cliente con 5.000 SKU no va a
-- marcar 5.000 casillas, pero marcas propias tiene dos o tres. Se eligen esas
-- y todo su catálogo queda clasificado.
--
--
-- Por qué una tabla y no solo el booleano del listing
-- --------------------------------------------------
-- Porque el catálogo crece. Si solo se estampara `es_marca_propia` sobre las
-- filas de hoy, el censo de la semana que viene traería referencias nuevas de
-- la marca del cliente SIN marcar, y nadie se enteraría: el BSR dejaría de
-- medirse justo en los productos recién lanzados, que son los que más importan.
--
-- La lista de marcas es la fuente de la verdad. `es_marca_propia` es el valor
-- ya resuelto que se consulta en las lecturas, y se recalcula solo.
--
--
-- Por qué hace falta `marca_propia_origen`
-- ----------------------------------------
-- Para no pisar lo que ha puesto una persona. Hay excepciones reales: una
-- marca que es del cliente salvo cuatro referencias que revende, o al revés,
-- un producto suyo listado bajo la marca del fabricante. Con el origen a
-- 'manual' esa fila queda fuera del recálculo y sobrevive a los barridos.
--
-- Es el mismo patrón que `dims_origen`, y viene de un fallo real que encontró
-- la auditoría de anoche: el barrido semanal borraba las medidas puestas a
-- mano porque escribía la columna viniera o no el dato.
--
--
-- De dónde sale la marca
-- ----------------------
-- De `amazon_listings.marca`, que la rellena el enriquecido de catálogo
-- (Catalog Items, summaries.brand) en el barrido SEMANAL. En un cliente recién
-- conectado esa columna está vacía y la lista de marcas sale vacía: no es un
-- fallo, es que todavía no se ha enriquecido. La pantalla lo dice.

-- ---------- La lista ----------
CREATE TABLE IF NOT EXISTS public.amazon_marcas_propias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /** Tal y como viene de Amazon, que es como se enseña en pantalla */
  marca TEXT NOT NULL,

  /**
   * La misma en minúsculas, sin acentos ni espacios de más.
   *
   * Es la que casa, y hace falta porque Amazon devuelve la marca escrita como
   * la puso quien creó el listing: «Pikolinos», «PIKOLINOS» y «Pikolinos »
   * conviven en el mismo catálogo. Sin normalizar, marcar una dejaría fuera a
   * las otras dos y el cliente vería la mitad de sus productos sin clasificar
   * sin entender por qué.
   */
  marca_norm TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT amazon_marcas_propias_marca_ok CHECK (length(trim(marca)) > 0),
  CONSTRAINT amazon_marcas_propias_unica UNIQUE (client_id, marca_norm)
);

CREATE INDEX IF NOT EXISTS amazon_marcas_propias_cliente_idx
  ON public.amazon_marcas_propias (client_id);

-- ---------- De dónde viene el valor de cada listing ----------
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS marca_propia_origen TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'amazon_listings_marca_propia_origen_ok'
  ) THEN
    ALTER TABLE public.amazon_listings
      ADD CONSTRAINT amazon_listings_marca_propia_origen_ok
      CHECK (marca_propia_origen IS NULL OR marca_propia_origen IN ('marca', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.amazon_listings.marca_propia_origen IS
  'marca = lo puso el recálculo desde amazon_marcas_propias y se puede volver a '
  'calcular. manual = lo puso una persona para esta referencia concreta y el '
  'recálculo NO lo toca. NULL = nunca se ha clasificado.';

-- Buscar por marca dentro de una conexión es lo que hace la pantalla de marcas
-- y lo que hace el recálculo. Sin esto, con 30.000 referencias se arrastra.
CREATE INDEX IF NOT EXISTS amazon_listings_marca_idx
  ON public.amazon_listings (connection_id, marca)
  WHERE marca IS NOT NULL;

-- ---------- Permisos ----------
ALTER TABLE public.amazon_marcas_propias ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'amazon_marcas_propias' AND policyname = 'amazon_marcas_propias_admin'
  ) THEN
    CREATE POLICY amazon_marcas_propias_admin ON public.amazon_marcas_propias
      FOR ALL USING (public.is_erp_admin()) WITH CHECK (public.is_erp_admin());
  END IF;
END $$;
