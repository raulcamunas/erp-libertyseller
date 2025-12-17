-- =====================================================
-- AÑADIR CLIENTE SAUSI
-- =====================================================

-- Insertar cliente SAUSI con tasa del 50% sobre beneficios (igual que DIRU)
INSERT INTO public.clients (name, base_commission_rate) VALUES 
('SAUSI', 0.50)
ON CONFLICT (name) DO UPDATE SET base_commission_rate = EXCLUDED.base_commission_rate;


