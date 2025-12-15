-- =====================================================
-- CREAR USUARIO ALEJANDRO CON PERMISOS
-- =====================================================
-- 
-- NOTA: Este script asume que el usuario ya existe en auth.users
-- Si el usuario no existe, créalo primero desde la aplicación o usa la API
--
-- Para crear el usuario desde la aplicación:
-- 1. Ve a /auth/signup
-- 2. Regístrate con: alejandrogamez@gmail.com / libertyseller.123
-- 3. Luego ejecuta este SQL para asignar permisos
--
-- =====================================================

-- Opción 1: Si el usuario YA EXISTE, solo asignar permisos
-- (Ejecuta esto después de crear el usuario desde la app)

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Buscar el ID del usuario por email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'alejandrogamez@gmail.com';

  -- Si el usuario existe, asignar permiso de LinkedIn
  IF v_user_id IS NOT NULL THEN
    -- Eliminar permisos existentes de LinkedIn si los hay
    DELETE FROM public.user_app_permissions
    WHERE user_id = v_user_id AND app_id = 'linkedin';

    -- Crear permiso de LinkedIn Prospección
    INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
    VALUES (v_user_id, 'linkedin', true)
    ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

    RAISE NOTICE 'Permiso de LinkedIn asignado al usuario %', v_user_id;
  ELSE
    RAISE NOTICE 'Usuario no encontrado. Por favor crea el usuario primero desde /auth/signup';
  END IF;
END $$;

-- Verificar que se creó correctamente
SELECT 
  p.email,
  p.full_name,
  p.role,
  uap.app_id,
  uap.can_access
FROM public.profiles p
LEFT JOIN public.user_app_permissions uap ON p.id = uap.user_id
WHERE p.email = 'alejandrogamez@gmail.com';

