-- ============================================================================
-- 265 · SACAR DEL «TIEMPO REAL» LAS TABLAS DE AMAZON QUE NADIE ESCUCHA
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. No borra, no cambia ni una fila: solo deja de AVISAR en directo de los cambios de seis tablas.
--
-- POR QUÉ. «Tiempo real» (Realtime) es lo que hace que una pantalla se actualice sola cuando alguien cambia un dato (una cita, un lead…). Para eso, la base de datos tiene que LEER y
-- DESCODIFICAR cada cambio de cada tabla que esté en la lista `supabase_realtime`, y pasárselo al servicio de tiempo real, aunque NADIE esté escuchando esa tabla. Varias tablas de la
-- cadena de Amazon entraron en esa lista y ninguna pantalla las escucha (se comprueba en el código: las únicas tablas con `postgres_changes` son cold_leads, appointments,
-- appointment_comments, crm_clients, crm_interactions, work_hours, payroll_rates, app_settings, stock_mappings, avisos_equipo, notifications y web_leads).
--
-- Y la cadena de Amazon es la que más escribe: `amazon_listings` (60.499 filas) tiene unas 12.000 actualizaciones cada 20 minutos —el catálogo se relee entero cada 15—, es decir, unas
-- 13 por segundo descodificadas para nadie, todo el día. Con una base pequeña (una Nano de Supabase, con el disco ya justo: el 29 oct 2026 se quedó sin presupuesto de disco y se colgó)
-- es trabajo de disco y de memoria que sobra.
--
-- QUÉ NO CAMBIA. Ninguna pantalla deja de actualizarse: las seis tablas se leen por la API normal (con sus recargas y sus consultas), no por el canal en directo. Las tablas que SÍ se
-- escuchan no se tocan. Si algún día una pantalla nueva quiere escuchar una de estas, se vuelve a añadir (abajo, «CÓMO DESHACERLO»).
--
--   amazon_listings        el catálogo de cada cuenta (precios, stock, estado): lo reescribe el proceso «Catálogo de Amazon»
--   amazon_submissions     el registro de lo que se ha mandado a Amazon (297.832 filas)
--   amazon_jobs            la cola de trabajos de plataforma
--   amazon_eventos         el histórico de eventos de la plataforma
--   stock_read_profiles    los perfiles de lectura de stock
--   stock_profile_runs     las pasadas de esos perfiles
--
-- Con `lock_timeout`: si no consigue el bloqueo de la lista en 5 segundos, se cancela SOLO sin romper nada y se vuelve a pegar un minuto después.
--
--
-- ============ CÓMO COMPROBAR QUE FUNCIONA ====================================
--
--   -- las tablas que siguen en tiempo real (deben salir las que SÍ se escuchan; ninguna de las seis de arriba)
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
--
-- ============ CÓMO DESHACERLO ================================================
--
--   alter publication supabase_realtime add table public.amazon_listings, public.amazon_submissions, public.amazon_jobs, public.amazon_eventos, public.stock_read_profiles, public.stock_profile_runs;
--   -- (si alguna no estaba en la lista antes, esa línea dará error: añade solo las que haya dicho el aviso de abajo)
--
-- ============================================================================

set lock_timeout = '5s';

do $$
declare
  t text;
  quitadas text[] := '{}';
begin
  foreach t in array array['amazon_listings', 'amazon_submissions', 'amazon_jobs', 'amazon_eventos', 'stock_read_profiles', 'stock_profile_runs'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
      quitadas := array_append(quitadas, t);
    end if;
  end loop;
  raise notice 'Quitadas del tiempo real: %', case when cardinality(quitadas) = 0 then '(ninguna: ya estaban fuera)' else array_to_string(quitadas, ', ') end;
end $$;
