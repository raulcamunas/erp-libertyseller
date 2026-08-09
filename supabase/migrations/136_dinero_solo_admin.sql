-- ==================================================================
-- 136 · EL DINERO Y LAS NÓMINAS, SOLO PARA LOS SOCIOS
-- ==================================================================
--
-- El fallo
-- --------
-- Estas tablas tenían políticas del tipo `auth.role() = 'authenticated'`, o sea
-- «vale con estar dentro». Cualquier persona con cuenta en el ERP —una
-- comercial, por ejemplo— podía abrir la consola del navegador y pedir:
--
--     GET /rest/v1/employee_payment_adjustments?select=*
--     GET /rest/v1/finance_periods?select=*
--
-- y sacar lo que cobra cada uno y toda la tesorería de la empresa.
--
-- La interfaz SÍ lo tapaba: sin el permiso de Tesorería el módulo ni aparece en
-- el menú. Pero el menú es un cartel, no una cerradura. La cerradura es esto.
--
--
-- Qué se cierra y qué NO, y por qué
-- ---------------------------------
-- SE CIERRA a admin (los dos socios):
--     finance_periods · finance_payments · finance_attachments
--     employee_payment_adjustments
--
-- NO SE TOCA, y son decisiones, no descuidos:
--
--   * `payroll_rates` — la lee /dashboard/horas («Mis Horas») CON LA SESIÓN DE
--     QUIEN ENTRA, y hace `select('*')` para que `resolveRate` elija sobre la
--     lista entera. Los cuatro comerciales usan esa pantalla a diario.
--     Cerrarla les dejaría la tarifa a cero SIN NINGÚN ERROR —RLS no falla,
--     devuelve cero filas— y verían sus horas valoradas a 0 €. Acotarla por
--     persona es posible, pero hay que mirar antes qué hace `resolveRate` con
--     las filas que no son de nadie, y eso es otra tarea.
--
--   * `commission_reports` — la lee /report/commissions/[slug], que es una RUTA
--     PÚBLICA (está en publicRoutes de middleware.ts): son los informes que se
--     le mandan al cliente y se abren SIN sesión. Cerrarla a admin los rompe
--     todos.
--
--   * `commission_exceptions` — la lee la calculadora de /dashboard/commissions.
--     Se queda con el resto de comisiones para no partir ese módulo en dos
--     reglas distintas.
--
-- Las tres quedan apuntadas para el repaso de las otras 22 tablas.
--
--
-- Cómo está escrito
-- -----------------
-- Se BORRAN las políticas viejas por nombre y se crea una nueva por tabla. El
-- borrado va con IF EXISTS y el nombre exacto: dejar viva una política laxa al
-- lado de una estricta no sirve de nada, porque en Postgres las políticas
-- PERMISSIVE se SUMAN —con que una deje pasar, se pasa—.
--
-- `is_erp_admin(auth.uid())` SIEMPRE con el argumento: la función solo existe
-- como is_erp_admin(uid UUID) (111_employees.sql) y no tiene valor por defecto.
-- Llamarla sin argumentos no compila, y como el editor de Supabase corre el
-- fichero entero en UNA transacción, se llevaría por delante todo lo de arriba.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella estas politicas dejarian las tablas MAS abiertas que ahora.';
  END IF;
END $$;


-- ---------- Tesorería y nóminas ----------
DO $$
DECLARE
  t TEXT;
  pol RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_periods',
    'finance_payments',
    'finance_attachments',
    'employee_payment_adjustments'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'La tabla % no existe, se salta', t;
      CONTINUE;
    END IF;

    -- Fuera TODAS las políticas que tenga hoy. Se hace por barrido y no por
    -- nombre a mano porque están repartidas entre las migraciones 004, 024 y
    -- 045, con nombres distintos, y una sola que se quede viva anula el cierre:
    -- las políticas permisivas se suman.
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      || 'USING (public.is_erp_admin(auth.uid())) '
      || 'WITH CHECK (public.is_erp_admin(auth.uid()))',
      t || '_solo_admin', t
    );
  END LOOP;
END $$;


-- ---------- Comprobación ----------
-- Que no quede ninguna política laxa suelta al lado de la nueva.
DO $$
DECLARE
  t TEXT;
  sobran INT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_periods',
    'finance_payments',
    'finance_attachments',
    'employee_payment_adjustments'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    SELECT count(*) INTO sobran
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t
      AND policyname <> t || '_solo_admin';

    IF sobran > 0 THEN
      RAISE EXCEPTION
        'En % han quedado % politicas ademas de la de admin. Como las permisivas se suman, la tabla sigue abierta.',
        t, sobran;
    END IF;
  END LOOP;
END $$;

-- Para deshacerlo: las políticas viejas están en 004_create_finances_tables.sql,
-- 024_create_employee_payment_adjustments.sql y 045.
