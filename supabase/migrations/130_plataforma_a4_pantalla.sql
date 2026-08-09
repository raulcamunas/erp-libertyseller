-- =====================================================
-- 130 · MÓDULO A4 — LA CONSULTA DE LA PANTALLA
-- =====================================================
-- La 129 creó lo que hay que GUARDAR de A4 (el impuesto de cada marketplace,
-- los umbrales del cliente y a qué canal se pidió cada tarifa). Esta crea lo
-- único que faltaba para poder PINTARLO: la consulta que reúne, para cada
-- referencia de una cuenta y un país, la última foto de cada cosa.
--
--
-- ============ POR QUÉ ESTO ES UNA FUNCIÓN Y NO CINCO CONSULTAS ============
--
-- El análisis se calcula al vuelo —la 129 explica por qué no hay tabla de
-- resultados— y necesita, POR CADA SKU, la última fila de cinco series
-- distintas: el diagnóstico de Buy Box, la estimación de tarifas del escenario
-- propio, la del escenario de Amazon, el ranking y si alguna vez hubo una
-- tarifa salida del informe Fee Preview.
--
-- Hacerlo desde TypeScript obliga a traerse la VENTANA ENTERA de cada serie y
-- quedarse con la primera fila de cada SKU en memoria. Con el cliente de 13.700
-- referencias y una ventana de treinta noches eso son cuatrocientas mil filas
-- por la red para leer trece mil. Funciona el primer mes y revienta justo
-- cuando el histórico empieza a servir para algo — que es el mismo motivo por el
-- que la 125 y la 126 bajaron sus recuentos a Postgres.
--
-- Aquí cada serie se resuelve con un LATERAL … ORDER BY fecha DESC LIMIT 1
-- sobre el índice que ya existe: una fila leída por SKU y por serie.
--
--
-- ============ LO QUE ESTA FUNCIÓN NO HACE, Y ES A PROPÓSITO ============
--
-- NO DECIDE NADA. No calcula margen, no aplica umbrales y no emite veredictos.
-- Devuelve datos crudos y ya está. Todo el juicio vive en
-- lib/plataforma/fbmfba/*.ts, que son funciones puras que se comprueban caso a
-- caso con scripts/check-margen-fbmfba.ts sin levantar ni la base de datos.
-- Repartir la decisión entre SQL y TypeScript es como se llega a que el número
-- de la pantalla y el del informe no cuadren y nadie sepa cuál está mal.
--
-- NO AGREGA VENTAS. Cuando hay varias fuentes para el mismo (SKU, día) gana la
-- más fiable, y ese orden lo fija lib/plataforma/ventas.ts —que además es la
-- interfaz que la Fase B sustituye por el informe de Amazon sin que A4 se
-- entere—. Escribirlo también aquí sería tener la misma regla en dos sitios.
--
-- Se lanza en el editor SQL de Supabase, DESPUÉS de la 129.
-- IDEMPOTENTE: se puede volver a pegar sin romper nada.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción: un fallo
-- a la mitad deshace lo anterior. Mejor negarse aquí, con el nombre del fichero
-- que hay que lanzar antes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'amazon_fees_estimados' AND column_name = 'canal'
  ) THEN
    RAISE EXCEPTION
      'Falta amazon_fees_estimados.canal. Lanza antes 129_plataforma_a4_fbm_fba.sql: sin el canal, una tarifa sin logística de Amazon significa a la vez "se pidió como envío propio" y "se pidió como FBA y no vino", y A4 compararía el escenario de hoy contra sí mismo.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_buybox_diagnostico'
  ) THEN
    RAISE EXCEPTION
      'No existe public.amazon_buybox_diagnostico. Lanza antes 126_plataforma_a2_buybox.sql: sin saber quién tiene hoy la oferta destacada, el precio de referencia de Amazon no se puede interpretar y A4 calcularía el margen al precio equivocado.';
  END IF;
END $$;

-- =====================================================
-- 1) EL ÍNDICE QUE HACE QUE ESTO SEA BARATO
-- =====================================================
-- El ranking se consulta por (vendedor, país, SKU) y se quiere el último. El
-- índice de la 123 ya lo cubre; este añade el tipo, porque A4 prefiere SIEMPRE
-- el ranking de la categoría raíz —que es el que sirve para comparar rotación—
-- y solo baja al de la subcategoría cuando no hay ninguno del primero.
CREATE INDEX IF NOT EXISTS idx_amazon_snap_bsr_tipo
  ON public.amazon_snapshots_bsr(selling_partner_id, marketplace_id, sku, tipo, fecha DESC);

-- =====================================================
-- 2) LA CONSULTA
-- =====================================================
-- El DROP previo no sobra: CREATE OR REPLACE FUNCTION no puede cambiar el tipo
-- de retorno, así que sin él la segunda vez que se lance esto con una columna
-- nueva falla con un mensaje que no dice qué pasa.
DROP FUNCTION IF EXISTS public.plataforma_fbmfba_datos(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER);

CREATE FUNCTION public.plataforma_fbmfba_datos(
  p_connection_id UUID,
  p_selling_partner_id TEXT,
  p_marketplace_id TEXT,
  p_dias_vigencia INTEGER DEFAULT 7,
  p_desde INTEGER DEFAULT 0,
  p_limite INTEGER DEFAULT 1000
)
RETURNS TABLE (
  sku TEXT,
  asin TEXT,
  titulo TEXT,
  marca TEXT,

  /* Se devuelve el CÓDIGO CRUDO y no un booleano. `is_fba` es una columna
     generada que vale FALSE tanto para «lo envía el cliente» como para «no
     consta el canal», y esos dos casos son un candidato y un dato que falta */
  fulfillment_channel_code TEXT,
  en_seguimiento BOOLEAN,
  clasificacion_item TEXT,

  precio NUMERIC,
  moneda TEXT,

  /* Si hay medidas DEL EMBALAJE, que es sobre lo que se calcula la tarifa de
     FBA. Las del producto no sirven para eso */
  hay_medidas BOOLEAN,
  dims_origen TEXT,

  buybox_estado TEXT,
  amazon_estado TEXT,
  /* De dónde sale la distinción entre Prime del vendedor (SFP) y envío normal:
     el informe de listings dice 'DEFAULT' para los dos y solo la lectura de
     ofertas los separa */
  canal_propio TEXT,
  foep NUMERIC,
  foep_estado TEXT,
  foep_resultado TEXT,
  foep_fecha TIMESTAMPTZ,
  diagnostico_fecha TIMESTAMPTZ,

  fee_propio_precio NUMERIC,
  fee_propio_moneda TEXT,
  fee_propio_referral NUMERIC,
  fee_propio_fba NUMERIC,
  fee_propio_otras NUMERIC,
  fee_propio_origen TEXT,
  fee_propio_fecha TIMESTAMPTZ,

  fee_fba_precio NUMERIC,
  fee_fba_moneda TEXT,
  fee_fba_referral NUMERIC,
  fee_fba_fba NUMERIC,
  fee_fba_otras NUMERIC,
  fee_fba_origen TEXT,
  fee_fba_fecha TIMESTAMPTZ,

  /* Hay alguna estimación salida del informe Fee Preview de Amazon. Es la ÚNICA
     evidencia posible de que el producto ha pasado por un centro logístico y
     de que Amazon ha cobrado con esas medidas — y solo se da en SKU que YA
     están en FBA, que es justo lo que A4 no tiene que evaluar */
  hay_fee_preview BOOLEAN,

  /* Estimaciones guardadas SIN canal: son anteriores a la 129 y no se pueden
     usar, porque no se sabe a qué escenario se pidieron. Se cuenta para poder
     decirlo en pantalla en vez de que la referencia salga «sin tarifas» sin
     más */
  fees_sin_canal BIGINT,

  bsr INTEGER,
  bsr_tipo TEXT,
  bsr_categoria TEXT,
  bsr_fecha TIMESTAMPTZ,

  total BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH catalogo AS (
    SELECT
      l.sku, l.asin, l.title, l.marca, l.fulfillment_channel_code,
      COALESCE(l.activo_manual, l.activo_calculado) AS seguimiento,
      l.clasificacion_item, l.price, l.currency, l.dims_origen,
      (
        l.peso_paquete IS NOT NULL
        OR (l.largo_paquete IS NOT NULL AND l.ancho_paquete IS NOT NULL AND l.alto_paquete IS NOT NULL)
      ) AS medidas,
      COUNT(*) OVER () AS total
    FROM public.amazon_listings l
    WHERE l.connection_id = p_connection_id
      AND l.marketplace_id = p_marketplace_id
      -- Un VARIATION_PARENT no se compra ni se vende: es el nodo que agrupa las
      -- tallas. Meterlo en un análisis de margen ensucia las cifras sin que se
      -- note, porque parece un producto más.
      AND (l.clasificacion_item IS NULL OR l.clasificacion_item <> 'VARIATION_PARENT')
    ORDER BY l.sku
    OFFSET GREATEST(p_desde, 0)
    LIMIT GREATEST(p_limite, 1)
  )
  SELECT
    c.sku, c.asin, c.title, c.marca,
    c.fulfillment_channel_code, c.seguimiento, c.clasificacion_item,
    c.price, c.currency,
    c.medidas, c.dims_origen,

    d.buybox_estado, d.amazon_estado,
    NULLIF(d.datos->>'canalPropio', ''),
    d.foep, d.foep_estado, NULLIF(d.datos->>'foepResultado', ''),
    d.foep_fecha, d.fecha,

    fp.precio_referencia, fp.moneda, fp.referral_fee, fp.fba_fee, fp.otras_fees,
    fp.origen, fp.fecha,

    ff.precio_referencia, ff.moneda, ff.referral_fee, ff.fba_fee, ff.otras_fees,
    ff.origen, ff.fecha,

    COALESCE(pv.hay, FALSE),
    COALESCE(sc.n, 0),

    b.rank, b.tipo, b.categoria, b.fecha,

    c.total
  FROM catalogo c

  /* El diagnóstico de Buy Box. Con ventana: uno de hace tres semanas no es un
     diagnóstico, es un recuerdo, y usarlo haría que A4 interpretara el techo de
     Amazon con una foto de quién tenía la oferta destacada que ya no vale */
  LEFT JOIN LATERAL (
    SELECT d.buybox_estado, d.amazon_estado, d.datos, d.foep, d.foep_estado,
           d.foep_fecha, d.fecha
    FROM public.amazon_buybox_diagnostico d
    WHERE d.connection_id = p_connection_id
      AND d.marketplace_id = p_marketplace_id
      AND d.sku = c.sku
      AND d.fecha >= NOW() - make_interval(days => GREATEST(p_dias_vigencia, 1))
    ORDER BY d.fecha DESC, d.id DESC
    LIMIT 1
  ) d ON TRUE

  /* Las tarifas del escenario de HOY. SIN ventana a propósito: una tarifa no
     caduca por vieja, deja de servir cuando el precio se mueve, y de eso se
     encarga la tolerancia de margen.ts comparando `precio_referencia` con el
     precio que se evalúa */
  LEFT JOIN LATERAL (
    SELECT f.precio_referencia, f.moneda, f.referral_fee, f.fba_fee, f.otras_fees,
           f.origen, f.fecha
    FROM public.amazon_fees_estimados f
    WHERE f.connection_id = p_connection_id
      AND f.marketplace_id = p_marketplace_id
      AND f.sku = c.sku
      AND f.canal = 'propio'
    ORDER BY f.fecha DESC, f.id DESC
    LIMIT 1
  ) fp ON TRUE

  /* Las del escenario de Amazon. Hay que PEDIRLAS marcando ese canal: para una
     referencia que hoy envía el cliente, la estimación normal no trae la tarifa
     de logística, que es justo el número que decide esta migración */
  LEFT JOIN LATERAL (
    SELECT f.precio_referencia, f.moneda, f.referral_fee, f.fba_fee, f.otras_fees,
           f.origen, f.fecha
    FROM public.amazon_fees_estimados f
    WHERE f.connection_id = p_connection_id
      AND f.marketplace_id = p_marketplace_id
      AND f.sku = c.sku
      AND f.canal = 'fba'
    ORDER BY f.fecha DESC, f.id DESC
    LIMIT 1
  ) ff ON TRUE

  LEFT JOIN LATERAL (
    SELECT TRUE AS hay
    FROM public.amazon_fees_estimados f
    WHERE f.connection_id = p_connection_id
      AND f.marketplace_id = p_marketplace_id
      AND f.sku = c.sku
      AND f.origen = 'fee_preview'
    LIMIT 1
  ) pv ON TRUE

  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS n
    FROM public.amazon_fees_estimados f
    WHERE f.connection_id = p_connection_id
      AND f.marketplace_id = p_marketplace_id
      AND f.sku = c.sku
      AND f.canal IS NULL
  ) sc ON TRUE

  /* El ranking. Se prefiere SIEMPRE el de la categoría raíz —el número grande,
     el que sirve para comparar rotación— y solo se baja al de la subcategoría
     cuando no hay ninguno del primero. Mezclarlos haría la columna
     ininterpretable: un 113 y un 72.855 no significan lo mismo */
  LEFT JOIN LATERAL (
    SELECT s.rank, s.tipo, s.categoria, s.fecha
    FROM public.amazon_snapshots_bsr s
    WHERE s.selling_partner_id = p_selling_partner_id
      AND s.marketplace_id = p_marketplace_id
      AND s.sku = c.sku
    ORDER BY (s.tipo <> 'grupo'), s.fecha DESC
    LIMIT 1
  ) b ON TRUE

  ORDER BY c.sku
$$;

COMMENT ON FUNCTION public.plataforma_fbmfba_datos(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) IS
  'Reúne, por SKU de una cuenta y un país, la última foto del diagnóstico de Buy Box, de las tarifas de cada escenario y del ranking. NO decide nada: el margen, los umbrales y el veredicto viven en lib/plataforma/fbmfba/*.ts, que son funciones puras y se comprueban sin base de datos.';

-- Solo el servidor. Una SECURITY DEFINER aquí convertiría a cualquiera con
-- sesión en alguien que puede leer los precios y el catálogo de dieciséis
-- tiendas ajenas.
REVOKE ALL ON FUNCTION public.plataforma_fbmfba_datos(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- =====================================================
-- 3) COMPROBACIÓN FINAL
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'plataforma_fbmfba_datos'
  ) THEN
    RAISE EXCEPTION 'plataforma_fbmfba_datos() no se ha creado.';
  END IF;

  RAISE NOTICE '130 aplicada: A4 ya puede leer su pantalla.';
END $$;
