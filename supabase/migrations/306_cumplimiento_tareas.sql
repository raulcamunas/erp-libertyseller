-- ============================================================================
-- 306 · CUMPLIMIENTO: LA PESTAÑA «HOY» CON CIFRAS EXACTAS Y LOS AVISOS MENORES CONTADOS
-- ============================================================================
--
-- Desde el 14 nov 2026 los avisos que no cambian nada en la venta («faltan atributos clave… no impide que aparezca»,
-- envíos rechazados que dejan la ficha como estaba, errores internos de Amazon…) ya NO cuentan en `errores` / `avisos`
-- de listing_cumplimiento (lib/cumplimiento/incidencias.ts, MENORES). Siguen dentro del JSON `incidencias`.
--
-- Dos funciones nuevas, solo de lectura. NO cambia ninguna tabla ni ninguna función de la 297.
--
--   · cumplimiento_codigos_todos(conexiones, país, límite)   como cumplimiento_codigos (297), pero mira TODAS las filas con
--       alguna incidencia (la 297 solo las que tienen errores, avisos u ocultación, y ahora se dejaría fuera los listings
--       que solo tienen avisos menores) y además dice cuántos de los ocultos tienen stock.
--   · cumplimiento_tareas(conexiones, país, mapa)   cuántos listings DISTINTOS hay en cada tarea de la pestaña «Hoy»
--       («Pedir la aprobación de la marca», «Registrar la RAP»…). Una tarea junta varios códigos y un listing puede tener
--       dos de la misma (el fabricante y la persona responsable del GPSR van en códigos distintos): sumar por código
--       contaba hasta un 39 % de más. El mapa código → tarea lo hace el servidor (lib/cumplimiento/acciones.ts):
--       {"18299": {"b": "bloquea|aprobacion-marca", "n": "afecta|aprobacion-marca"}, ...}; «b» si la incidencia oculta
--       el listing ahora (misma regla que ocultaAhora()), «n» si no.
--
-- Sin esta migración la app funciona igual: suma por código (y lo dice en pantalla) y los avisos menores salen incompletos.
-- Todo se pide por las conexiones de UN cliente: ninguna función junta clientes. Solo el servidor (llave de servicio) las
-- llama. IDEMPOTENTE. Hace falta la 227.

DO $$
BEGIN
  IF to_regclass('public.listing_cumplimiento') IS NULL THEN
    RAISE EXCEPTION 'Falta public.listing_cumplimiento: lanza antes 227_cumplimiento_listings.sql.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cumplimiento_codigos_todos(p_conexiones UUID[], p_mercado TEXT, p_limite INTEGER DEFAULT 200)
RETURNS TABLE (codigo TEXT, gravedad TEXT, tema TEXT, mensaje TEXT, listings BIGINT, con_stock BIGINT, ocultan BIGINT, ocultan_con_stock BIGINT, desde TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH i AS (
    SELECT lc.id, lc.con_stock, x.inc,
           ((x.inc->'acciones') ?| ARRAY['SEARCH_SUPPRESSED', 'LISTING_SUPPRESSED', 'CATALOG_ITEM_REMOVED'])
             AND NOT (
               COALESCE(x.inc->'exencion'->>'estado', '') = 'EXEMPT'
               OR (COALESCE(x.inc->'exencion'->>'estado', '') = 'EXEMPT_UNTIL_EXPIRY_DATE' AND (x.inc->'exencion'->>'caduca')::timestamptz > now())
             ) AS oculta
    FROM public.listing_cumplimiento lc
    CROSS JOIN LATERAL jsonb_array_elements(lc.incidencias) AS x(inc)
    WHERE lc.connection_id = ANY (p_conexiones) AND lc.en_amazon
      AND (p_mercado IS NULL OR lc.marketplace_id = p_mercado)
      AND jsonb_array_length(lc.incidencias) > 0
  )
  SELECT
    i.inc->>'codigo',
    CASE WHEN bool_or(i.inc->>'gravedad' = 'error') THEN 'error' WHEN bool_or(i.inc->>'gravedad' = 'aviso') THEN 'aviso' ELSE 'info' END,
    mode() WITHIN GROUP (ORDER BY i.inc->>'tema'),
    mode() WITHIN GROUP (ORDER BY left(i.inc->>'mensaje', 600)),
    count(DISTINCT i.id),
    count(DISTINCT i.id) FILTER (WHERE i.con_stock),
    count(DISTINCT i.id) FILTER (WHERE i.oculta),
    count(DISTINCT i.id) FILTER (WHERE i.oculta AND i.con_stock),
    min((i.inc->>'desde')::timestamptz)
  FROM i
  WHERE i.inc->>'codigo' IS NOT NULL
  GROUP BY i.inc->>'codigo'
  ORDER BY count(DISTINCT i.id) FILTER (WHERE i.oculta) DESC, count(DISTINCT i.id) DESC
  LIMIT GREATEST(1, LEAST(p_limite, 400))
$$;

CREATE OR REPLACE FUNCTION public.cumplimiento_tareas(p_conexiones UUID[], p_mercado TEXT, p_mapa JSONB)
RETURNS TABLE (tarea TEXT, listings BIGINT, con_stock BIGINT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH i AS (
    SELECT lc.id, lc.con_stock, x.inc->>'codigo' AS codigo,
           ((x.inc->'acciones') ?| ARRAY['SEARCH_SUPPRESSED', 'LISTING_SUPPRESSED', 'CATALOG_ITEM_REMOVED'])
             AND NOT (
               COALESCE(x.inc->'exencion'->>'estado', '') = 'EXEMPT'
               OR (COALESCE(x.inc->'exencion'->>'estado', '') = 'EXEMPT_UNTIL_EXPIRY_DATE' AND (x.inc->'exencion'->>'caduca')::timestamptz > now())
             ) AS oculta
    FROM public.listing_cumplimiento lc
    CROSS JOIN LATERAL jsonb_array_elements(lc.incidencias) AS x(inc)
    WHERE lc.connection_id = ANY (p_conexiones) AND lc.en_amazon
      AND (p_mercado IS NULL OR lc.marketplace_id = p_mercado)
      AND jsonb_array_length(lc.incidencias) > 0
  )
  SELECT
    -- Un código que el mapa no trae (no debería pasar) sale como «?|código» y el servidor lo pone en una tarea genérica
    COALESCE(p_mapa->(i.codigo)->>(CASE WHEN i.oculta THEN 'b' ELSE 'n' END), '?|' || COALESCE(i.codigo, '')),
    count(DISTINCT i.id),
    count(DISTINCT i.id) FILTER (WHERE i.con_stock)
  FROM i
  GROUP BY 1
$$;

REVOKE ALL ON FUNCTION public.cumplimiento_codigos_todos(UUID[], TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cumplimiento_tareas(UUID[], TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cumplimiento_codigos_todos(UUID[], TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.cumplimiento_tareas(UUID[], TEXT, JSONB) TO service_role;
