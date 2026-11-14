-- 300 · TAX REPORTS: UN SEGUNDO FICHERO POR MES (Shoplamp: el Sellerboard del envío)
--
-- Shoplamp paga el 5 % de lo que su facturación neta del mes supera 3.500 €. Desde noviembre de 2026 se le resta antes el coste de
-- envío del mes, que el tax report de Amazon no trae: sale de la columna «Shipping» del «Tablero de productos» de Sellerboard. Ese
-- Excel se cuelga EN LA MISMA CELDA DEL MES que el tax report, al lado, y la liquidación de comisiones coge los dos.
--
-- Hasta ahora una celda era un fichero: UNIQUE (cliente_id, anio, mes). Ahora cada fichero dice en qué hueco va:
--   · 'principal' el de siempre (todas las filas que ya hay).
--   · 'segundo'   el de al lado, solo en los clientes que lo tienen abierto (`tax_report_clientes.segundo_fichero` dice cómo se llama).
--
-- Se puede lanzar dos veces sin romper nada.

-- 1) Cómo se llama el segundo fichero de un cliente. NULL = no tiene segundo hueco.
ALTER TABLE public.tax_report_clientes
  ADD COLUMN IF NOT EXISTS segundo_fichero TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_report_clientes_segundo_fichero_no_vacio') THEN
    ALTER TABLE public.tax_report_clientes
      ADD CONSTRAINT tax_report_clientes_segundo_fichero_no_vacio CHECK (segundo_fichero IS NULL OR btrim(segundo_fichero) <> '');
  END IF;
END $$;

COMMENT ON COLUMN public.tax_report_clientes.segundo_fichero IS
  'Si el cliente cuelga un segundo fichero cada mes al lado del principal, cómo se llama (Shoplamp: «Sellerboard (envío)»). NULL = solo uno.';

-- 2) En qué hueco va cada fichero
ALTER TABLE public.tax_report_ficheros
  ADD COLUMN IF NOT EXISTS ranura TEXT NOT NULL DEFAULT 'principal';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_report_ficheros_ranura_valida') THEN
    ALTER TABLE public.tax_report_ficheros
      ADD CONSTRAINT tax_report_ficheros_ranura_valida CHECK (ranura IN ('principal', 'segundo'));
  END IF;
END $$;

-- 3) Una celda, un fichero POR HUECO. Se quita el UNIQUE (cliente_id, anio, mes), se llame como se llame, y se pone el de cuatro columnas.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.tax_report_ficheros'::regclass
       AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(c.conkey) k
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
           = ARRAY['anio', 'cliente_id', 'mes']
  LOOP
    EXECUTE format('ALTER TABLE public.tax_report_ficheros DROP CONSTRAINT %I', r.conname);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_report_ficheros_celda_ranura') THEN
    ALTER TABLE public.tax_report_ficheros
      ADD CONSTRAINT tax_report_ficheros_celda_ranura UNIQUE (cliente_id, anio, mes, ranura);
  END IF;
END $$;

-- 4) Shoplamp abre el hueco del Sellerboard
UPDATE public.tax_report_clientes
   SET segundo_fichero = 'Sellerboard (envío)'
 WHERE segundo_fichero IS NULL
   AND (client_id = (SELECT id FROM public.clients WHERE name = 'SHOPLAMP' LIMIT 1) OR upper(btrim(nombre)) = 'SHOPLAMP');

-- Comprobación: debe salir SHOPLAMP con «Sellerboard (envío)» y el UNIQUE nuevo
SELECT nombre, segundo_fichero FROM public.tax_report_clientes WHERE segundo_fichero IS NOT NULL;
SELECT conname FROM pg_constraint WHERE conrelid = 'public.tax_report_ficheros'::regclass AND contype = 'u';
