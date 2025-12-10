-- =====================================================
-- SCRIPT PARA INSERTAR MANUALMENTE UN USUARIO ADMIN
-- =====================================================
-- 
-- INSTRUCCIONES:
-- 1. Primero regístrate en la aplicación con tu email: tu@email.com
-- 2. Ejecuta este SQL en el SQL Editor de Supabase
-- 3. Reemplaza 'TU_USER_ID_AQUI' con el ID del usuario que acabas de crear
--
-- Para obtener el USER_ID:
-- SELECT id, email FROM auth.users WHERE email = 'tu@email.com';
--
-- =====================================================

-- Opción 1: Si ya conoces el USER_ID, ejecuta esto directamente:
-- UPDATE public.profiles 
-- SET role = 'admin' 
-- WHERE id = 'TU_USER_ID_AQUI';

-- Opción 2: Actualizar por email (más fácil)
UPDATE public.profiles 
SET role = 'admin' 
WHERE email = 'tu@email.com';

-- Verificar que se actualizó correctamente
SELECT id, email, full_name, role 
FROM public.profiles 
WHERE email = 'tu@email.com';

