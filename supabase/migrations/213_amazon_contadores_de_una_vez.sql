-- ============================================================================
-- 213 · LOS CONTADORES DEL CATÁLOGO, EN UN SOLO VIAJE
-- ============================================================================
--
-- La pantalla de Amazon API tardaba SEIS SEGUNDOS en aparecer. Medido contra
-- producción, consulta a consulta:
--
--     298 ms  amazon_clients
--      62 ms  amazon_connections
--    5813 ms  el bucle: 10 conexiones × 3 contadores = 30 viajes EN SERIE
--    ──────
--    6182 ms  loadAmazonData() entera
--
-- No era Postgres: era la latencia. Treinta idas y vueltas a Supabase, cada una
-- esperando a que terminara la anterior, a 60-100 ms de ida y vuelta. Los mismos
-- treinta lanzados a la vez tardan 642 ms, o sea que nueve de cada diez segundos
-- eran esperar, no contar.
--
-- Esta función hace los dos contadores que la pantalla SÍ enseña —cuántas
-- referencias tiene cada conexión y cuántas llevan un día sin que Amazon las
-- confirme— de todas las conexiones a la vez, en una pasada y un solo viaje.
--
--
-- ============ POR QUÉ NO HACÍA FALTA NINGÚN ÍNDICE ============
--
-- `idx_amazon_listings_frescura` sobre (connection_id, last_seen_at) ya existe
-- desde la 118 y cubre las dos cuentas: la primera por el prefijo de la clave y
-- la segunda entera. El problema nunca fue el plan, fue repetirlo treinta veces
-- por la red. Esto lo deja en un recorrido de ese mismo índice.
--
--
-- ============ EL TERCER CONTADOR SE CAE DE LA PANTALLA ============
--
-- Había un tercero, `submissionCounts`, que contaba amazon_submissions por
-- conexión. No está aquí a propósito: solo se pinta DENTRO del diálogo de
-- desconectar una cuenta, para poder decir «se conservan N cambios registrados».
-- Entrais tiene 268.610 filas ahí y ese contador solo costaba 1.963 ms, en cada
-- carga de la pantalla, para una frase que casi nadie llega a leer. Ahora se pide
-- al abrir el diálogo. El código va en app/api/amazon/connections/[id]/cambios.
--
--
-- ============ QUIÉN PUEDE LLAMARLA ============
--
-- SECURITY DEFINER para que lea amazon_listings sin depender de las políticas de
-- quien llama —la 118 le niega a `authenticated` hasta el SELECT—, y por eso
-- mismo se le QUITA el permiso de ejecución a anon y a authenticated: la llama el
-- servidor con service_role y nadie más. Sin ese REVOKE, una función definer es
-- una puerta abierta a contar filas de las tiendas de los clientes desde el
-- navegador.
--
-- STABLE porque dentro de la misma consulta no cambia, así el planificador la
-- resuelve una vez.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.amazon_contadores_catalogo(limite_rancio TIMESTAMPTZ)
RETURNS TABLE (connection_id UUID, listings BIGINT, rancias BIGINT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    l.connection_id,
    count(*) AS listings,
    -- Las que llevan más de un día sin verse. El `last_seen_at IS NULL` no
    -- cuenta como rancia: es una fila recién insertada que todavía no ha pasado
    -- por ningún censo, no una que se haya quedado atrás.
    count(*) FILTER (WHERE l.last_seen_at IS NOT NULL AND l.last_seen_at < limite_rancio) AS rancias
  FROM public.amazon_listings l
  GROUP BY l.connection_id;
$$;

COMMENT ON FUNCTION public.amazon_contadores_catalogo(TIMESTAMPTZ) IS
  'Las referencias de catálogo y las rancias de CADA conexión, en un solo viaje. '
  'Sustituye al bucle de lib/amazon/data.ts que hacía tres COUNT por conexión en '
  'serie y se llevaba 5,8 s de los 6,2 que tardaba en abrirse Amazon API. Solo '
  'service_role: es SECURITY DEFINER sobre el catálogo de las tiendas de los clientes.';

REVOKE ALL ON FUNCTION public.amazon_contadores_catalogo(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.amazon_contadores_catalogo(TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.amazon_contadores_catalogo(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.amazon_contadores_catalogo(TIMESTAMPTZ) TO service_role;

-- ============================================================================
-- COMPROBACIÓN · termina en un SELECT porque el editor de Supabase no enseña los
-- NOTICE, y una migración que «no dice nada» ya se dio por buena una vez.
-- ============================================================================
SELECT
  c.name                                  AS conexion,
  COALESCE(k.listings, 0)                 AS referencias,
  COALESCE(k.rancias, 0)                  AS sin_confirmar_desde_hace_un_dia
FROM public.amazon_connections c
LEFT JOIN public.amazon_contadores_catalogo(now() - interval '1 day') k
  ON k.connection_id = c.id
ORDER BY 2 DESC;

-- ============================================================================
-- Y DE PASO, EL ANTI-JOIN DE LOS LOTES DE PRECIO
-- ============================================================================
--
-- La vista `amazon_lotes_precio` (migración 183) descarta los lotes que ya
-- pasaron por el ciclo de stock con un NOT EXISTS contra stock_profile_runs...
-- por una columna que NO TIENE ÍNDICE en ningún sitio. Si el planificador elige
-- bucle anidado en vez de hash, cada una de las 251.523 filas de precio recorre
-- las 2.726 ejecuciones.
--
-- NO PROMETO QUE ESTO ARREGLE LOS OCHO SEGUNDOS, y conviene decirlo: la consulta
-- de Entrais se cancela hoy por tiempo límite, y la causa de fondo es que para
-- sacar los 60 lotes más recientes hay que calcular el min(created_at) de cada
-- lote, o sea recorrer las 251.523 filas. Eso no lo arregla ningún índice; lo
-- arregla una tabla de resumen que mantenga quien escribe. Este índice quita el
-- único plan realmente catastrófico que puede estar encima.
--
-- Mientras tanto, la pantalla ya no espera: lib/growth/ejecuciones.ts corta esa
-- consulta a 1,5 s y pinta el resto del panel sin esa sección.
CREATE INDEX IF NOT EXISTS idx_stock_profile_runs_batch
  ON public.stock_profile_runs (batch_id)
  WHERE batch_id IS NOT NULL;

-- Y el top-40 del historial de orígenes, que es un ORDER BY created_at DESC sin
-- ningún índice que lo sirva: hoy son 2.726 filas y se nota poco, pero la tabla
-- solo crece y la consulta está en la carga de Amazon API.
CREATE INDEX IF NOT EXISTS idx_stock_profile_runs_recientes
  ON public.stock_profile_runs (created_at DESC, id DESC);

SELECT
  'stock_profile_runs' AS tabla,
  (SELECT count(*) FROM public.stock_profile_runs)            AS filas,
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'stock_profile_runs'
      AND indexname IN ('idx_stock_profile_runs_batch', 'idx_stock_profile_runs_recientes')) AS indices_nuevos;
