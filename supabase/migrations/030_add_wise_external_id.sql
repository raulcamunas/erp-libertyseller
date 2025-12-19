-- =====================================================
-- AÑADIR EXTERNAL_ID PARA SINCRONIZACIÓN CON WISE
-- =====================================================

-- Agregar columna external_id para guardar el ID de transacción de Wise
ALTER TABLE public.finance_payments
ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Crear índice único para evitar duplicados
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_payments_external_id 
ON public.finance_payments(external_id) 
WHERE external_id IS NOT NULL;

-- Añadir comentario a la columna
COMMENT ON COLUMN public.finance_payments.external_id IS 'ID externo de la transacción (ej: ID de Wise) para evitar duplicados en sincronización';



