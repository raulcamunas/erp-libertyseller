-- =====================================================
-- SCRIPT COMPLETO PARA CREAR USUARIO ALEJANDRO
-- =====================================================
-- 
-- INSTRUCCIONES:
-- 1. Primero crea el usuario desde la aplicación en /auth/signup
--    Email: alejandrogamez@gmail.com
--    Contraseña: libertyseller.123
--    Nombre: Alejandro
--
-- 2. Luego ejecuta este SQL para asignar el permiso de LinkedIn
--
-- =====================================================

-- Verificar si el usuario existe
DO $$
DECLARE
  v_user_id UUID;
  v_profile_exists BOOLEAN;
BEGIN
  -- Buscar el ID del usuario por email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'alejandrogamez@gmail.com';

  IF v_user_id IS NOT NULL THEN
    RAISE NOTICE 'Usuario encontrado: %', v_user_id;
    
    -- Verificar si existe el perfil
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_user_id) INTO v_profile_exists;
    
    IF NOT v_profile_exists THEN
      -- Crear perfil si no existe
      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES (v_user_id, 'alejandrogamez@gmail.com', 'Alejandro', 'employee')
      ON CONFLICT (id) DO NOTHING;
      
      RAISE NOTICE 'Perfil creado para el usuario';
    END IF;

    -- Eliminar todos los permisos existentes de este usuario
    DELETE FROM public.user_app_permissions
    WHERE user_id = v_user_id;

    -- Crear permiso SOLO para LinkedIn Prospección
    INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
    VALUES (v_user_id, 'linkedin', true)
    ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

    RAISE NOTICE 'Permiso de LinkedIn Prospección asignado correctamente';
  ELSE
    RAISE NOTICE 'ERROR: Usuario no encontrado. Por favor crea el usuario primero desde /auth/signup';
    RAISE NOTICE 'Email: alejandrogamez@gmail.com';
    RAISE NOTICE 'Contraseña: libertyseller.123';
  END IF;
END $$;

-- Verificar resultado
SELECT 
  p.email,
  p.full_name,
  p.role,
  uap.app_id,
  uap.can_access,
  CASE 
    WHEN uap.app_id = 'linkedin' THEN '✅ Tiene acceso'
    ELSE '❌ Sin acceso'
  END as estado
FROM public.profiles p
LEFT JOIN public.user_app_permissions uap ON p.id = uap.user_id
WHERE p.email = 'alejandrogamez@gmail.com'
ORDER BY uap.app_id;


