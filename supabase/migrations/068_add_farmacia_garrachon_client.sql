-- =====================================================
-- AÑADIR CLIENTE FARMACIA GARRACHON
-- Mismo flujo que ShoesF: comparativa dos años, 2.5% sobre excedente
-- =====================================================

INSERT INTO public.clients (name, base_commission_rate) VALUES 
('Farmacia Garrachon', 0.0250)
ON CONFLICT (name) DO UPDATE SET base_commission_rate = EXCLUDED.base_commission_rate;
