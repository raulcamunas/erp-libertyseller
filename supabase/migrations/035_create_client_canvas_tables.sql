-- =====================================================
-- TABLAS PARA CANVAS CLIENTES (Tipo Notion)
-- =====================================================

-- Tabla de Clientes del Canvas
CREATE TABLE IF NOT EXISTS public.client_canvas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#FF6600', -- Color de la pestaña/tarjeta
  icon TEXT, -- Icono opcional (emoji o nombre)
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE(name)
);

-- Tabla de Tareas para cada Cliente
CREATE TABLE IF NOT EXISTS public.client_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.client_canvas(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'archived')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date TIMESTAMPTZ,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  position INTEGER DEFAULT 0 -- Para ordenar las tareas
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_client_canvas_created_at ON public.client_canvas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_canvas_created_by ON public.client_canvas(created_by);
CREATE INDEX IF NOT EXISTS idx_client_tasks_client_id ON public.client_tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_client_tasks_status ON public.client_tasks(status);
CREATE INDEX IF NOT EXISTS idx_client_tasks_assigned_to ON public.client_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_client_tasks_due_date ON public.client_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_client_tasks_position ON public.client_tasks(client_id, position);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_client_canvas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_client_canvas_updated_at
  BEFORE UPDATE ON public.client_canvas
  FOR EACH ROW
  EXECUTE FUNCTION update_client_canvas_updated_at();

CREATE TRIGGER trigger_update_client_tasks_updated_at
  BEFORE UPDATE ON public.client_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS
ALTER TABLE public.client_canvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_tasks ENABLE ROW LEVEL SECURITY;

-- Políticas RLS: Todos los usuarios autenticados pueden gestionar clientes y tareas
CREATE POLICY "Authenticated users can manage client canvas"
  ON public.client_canvas
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage client tasks"
  ON public.client_tasks
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');



