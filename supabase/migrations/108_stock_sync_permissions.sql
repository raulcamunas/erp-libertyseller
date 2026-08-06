-- =====================================================
-- ACCESO AL MÓDULO «SINCRONISMO DE STOCK»
-- =====================================================
-- La app se llama 'stock-sync' y ese id tiene que coincidir exactamente en
-- tres sitios o el módulo queda invisible sin dar ningún error:
--   - lib/config/apps.ts (menú lateral y parrilla del dashboard),
--   - el mapa routeToAppId de middleware.ts,
--   - la columna app_id de esta tabla.
--
-- Hace falta porque a un employee el menú solo le enseña las apps que tenga
-- en user_app_permissions, y el middleware le redirige a /dashboard si no hay
-- fila. Las políticas RLS de la 106 (is_stock_team) sí le dejan leer y
-- escribir, así que sin esta migración el permiso de datos existe pero la
-- puerta está cerrada: el síntoma es un redirect silencioso a /dashboard.

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
    SELECT p.id, 'stock-sync', true
    FROM public.profiles p
    WHERE p.role = 'admin'
    ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

  END IF;
END $$;

-- ---------- Quien sube el stock a Amazon ----------
-- Se deja preparado y sin ejecutar a propósito: este módulo escribe el
-- fichero que fija las unidades de todos los listings del cliente en Amazon,
-- y una lista de correos adivinada le daría a quien no toca la capacidad de
-- dejar un catálogo entero a cero. Descomenta el bloque y pon los correos
-- reales de la persona de operaciones antes de lanzar la migración.
--
-- DO $$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM information_schema.tables
--     WHERE table_schema = 'public' AND table_name = 'user_app_permissions'
--   ) THEN
--     INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
--     SELECT p.id, 'stock-sync', true
--     FROM public.profiles p
--     WHERE p.email IN (
--       'correo-de-operaciones@libertyseller.com'
--     )
--     ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;
--   END IF;
-- END $$;
