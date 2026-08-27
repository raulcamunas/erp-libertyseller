-- ==================================================================
-- LIMPIEZA · PASO 1 · BORRAR
-- ==================================================================
--
-- ESTE FICHERO NO LLEVA NI UN VACUUM, y esa es toda la razon de que este
-- separado del paso 2.
--
-- El editor de Supabase manda TODO lo que se lanza como UNA transaccion. Y
-- VACUUM no puede correr dentro de una transaccion. O sea que un fichero con los
-- DELETE y los VACUUM juntos hace esto:
--
--     1. los DELETE se ejecutan
--     2. el primer VACUUM revienta con «cannot run inside a transaction block»
--     3. LA TRANSACCION ENTERA SE DESHACE y los DELETE se pierden
--
-- Y no da ningun aviso de que se ha deshecho: solo se ve el error del VACUUM.
-- Paso comprobado el 27 de agosto de 2026 — el script se lanzo entero, dio ese
-- error, y las 335.711 filas de BSR seguian ahi las 335.711.
--
--
-- ANTES: LA MIGRACION 162
-- Las cinco tablas de mediciones tienen un candado de solo insercion que corta
-- cualquier borrado. La 162 lo afina para dejar retirar lo de hace mas de un
-- dia. Sin ella esto corta con «ERROR 23001: es una serie temporal».
--
-- LO QUE NO SE TOCA: el catalogo, los envios a Amazon, los precios de Entrais,
-- los leads, las citas. Aqui solo caen mediciones repetidas y registros.

-- ---------- Que se va a borrar ----------
SELECT 'amazon_snapshots_bsr'      AS tabla, count(*) AS se_borran FROM public.amazon_snapshots_bsr      WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_snapshots_precio',      count(*) FROM public.amazon_snapshots_precio      WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_buybox_diagnostico',    count(*) FROM public.amazon_buybox_diagnostico    WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_snapshots_inventario',  count(*) FROM public.amazon_snapshots_inventario  WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_fees_estimados',        count(*) FROM public.amazon_fees_estimados        WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_eventos',               count(*) FROM public.amazon_eventos               WHERE created_at < now() - interval '15 days'
UNION ALL SELECT 'cron_ejecuciones',             count(*) FROM public.cron_ejecuciones             WHERE iniciado_at < now() - interval '15 days'
UNION ALL SELECT 'amazon_jobs',                  count(*) FROM public.amazon_jobs                  WHERE terminado_at IS NOT NULL AND terminado_at < now() - interval '15 days'
ORDER BY se_borran DESC;

-- ---------- Borrar ----------
-- De una en una y mirando el resultado. Si alguna tarda demasiado y el editor
-- corta, no pasa nada: se relanza y sigue por donde estaba.

DELETE FROM public.amazon_snapshots_bsr        WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_snapshots_precio     WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_buybox_diagnostico   WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_snapshots_inventario WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_fees_estimados       WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_eventos              WHERE created_at < now() - interval '15 days';
DELETE FROM public.cron_ejecuciones            WHERE iniciado_at < now() - interval '15 days';

-- amazon_jobs va con su propia condicion: `terminado_at IS NULL` es un trabajo
-- VIVO, y borrar uno en marcha dejaria al motor sin saber por donde iba.
DELETE FROM public.amazon_jobs
WHERE terminado_at IS NOT NULL AND terminado_at < now() - interval '15 days';

-- ---------- Como ha quedado ----------
SELECT 'amazon_snapshots_bsr' AS tabla, count(*) AS quedan FROM public.amazon_snapshots_bsr
UNION ALL SELECT 'amazon_snapshots_precio',   count(*) FROM public.amazon_snapshots_precio
UNION ALL SELECT 'amazon_buybox_diagnostico', count(*) FROM public.amazon_buybox_diagnostico
UNION ALL SELECT 'amazon_fees_estimados',     count(*) FROM public.amazon_fees_estimados
UNION ALL SELECT 'amazon_eventos',            count(*) FROM public.amazon_eventos
UNION ALL SELECT 'cron_ejecuciones',          count(*) FROM public.cron_ejecuciones
UNION ALL SELECT 'amazon_jobs',               count(*) FROM public.amazon_jobs
ORDER BY quedan DESC;
