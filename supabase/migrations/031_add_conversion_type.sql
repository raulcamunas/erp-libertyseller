-- Añadir 'conversion' como tipo válido para finance_payments
-- Primero eliminar la constraint existente
ALTER TABLE public.finance_payments
DROP CONSTRAINT IF EXISTS finance_payments_type_check;

-- Añadir la nueva constraint que incluye 'conversion'
ALTER TABLE public.finance_payments
ADD CONSTRAINT finance_payments_type_check 
CHECK (type IN ('income', 'expense', 'conversion'));

