-- 274 · Nuevo resultado de una cita: «Semi-cualificada», con su propio precio mes a mes.
-- Sin precio puesto, una semi-cualificada no cobra nada. IDEMPOTENTE: lanzarla otra vez no cambia nada.

ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'semi_qualified';

ALTER TABLE public.payroll_rates
  ADD COLUMN IF NOT EXISTS commission_per_semi_qualified NUMERIC;

COMMENT ON COLUMN public.payroll_rates.commission_per_semi_qualified IS 'Lo que cobra una cita semi-cualificada ese mes. NULL = sin decidir: no cobra nada.';
