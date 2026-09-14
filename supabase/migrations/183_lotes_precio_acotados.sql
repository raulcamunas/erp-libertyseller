-- ==================================================================
-- 183 · ACOTAR LA VISTA DE LOTES DE PRECIO
-- ==================================================================
--
-- `amazon_lotes_precio` agrupa `amazon_submissions` al vuelo, SIN límite de
-- fecha. Hoy son 208.983 envíos de precio y crecen unos 5.000 al día, porque
-- desde la 179 el motor publica de verdad todo el catálogo cada hora.
--
-- Medido contra la base real, la misma consulta que hace la pantalla:
--
--     en frío       6,1 s
--     en caliente    0,5 s
--
-- Y la pantalla solo enseña LOS ÚLTIMOS 60 LOTES. O sea que se agrupan 209.000
-- filas para tirar el 99 %.
--
-- Seis segundos en frío es lo que pone la pestaña de Growth Partner al borde
-- del límite de tiempo de sentencia, y a cinco mil filas al día no es cuestión
-- de si se pasa, sino de cuándo.
--
--
-- ============ POR QUÉ NOVENTA DÍAS Y NO SE PIERDE NADA ============
--
-- El historial de la pantalla son 60 lotes; con una publicación por hora, eso
-- son dos días y medio. Noventa días es cuarenta veces lo que se llega a ver.
--
-- Y el DETALLE de un lote no sale de aquí: `cambiosDeLotePrecio()` lee
-- `amazon_submissions` por `batch_id` directamente, así que un lote de hace un
-- año se sigue abriendo entero. Lo que se acota es el RESUMEN, no el registro.
CREATE OR REPLACE VIEW public.amazon_lotes_precio
WITH (security_invoker = true) AS
SELECT
  s.batch_id,
  s.connection_id,
  s.marketplace_id,
  min(s.created_at)                                                    AS created_at,
  max(s.source::text)                                                  AS source,
  max(s.source_ref)                                                    AS source_ref,
  max(s.created_by::text)                                              AS created_by,
  count(*)                                                             AS total,
  -- 'caducado' entra en los aceptados: salió hacia Amazon y Amazon lo cogió; lo
  -- único que pasó es que dejó de comprobarse contra el espejo (migración 182).
  -- Sin esto, los lotes viejos enseñaban «total 200, aceptados 0», que se lee
  -- como que no se mandó nada.
  count(*) FILTER (WHERE s.status IN ('aceptado', 'confirmado', 'caducado')) AS aceptados,
  count(*) FILTER (WHERE s.status IN ('invalido', 'error'))             AS fallidos,
  count(*) FILTER (WHERE s.status = 'pendiente')                        AS pendientes,
  min(s.error_message) FILTER (WHERE s.error_message IS NOT NULL)       AS primer_error
FROM public.amazon_submissions s
WHERE s.field = 'precio'
  AND s.created_at >= NOW() - INTERVAL '90 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_profile_runs r WHERE r.batch_id = s.batch_id
  )
GROUP BY s.batch_id, s.connection_id, s.marketplace_id;

COMMENT ON VIEW public.amazon_lotes_precio IS
  'Resumen por lote de los precios publicados fuera del ciclo de stock. Solo los ultimos 90 dias: '
  'la pantalla enseña 60 lotes y agrupar la tabla entera la ponia en 6 s. El detalle de un lote '
  'concreto NO sale de aqui, sale de amazon_submissions por batch_id, asi que no se pierde nada.';

DO $$
DECLARE
  v_lotes INTEGER;
  v_ms NUMERIC;
  v_t0 TIMESTAMPTZ;
BEGIN
  v_t0 := clock_timestamp();
  SELECT count(*) INTO v_lotes FROM public.amazon_lotes_precio;
  v_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000;
  RAISE NOTICE 'La vista agrupa ahora % lotes y ha tardado % ms.', v_lotes, round(v_ms);
END $$;
