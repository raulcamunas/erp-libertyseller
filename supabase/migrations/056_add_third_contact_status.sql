-- =====================================================
-- AÑADIR ESTADO 'third_contact' A PROSPECTOS
-- =====================================================

-- Actualizar el CHECK constraint en company_prospects para incluir 'third_contact'
ALTER TABLE public.company_prospects
DROP CONSTRAINT IF EXISTS company_prospects_status_check;

ALTER TABLE public.company_prospects
ADD CONSTRAINT company_prospects_status_check 
CHECK (status IN ('identified', 'connected', 'messaged', 'replied', 'third_contact'));

-- Actualizar el CHECK constraint en prospect_status_history
ALTER TABLE public.prospect_status_history
DROP CONSTRAINT IF EXISTS prospect_status_history_status_check;

ALTER TABLE public.prospect_status_history
ADD CONSTRAINT prospect_status_history_status_check 
CHECK (status IN ('identified', 'connected', 'messaged', 'replied', 'third_contact'));

