-- =====================================================
-- AÑADIR CLIENTE CREATIVE TOYS
-- =====================================================

-- Insertar cliente Creative Toys con tasa del 5% (igual que Ham Master)
INSERT INTO public.clients (name, base_commission_rate) VALUES 
('Creative Toys', 0.05)
ON CONFLICT (name) DO UPDATE SET base_commission_rate = EXCLUDED.base_commission_rate;




