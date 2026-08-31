-- ==================================================================
-- 167 · QUE LAS PUBLICACIONES DE PRECIO SE VEAN EN EL HISTORIAL
-- ==================================================================
--
-- El historial de «Ejecuciones» sale de `stock_profile_runs`: una fila por
-- pasada de stock. Los precios NO pasan por ahi —los manda el motor de Entrais
-- directamente con sendChanges()— asi que en pantalla no existian. Se veia lo
-- que el ERP le hacia al stock de un cliente y no lo que le hacia a sus precios,
-- que es la mitad de lo que le hace.
--
--
-- POR QUE UNA VISTA Y NO UNA TABLA NUEVA
-- --------------------------------------
-- Porque el dato YA ESTA, entero y bien, en `amazon_submissions`: cada envio
-- deja su fila con SKU, valor anterior, valor nuevo y en que acabo. Escribir
-- ademas una fila de resumen por lote seria guardar dos veces lo mismo y abrir
-- la puerta a que las dos versiones no coincidan.
--
-- La vista agrupa por lote al vuelo. No ocupa nada y no puede desincronizarse
-- de lo que agrupa.
--
--
-- SE EXCLUYEN LOS LOTES QUE YA SALEN COMO PASADA DE STOCK
-- ------------------------------------------------------
-- Un perfil de sincronismo con `enviar_precio` puesto manda precios DENTRO de su
-- pasada, y esa pasada ya tiene su fila en el historial. Sin el NOT EXISTS de
-- abajo, ese mismo envio saldria dos veces: una como pasada y otra como
-- publicacion de precios, y quien lo mire contara el doble de cambios de los que
-- hubo.

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
  count(*) FILTER (WHERE s.status IN ('aceptado', 'confirmado'))        AS aceptados,
  count(*) FILTER (WHERE s.status IN ('invalido', 'error'))             AS fallidos,
  count(*) FILTER (WHERE s.status = 'pendiente')                        AS pendientes,
  -- El primer error que haya, para poder decir en pantalla QUE fallo sin tener
  -- que abrir el lote. Un lote fallido que solo dice «3 fallidos» obliga a un
  -- clic mas para saber si es un problema de permisos o de un SKU raro.
  min(s.error_message) FILTER (WHERE s.error_message IS NOT NULL)       AS primer_error
FROM public.amazon_submissions s
WHERE s.field = 'precio'
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_profile_runs r WHERE r.batch_id = s.batch_id
  )
GROUP BY s.batch_id, s.connection_id, s.marketplace_id;

COMMENT ON VIEW public.amazon_lotes_precio IS
  'Un resumen por lote de precios publicado fuera del ciclo de stock (el motor de Entrais). Agrupa amazon_submissions al vuelo: no guarda nada y no puede desincronizarse. Excluye los lotes que ya salen en el historial como pasada de stock, para no contarlos dos veces.';

-- El indice que hace barata la vista. Sin el, agrupar obliga a recorrer la tabla
-- entera de envios cada vez que alguien abre la pestana de ejecuciones.
CREATE INDEX IF NOT EXISTS amazon_submissions_precio_lote_idx
  ON public.amazon_submissions (connection_id, created_at DESC)
  WHERE field = 'precio';

-- ---------- Comprobacion ----------
DO $$
DECLARE
  lotes INTEGER;
BEGIN
  SELECT count(*) INTO lotes FROM public.amazon_lotes_precio;
  RAISE NOTICE 'Vista creada. Ahora mismo agrupa % lotes de precio publicados fuera del ciclo de stock.', lotes;
END $$;
