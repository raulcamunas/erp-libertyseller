-- =====================================================
-- CORREGIR RECURSIÓN INFINITA EN POLÍTICAS RLS DE PROFILES
-- =====================================================

-- Crear función helper que use SECURITY DEFINER para obtener el rol sin pasar por RLS
CREATE OR REPLACE FUNCTION public.get_user_role_safe(user_id_param UUID)
RETURNS TEXT AS $$
  SELECT role::TEXT FROM public.profiles WHERE id = user_id_param;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Eliminar la política problemática
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- Crear nueva política que use la función helper para evitar recursión
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (
    public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- También corregir la política de actualización si existe
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

-- Si necesitamos que los admins puedan actualizar perfiles, usar la función helper
CREATE POLICY "Admins can update all profiles"
  ON public.profiles
  FOR UPDATE
  USING (
    public.get_user_role_safe(auth.uid()) = 'admin'
  )
  WITH CHECK (
    public.get_user_role_safe(auth.uid()) = 'admin'
  );


