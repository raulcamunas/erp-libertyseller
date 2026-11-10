-- ============================================================================
-- 297 · CUMPLIMIENTO COMO APP: CIFRAS POR PAÍS, INCIDENCIAS AGRUPADAS Y FOTO DIARIA
-- ============================================================================
--
-- «Cumplimiento» sale de Growth Partner y pasa a ser una app propia, con un panel por cliente y país. Esta migración NO cambia `listing_cumplimiento` (227): añade cómo leerla de golpe.
--
--   · cumplimiento_cifras(conexiones)          las cifras de un cliente, una fila por país, con UNA lectura de la tabla (antes eran ~25 recuentos por pantalla).
--   · cumplimiento_catalogo(conexiones)        cuántos listings tiene el catálogo en cada país (para la barra de «revisados de cuántos»).
--   · cumplimiento_temas(conexiones, país)     cuántos listings tienen cada tema.
--   · cumplimiento_codigos(conexiones, país)   las incidencias de Amazon agrupadas por su código: el mismo aviso de la RAP en 10.000 listings es UNA línea.
--   · cumplimiento_diario + cumplimiento_foto_del_dia()   una foto al día por cuenta y país, para la gráfica de evolución. La saca la tarea «cumplimiento» en su primera pasada del día;
--                                                         esta migración saca la de hoy para que la gráfica tenga ya su primer punto.
--
-- Todo se pide por las conexiones de UN cliente (las traduce el servidor desde el cliente elegido): ninguna función junta clientes.
-- Solo el servidor (llave de servicio) llama a las funciones. RLS en la tabla nueva, lectura solo admin. IDEMPOTENTE. Hace falta la 227.

DO $$
BEGIN
  IF to_regclass('public.listing_cumplimiento') IS NULL THEN
    RAISE EXCEPTION 'Falta public.listing_cumplimiento: lanza antes 227_cumplimiento_listings.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cumplimiento_diario (
  connection_id      UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id     TEXT NOT NULL,
  dia                DATE NOT NULL,
  revisados          INTEGER NOT NULL DEFAULT 0,
  limpios            INTEGER NOT NULL DEFAULT 0,
  atencion           INTEGER NOT NULL DEFAULT 0,
  con_errores        INTEGER NOT NULL DEFAULT 0,
  ocultos            INTEGER NOT NULL DEFAULT 0,
  solo_avisos        INTEGER NOT NULL DEFAULT 0,
  atencion_con_stock INTEGER NOT NULL DEFAULT 0,
  normativa          INTEGER NOT NULL DEFAULT 0,
  actualizado_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id, dia)
);

ALTER TABLE public.cumplimiento_diario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cumplimiento_diario_admin_lee ON public.cumplimiento_diario;
CREATE POLICY cumplimiento_diario_admin_lee ON public.cumplimiento_diario FOR SELECT TO authenticated USING (public.is_erp_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cumplimiento_diario FROM authenticated, anon;

-- Las cifras de un cliente, una fila por país. «atención» = con errores u oculto. La antigüedad cuenta desde el problema abierto más antiguo del listing (columna `desde`).
CREATE OR REPLACE FUNCTION public.cumplimiento_cifras(p_conexiones UUID[])
RETURNS TABLE (
  marketplace_id TEXT, revisados BIGINT, limpios BIGINT, atencion BIGINT, con_errores BIGINT, ocultos BIGINT, solo_avisos BIGINT,
  atencion_con_stock BIGINT, normativa BIGINT, antig_7 BIGINT, antig_30 BIGINT, antig_90 BIGINT, antig_mas BIGINT, ultima_revision TIMESTAMPTZ
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    lc.marketplace_id,
    count(*),
    count(*) FILTER (WHERE lc.errores = 0 AND lc.avisos = 0 AND NOT lc.suprimido),
    count(*) FILTER (WHERE lc.errores > 0 OR lc.suprimido),
    count(*) FILTER (WHERE lc.errores > 0),
    count(*) FILTER (WHERE lc.suprimido),
    count(*) FILTER (WHERE lc.avisos > 0 AND lc.errores = 0 AND NOT lc.suprimido),
    count(*) FILTER (WHERE (lc.errores > 0 OR lc.suprimido) AND lc.con_stock),
    count(*) FILTER (WHERE 'normativa' = ANY (lc.temas)),
    count(*) FILTER (WHERE (lc.errores > 0 OR lc.suprimido) AND lc.desde >= now() - interval '7 days'),
    count(*) FILTER (WHERE (lc.errores > 0 OR lc.suprimido) AND lc.desde < now() - interval '7 days' AND lc.desde >= now() - interval '30 days'),
    count(*) FILTER (WHERE (lc.errores > 0 OR lc.suprimido) AND lc.desde < now() - interval '30 days' AND lc.desde >= now() - interval '90 days'),
    count(*) FILTER (WHERE (lc.errores > 0 OR lc.suprimido) AND lc.desde < now() - interval '90 days'),
    max(lc.revisado_at)
  FROM public.listing_cumplimiento lc
  WHERE lc.connection_id = ANY (p_conexiones) AND lc.en_amazon
  GROUP BY lc.marketplace_id
$$;

CREATE OR REPLACE FUNCTION public.cumplimiento_catalogo(p_conexiones UUID[])
RETURNS TABLE (marketplace_id TEXT, total BIGINT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT l.marketplace_id, count(*) FROM public.amazon_listings l WHERE l.connection_id = ANY (p_conexiones) GROUP BY l.marketplace_id
$$;

-- Cuántos listings tienen cada tema (un listing cuenta en todos los suyos). p_mercado NULL = todos los países del cliente.
CREATE OR REPLACE FUNCTION public.cumplimiento_temas(p_conexiones UUID[], p_mercado TEXT)
RETURNS TABLE (tema TEXT, atencion BIGINT, todos BIGINT, atencion_con_stock BIGINT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT t.tema,
         count(*) FILTER (WHERE lc.errores > 0 OR lc.suprimido),
         count(*),
         count(*) FILTER (WHERE (lc.errores > 0 OR lc.suprimido) AND lc.con_stock)
  FROM public.listing_cumplimiento lc
  CROSS JOIN LATERAL unnest(lc.temas) AS t(tema)
  WHERE lc.connection_id = ANY (p_conexiones) AND lc.en_amazon
    AND (p_mercado IS NULL OR lc.marketplace_id = p_mercado)
    AND (lc.errores > 0 OR lc.avisos > 0 OR lc.suprimido)
  GROUP BY t.tema
$$;

-- Las incidencias agrupadas por el código de Amazon. «ocultan» mira lo mismo que ocultaAhora() en lib/cumplimiento/incidencias.ts: una acción que saca el listing y sin exención vigente.
CREATE OR REPLACE FUNCTION public.cumplimiento_codigos(p_conexiones UUID[], p_mercado TEXT, p_limite INTEGER DEFAULT 60)
RETURNS TABLE (codigo TEXT, gravedad TEXT, tema TEXT, mensaje TEXT, listings BIGINT, con_stock BIGINT, ocultan BIGINT, desde TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH i AS (
    SELECT lc.id, lc.con_stock, x.inc
    FROM public.listing_cumplimiento lc
    CROSS JOIN LATERAL jsonb_array_elements(lc.incidencias) AS x(inc)
    WHERE lc.connection_id = ANY (p_conexiones) AND lc.en_amazon
      AND (p_mercado IS NULL OR lc.marketplace_id = p_mercado)
      AND (lc.errores > 0 OR lc.avisos > 0 OR lc.suprimido)
  )
  SELECT
    i.inc->>'codigo',
    CASE WHEN bool_or(i.inc->>'gravedad' = 'error') THEN 'error' WHEN bool_or(i.inc->>'gravedad' = 'aviso') THEN 'aviso' ELSE 'info' END,
    mode() WITHIN GROUP (ORDER BY i.inc->>'tema'),
    mode() WITHIN GROUP (ORDER BY left(i.inc->>'mensaje', 600)),
    count(DISTINCT i.id),
    count(DISTINCT i.id) FILTER (WHERE i.con_stock),
    count(DISTINCT i.id) FILTER (
      WHERE (i.inc->'acciones') ?| ARRAY['SEARCH_SUPPRESSED', 'LISTING_SUPPRESSED', 'CATALOG_ITEM_REMOVED']
        AND NOT (
          COALESCE(i.inc->'exencion'->>'estado', '') = 'EXEMPT'
          OR (COALESCE(i.inc->'exencion'->>'estado', '') = 'EXEMPT_UNTIL_EXPIRY_DATE' AND (i.inc->'exencion'->>'caduca')::timestamptz > now())
        )
    ),
    min((i.inc->>'desde')::timestamptz)
  FROM i
  WHERE i.inc->>'codigo' IS NOT NULL
  GROUP BY i.inc->>'codigo'
  ORDER BY count(DISTINCT i.id) FILTER (WHERE i.inc->>'gravedad' = 'error') DESC, count(DISTINCT i.id) DESC
  LIMIT GREATEST(1, LEAST(p_limite, 200))
$$;

-- La foto del día de TODAS las cuentas y países (una fila por cuenta y país: no se juntan clientes). La vuelve a sacar si se llama dos veces el mismo día.
CREATE OR REPLACE FUNCTION public.cumplimiento_foto_del_dia()
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
  WITH f AS (
    INSERT INTO public.cumplimiento_diario AS d (connection_id, marketplace_id, dia, revisados, limpios, atencion, con_errores, ocultos, solo_avisos, atencion_con_stock, normativa, actualizado_at)
    SELECT lc.connection_id, lc.marketplace_id, (now() AT TIME ZONE 'Europe/Madrid')::date,
           count(*),
           count(*) FILTER (WHERE lc.errores = 0 AND lc.avisos = 0 AND NOT lc.suprimido),
           count(*) FILTER (WHERE lc.errores > 0 OR lc.suprimido),
           count(*) FILTER (WHERE lc.errores > 0),
           count(*) FILTER (WHERE lc.suprimido),
           count(*) FILTER (WHERE lc.avisos > 0 AND lc.errores = 0 AND NOT lc.suprimido),
           count(*) FILTER (WHERE (lc.errores > 0 OR lc.suprimido) AND lc.con_stock),
           count(*) FILTER (WHERE 'normativa' = ANY (lc.temas)),
           now()
    FROM public.listing_cumplimiento lc
    WHERE lc.en_amazon
    GROUP BY lc.connection_id, lc.marketplace_id
    ON CONFLICT (connection_id, marketplace_id, dia) DO UPDATE SET
      revisados = EXCLUDED.revisados, limpios = EXCLUDED.limpios, atencion = EXCLUDED.atencion, con_errores = EXCLUDED.con_errores,
      ocultos = EXCLUDED.ocultos, solo_avisos = EXCLUDED.solo_avisos, atencion_con_stock = EXCLUDED.atencion_con_stock,
      normativa = EXCLUDED.normativa, actualizado_at = EXCLUDED.actualizado_at
    RETURNING 1
  )
  SELECT count(*)::integer FROM f
$$;

REVOKE ALL ON FUNCTION public.cumplimiento_cifras(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cumplimiento_catalogo(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cumplimiento_temas(UUID[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cumplimiento_codigos(UUID[], TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cumplimiento_foto_del_dia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cumplimiento_cifras(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.cumplimiento_catalogo(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.cumplimiento_temas(UUID[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cumplimiento_codigos(UUID[], TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.cumplimiento_foto_del_dia() TO service_role;

-- El primer punto de la gráfica: la foto de hoy
SELECT public.cumplimiento_foto_del_dia() AS cuentas_y_paises_en_la_foto_de_hoy;
