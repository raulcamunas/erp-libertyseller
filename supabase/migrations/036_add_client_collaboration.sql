-- =====================================================
-- SISTEMA DE COLABORACIÓN PARA CLIENTES
-- =====================================================

-- Tabla de miembros por cliente (usuarios que tienen acceso a un cliente)
CREATE TABLE IF NOT EXISTS public.client_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.client_canvas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(client_id, user_id)
);

-- Tabla de comentarios en tareas
CREATE TABLE IF NOT EXISTS public.task_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.client_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_client_members_client_id ON public.client_members(client_id);
CREATE INDEX IF NOT EXISTS idx_client_members_user_id ON public.client_members(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON public.task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON public.task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON public.task_comments(created_at DESC);

-- Trigger para actualizar updated_at en task_comments
DROP TRIGGER IF EXISTS trigger_update_task_comments_updated_at ON public.task_comments;
CREATE TRIGGER trigger_update_task_comments_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS
ALTER TABLE public.client_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para client_members
-- Eliminar políticas existentes si existen
DROP POLICY IF EXISTS "Users can view client members of accessible clients" ON public.client_members;
DROP POLICY IF EXISTS "Users can add members to accessible clients" ON public.client_members;
DROP POLICY IF EXISTS "Users can remove members from accessible clients" ON public.client_members;
DROP POLICY IF EXISTS "Authenticated users can manage client members" ON public.client_members;
DROP POLICY IF EXISTS "Users can view their own client memberships" ON public.client_members;
DROP POLICY IF EXISTS "Creators and admins can view all members" ON public.client_members;
DROP POLICY IF EXISTS "Creators and admins can add members" ON public.client_members;
DROP POLICY IF EXISTS "Creators and admins can remove members" ON public.client_members;
DROP POLICY IF EXISTS "Users can view members of their clients" ON public.client_members;

-- Política simple: Los usuarios pueden ver miembros de clientes que crearon
CREATE POLICY "Creators can view all members"
  ON public.client_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_members.client_id
      AND client_canvas.created_by = auth.uid()
    )
  );

-- Política: Los usuarios pueden ver sus propias membresías
CREATE POLICY "Users can view own membership"
  ON public.client_members
  FOR SELECT
  USING (user_id = auth.uid());

-- Política: Los admins pueden ver todo
CREATE POLICY "Admins can view all members"
  ON public.client_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Los creadores y admins pueden añadir miembros
CREATE POLICY "Creators and admins can add members"
  ON public.client_members
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_members.client_id
      AND (
        client_canvas.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  );

-- Los creadores y admins pueden eliminar miembros
CREATE POLICY "Creators and admins can remove members"
  ON public.client_members
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_members.client_id
      AND (
        client_canvas.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
    )
  );

-- Políticas RLS para task_comments
-- Eliminar política existente si existe
DROP POLICY IF EXISTS "Authenticated users can manage task comments" ON public.task_comments;

CREATE POLICY "Authenticated users can manage task comments"
  ON public.task_comments
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Asegurar que assigned_to en client_tasks referencia profiles
-- (Ya debería estar así, pero lo verificamos)
-- Si no existe, añadimos la foreign key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'client_tasks_assigned_to_fkey'
  ) THEN
    ALTER TABLE public.client_tasks
    ADD CONSTRAINT client_tasks_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

