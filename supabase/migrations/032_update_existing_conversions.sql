-- Actualizar transacciones existentes que son conversiones
-- Cualquier transacción cuyo client_name empiece con "To " es una conversión
UPDATE public.finance_payments
SET type = 'conversion'
WHERE 
  (client_name ILIKE 'To %' OR client_name ILIKE 'To EUR%' OR client_name ILIKE 'To USD%' OR client_name ILIKE 'To GBP%')
  AND type != 'conversion';

