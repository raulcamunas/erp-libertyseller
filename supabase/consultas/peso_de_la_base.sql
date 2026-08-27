-- ==================================================================
-- QUE ESTA OCUPANDO LA BASE
-- ==================================================================
-- Pegar entera en el SQL Editor de Supabase. No cambia nada: solo lee.
--
-- Las tres columnas dicen cosas distintas y hay que mirarlas juntas:
--
--   datos    lo que ocupan las filas
--   indices  lo que ocupan los indices. En tablas con muchas columnas
--            indexadas suele ser MAS que los datos.
--   muertas  filas borradas o pisadas que todavia ocupan sitio. Si esto es
--            alto, el problema no es lo que hay guardado sino cuantas veces
--            se reescribe: cada UPDATE deja una copia muerta detras.

SELECT
  -- `s.` y no `relname` a secas: pg_stat_user_tables y pg_class tienen las dos
  -- una columna con ese nombre, y sin calificarla Postgres corta con
  -- «column reference "relname" is ambiguous».
  s.relname                                                 AS tabla,
  to_char(n_live_tup, '999G999G999')                        AS filas,
  pg_size_pretty(pg_total_relation_size(c.oid))             AS total,
  pg_size_pretty(pg_table_size(c.oid))                      AS datos,
  pg_size_pretty(pg_indexes_size(c.oid))                    AS indices,
  to_char(n_dead_tup, '999G999G999')                        AS muertas,
  CASE WHEN n_live_tup > 0
       THEN round(100.0 * n_dead_tup / n_live_tup, 1)
       ELSE 0 END                                           AS pct_muertas,
  to_char(last_autovacuum, 'DD Mon HH24:MI')                AS ultimo_vacuum
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 25;

-- ---------- El total, para cuadrarlo con lo que dice la pantalla ----------
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS base_entera,
  pg_size_pretty(sum(pg_total_relation_size(c.oid)))   AS solo_tablas_public
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r';
