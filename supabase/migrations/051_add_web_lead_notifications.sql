-- =====================================================
-- AÑADIR NOTIFICACIONES PARA WEB LEADS
-- =====================================================

-- Actualizar el tipo de notificación para incluir 'web_lead'
ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check 
CHECK (type IN ('comment', 'mention', 'task_assigned', 'task_updated', 'web_lead'));

-- Función para crear notificaciones cuando se inserta un lead en estado "registrado"
-- Solo para usuarios admin
CREATE OR REPLACE FUNCTION public.create_web_lead_notification()
RETURNS TRIGGER AS $$
DECLARE
  admin_user RECORD;
BEGIN
  -- Solo crear notificaciones si el lead está en estado "registrado"
  IF NEW.status = 'registrado' THEN
    -- Crear notificación para todos los usuarios admin
    FOR admin_user IN
      SELECT id
      FROM public.profiles
      WHERE role = 'admin'
    LOOP
      INSERT INTO public.notifications (
        user_id,
        type,
        title,
        message,
        read,
        created_at
      )
      VALUES (
        admin_user.id,
        'web_lead',
        'Nuevo Lead Registrado',
        COALESCE(NEW.nombre, 'Lead sin nombre') || 
        CASE 
          WHEN NEW.email IS NOT NULL THEN ' - ' || NEW.email
          ELSE ''
        END,
        false,
        NOW()
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para crear notificaciones cuando se inserta un lead
DROP TRIGGER IF EXISTS trigger_create_web_lead_notification ON public.web_leads;
CREATE TRIGGER trigger_create_web_lead_notification
  AFTER INSERT ON public.web_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.create_web_lead_notification();


