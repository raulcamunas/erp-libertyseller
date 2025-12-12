-- =====================================================
-- AÑADIR CLIENTE SHOESF
-- =====================================================

-- Insertar cliente ShoesF con tasa del 5% sobre el excedente
INSERT INTO public.clients (name, base_commission_rate) VALUES 
('ShoesF', 0.05)
ON CONFLICT (name) DO UPDATE SET base_commission_rate = EXCLUDED.base_commission_rate;

