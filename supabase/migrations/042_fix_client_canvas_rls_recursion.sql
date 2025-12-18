-- =====================================================
-- CORREGIR RECURSIÓN INFINITA EN POLÍTICAS RLS DE CLIENT_CANVAS
-- =====================================================

-- Crear función helper para verificar membresía sin pasar por RLS
CREATE OR REPLACE FUNCTION public.is_user_client_member(client_id_param UUID, user_id_param UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_members.client_id = client_id_param
    AND client_members.user_id = user_id_param
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Crear función helper para verificar si un usuario es creador de un cliente (sin pasar por RLS)
CREATE OR REPLACE FUNCTION public.is_user_client_creator(client_id_param UUID, user_id_param UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.client_canvas
    WHERE client_canvas.id = client_id_param
    AND client_canvas.created_by = user_id_param
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Corregir políticas de client_canvas que consultan profiles
DROP POLICY IF EXISTS "Admins can view all clients" ON public.client_canvas;
DROP POLICY IF EXISTS "Admins can update all clients" ON public.client_canvas;
DROP POLICY IF EXISTS "Admins can delete all clients" ON public.client_canvas;

-- Política: Los admins pueden ver todos los clientes (usando función helper)
CREATE POLICY "Admins can view all clients"
  ON public.client_canvas
  FOR SELECT
  USING (
    public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los admins pueden actualizar cualquier cliente (usando función helper)
CREATE POLICY "Admins can update all clients"
  ON public.client_canvas
  FOR UPDATE
  USING (
    public.get_user_role_safe(auth.uid()) = 'admin'
  )
  WITH CHECK (
    public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los admins pueden eliminar cualquier cliente (usando función helper)
CREATE POLICY "Admins can delete all clients"
  ON public.client_canvas
  FOR DELETE
  USING (
    public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Eliminar políticas problemáticas de client_canvas
DROP POLICY IF EXISTS "Users can view clients where they are members" ON public.client_canvas;

-- Recrear la política usando la función helper para evitar recursión
CREATE POLICY "Users can view clients where they are members"
  ON public.client_canvas
  FOR SELECT
  USING (
    public.is_user_client_member(client_canvas.id, auth.uid())
  );

-- También corregir las políticas de client_tasks que consultan client_canvas
DROP POLICY IF EXISTS "Users can view tasks where they are members" ON public.client_tasks;
DROP POLICY IF EXISTS "Users can create tasks in accessible clients" ON public.client_tasks;
DROP POLICY IF EXISTS "Users can update tasks in accessible clients" ON public.client_tasks;
DROP POLICY IF EXISTS "Users can delete tasks in accessible clients" ON public.client_tasks;

-- Política: Los usuarios pueden ver tareas de clientes donde son miembros (usando función helper)
CREATE POLICY "Users can view tasks where they are members"
  ON public.client_tasks
  FOR SELECT
  USING (
    -- Es creador del cliente (usando función helper)
    public.is_user_client_creator(client_tasks.client_id, auth.uid())
    -- O es miembro del cliente (usando función helper)
    OR public.is_user_client_member(client_tasks.client_id, auth.uid())
  );

-- Política: Los usuarios pueden crear tareas en clientes accesibles
CREATE POLICY "Users can create tasks in accessible clients"
  ON public.client_tasks
  FOR INSERT
  WITH CHECK (
    -- Es creador del cliente (usando función helper)
    public.is_user_client_creator(client_tasks.client_id, auth.uid())
    -- O es miembro del cliente (usando función helper)
    OR public.is_user_client_member(client_tasks.client_id, auth.uid())
  );

-- Política: Los usuarios pueden actualizar tareas en clientes accesibles
CREATE POLICY "Users can update tasks in accessible clients"
  ON public.client_tasks
  FOR UPDATE
  USING (
    -- Es creador del cliente (usando función helper)
    public.is_user_client_creator(client_tasks.client_id, auth.uid())
    -- O es miembro del cliente (usando función helper)
    OR public.is_user_client_member(client_tasks.client_id, auth.uid())
  )
  WITH CHECK (
    -- Es creador del cliente (usando función helper)
    public.is_user_client_creator(client_tasks.client_id, auth.uid())
    -- O es miembro del cliente (usando función helper)
    OR public.is_user_client_member(client_tasks.client_id, auth.uid())
  );

-- Política: Los usuarios pueden eliminar tareas en clientes accesibles
CREATE POLICY "Users can delete tasks in accessible clients"
  ON public.client_tasks
  FOR DELETE
  USING (
    -- Es creador del cliente (usando función helper)
    public.is_user_client_creator(client_tasks.client_id, auth.uid())
    -- O es miembro del cliente (usando función helper)
    OR public.is_user_client_member(client_tasks.client_id, auth.uid())
  );

-- También corregir políticas de client_tasks que consultan profiles para admins
DROP POLICY IF EXISTS "Admins can view all tasks" ON public.client_tasks;

CREATE POLICY "Admins can view all tasks"
  ON public.client_tasks
  FOR SELECT
  USING (
    public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Corregir políticas de client_members que consultan client_canvas
DROP POLICY IF EXISTS "Creators and admins can view all members" ON public.client_members;
DROP POLICY IF EXISTS "Creators and admins can add members" ON public.client_members;
DROP POLICY IF EXISTS "Creators and admins can remove members" ON public.client_members;

-- Política: Los creadores y admins pueden ver todos los miembros de sus clientes
CREATE POLICY "Creators and admins can view all members"
  ON public.client_members
  FOR SELECT
  USING (
    -- Es creador del cliente (usando función helper)
    public.is_user_client_creator(client_members.client_id, auth.uid())
    -- O es admin
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los creadores y admins pueden añadir miembros
CREATE POLICY "Creators and admins can add members"
  ON public.client_members
  FOR INSERT
  WITH CHECK (
    -- Es creador del cliente (usando función helper)
    public.is_user_client_creator(client_members.client_id, auth.uid())
    -- O es admin
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los creadores y admins pueden eliminar miembros
CREATE POLICY "Creators and admins can remove members"
  ON public.client_members
  FOR DELETE
  USING (
    -- Es creador del cliente (usando función helper)
    public.is_user_client_creator(client_members.client_id, auth.uid())
    -- O es admin
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

