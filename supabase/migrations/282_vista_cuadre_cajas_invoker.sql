-- ============================================================================
-- 282 · La vista fba_cuadre_cajas pasa a «security invoker»
-- ============================================================================
-- El aviso crítico de Supabase (Security Advisor, 8 nov 2026): una vista creada sin más se ejecuta con los permisos de quien la CREÓ, y se salta las políticas (RLS) de las tablas
-- de las que lee. Con `security_invoker` cada consulta se hace con los permisos de quien pregunta, que es lo que la 195 daba por hecho al poner RLS en las cajas.
-- Ningún código del ERP lee esta vista, así que no cambia nada de lo que se ve. Se puede lanzar las veces que se quiera.

ALTER VIEW public.fba_cuadre_cajas SET (security_invoker = true);

-- COMPROBACIÓN: tiene que salir «true»
SELECT coalesce(
  (SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'fba_cuadre_cajas'),
  false
) AS vista_con_security_invoker;
