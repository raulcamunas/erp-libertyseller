-- =====================================================
-- CRM: dar de alta clientes a mano (sin cita previa)
-- =====================================================
-- Hasta ahora una ficha del CRM solo podía nacer de una cita cualificada.
-- Hace falta poder meter clientes que vienen por otro lado (cartera
-- antigua, recomendación, un Sheet...), así que la cita pasa a ser
-- opcional y la ficha guarda sus propios datos de contacto.

ALTER TABLE public.crm_clients
  ALTER COLUMN appointment_id DROP NOT NULL;

ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS lead_name TEXT,
  ADD COLUMN IF NOT EXISTS lead_email TEXT,
  ADD COLUMN IF NOT EXISTS lead_phone TEXT,
  ADD COLUMN IF NOT EXISTS lead_company TEXT,
  ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS amazon_link TEXT;

COMMENT ON COLUMN public.crm_clients.lead_name IS
  'Solo para altas manuales. Si la ficha viene de una cita, el nombre lo manda la cita.';

-- Una ficha manual necesita al menos un nombre; una que viene de cita lo
-- hereda de ella.
ALTER TABLE public.crm_clients
  DROP CONSTRAINT IF EXISTS crm_clients_has_identity;
ALTER TABLE public.crm_clients
  ADD CONSTRAINT crm_clients_has_identity
  CHECK (appointment_id IS NOT NULL OR COALESCE(TRIM(lead_name), '') <> '');
