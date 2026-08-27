-- ==================================================================
-- LIMPIEZA A FONDO · SE LANZA A MANO, UNA VEZ
-- ==================================================================
--
-- ESTO BORRA. Y no es recuperable: Amazon no deja pedir hacia atras el BSR ni
-- los precios de dias pasados. Se ha decidido asi con el dato delante — «el
-- historial de BSR me da igual, ya usare Keepa».
--
-- Lo que NO se toca: el catalogo (`amazon_listings`), los envios a Amazon
-- (`amazon_submissions`), los precios calculados de Entrais, los leads, las
-- citas ni nada de gestion. Aqui solo caen mediciones repetidas y registros.
--
-- ANTES DE NADA: APLICA LA MIGRACION 162.
--
-- Las cinco tablas de mediciones tienen desde la 123 un candado que corta
-- CUALQUIER borrado — son series de solo insercion y esta bien que lo tengan.
-- La 162 lo afina: sigue prohibiendo el UPDATE y el TRUNCATE, y deja retirar
-- filas de hace mas de un dia. Sin ella, el bloque 2 corta con:
--
--     ERROR 23001: ... es una serie temporal de SOLO INSERCION
--
-- Va en cuatro bloques y el orden importa. Lanzalos DE UNO EN UNO y mira el
-- resultado de cada uno antes de seguir.
--
-- Y los VACUUM FULL, UNO A UNO Y SOLOS: no se pueden ejecutar dentro de una
-- transaccion, asi que lanzarlos en bloque con lo demas los tumba.

-- ══════════════════ 1 · QUE SE VA A BORRAR (no borra nada) ══════════════════
SELECT 'amazon_snapshots_bsr'      AS tabla, count(*) AS se_borran FROM public.amazon_snapshots_bsr      WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_snapshots_precio',      count(*) FROM public.amazon_snapshots_precio      WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_snapshots_inventario',  count(*) FROM public.amazon_snapshots_inventario  WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_fees_estimados',        count(*) FROM public.amazon_fees_estimados        WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_buybox_diagnostico',    count(*) FROM public.amazon_buybox_diagnostico    WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_eventos',               count(*) FROM public.amazon_eventos               WHERE created_at < now() - interval '15 days'
UNION ALL SELECT 'cron_ejecuciones',             count(*) FROM public.cron_ejecuciones             WHERE iniciado_at < now() - interval '15 days'
ORDER BY se_borran DESC;


-- ══════════════════ 2 · BORRAR ══════════════════
-- Cada DELETE por separado y no en una transaccion gigante: media hora de
-- transaccion abierta en Supabase se corta sola y deja el WAL inflado, que es
-- justo lo contrario de lo que se busca.

DELETE FROM public.amazon_snapshots_bsr      WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_snapshots_precio   WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_snapshots_inventario WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_fees_estimados     WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_buybox_diagnostico WHERE fecha < now() - interval '3 days';
DELETE FROM public.amazon_eventos            WHERE created_at < now() - interval '15 days';
DELETE FROM public.cron_ejecuciones          WHERE iniciado_at < now() - interval '15 days';


-- ══════════════════ 3 · DEVOLVER EL ESPACIO ══════════════════
--
-- SIN ESTO LA CIFRA DE SUPABASE NO BAJA. Postgres marca las filas como muertas
-- y reutiliza ese sitio para lo que venga despues, pero no se lo devuelve al
-- disco. El DELETE de arriba, solo, detiene el crecimiento y deja el numero
-- exactamente igual que estaba.
--
-- VACUUM FULL reescribe la tabla entera y LA BLOQUEA mientras lo hace. Una a
-- una y no todas de golpe:
--
--   · Las tres primeras son de mediciones. Si se bloquean un minuto no pasa
--     nada: el trabajo que escribe ahi reintenta.
--   · `amazon_listings` es la ultima A PROPOSITO. Es la que usa el ciclo de
--     stock cada quince minutos y la que mas bloqueo va a dar. Lanzala cuando
--     no haya nadie trabajando, y si tarda mas de lo que aguantas, dejala:
--     es la que menos falta hace de todas.

VACUUM FULL public.amazon_snapshots_bsr;
VACUUM FULL public.amazon_snapshots_precio;
VACUUM FULL public.amazon_fees_estimados;
VACUUM FULL public.amazon_buybox_diagnostico;
VACUUM FULL public.amazon_eventos;
VACUUM FULL public.cron_ejecuciones;
VACUUM FULL public.amazon_listings;

-- Y el resultado
SELECT pg_size_pretty(pg_database_size(current_database())) AS base_despues;


-- ══════════════════ 4 · LOS TRABAJOS TERMINADOS ══════════════════
-- Aparte de los bloques de arriba porque aqui la condicion NO es solo la fecha:
-- `terminado_at IS NULL` es un trabajo VIVO, y borrar uno en marcha dejaria al
-- motor sin saber por donde iba. Solo caen los que ya acabaron.

SELECT count(*) AS trabajos_terminados_viejos
FROM public.amazon_jobs
WHERE terminado_at IS NOT NULL AND terminado_at < now() - interval '15 days';

DELETE FROM public.amazon_jobs
WHERE terminado_at IS NOT NULL AND terminado_at < now() - interval '15 days';

VACUUM FULL public.amazon_jobs;
