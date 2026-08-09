-- =====================================================
-- 133 · DOS PUERTAS ABIERTAS EN LA BASE DE DATOS
-- =====================================================
-- Esta migración NO crea ni una tabla, ni una columna, ni una función nueva.
-- Solo QUITA dos permisos que nunca se quisieron dar y que están REPRODUCIDOS
-- contra la base de producción, uno por uno, con la salida literal pegada aquí
-- debajo.
--
-- Se lanza en el editor SQL de Supabase.
-- IDEMPOTENTE: se puede volver a pegar sin romper nada. Todo lo frágil va
-- dentro de un bloque DO, porque el editor ejecuta el fichero entero en UNA
-- transacción y un solo error aborta hasta lo que ya había funcionado.
--
--
-- ============ 1. UN EMPLEADO SE ASCENDÍA A ADMIN ÉL SOLO ============
--
-- La migración 001 dejó escrito en un comentario «Los usuarios pueden
-- actualizar su propio perfil (excepto el rol)» y luego NO puso el «excepto el
-- rol» en ningún sitio: la política es
--
--     FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id)
--
-- sin acotar columnas, y no hay ningún REVOKE de UPDATE a `authenticated`.
--
-- LO QUE COLABA, ejecutado contra la base de VERDAD con una cuenta de rol
-- `employee` y la clave anónima (la que viaja en el bundle de JavaScript):
--
--     antes  : employee
--     PATCH {SUPABASE_URL}/rest/v1/profiles?id=eq.<su_propio_uid>
--       Authorization: Bearer <su JWT de employee>
--       {"role":"admin"}
--     ->  HTTP 200  [{"...","role":"admin",...}]
--     después: admin
--
-- (revertido a employee en el acto). Y como el registro está abierto, la cadena
-- completa es: cualquiera de internet -> se registra -> employee -> admin. Con
-- admin se entra a /dashboard/users, a los refresh tokens de Amazon de los 16
-- clientes, a los sueldos y a la tesorería.
--
-- `email` va con el rol en la misma cerradura, y no por simetría: es una llave
-- de verdad en este ERP. app/dashboard/agenda/desglose/page.tsx da visión de
-- TODO el equipo a quien tenga uno de dos correos concretos
-- (FULL_ACCESS_EMAILS), y middleware.ts:104 abre /dashboard/users a un admin
-- con un correo concreto. Sin esta guarda, cambiarse el propio `email` a mano
-- por PATCH era media escalada gratis.
--
--
-- ============ 2. UN ANÓNIMO BORRABA EL HISTÓRICO DE HORAS ============
--
-- Las migraciones 059, 062 y 063 crearon las tres funciones de borrado del
-- tracker como SECURITY DEFINER y solo escribieron
-- `GRANT EXECUTE ... TO authenticated`. Ese GRANT es DECORATIVO: Postgres
-- concede EXECUTE a PUBLIC por defecto en cada función nueva, y en ningún sitio
-- se hizo el REVOKE, así que `anon` lo heredaba.
--
-- LO QUE COLABA, con SOLO la NEXT_PUBLIC_SUPABASE_ANON_KEY y sin sesión:
--
--     POST /rest/v1/rpc/delete_tracker_log    {"p_log_id":"<uuid inexistente>"}
--       -> HTTP 200  false
--     POST /rest/v1/rpc/delete_tracker_report {"p_report_id":"<uuid inexistente>"}
--       -> HTTP 200  false
--
-- Ese 200 es la función EJECUTÁNDOSE y contestando «no había nada con ese id».
-- Se usaron ids inexistentes a propósito para no borrar nada real. Con un
-- `p_employee_id` de verdad y un rango de fechas amplio, `delete_tracker_reports`
-- vacía las 6.993 filas de tracker_logs, que son la fuente con la que se calcula
-- lo que se le paga a cada persona. El CONTRASTE está en la misma base: una
-- función bien revocada (plataforma_buybox_resumen) contesta
-- «42501 permission denied» a esa misma llamada.
--
-- Lo mismo con las dos de inserción (023 y 061), solo que ahí el GRANT a `anon`
-- es EXPLÍCITO: `insert_tracker_report` con la clave anónima y sin sesión
-- devolvió «22007 invalid input syntax for type timestamp» — o sea el error del
-- CUERPO de la función: la ejecución había entrado.
--
--
-- ============ POR QUÉ NADA DE ESTO CAMBIA LO QUE HACE EL ERP ============
--
--   · Perfiles: NINGUNA pantalla del ERP deja hoy a nadie cambiarse el rol ni
--     el correo. Comprobado buscando en app/, components/ y lib/: los ÚNICOS
--     sitios del repositorio que escriben en `profiles` son
--     app/api/users/update/route.ts y app/api/users/create/route.ts, y los dos
--     lo hacen con SUPABASE_SERVICE_ROLE_KEY. Por eso la guarda deja pasar
--     `service_role`: si no, la pantalla de usuarios dejaría de poder cambiar
--     roles, que es justo su función.
--
--   · Tracker: las tres de borrado las llama components/tracker/TrackerDashboard.tsx
--     y las dos de inserción components/tracker/AddManualHoursModal.tsx, todas
--     desde el navegador CON sesión (rol `authenticated`, que conserva el
--     permiso), y /api/tracker/ingest desde el servidor con service_role, al que
--     se le concede explícitamente más abajo.
--
--
-- ============ SI ALGO SE ROMPE, ESTO ES LO QUE HAY QUE DESHACER ============
--
-- Cada bloque lleva debajo la línea exacta para revertirlo. El único punto con
-- alguna duda razonable son las DOS FUNCIONES DE INSERCIÓN del tracker: la
-- migración 023 le dio EXECUTE a `anon` a propósito, con el comentario «desde
-- extensión». Hoy la extensión entra por app/api/tracker/ingest/route.ts —que
-- por eso tiene cabeceras CORS con Access-Control-Allow-Origin: *— y esa ruta
-- usa service_role, así que quitarle el permiso a `anon` no la toca. Pero si la
-- extensión desplegada hablara con PostgREST directamente con la clave anónima,
-- DEJARÍA DE REGISTRAR HORAS Y SIN DAR NINGÚN ERROR VISIBLE.
--
-- Dos datos para valorarlo: la última fila del tracker es del 2026-01-02, siete
-- meses sin actividad; y /api/tracker/ingest coge la anon key como respaldo si
-- falta SUPABASE_SERVICE_ROLE_KEY (línea 43), así que en un servidor sin esa
-- variable la ruta también se quedaría fuera.
--
-- SI EL TRACKER DEJA DE GRABAR, ESTA ES LA PRIMERA SOSPECHA, y se deshace con:
--     GRANT EXECUTE ON FUNCTION public.insert_tracker_report(TEXT, TIMESTAMPTZ) TO anon;
--     GRANT EXECUTE ON FUNCTION public.insert_tracker_log(UUID, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;


-- =====================================================
-- 1. PERFILES: EL ROL Y EL CORREO NO SE TOCAN DESDE EL NAVEGADOR
-- =====================================================

-- Guarda previa, igual que en las migraciones 116, 118 y 120: si no existiera
-- is_erp_admin() la comprobación de más abajo daría siempre falso y dejaría
-- fuera hasta a los administradores.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella esta guarda dejaría fuera a los propios administradores.';
  END IF;
END $$;

-- SECURITY INVOKER (el modo por defecto, no se pone SECURITY DEFINER) Y ES
-- IMPRESCINDIBLE: la guarda decide mirando `current_user`, que es el rol que
-- PostgREST fija con SET LOCAL ROLE según el JWT —`anon`, `authenticated` o
-- `service_role`—. Con SECURITY DEFINER, `current_user` pasaría a ser el dueño
-- de la función y la comprobación no distinguiría a nadie.
--
-- Se comprueba `current_user` y no `auth.role()` porque el primero es el rol de
-- verdad de la conexión: no depende de que el JWT traiga o no el claim.
CREATE OR REPLACE FUNCTION public.guardar_rol_de_perfil()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.email IS DISTINCT FROM OLD.email THEN
    -- Solo se frena a quien entra por PostgREST con la clave pública. Todo lo
    -- demás pasa: `service_role` (la pantalla de usuarios), `postgres` y el
    -- mantenimiento desde el editor SQL, y `supabase_auth_admin` por si algún
    -- día un trigger de auth sincroniza el correo.
    IF current_user IN ('authenticated', 'anon')
       AND NOT public.is_erp_admin(auth.uid()) THEN
      RAISE EXCEPTION
        'El rol y el correo de un perfil solo los puede cambiar un administrador desde la pantalla de usuarios (perfil %)', OLD.id
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guardar_rol_de_perfil ON public.profiles;
CREATE TRIGGER guardar_rol_de_perfil
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guardar_rol_de_perfil();

-- Para deshacerlo:
--     DROP TRIGGER IF EXISTS guardar_rol_de_perfil ON public.profiles;


-- =====================================================
-- 2. TRACKER: LAS CINCO FUNCIONES DEJAN DE SER PÚBLICAS
-- =====================================================
-- El REVOKE va dentro de un DO con comprobación de existencia porque una
-- función que no esté (por una migración que no se llegó a lanzar en una copia
-- de la base) abortaría el fichero ENTERO, incluida la guarda de perfiles de
-- arriba.
--
-- El orden importa: primero REVOKE FROM PUBLIC —que es de donde viene el
-- permiso heredado— y después el GRANT a los dos roles que sí tienen que poder.
DO $$
DECLARE
  fn TEXT;
  firmas TEXT[] := ARRAY[
    'public.delete_tracker_reports(TEXT, TIMESTAMPTZ, TIMESTAMPTZ)',
    'public.delete_tracker_report(UUID)',
    'public.delete_tracker_log(UUID)',
    'public.insert_tracker_report(TEXT, TIMESTAMPTZ)',
    'public.insert_tracker_log(UUID, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ)'
  ];
BEGIN
  FOREACH fn IN ARRAY firmas LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE NOTICE 'No existe %, se salta', fn;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    RAISE NOTICE 'Cerrada a anon: %', fn;
  END LOOP;
END $$;

-- Para deshacerlo (solo si el tracker deja de grabar; ver la cabecera):
--     GRANT EXECUTE ON FUNCTION public.insert_tracker_report(TEXT, TIMESTAMPTZ) TO anon;
--     GRANT EXECUTE ON FUNCTION public.insert_tracker_log(UUID, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;


-- =====================================================
-- CÓMO COMPROBAR QUE HA FUNCIONADO
-- =====================================================
-- 1) Con un JWT de rol employee y la clave anónima:
--      PATCH /rest/v1/profiles?id=eq.<su_uid>  {"role":"admin"}
--    Antes: HTTP 200 y el rol cambiaba. Ahora: error 42501 con el mensaje de
--    arriba, y el rol se queda como estaba.
--
-- 2) Con SOLO la clave anónima y sin sesión:
--      POST /rest/v1/rpc/delete_tracker_log {"p_log_id":"<uuid cualquiera>"}
--    Antes: HTTP 200 `false`. Ahora: 401/403 con «42501 permission denied».
--
-- 3) Que lo de siempre sigue igual: entrar en /dashboard/users como
--    administrador y cambiarle el rol a alguien (tiene que seguir funcionando,
--    va por service_role), y abrir el tracker con sesión y borrar un registro.
