-- =====================================================
-- RESTRINGIR ACCESO DE PARTNERS A CLIENTES
-- =====================================================

-- Eliminar políticas existentes de client_canvas
DROP POLICY IF EXISTS "Authenticated users can manage client canvas" ON public.client_canvas;
DROP POLICY IF EXISTS "Users can view their own clients" ON public.client_canvas;
DROP POLICY IF EXISTS "Partners can view their client memberships" ON public.client_canvas;

-- Política: Los usuarios pueden ver clientes que crearon
CREATE POLICY "Users can view their own clients"
  ON public.client_canvas
  FOR SELECT
  USING (created_by = auth.uid());

-- Política: Los usuarios pueden ver clientes donde son miembros
CREATE POLICY "Users can view clients where they are members"
  ON public.client_canvas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.client_members
      WHERE client_members.client_id = client_canvas.id
      AND client_members.user_id = auth.uid()
    )
  );

-- Política: Los admins pueden ver todos los clientes
CREATE POLICY "Admins can view all clients"
  ON public.client_canvas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Política: Los usuarios pueden crear clientes
CREATE POLICY "Users can create clients"
  ON public.client_canvas
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Política: Los usuarios pueden actualizar clientes que crearon
CREATE POLICY "Users can update their own clients"
  ON public.client_canvas
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Política: Los admins pueden actualizar cualquier cliente
CREATE POLICY "Admins can update all clients"
  ON public.client_canvas
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Política: Los usuarios pueden eliminar clientes que crearon
CREATE POLICY "Users can delete their own clients"
  ON public.client_canvas
  FOR DELETE
  USING (created_by = auth.uid());

-- Política: Los admins pueden eliminar cualquier cliente
CREATE POLICY "Admins can delete all clients"
  ON public.client_canvas
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Eliminar políticas existentes de client_tasks
DROP POLICY IF EXISTS "Authenticated users can manage client tasks" ON public.client_tasks;
DROP POLICY IF EXISTS "Users can view tasks of their clients" ON public.client_tasks;
DROP POLICY IF EXISTS "Partners can view tasks of their client memberships" ON public.client_tasks;

-- Política: Los usuarios pueden ver tareas de clientes que crearon
CREATE POLICY "Users can view tasks of their clients"
  ON public.client_tasks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_tasks.client_id
      AND client_canvas.created_by = auth.uid()
    )
  );

-- Política: Los usuarios pueden ver tareas de clientes donde son miembros
CREATE POLICY "Users can view tasks where they are members"
  ON public.client_tasks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.client_members
      WHERE client_members.client_id = client_tasks.client_id
      AND client_members.user_id = auth.uid()
    )
  );

-- Política: Los admins pueden ver todas las tareas
CREATE POLICY "Admins can view all tasks"
  ON public.client_tasks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Política: Los usuarios pueden crear tareas en clientes que crearon o donde son miembros
CREATE POLICY "Users can create tasks in accessible clients"
  ON public.client_tasks
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_tasks.client_id
      AND (
        client_canvas.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.client_members
          WHERE client_members.client_id = client_canvas.id
          AND client_members.user_id = auth.uid()
        )
      )
    )
  );

-- Política: Los usuarios pueden actualizar tareas en clientes que crearon o donde son miembros
CREATE POLICY "Users can update tasks in accessible clients"
  ON public.client_tasks
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_tasks.client_id
      AND (
        client_canvas.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.client_members
          WHERE client_members.client_id = client_canvas.id
          AND client_members.user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_tasks.client_id
      AND (
        client_canvas.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.client_members
          WHERE client_members.client_id = client_canvas.id
          AND client_members.user_id = auth.uid()
        )
      )
    )
  );

-- Política: Los usuarios pueden eliminar tareas en clientes que crearon o donde son miembros
CREATE POLICY "Users can delete tasks in accessible clients"
  ON public.client_tasks
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_tasks.client_id
      AND (
        client_canvas.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.client_members
          WHERE client_members.client_id = client_canvas.id
          AND client_members.user_id = auth.uid()
        )
      )
    )
  );


