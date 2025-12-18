-- =====================================================
-- TABLA DE NOTIFICACIONES
-- =====================================================

-- Tabla de notificaciones
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'comment' CHECK (type IN ('comment', 'mention', 'task_assigned', 'task_updated')),
  title TEXT NOT NULL,
  message TEXT,
  related_task_id UUID REFERENCES public.client_tasks(id) ON DELETE CASCADE,
  related_client_id UUID REFERENCES public.client_canvas(id) ON DELETE CASCADE,
  related_comment_id UUID REFERENCES public.task_comments(id) ON DELETE CASCADE,
  read BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_related_task_id ON public.notifications(related_task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_related_client_id ON public.notifications(related_client_id);

-- Habilitar RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios solo pueden ver sus propias notificaciones
CREATE POLICY "Users can view own notifications"
  ON public.notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- Política: Los usuarios pueden actualizar sus propias notificaciones (marcar como leídas)
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Política: Se pueden crear notificaciones para cualquier usuario (desde el backend)
CREATE POLICY "System can create notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (true);

-- Función para crear notificación cuando se añade un comentario
CREATE OR REPLACE FUNCTION public.create_comment_notification()
RETURNS TRIGGER AS $$
DECLARE
  task_owner_id UUID;
  task_client_id UUID;
  commenter_name TEXT;
BEGIN
  -- Obtener el cliente y el propietario de la tarea
  SELECT client_id INTO task_client_id
  FROM public.client_tasks
  WHERE id = NEW.task_id;

  -- Obtener el nombre del usuario que comentó
  SELECT full_name INTO commenter_name
  FROM public.profiles
  WHERE id = NEW.user_id;

  -- Crear notificaciones para todos los miembros del cliente (excepto el que comentó)
  INSERT INTO public.notifications (user_id, type, title, message, related_task_id, related_client_id, related_comment_id)
  SELECT 
    cm.user_id,
    'comment',
    COALESCE(commenter_name, 'Alguien') || ' comentó en una tarea',
    LEFT(NEW.content, 100),
    NEW.task_id,
    task_client_id,
    NEW.id
  FROM public.client_members cm
  WHERE cm.client_id = task_client_id
    AND cm.user_id != NEW.user_id
    AND cm.user_id IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para crear notificaciones cuando se añade un comentario
DROP TRIGGER IF EXISTS trigger_create_comment_notification ON public.task_comments;
CREATE TRIGGER trigger_create_comment_notification
  AFTER INSERT ON public.task_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_comment_notification();

