-- =====================================================
-- ELIMINAR AGENTE 'Alejandro' DEL MÓDULO DE LINKEDIN
-- =====================================================

-- PRIMERO: Actualizar cualquier prospecto que tenga 'Alejandro' como agente a 'Raul' (o 'Mario' según prefieras)
-- Por defecto, los asignamos a 'Raul'
UPDATE public.company_prospects
SET agent = 'Raul'
WHERE agent = 'Alejandro';

-- SEGUNDO: Actualizar constraint de agente para eliminar 'Alejandro'
ALTER TABLE public.company_prospects
DROP CONSTRAINT IF EXISTS company_prospects_agent_check;

ALTER TABLE public.company_prospects
ADD CONSTRAINT company_prospects_agent_check
CHECK (agent IN ('Raul', 'Mario'));

