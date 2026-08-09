-- =====================================================
-- 125 · LAS TRES PREGUNTAS QUE LAS PANTALLAS DE A1 NO PUEDEN HACER DESDE FUERA
-- =====================================================
-- La migración 123 montó el esquema del módulo A1. Esta no añade ni una tabla ni
-- una columna: añade TRES FUNCIONES DE SOLO LECTURA, y existe por un motivo muy
-- concreto que conviene entender antes de tocar nada.
--
--
-- ============ POR QUÉ ESTO NO SE PUEDE HACER CON CONSULTAS NORMALES ============
--
-- Las pantallas de A1 tienen que contestar tres preguntas:
--
--   1. «De los SKU de este cliente, ¿cuántos tienen BSR? ¿Y lectura de
--      inventario?» — o sea, LA COBERTURA DE DATOS, que es la que dice de qué
--      análisis se puede uno fiar.
--   2. «¿Cuándo terminó bien por última vez cada refresco, cuenta por cuenta?»
--   3. «¿Cuántos trabajos vivos y cuántas incidencias abiertas tiene cada
--      cliente?»
--
-- Las tres son AGREGACIONES sobre tablas que crecen para siempre. La primera es
-- la peor: «cuántos SKU tienen al menos un snapshot de BSR» no se puede
-- responder desde PostgREST sin traerse las filas, y en ShoesF eso son 13.700
-- referencias × 30 días de serie. Traerse cien mil filas al servidor de Node
-- para contar trece mil valores distintos es la clase de consulta que funciona
-- el primer mes y revienta justo cuando el histórico empieza a servir para algo.
--
-- Aquí se resuelve donde tiene que resolverse: dentro de Postgres, con los
-- índices que la 123 ya creó —(selling_partner_id, marketplace_id, sku, fecha
-- DESC) en las dos series— y devolviendo una fila por unidad de trabajo en vez
-- de cien mil.
--
--
-- ============ CUMPLIMIENTO ANTE AMAZON ============
--
-- Las tres funciones aceptan `p_client_id` y NINGUNA agrega, compara ni ordena
-- nada entre clientes. `plataforma_resumen_ingesta` admite NULL para devolver
-- una fila POR CADA cliente, y eso es exactamente lo que permite el compromiso
-- firmado: métricas de cada cuenta POR SEPARADO. No hay medias, no hay totales
-- del conjunto y no hay ningún ORDER BY que ponga a un cliente por delante de
-- otro por sus cifras. Si algún día alguien quiere «los clientes con peor
-- cobertura primero», eso es un ranking cruzando cuentas y NO se puede hacer
-- aquí: hay que pararse y decirlo.
--
-- Y lo que devuelven las tres son datos NUESTROS del proceso —cuántas filas
-- tenemos, cuándo las leímos, qué trabajos hay en la cola—, no datos de negocio
-- de ninguna tienda.
--
--
-- ============ POR QUÉ SON FUNCIONES Y NO VISTAS ============
--
-- Porque una vista no lleva parámetros, y el parámetro es lo que hace que la
-- consulta sea barata: sin `p_client_id` dentro del plan, Postgres calcularía la
-- cobertura de los dieciséis clientes para enseñar la de uno.
--
-- Van con SECURITY INVOKER (el valor por omisión, escrito explícito para que se
-- vea) y con el EXECUTE retirado a `anon` y a `authenticated`. Solo las llama el
-- servidor con service_role. Una función SECURITY DEFINER aquí sería un agujero:
-- convertiría a cualquiera con sesión en alguien que puede contar el catálogo de
-- todos los clientes.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción: reventar
-- aquí deja la base intacta en vez de a medias.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_snapshots_bsr'
  ) THEN
    RAISE EXCEPTION
      'No existen las tablas del módulo A1. Lanza antes 123_plataforma_a1.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'amazon_listings'
      AND column_name = 'activo_calculado'
  ) THEN
    RAISE EXCEPTION
      'A amazon_listings le faltan las columnas de seguimiento. Lanza antes 123_plataforma_a1.sql.';
  END IF;
END $$;


-- =====================================================
-- 1 · COBERTURA DE DATOS
-- =====================================================
-- Una fila por unidad de trabajo (conexión × marketplace), que es el grano al
-- que se leen los datos: el mismo SKU tiene stock y ranking distintos en España
-- y en Francia.
--
--
-- LAS DOS VENTANAS, Y POR QUÉ NO SON LA MISMA
-- -------------------------------------------
-- «Tiene BSR» no significa «alguna vez tuvo»: significa «lo hemos leído
-- últimamente». Un SKU cuyo último ranking es de febrero NO está cubierto, está
-- abandonado, y contarlo como cubierto es justo la mentira que esta pantalla
-- existe para evitar. Por eso hay ventana, y por eso son dos: el BSR se planifica
-- a diario pero se tolera un mes (una serie con huecos sigue siendo una serie),
-- mientras que el inventario se pregunta cada noche y a los siete días sin leer
-- ya no sirve para decidir una reposición.
--
-- Las dos son PARÁMETROS con valor por omisión, no constantes: el día que el
-- refresco cambie de cadencia, esto no hay que tocarlo.
--
--
-- EL INVENTARIO SE CUENTA EN CUATRO CAJONES Y NO EN DOS
-- ----------------------------------------------------
-- Es la lección más cara de todo A1 y aquí también aplica. FBA Inventory NO
-- devuelve los SKU gestionados por el vendedor, así que:
--
--   conocido    -> es de FBA y tenemos sus existencias
--   no_aplica   -> es FBM. NO es un agujero de cobertura: es la respuesta
--                  correcta, y en ShoesF va a ser el 90 % del catálogo
--   desconocido -> se intentó y no se pudo. ESTO SÍ es un agujero
--   sin_leer    -> nunca se ha mirado dentro de la ventana. También lo es
--
-- Con dos cajones, un cliente mayoritariamente FBM aparecería con un 10 % de
-- cobertura de inventario y alguien saldría a arreglar algo que no está roto.
--
-- Se mira el snapshot MÁS RECIENTE de cada SKU (LATERAL ... ORDER BY fecha DESC
-- LIMIT 1) y no «si existe alguno de cada clase», porque un SKU que ayer no se
-- pudo leer y hoy sí está cubierto hoy: lo que vale es la última palabra.
--
-- El DROP previo no sobra: `CREATE OR REPLACE FUNCTION` NO puede cambiar el tipo
-- de retorno, así que el día que a esta tabla se le añada una columna, volver a
-- lanzar el fichero fallaría con «cannot change return type of existing
-- function» y quien lo lanzara pensaría que la migración está rota. Con el DROP
-- delante, este fichero se puede relanzar siempre.
DROP FUNCTION IF EXISTS public.plataforma_cobertura_a1(UUID, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.plataforma_cobertura_a1(
  p_client_id UUID,
  p_dias_bsr INTEGER DEFAULT 30,
  p_dias_inventario INTEGER DEFAULT 7
)
RETURNS TABLE (
  connection_id UUID,
  connection_name TEXT,
  selling_partner_id TEXT,
  marketplace_id TEXT,
  total BIGINT,
  en_seguimiento BIGINT,
  fba BIGINT,
  fbm BIGINT,
  a_la_venta BIGINT,
  con_asin BIGINT,
  con_precio BIGINT,
  con_atributos BIGINT,
  con_marca BIGINT,
  con_categoria BIGINT,
  con_dimensiones BIGINT,
  con_dimensiones_amazon BIGINT,
  con_bsr BIGINT,
  inv_conocido BIGINT,
  inv_no_aplica BIGINT,
  inv_desconocido BIGINT,
  inv_sin_leer BIGINT,
  catalogo_ultimo TIMESTAMPTZ,
  bsr_ultimo TIMESTAMPTZ,
  inv_ultimo TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.selling_partner_id,
    l.marketplace_id,
    count(*),

    -- El valor efectivo de «en seguimiento» es COALESCE(activo_manual,
    -- activo_calculado): lo que dijo una persona gana siempre sobre lo que
    -- calculó la regla. Un count sobre activo_calculado a secas se saltaría la
    -- decisión manual sin que nadie lo notara, que es la misma trampa que
    -- documenta soloEnSeguimiento() en lib/plataforma/catalogo.ts.
    count(*) FILTER (WHERE COALESCE(l.activo_manual, l.activo_calculado)),
    count(*) FILTER (WHERE l.is_fba),
    count(*) FILTER (WHERE NOT l.is_fba),
    count(*) FILTER (WHERE 'BUYABLE' = ANY (l.listing_status)),
    count(*) FILTER (WHERE l.asin IS NOT NULL),
    count(*) FILTER (WHERE l.price IS NOT NULL AND l.price > 0),

    -- «Tiene atributos» = searchCatalogItems ha pasado por este SKU. Es
    -- catalogo_visto_at y no last_seen_at: el segundo lo mueve el barrido de
    -- quince minutos y estaría al día siempre, diciendo que hay cobertura de
    -- algo que no se ha leído nunca.
    count(*) FILTER (WHERE l.catalogo_visto_at IS NOT NULL),
    count(*) FILTER (WHERE l.marca IS NOT NULL),
    count(*) FILTER (WHERE l.categoria IS NOT NULL),

    -- Dimensiones DEL EMBALAJE, que son las que usa Amazon para calcular la
    -- tarifa de FBA. Las del producto no sirven para eso, así que contarlas
    -- aquí daría una cobertura optimista justo en el dato del que depende A4.
    count(*) FILTER (
      WHERE l.peso_paquete IS NOT NULL
         OR (l.largo_paquete IS NOT NULL AND l.ancho_paquete IS NOT NULL AND l.alto_paquete IS NOT NULL)
    ),
    -- Y de esas, las CERTIFICADAS por Amazon. La regla 4 del §3.5 de la
    -- especificación pide poder distinguirlas de las que midió alguien a ojo,
    -- porque su estimación de tarifa no vale lo mismo.
    count(*) FILTER (
      WHERE l.dims_origen = 'amazon'
        AND (l.peso_paquete IS NOT NULL OR l.largo_paquete IS NOT NULL)
    ),

    count(*) FILTER (WHERE bsr.fecha IS NOT NULL),
    count(*) FILTER (WHERE inv.estado_dato = 'conocido'),
    count(*) FILTER (WHERE inv.estado_dato = 'no_aplica'),
    count(*) FILTER (WHERE inv.estado_dato = 'desconocido'),
    count(*) FILTER (WHERE inv.estado_dato IS NULL),

    max(l.catalogo_visto_at),
    max(bsr.fecha),
    max(inv.fecha)

  FROM public.amazon_connections c
  JOIN public.amazon_listings l ON l.connection_id = c.id

  -- El último ranking de cada SKU dentro de la ventana. El LEFT JOIN LATERAL con
  -- LIMIT 1 usa el índice (selling_partner_id, marketplace_id, sku, fecha DESC)
  -- de la 123: es un descenso de árbol por SKU, no un recorrido de la serie.
  --
  -- Se cruza por los TRES CAMPOS CONGELADOS (vendedor, marketplace, SKU) y no
  -- por listing_id, y eso tampoco es un capricho: las series no tienen clave
  -- ajena a propósito —purgeMissingListings() borra listings de verdad— así que
  -- listing_id puede estar apuntando a nada mientras la identidad congelada
  -- sigue siendo correcta.
  LEFT JOIN LATERAL (
    SELECT s.fecha
    FROM public.amazon_snapshots_bsr s
    WHERE s.selling_partner_id = c.selling_partner_id
      AND s.marketplace_id = l.marketplace_id
      AND s.sku = l.sku
      AND s.fecha >= now() - make_interval(days => GREATEST(p_dias_bsr, 1))
    ORDER BY s.fecha DESC
    LIMIT 1
  ) bsr ON TRUE

  LEFT JOIN LATERAL (
    SELECT s.estado_dato, s.fecha
    FROM public.amazon_snapshots_inventario s
    WHERE s.selling_partner_id = c.selling_partner_id
      AND s.marketplace_id = l.marketplace_id
      AND s.sku = l.sku
      AND s.fecha >= now() - make_interval(days => GREATEST(p_dias_inventario, 1))
    ORDER BY s.fecha DESC
    LIMIT 1
  ) inv ON TRUE

  WHERE c.client_id = p_client_id
  GROUP BY c.id, c.name, c.selling_partner_id, l.marketplace_id
  ORDER BY c.name, l.marketplace_id;
$$;

COMMENT ON FUNCTION public.plataforma_cobertura_a1(UUID, INTEGER, INTEGER) IS
  'Cobertura de datos de A1 por unidad de trabajo (conexión × marketplace): cuántos SKU tienen atributos, dimensiones de embalaje, BSR y lectura de inventario. El inventario va en cuatro cajones porque «no_aplica» (FBM) no es un agujero de cobertura: es la respuesta correcta. Solo para el cliente que se le pasa; nunca agrega entre clientes.';


-- =====================================================
-- 2 · CUÁNDO TERMINÓ BIEN CADA REFRESCO
-- =====================================================
-- Es la pregunta «¿cuándo fue el último barrido completo y el último diario?»,
-- que es la primera que se hace quien abre la pantalla de ingesta.
--
-- TRES FILTROS QUE PARECEN DETALLES Y DECIDEN SI EL DATO ES VERDAD:
--
--   · SOLO 'terminado'. Un trabajo que acabó en error no es un barrido hecho.
--     Es la misma regla que aplica ultimosTerminados() en el planificador, y por
--     el mismo motivo: si contara, un cliente cuyo censo falla cada noche
--     parecería al día.
--   · SOLO skus_filtro IS NULL. Un trabajo de prueba sobre veinte referencias no
--     puede hacer creer que el catálogo entero está fresco.
--   · DISTINCT ON por (cliente, tipo, conexión, marketplace), que es el grano al
--     que se planifica. Un solo «último censo» por cliente escondería que el de
--     Francia lleva tres semanas sin correr.
DROP FUNCTION IF EXISTS public.plataforma_ultimos_refrescos(UUID);
CREATE OR REPLACE FUNCTION public.plataforma_ultimos_refrescos(
  p_client_id UUID DEFAULT NULL
)
RETURNS TABLE (
  client_id UUID,
  tipo TEXT,
  connection_id UUID,
  marketplace_id TEXT,
  terminado_at TIMESTAMPTZ,
  job_id UUID,
  procesados INTEGER,
  omitidos INTEGER,
  errores INTEGER,
  resumen TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (j.client_id, j.tipo, j.connection_id, j.marketplace_id)
    j.client_id,
    j.tipo,
    j.connection_id,
    j.marketplace_id,
    j.terminado_at,
    j.id,
    j.procesados,
    j.omitidos,
    j.errores,
    j.resumen
  FROM public.amazon_jobs j
  WHERE j.estado = 'terminado'
    AND j.terminado_at IS NOT NULL
    AND j.skus_filtro IS NULL
    AND (p_client_id IS NULL OR j.client_id = p_client_id)
  ORDER BY j.client_id, j.tipo, j.connection_id, j.marketplace_id, j.terminado_at DESC;
$$;

COMMENT ON FUNCTION public.plataforma_ultimos_refrescos(UUID) IS
  'El último trabajo TERMINADO de cada (cliente, tipo, conexión, marketplace), sin contar los de subconjunto de prueba. Es lo que contesta «cuándo fue el último barrido completo y el último diario».';


-- =====================================================
-- 3 · EL RESUMEN DE INGESTA DE CADA CLIENTE
-- =====================================================
-- Una fila por cliente con lo que hace falta para el selector: si se está
-- moviendo algo, si algo se ha roto, si hay incidencias sin mirar.
--
-- TODO LO QUE CUENTA ES NUESTRO: filas de amazon_jobs y amazon_eventos, que son
-- del ERP. Ni un dato de negocio de ninguna tienda, y ni una comparación entre
-- clientes: son dieciséis filas independientes que la pantalla pinta una debajo
-- de otra.
--
-- Los errores se cuentan en una VENTANA de 24 horas y no desde el principio de
-- los tiempos: un contador que sube y nunca baja deja de mirarse en una semana.
DROP FUNCTION IF EXISTS public.plataforma_resumen_ingesta(UUID);
CREATE OR REPLACE FUNCTION public.plataforma_resumen_ingesta(
  p_client_id UUID DEFAULT NULL
)
RETURNS TABLE (
  client_id UUID,
  pendientes BIGINT,
  en_curso BIGINT,
  pausados BIGINT,
  errores_24h BIGINT,
  eventos_abiertos BIGINT,
  eventos_graves_abiertos BIGINT,
  ultimo_movimiento TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH trabajos AS (
    SELECT
      j.client_id,
      count(*) FILTER (WHERE j.estado = 'pendiente') AS pendientes,
      count(*) FILTER (WHERE j.estado = 'en_curso') AS en_curso,
      count(*) FILTER (WHERE j.estado = 'pausado') AS pausados,
      count(*) FILTER (
        WHERE j.estado = 'error' AND j.terminado_at >= now() - interval '24 hours'
      ) AS errores_24h,
      max(GREATEST(
        COALESCE(j.progreso_at, j.updated_at),
        COALESCE(j.terminado_at, j.updated_at)
      )) AS ultimo_movimiento
    FROM public.amazon_jobs j
    WHERE p_client_id IS NULL OR j.client_id = p_client_id
    GROUP BY j.client_id
  ),
  incidencias AS (
    SELECT
      e.client_id,
      count(*) AS abiertos,
      count(*) FILTER (WHERE e.severidad IN ('error', 'critico')) AS graves
    FROM public.amazon_eventos e
    WHERE e.resuelto = false
      AND e.client_id IS NOT NULL
      AND (p_client_id IS NULL OR e.client_id = p_client_id)
    GROUP BY e.client_id
  )
  SELECT
    cl.id,
    COALESCE(t.pendientes, 0),
    COALESCE(t.en_curso, 0),
    COALESCE(t.pausados, 0),
    COALESCE(t.errores_24h, 0),
    COALESCE(i.abiertos, 0),
    COALESCE(i.graves, 0),
    t.ultimo_movimiento
  FROM public.amazon_clients cl
  LEFT JOIN trabajos t ON t.client_id = cl.id
  LEFT JOIN incidencias i ON i.client_id = cl.id
  WHERE p_client_id IS NULL OR cl.id = p_client_id
  -- Orden alfabético con la posición manual por delante, NUNCA por cifras: un
  -- «los clientes con más incidencias primero» sería un ranking entre cuentas.
  ORDER BY cl.position NULLS LAST, cl.name, cl.id;
$$;

COMMENT ON FUNCTION public.plataforma_resumen_ingesta(UUID) IS
  'Una fila por cliente con el estado de SU ingesta: trabajos vivos, errores de las últimas 24 h e incidencias abiertas. Solo cuenta filas del ERP (amazon_jobs, amazon_eventos), nunca datos de negocio, y no compara ni ordena clientes entre sí.';


-- =====================================================
-- 4 · QUIÉN PUEDE EJECUTARLAS
-- =====================================================
-- Postgres reparte EXECUTE a PUBLIC por omisión en cada función nueva. Sin este
-- REVOKE, cualquiera con una sesión del ERP podría contar el catálogo de todos
-- los clientes desde la consola del navegador, saltándose que amazon_listings
-- solo la lee un admin. El REVOKE va antes del GRANT a propósito.
REVOKE ALL ON FUNCTION public.plataforma_cobertura_a1(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plataforma_ultimos_refrescos(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plataforma_resumen_ingesta(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.plataforma_cobertura_a1(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.plataforma_ultimos_refrescos(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.plataforma_resumen_ingesta(UUID) TO service_role;


-- =====================================================
-- 5 · COMPROBACIÓN
-- =====================================================
DO $$
DECLARE
  v_funciones INTEGER;
BEGIN
  SELECT count(*) INTO v_funciones
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'plataforma_cobertura_a1',
      'plataforma_ultimos_refrescos',
      'plataforma_resumen_ingesta'
    );

  IF v_funciones < 3 THEN
    RAISE EXCEPTION 'Faltan funciones de la 125: se esperaban 3 y hay %.', v_funciones;
  END IF;

  RAISE NOTICE '125 aplicada: 3 funciones de solo lectura para las pantallas de A1.';
END $$;
