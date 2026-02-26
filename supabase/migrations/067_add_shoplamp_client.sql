-- =====================================================
-- AÑADIR CLIENTE SHOPLAMP
-- =====================================================
-- Mismo formato que Ham Master: CSV Amazon (Transaction Type, OUR_PRICE/SHIPPING Tax Exclusive), 5% sobre base neta.

INSERT INTO public.clients (name, base_commission_rate) VALUES 
('SHOPLAMP', 0.05)
ON CONFLICT (name) DO UPDATE SET base_commission_rate = EXCLUDED.base_commission_rate;
