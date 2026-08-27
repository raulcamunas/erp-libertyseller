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
-- Va en tres bloques y el orden importa. Lanzalos DE UNO EN UNO y mira el
-- resultado de cada uno antes de seguir.

-- ══════════════════ 1 · QUE SE VA A BORRAR (no borra nada) ══════════════════
SELECT 'amazon_snapshots_bsr'      AS tabla, count(*) AS se_borran FROM public.amazon_snapshots_bsr      WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_snapshots_precio',      count(*) FROM public.amazon_snapshots_precio      WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_snapshots_inventario',  count(*) FROM public.amazon_snapshots_inventario  WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_fees_estimados',        count(*) FROM public.amazon_fees_estimados        WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_buybox_diagnostico',    count(*) FROM public.amazon_buybox_diagnostico    WHERE fecha < now() - interval '3 days'
UNION ALL SELECT 'amazon_eventos',               count(*) FROM public.amazon_eventos               WHERE created_at < now() - interval '15 days'
UNION ALL SELECT 'cron_ejecuciones',             count(*) FROM public.cron_ejecuciones             WHERE empezado_at < now() - interval '15 days'
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
DELETE FROM public.cron_ejecuciones          WHERE empezado_at < now() - interval '15 days';


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
