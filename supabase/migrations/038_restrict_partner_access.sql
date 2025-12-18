-- =====================================================
-- RESTRINGIR ACCESO DE PARTNERS
-- =====================================================

-- Las políticas existentes ya permiten que los usuarios vean su propio perfil
-- y los admins vean todos. Necesitamos asegurar que los partners NO puedan
-- ver otros perfiles incluso si son admins en otras políticas.

-- La política "Users can view own profile" ya cubre que los partners vean su propio perfil
-- La política "Admins can view all profiles" solo aplica a admins, no a partners

-- Asegurar que los partners no puedan ver otros perfiles
-- NOTA: La política de admins se corrige en la migración 041_fix_profiles_rls_recursion.sql
-- usando una función SECURITY DEFINER para evitar recursión infinita.
-- No modificamos la política aquí para evitar conflictos.

-- La política "Users can view own profile" ya asegura que todos (incluidos partners)
-- pueden ver su propio perfil, así que no necesitamos cambiarla.

-- Asegurar que los partners no puedan actualizar otros perfiles
-- La política existente "Users can update own profile" ya cubre esto correctamente
-- porque solo permite actualizar cuando auth.uid() = id

-- Verificar que los partners solo puedan ver clientes donde son miembros
-- Esto ya está cubierto por las políticas de client_canvas y client_members
-- que verifican membresía antes de permitir acceso

