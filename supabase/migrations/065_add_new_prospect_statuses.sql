-- =====================================================
-- AÑADIR NUEVOS ESTADOS A PROSPECTOS: En seguimiento, Reunión concretada, No le interesa
-- Y ELIMINAR ESTADO 'replied'
-- =====================================================

-- Primero, actualizar los registros existentes que tengan estados no permitidos
-- Migrar 'replied' a 'messaged' (estado más cercano en el flujo)
UPDATE public.company_prospects
SET status = 'messaged'
WHERE status = 'replied';

-- Actualizar el historial de estados también
UPDATE public.prospect_status_history
SET status = 'messaged'
WHERE status = 'replied';

-- Ahora actualizar el CHECK constraint en company_prospects para incluir los nuevos estados
ALTER TABLE public.company_prospects
DROP CONSTRAINT IF EXISTS company_prospects_status_check;

ALTER TABLE public.company_prospects
ADD CONSTRAINT company_prospects_status_check 
CHECK (status IN (
  'identified', 
  'connected', 
  'messaged', 
  'third_contact',
  'in_follow_up',
  'meeting_scheduled',
  'not_interested'
));

-- Actualizar el CHECK constraint en prospect_status_history
ALTER TABLE public.prospect_status_history
DROP CONSTRAINT IF EXISTS prospect_status_history_status_check;

ALTER TABLE public.prospect_status_history
ADD CONSTRAINT prospect_status_history_status_check 
CHECK (status IN (
  'identified', 
  'connected', 
  'messaged', 
  'third_contact',
  'in_follow_up',
  'meeting_scheduled',
  'not_interested'
));

