-- =====================================================
-- MARKETING: productos y sus cifras semanales
-- =====================================================
-- El TACoS se estaba tecleando a mano en cada campaña y no podía salir bien:
-- es una métrica de PRODUCTO, no de campaña.
--
--   ACoS  = gasto de la campaña / ventas atribuidas a esa campaña
--   TACoS = gasto publicitario TOTAL del producto / ventas TOTALES del producto
--
-- Las ventas totales salen de Sellerboard y son del producto entero (orgánicas
-- + publicidad), así que no se pueden repartir entre las campañas que lo
-- anuncian. Un producto con cinco campañas tiene UN TACoS: la suma del gasto de
-- las cinco dividida entre sus ventas totales. Por eso las ventas totales y el
-- coste viven en una fila por producto y semana, y el TACoS se calcula, no se
-- escribe.
--
-- El enlace campaña -> producto sale del propio nombre de la campaña: la
-- convención de Liberty Seller es «ASIN | SKU | RESUMEN TITULO | TIPO DE
-- CAMPAÑA», por ejemplo «B104924910 | 942098».

-- ---------- Catálogo de productos ----------
-- Deliberadamente mínimo: ASIN, SKU y nombre. No es un maestro de artículos
-- (eso es Sellerboard / Seller Central), solo lo justo para agrupar campañas y
-- colgar de ahí las cifras semanales.
--
-- Solo el ASIN es obligatorio porque es la clave de enlace; el SKU y el nombre
-- se rellenan después sin bloquear el alta.
CREATE TABLE IF NOT EXISTS public.marketing_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.marketing_clients(id) ON DELETE CASCADE,
  /** Normalizado a mayúsculas y sin espacios por trg_marketing_products_normalize */
  asin TEXT NOT NULL,
  sku TEXT,
  name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- Por cliente y no global: el mismo ASIN puede estar en dos cuentas de
  -- vendedor distintas y cada una lleva sus propias campañas.
  UNIQUE (client_id, asin)
);

-- El UNIQUE de arriba solo sirve cuando ya se sabe el cliente. Al enlazar una
-- campaña se busca por ASIN suelto, así que hace falta su propio índice.
CREATE INDEX IF NOT EXISTS idx_marketing_products_asin
  ON public.marketing_products(asin);

-- El ASIN es la clave de enlace con las campañas: si entra con un espacio
-- delante o en minúsculas deja de casar y el producto se queda huérfano sin
-- que nadie se entere. Se normaliza en base de datos y no en la interfaz para
-- que dé igual desde dónde llegue la fila (formulario, importación, SQL a
-- mano).
CREATE OR REPLACE FUNCTION public.normalize_marketing_product_asin()
RETURNS TRIGGER AS $$
BEGIN
  NEW.asin = upper(regexp_replace(NEW.asin, '\s', '', 'g'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_products_normalize ON public.marketing_products;
CREATE TRIGGER trg_marketing_products_normalize
  BEFORE INSERT OR UPDATE ON public.marketing_products
  FOR EACH ROW EXECUTE FUNCTION public.normalize_marketing_product_asin();

-- ---------- Cifras del producto en una semana ----------
-- Una fila = lo que el producto vendió y costó en la semana de revisión, con
-- las mismas fechas que se filtraron en la consola de Amazon Ads. El flujo es:
-- se vuelcan las campañas desde Amazon Ads y luego, con ese mismo rango de
-- fechas en Sellerboard, se apunta aquí la venta total del producto.
--
-- El coste unitario se guarda semana a semana a propósito: el proveedor lo
-- sube o lo baja unos euros y hay que poder mirar atrás y ver con qué coste se
-- estaba trabajando cuando se tomó una decisión de puja.
CREATE TABLE IF NOT EXISTS public.marketing_product_weeks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.marketing_products(id) ON DELETE CASCADE,
  week_id UUID NOT NULL REFERENCES public.marketing_weeks(id) ON DELETE CASCADE,
  -- Sin DEFAULT 0, igual que las métricas de marketing_campaigns: NULL es «aún
  -- no volcado de Sellerboard» y 0 es una semana sin ventas. Con el TACoS esa
  -- diferencia es crítica, porque un 0 real no da TACoS (no se divide entre
  -- cero) mientras que un NULL solo significa que falta el dato.
  /** Ventas totales del producto según Sellerboard: orgánicas + publicidad */
  total_sales NUMERIC,
  units_sold INTEGER,
  /** Coste del producto esa semana, por unidad */
  unit_cost NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (product_id, week_id)
);

-- El UNIQUE ya deja product_id a la izquierda. Falta el camino contrario, que
-- es el que usa la pantalla: todos los productos de la semana que se revisa.
CREATE INDEX IF NOT EXISTS idx_marketing_product_weeks_week
  ON public.marketing_product_weeks(week_id);

-- Producto y semana cuelgan cada uno de su cliente por su lado, así que las dos
-- FKs no impiden cruzar el producto de un cliente con la semana de otro. Eso no
-- daría error en ningún sitio: simplemente saldría un TACoS calculado con las
-- ventas del cliente equivocado, que es justo el fallo que nadie detectaría.
CREATE OR REPLACE FUNCTION public.check_marketing_product_week_client()
RETURNS TRIGGER AS $$
DECLARE
  product_client UUID;
  week_client UUID;
BEGIN
  SELECT client_id INTO product_client
    FROM public.marketing_products WHERE id = NEW.product_id;
  SELECT client_id INTO week_client
    FROM public.marketing_weeks WHERE id = NEW.week_id;

  IF product_client IS DISTINCT FROM week_client THEN
    RAISE EXCEPTION 'El producto % y la semana % pertenecen a clientes distintos',
      NEW.product_id, NEW.week_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_product_weeks_client ON public.marketing_product_weeks;
CREATE TRIGGER trg_marketing_product_weeks_client
  BEFORE INSERT OR UPDATE ON public.marketing_product_weeks
  FOR EACH ROW EXECUTE FUNCTION public.check_marketing_product_week_client();

-- ---------- Enlace campaña -> producto ----------
-- NULL es un estado válido y esperado: una campaña recién creada, o una cuyo
-- nombre no sigue la convención, se queda sin producto hasta que alguien la
-- enlace a mano. SET NULL al borrar el producto porque la campaña y sus
-- métricas siguen siendo válidas sin él; lo único que se pierde es el TACoS.
ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.marketing_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_product
  ON public.marketing_campaigns(product_id);

-- El TACoS que hay en marketing_campaigns se queda, pero como dato histórico
-- de solo lectura. No se borra la columna porque esos números se tecleaban a
-- mano semana a semana y no hay forma de reconstruirlos: las filas de
-- marketing_product_weeks de las semanas ya cerradas no existen y nadie va a
-- volver a Sellerboard a rellenarlas hacia atrás. Borrarlo sería tirar el único
-- rastro que queda de lo que se le enseñó al cliente en su día.
--
-- La interfaz deja de mostrarlo y de dejarlo editar: el TACoS bueno se calcula
-- por producto a partir de marketing_product_weeks.total_sales. Que no se sume
-- entre campañas tampoco tenía sentido, porque el mismo producto aparece en
-- varias campañas y sus ventas totales se estarían contando repetidas.
COMMENT ON COLUMN public.marketing_campaigns.tacos IS
  'OBSOLETO. Valor tecleado a mano antes de la migración 109, se conserva solo como histórico. El TACoS real se calcula por producto: suma del gasto de sus campañas / marketing_product_weeks.total_sales.';

-- ---------- ASIN a partir del nombre de la campaña ----------
-- Las campañas se nombran «ASIN | SKU | RESUMEN TITULO | TIPO DE CAMPAÑA», así
-- que el ASIN de cabeza basta para saber qué producto anuncian sin mantener el
-- enlace a mano.
--
-- Se exige que el ASIN termine en algo que no sea alfanumérico (el « |», un
-- espacio) o en fin de cadena, para no morder los diez primeros caracteres de
-- un código más largo y dar por bueno un ASIN que no existe.
--
-- El check digit de un ISBN-10 puede ser una X, por eso el segundo patrón no es
-- diez dígitos limpios.
--
-- OJO: extractAsin() en lib/types/marketing.ts implementa esta misma regla para
-- que la interfaz pueda proponer el enlace al crear una campaña. Si se toca una,
-- hay que tocar la otra o el enlace que propone la UI dejará de coincidir con el
-- que hace la base de datos.
CREATE OR REPLACE FUNCTION public.marketing_campaign_asin(campaign_name TEXT)
RETURNS TEXT AS $$
  SELECT (regexp_match(
    upper(btrim(campaign_name)),
    '^(B[0-9A-Z]{9}|[0-9]{9}[0-9X])([^0-9A-Z]|$)'
  ))[1];
$$ LANGUAGE sql IMMUTABLE;

-- Enlace de lo que ya está cargado. El cliente se compara además del ASIN
-- porque el mismo ASIN puede existir en dos cuentas distintas; la campaña
-- pertenece al cliente de su semana.
UPDATE public.marketing_campaigns c
SET product_id = p.id
FROM public.marketing_weeks w,
     public.marketing_products p
WHERE c.week_id = w.id
  AND p.client_id = w.client_id
  AND p.asin = public.marketing_campaign_asin(c.name)
  AND c.product_id IS NULL;

-- ---------- updated_at ----------
DROP TRIGGER IF EXISTS trg_marketing_products_updated ON public.marketing_products;
CREATE TRIGGER trg_marketing_products_updated
  BEFORE UPDATE ON public.marketing_products
  FOR EACH ROW EXECUTE FUNCTION public.update_marketing_updated_at();

DROP TRIGGER IF EXISTS trg_marketing_product_weeks_updated ON public.marketing_product_weeks;
CREATE TRIGGER trg_marketing_product_weeks_updated
  BEFORE UPDATE ON public.marketing_product_weeks
  FOR EACH ROW EXECUTE FUNCTION public.update_marketing_updated_at();

-- ---------- RLS ----------
-- Mismo criterio que el resto del módulo (ver 103): equipo interno, que incluye
-- al especialista de PPC con rol 'employee'.
ALTER TABLE public.marketing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_product_weeks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team manages marketing products" ON public.marketing_products;
CREATE POLICY "Team manages marketing products"
  ON public.marketing_products FOR ALL TO authenticated
  USING (public.is_marketing_team(auth.uid()))
  WITH CHECK (public.is_marketing_team(auth.uid()));

DROP POLICY IF EXISTS "Team manages marketing product weeks" ON public.marketing_product_weeks;
CREATE POLICY "Team manages marketing product weeks"
  ON public.marketing_product_weeks FOR ALL TO authenticated
  USING (public.is_marketing_team(auth.uid()))
  WITH CHECK (public.is_marketing_team(auth.uid()));

-- Realtime: las cifras del producto se editan durante la misma revisión que las
-- campañas y el TACoS de la pantalla depende de ellas. Con guardia, porque
-- añadir una tabla que ya está en la publicación da error y en el editor SQL de
-- Supabase eso deshace la migración entera.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_products', 'marketing_product_weeks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
