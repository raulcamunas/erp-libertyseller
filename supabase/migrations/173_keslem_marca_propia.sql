-- ==================================================================
-- 173 · KESLEM: COMISION PARTIDA POR MARCA, CON CATALOGO PROPIO
-- ==================================================================
--
-- El trato con Keslem es: 2 % sobre el excedente de facturacion respecto al año
-- anterior en marcas de terceros (arbitraje) y 4 % en su marca propia.
--
-- El informe de impuestos de Amazon —el que se sube para calcular— trae ASIN,
-- SKU e importes, pero NO trae ni titulo ni marca. Asi que con ese fichero solo
-- es IMPOSIBLE saber que es de marca propia. Hace falta cruzarlo con el catalogo.
--
--
-- POR QUE UNA TABLA DE CATALOGO Y NO UN CAMPO EN CADA CALCULO
-- ----------------------------------------------------------
-- Porque el catalogo cambia constantemente: dan de alta productos nuevos todas
-- las semanas. Si el reparto por marca viviera dentro de cada calculo, cada mes
-- habria que volver a subir el informe de listados —28.000 lineas— solo para que
-- el ERP supiera de quien es cada ASIN.
--
-- Con esta tabla se sube el informe de listados CUANDO SE QUIERA, se acumula, y
-- a partir de ahi los calculos mensuales solo necesitan el informe de impuestos.
-- Las referencias nuevas entran la proxima vez que se suba el listado, y las
-- viejas no se pierden: es un upsert, no un reemplazo.
--
--
-- POR QUE LA MARCA SE GUARDA COMO PALABRA Y NO COMO LISTA DE ASIN
-- --------------------------------------------------------------
-- `clients.marca_propia` guarda «KESLEM» y se marca como propio todo listado que
-- lleve esa palabra en el titulo. Comprobado contra su catalogo real: 4.016 de
-- 25.943 listados la llevan.
--
-- La alternativa —una lista de ASIN de marca propia— hay que mantenerla a mano
-- cada vez que dan de alta un producto, y en un catalogo que crece cada semana
-- eso se queda desactualizado el primer mes. La palabra se mantiene sola.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS marca_propia TEXT;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tasa_marca_propia NUMERIC;

COMMENT ON COLUMN public.clients.marca_propia IS
  'La palabra que identifica la marca propia del cliente en el titulo del producto. NULL = no distingue marcas y se aplica base_commission_rate a todo.';
COMMENT ON COLUMN public.clients.tasa_marca_propia IS
  'La tasa de los productos de marca propia. El resto va a base_commission_rate. NULL = una sola tasa para todo.';

-- ---------- El catalogo por cliente ----------
CREATE TABLE IF NOT EXISTS public.commission_catalog (
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  sku TEXT,

  -- Recortado: lo que hace falta para reconocer el producto en el informe y para
  -- buscar la marca. Guardar titulos enteros de 250 caracteres por 26.000
  -- referencias son megas para enseñar algo que se lee de un vistazo.
  item_name TEXT,

  -- Se resuelve AL SUBIR y se guarda, en vez de mirarlo en cada calculo. Asi el
  -- reparto de un mes no cambia solo porque alguien renombre un producto tres
  -- meses despues: lo que se facturo se facturo con la marca que tenia entonces.
  es_marca_propia BOOLEAN NOT NULL DEFAULT false,

  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (client_id, asin)
);

CREATE INDEX IF NOT EXISTS commission_catalog_propia_idx
  ON public.commission_catalog (client_id, es_marca_propia);

COMMENT ON TABLE public.commission_catalog IS
  'Las referencias de cada cliente: ASIN, nombre y si es de marca propia. Se alimenta subiendo el «Informe de todos los listados» de su Seller Central, y se acumula: los productos nuevos entran y los viejos no se pierden. Sirve para partir la comision por marca, porque el informe de impuestos no trae marca.';

ALTER TABLE public.commission_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_catalog_todo ON public.commission_catalog;
CREATE POLICY commission_catalog_todo ON public.commission_catalog
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------- Keslem ----------
INSERT INTO public.clients (name, base_commission_rate, marca_propia, tasa_marca_propia)
VALUES ('Keslem', 0.02, 'KESLEM', 0.04)
ON CONFLICT DO NOTHING;

UPDATE public.clients
SET base_commission_rate = 0.02, marca_propia = 'KESLEM', tasa_marca_propia = 0.04
WHERE name = 'Keslem';

-- ---------- Comprobacion ----------
DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT name, base_commission_rate, marca_propia, tasa_marca_propia INTO r
  FROM public.clients WHERE name = 'Keslem';

  IF r IS NULL THEN
    RAISE EXCEPTION 'Keslem no se ha dado de alta.';
  END IF;

  RAISE NOTICE 'Listo. Keslem: %%% en terceros y %%% en marca «%». Sube su informe de listados para que el ERP sepa que ASIN son de cada una.',
    round(r.base_commission_rate * 100, 2), round(r.tasa_marca_propia * 100, 2), r.marca_propia;
END $$;
