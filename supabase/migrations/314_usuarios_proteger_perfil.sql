-- ============================================================================
-- 314 · USUARIOS: EL PUESTO Y «SI LLAMA» PROTEGIDOS, Y LAS CASILLAS CERRADAS AL CEO
-- ============================================================================
-- 14 nov 2026. Dos agujeros que solo cerraba la interfaz:
--
--   1) `profiles`: la política «Users can update own profile» (migración 001) deja a cada uno actualizar SU fila, y el trigger guardar_rol_de_perfil (133) solo protegía
--      `role` y `email`. Desde la consola del navegador cualquiera podía hacer `update profiles set puesto = null` sobre sí mismo. Lo grave: un CEO (role 'admin' + puesto
--      'ceo', migración 290) se quitaba el puesto y pasaba a ser administrador PLENO, saltándose las casillas. Y un empleado podía ponerse is_comercial = true y salir en el
--      equipo de Cold Calling y en la Agenda. Ahora el trigger protege también `puesto` e `is_comercial`, y solo deja cambiar los cuatro a un administrador PLENO (no CEO)
--      o al servidor (service_role: la pantalla de Gestión de Usuarios pasa por /api/users).
--
--   2) `user_app_permissions`: las políticas de escritura (017 y 025) dejaban insertar, actualizar y borrar a cualquier role = 'admin'. Un CEO podía darse desde el
--      navegador todas las casillas que se le quitaron (Chat y Tareas de clientes incluidas). Ahora escribir es solo de un administrador PLENO. LEER sigue igual para todo
--      administrador (CEO incluido): leer casillas no da acceso a nada y hay pantallas que lo hacen.
--
-- Usa public.is_erp_admin(uuid) (migración 111) y una función nueva, public.is_erp_admin_pleno(uuid) = is_erp_admin y puesto distinto de 'ceo'.
-- Las políticas viejas de escritura se borran por NOMBRE (las cuatro de la 017 y las cuatro de la 025); la de «cada uno ve las suyas» no se toca.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar. Hacen falta antes la 111 (is_erp_admin), la 133 (el trigger) y la 257 (puesto).
-- Para deshacerlo: volver a pegar el bloque 1 de la 133 y las políticas de la 025.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.is_erp_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta public.is_erp_admin(uuid) (migración 111_employees.sql).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'puesto') THEN
    RAISE EXCEPTION 'Falta lanzar antes la migración 257_listas_de_leads_y_puestos.sql (la columna profiles.puesto).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_comercial') THEN
    RAISE EXCEPTION 'Falta la columna profiles.is_comercial (migración 073).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 0. Administrador PLENO: admin y no CEO
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER para que lea `profiles` sin pasar por su RLS (igual que is_erp_admin). search_path fijo para que nadie la engañe con otra tabla `profiles`.
-- CREATE OR REPLACE y no DROP + CREATE: al volver a pegar la migración, las políticas de abajo ya dependen de ella y un DROP fallaría.
CREATE OR REPLACE FUNCTION public.is_erp_admin_pleno(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_erp_admin(uid)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.puesto = 'ceo');
$$;

REVOKE ALL ON FUNCTION public.is_erp_admin_pleno(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_erp_admin_pleno(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1. El trigger de profiles: role, email, puesto e is_comercial
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER a propósito (como en la 133): decide mirando `current_user`, el rol que PostgREST fija según el JWT (`anon`, `authenticated` o `service_role`).
-- Solo se frena a quien entra con la clave pública; service_role (las rutas de /api/users), postgres (el editor SQL) y supabase_auth_admin pasan.
CREATE OR REPLACE FUNCTION public.guardar_rol_de_perfil()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.puesto IS DISTINCT FROM OLD.puesto
     OR NEW.is_comercial IS DISTINCT FROM OLD.is_comercial THEN
    IF current_user IN ('authenticated', 'anon')
       AND NOT public.is_erp_admin_pleno(auth.uid()) THEN
      RAISE EXCEPTION
        'El rol, el correo, el puesto y si llama de un perfil solo los cambia un administrador desde Gestión de Usuarios (perfil %)', OLD.id
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

-- ----------------------------------------------------------------------------
-- 2. user_app_permissions: escribir, solo un administrador PLENO
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_app_permissions ENABLE ROW LEVEL SECURITY;

-- Las de la 017
DROP POLICY IF EXISTS "Admins can insert user permissions" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admins can update user permissions" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admins can delete user permissions" ON public.user_app_permissions;
-- Las de la 025
DROP POLICY IF EXISTS "Admins can insert permissions" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admins can update permissions" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admins can delete permissions" ON public.user_app_permissions;
-- Las de esta migración, por si se vuelve a pegar
DROP POLICY IF EXISTS "Admin pleno inserta casillas" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admin pleno cambia casillas" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admin pleno borra casillas" ON public.user_app_permissions;

CREATE POLICY "Admin pleno inserta casillas"
  ON public.user_app_permissions FOR INSERT TO authenticated
  WITH CHECK (public.is_erp_admin_pleno(auth.uid()));

CREATE POLICY "Admin pleno cambia casillas"
  ON public.user_app_permissions FOR UPDATE TO authenticated
  USING (public.is_erp_admin_pleno(auth.uid()))
  WITH CHECK (public.is_erp_admin_pleno(auth.uid()));

CREATE POLICY "Admin pleno borra casillas"
  ON public.user_app_permissions FOR DELETE TO authenticated
  USING (public.is_erp_admin_pleno(auth.uid()));

-- ----------------------------------------------------------------------------
-- COMPROBACIÓN: tiene que salir UNA fila con todo en `true`
-- ----------------------------------------------------------------------------
SELECT
  to_regprocedure('public.is_erp_admin_pleno(uuid)') IS NOT NULL                                              AS funcion_admin_pleno,
  pg_get_functiondef('public.guardar_rol_de_perfil()'::regprocedure) LIKE '%is_comercial%'                     AS trigger_protege_is_comercial,
  pg_get_functiondef('public.guardar_rol_de_perfil()'::regprocedure) LIKE '%NEW.puesto%'                       AS trigger_protege_puesto,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guardar_rol_de_perfil' AND tgrelid = 'public.profiles'::regclass) AS trigger_puesto,
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_app_permissions'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND COALESCE(qual, '') || COALESCE(with_check, '') NOT LIKE '%is_erp_admin_pleno%'
  )                                                                                                             AS escribir_casillas_solo_admin_pleno;
