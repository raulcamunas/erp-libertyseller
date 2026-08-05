-- =====================================================
-- ACCESO AL MÓDULO «MARKETING» (Amazon Ads)
-- =====================================================
-- La app se llama 'marketing-ads' y NO 'marketing': ese id era el de la app
-- antigua que se retiró del menú, y reutilizarlo le abriría este módulo a
-- cualquiera que aún arrastre aquel permiso en user_app_permissions.
--
-- El menú lateral y la parrilla del dashboard solo enseñan a un employee las
-- apps que tenga en user_app_permissions, y el middleware redirige a
-- /dashboard si no hay fila, así que sin esto el especialista de PPC no vería
-- el módulo aunque las políticas RLS de la 103 (is_marketing_team) sí le
-- dejen leer y escribir los datos.

-- Guarda por si esta migración se ejecuta sobre una base recién creada donde
-- todavía no están las tablas de usuarios: un INSERT contra una tabla que no
-- existe aborta la migración entera en el editor SQL de Supabase.
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
    -- para que el permiso quede explícito en la tabla y la pantalla de
    -- gestión de usuarios enseñe la app marcada en vez de en blanco.
    INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
    SELECT p.id, 'marketing-ads', true
    FROM public.profiles p
    WHERE p.role = 'admin'
    ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

  END IF;
END $$;

-- ---------- Especialista de PPC y demás equipo de marketing ----------
-- Se deja preparado y sin ejecutar a propósito: quién lleva las campañas es
-- una decisión de negocio y meter aquí una lista adivinada le abriría las
-- cuentas de los clientes a quien no toca. Descomenta el bloque y pon los
-- correos reales antes de lanzar la migración.
--
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM information_schema.tables
--     WHERE table_schema = 'public' AND table_name = 'user_app_permissions'
--   ) THEN
--     INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
--     SELECT p.id, 'marketing-ads', true
--     FROM public.profiles p
--     WHERE p.email IN (
--       'correo-del-especialista@libertyseller.com'
--     )
--     ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;
--   END IF;
-- END $$;
