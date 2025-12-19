-- =====================================================
-- AÑADIR CLIENTE DIRU
-- =====================================================

-- Insertar cliente DIRU con tasa del 50% sobre beneficios
-- Nota: La tasa se usa como indicador, pero el cálculo real se hace sobre la pestaña de "beneficios" del Excel
INSERT INTO public.clients (name, base_commission_rate) VALUES 
('DIRU', 0.50)
ON CONFLICT (name) DO UPDATE SET base_commission_rate = EXCLUDED.base_commission_rate;



