-- =====================================================
-- PERMITIR EDICIÓN DE COMENTARIOS SOLO AL AUTOR
-- =====================================================

-- Eliminar política genérica existente
DROP POLICY IF EXISTS "Authenticated users can manage task comments" ON public.task_comments;

-- Política: Los usuarios pueden ver comentarios de tareas accesibles
CREATE POLICY "Users can view comments of accessible tasks"
  ON public.task_comments
  FOR SELECT
  USING (
    -- Verificar que la tarea es accesible usando función helper
    EXISTS (
      SELECT 1 FROM public.client_tasks
      WHERE client_tasks.id = task_comments.task_id
      AND (
        -- Es creador del cliente
        public.is_user_client_creator(client_tasks.client_id, auth.uid())
        -- O es miembro del cliente
        OR public.is_user_client_member(client_tasks.client_id, auth.uid())
        -- O es admin
        OR public.get_user_role_safe(auth.uid()) = 'admin'
      )
    )
  );

-- Política: Los usuarios pueden crear comentarios en tareas accesibles
CREATE POLICY "Users can create comments in accessible tasks"
  ON public.task_comments
  FOR INSERT
  WITH CHECK (
    -- Verificar que la tarea es accesible
    EXISTS (
      SELECT 1 FROM public.client_tasks
      WHERE client_tasks.id = task_comments.task_id
      AND (
        -- Es creador del cliente
        public.is_user_client_creator(client_tasks.client_id, auth.uid())
        -- O es miembro del cliente
        OR public.is_user_client_member(client_tasks.client_id, auth.uid())
        -- O es admin
        OR public.get_user_role_safe(auth.uid()) = 'admin'
      )
    )
    -- Y el usuario es el que está creando el comentario
    AND user_id = auth.uid()
  );

-- Política: Solo el autor puede actualizar su comentario
CREATE POLICY "Users can update their own comments"
  ON public.task_comments
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Política: Solo el autor puede eliminar su comentario (o admins)
CREATE POLICY "Users can delete their own comments or admins can delete any"
  ON public.task_comments
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

