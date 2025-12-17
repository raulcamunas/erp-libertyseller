-- Actualizar transacciones existentes que son conversiones
-- Cualquier transacción cuyo client_name empiece con "To " es una conversión
-- IMPORTANTE: Esta migración debe ejecutarse DESPUÉS de 031_add_conversion_type.sql

UPDATE public.finance_payments
SET type = 'conversion'
WHERE 
  (client_name ILIKE 'To %' 
   OR client_name ILIKE 'To EUR%' 
   OR client_name ILIKE 'To USD%' 
   OR client_name ILIKE 'To GBP%'
   OR client_name ILIKE 'To %')
  AND type != 'conversion';

