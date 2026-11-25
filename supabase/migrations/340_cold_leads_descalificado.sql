-- ============================================================================
-- 340 · NUEVO ESTADO DE LEAD: «Descalificado»
--
-- Cerrado como «No le interesa», pero no es un rechazo: el lead no es lo que buscamos (no es una tienda, es demasiado pequeño, datos falsos…).
-- No se llama, no se escribe y no entra en secuencias ni en el ciclo (lib/types/cold-leads.ts → ESTADOS_CERRADOS).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Sin ella, elegir «Descalificado» en la ficha da error al guardar.
-- ============================================================================

ALTER TABLE public.cold_leads DROP CONSTRAINT IF EXISTS cold_leads_status_check;
ALTER TABLE public.cold_leads ADD CONSTRAINT cold_leads_status_check CHECK (status IN (
  'pendiente',
  'no_contesta',
  'programado',
  'email_enviado',
  'seguimiento',
  'cita_cualificada',
  'no_interesa',
  'descalificado'
));
