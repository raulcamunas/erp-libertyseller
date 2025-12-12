-- =====================================================
-- AGREGAR CAMPO TYPE A FINANCE_PAYMENTS
-- =====================================================

-- Agregar columna type para distinguir ingresos y gastos
ALTER TABLE public.finance_payments
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'income' CHECK (type IN ('income', 'expense'));

-- Actualizar registros existentes como ingresos
UPDATE public.finance_payments
SET type = 'income'
WHERE type IS NULL;

