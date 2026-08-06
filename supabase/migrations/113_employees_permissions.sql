-- =====================================================
-- CONTROL EMPLEADOS: permisos de la app
-- =====================================================
-- La app se llama 'empleados' y ese id tiene que coincidir exactamente en
-- tres sitios o el módulo queda invisible sin dar ningún error:
--   - lib/config/apps.ts (menú lateral y parrilla del dashboard),
--   - el bloque de /dashboard/empleados en middleware.ts,
--   - la columna app_id de esta tabla.
--
-- OJO CON LO QUE ESTA MIGRACIÓN NO HACE: no le da acceso a ningún employee, y
-- no es un olvido. Aquí está el sueldo de todo el equipo, así que la app es
-- solo de admin —ni siquiera de los socios, que sí ven Tesorería—.
--
-- Y aunque alguien insertara a mano una fila dándole el permiso a un employee,
-- no entraría: el filtro de verdad no es esta tabla, son las políticas RLS de
-- la migración 111, que van contra public.is_erp_admin(). Esta tabla solo
-- decide qué se pinta en el menú.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_app_permissions'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN

    -- Los admins ya pasan todos los filtros por rol, pero se les deja la fila
    -- para que el permiso quede explícito en la tabla y la pantalla de gestión
    -- de usuarios enseñe la app marcada en vez de en blanco.
    INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
    SELECT p.id, 'empleados', true
    FROM public.profiles p
    WHERE p.role = 'admin'
    ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

    -- Y por si en alguna base quedó suelta una fila de este id para alguien
    -- que no es admin: se retira. Idempotente, como el resto.
    UPDATE public.user_app_permissions up
    SET can_access = false
    FROM public.profiles p
    WHERE up.user_id = p.id
      AND up.app_id = 'empleados'
      AND p.role <> 'admin'
      AND up.can_access;

  END IF;
END $$;
