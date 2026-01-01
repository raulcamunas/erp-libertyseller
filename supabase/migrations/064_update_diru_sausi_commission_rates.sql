-- =====================================================
-- ACTUALIZAR TASAS DE COMISIÓN DE DIRU Y SAUSI
-- =====================================================

-- Actualizar tasa de comisión de DIRU a 45%
UPDATE public.clients 
SET base_commission_rate = 0.45
WHERE name = 'DIRU';

-- Actualizar tasa de comisión de SAUSI a 40%
UPDATE public.clients 
SET base_commission_rate = 0.40
WHERE name = 'SAUSI';

