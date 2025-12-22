-- Añadir columna de siguiente contacto y nuevo agente 'Alejandro' al módulo de LinkedIn

-- Columna para la próxima fecha en la que deberíamos contactar al prospecto
ALTER TABLE public.company_prospects
ADD COLUMN IF NOT EXISTS next_contact_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_company_prospects_next_contact_at
  ON public.company_prospects(next_contact_at);

-- Actualizar constraint de agente para incluir 'Alejandro'
ALTER TABLE public.company_prospects
DROP CONSTRAINT IF EXISTS company_prospects_agent_check;

ALTER TABLE public.company_prospects
ADD CONSTRAINT company_prospects_agent_check
CHECK (agent IN ('Raul', 'Mario', 'Alejandro'));


