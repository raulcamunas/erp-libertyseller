-- =====================================================
-- AÑADIR CLIENTE BODEGAS VALHALLA
-- =====================================================
-- CSV Amazon estándar (Tax Document Library). 7% sobre base neta total (sin baseline).

INSERT INTO public.clients (name, base_commission_rate) VALUES
('Bodegas Valhalla', 0.07)
ON CONFLICT (name) DO UPDATE SET base_commission_rate = EXCLUDED.base_commission_rate;
