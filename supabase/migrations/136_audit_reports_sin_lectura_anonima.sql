-- =====================================================
-- 136 · LA TABLA DE INFORMES DE AUDITORÍA SE LEÍA ENTERA SIN SESIÓN
-- =====================================================
-- Esta migración NO crea ni una tabla, ni una columna, ni una función. Solo
-- QUITA una política de lectura que da acceso a todo el mundo.
--
-- Se lanza en el editor SQL de Supabase.
-- IDEMPOTENTE: se puede volver a pegar sin romper nada. Todo lo frágil va
-- dentro de bloques DO, porque el editor ejecuta el fichero entero en UNA
-- transacción y un solo error aborta hasta lo que ya había funcionado.
--
--
-- ============ EL AGUJERO ============
--
-- supabase/migrations/052_add_public_access_audit_reports.sql creó esto:
--
--     CREATE POLICY "Public can view audit reports by token"
--       ON public.audit_reports
--       FOR SELECT
--       TO anon, authenticated
--       USING (true);
--
-- El nombre dice «by token» y el USING dice `true`. RLS NO PUEDE VER el
-- `.eq('public_token', …)` que hace la ruta de API: el filtro lo pone quien
-- consulta, así que no acota a nadie. Con esa política, cualquiera con la
-- NEXT_PUBLIC_SUPABASE_ANON_KEY —que viaja en el bundle de JavaScript de la
-- web, o sea que la tiene cualquier visitante— se lleva la tabla entera:
--
--     GET {SUPABASE_URL}/rest/v1/audit_reports?select=*
--       apikey: <clave anónima>
--
-- y con ella los informes de auditoría de todos los clientes potenciales:
-- seller_url, métricas calculadas y el análisis de IA. No hace falta adivinar
-- ningún token.
--
-- NO ESTÁ REPRODUCIDO CONTRA PRODUCCIÓN a propósito: comprobarlo exigiría
-- pedirle a PostgREST datos de clientes potenciales, y la regla es no leer
-- datos personales para verificar un hallazgo. Lo que hay arriba es lo que dice
-- el SQL de la 052, que es suficiente para saber qué concede.
--
-- Por eso el cambio de Math.random() a crypto.getRandomValues() en
-- lib/parsers/helium.ts —que está bien y es gratis— no cerraba nada por sí
-- solo: el token no hay ni que adivinarlo mientras se pueda pedir la tabla.
--
--
-- ============ POR QUÉ NO ROMPE LOS ENLACES YA REPARTIDOS ============
--
-- Los informes compartidos NO los pide el navegador a PostgREST. La página
-- pública app/audit/share/[token]/page.tsx llama a
-- `/api/auditor/share/<token>`, que es código de servidor, y esa ruta ya
-- consulta con SUPABASE_SERVICE_ROLE_KEY, que se salta RLS. Comprobado que no
-- hay ningún otro sitio que toque esta tabla: las únicas coincidencias de
-- `audit_reports` en app/, components/ y lib/ son esa ruta y
-- app/api/auditor/upload/route.ts, que es de servidor y va con sesión.
--
-- El cambio de la ruta a la clave de servicio SE DESPLIEGA ANTES QUE ESTA
-- MIGRACIÓN. Hecho en ese orden, los enlaces de auditoría ya enviados siguen
-- abriendo exactamente igual antes y después.
--
-- La lectura desde dentro del ERP tampoco se toca: la política
-- "Authenticated users can view audit reports" de la migración 050 se queda
-- como está, así que quien tiene sesión sigue viendo lo mismo que hoy.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_reports'
      AND policyname = 'Public can view audit reports by token'
  ) THEN
    EXECUTE 'DROP POLICY "Public can view audit reports by token" ON public.audit_reports';
    RAISE NOTICE '136 · quitada la politica de lectura publica de audit_reports';
  ELSE
    RAISE NOTICE '136 · la politica de lectura publica de audit_reports ya no estaba';
  END IF;
END
$$;

-- Comprobación: después de esto, `anon` no debe tener ninguna política de
-- SELECT sobre audit_reports. Si sale alguna, es que hay otra puerta abierta
-- que esta migración no conoce.
DO $$
DECLARE
  restantes int;
BEGIN
  SELECT count(*) INTO restantes
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'audit_reports'
    AND cmd = 'SELECT'
    AND 'anon' = ANY (roles);

  IF restantes > 0 THEN
    RAISE WARNING '136 · OJO: quedan % politicas de SELECT sobre audit_reports que incluyen a anon', restantes;
  ELSE
    RAISE NOTICE '136 · audit_reports ya no se lee sin sesion';
  END IF;
END
$$;
