-- =====================================================
-- NUEVOS ESTADOS DE CITA
-- =====================================================
-- Se renombran los valores existentes en vez de borrarlos, para no
-- perder el estado de las citas ya guardadas:
--   completed  -> qualified      (Cita Cualificada)
--   cancelled  -> not_qualified  (Cita No Cualificada)
-- Y se añade uno nuevo: rescheduled (Re-agendada)

ALTER TYPE appointment_status RENAME VALUE 'completed' TO 'qualified';
ALTER TYPE appointment_status RENAME VALUE 'cancelled' TO 'not_qualified';
ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'rescheduled';
