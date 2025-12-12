-- =====================================================
-- ACTUALIZAR REGLAS DE COMISIONES
-- =====================================================

-- Actualizar/Insertar clientes con sus tasas correctas
INSERT INTO public.clients (name, base_commission_rate) VALUES 
('Jamones Tapas Party', 0.05),
('Ham Master', 0.05),
('Lenobotics', 0.03)
ON CONFLICT (name) DO UPDATE SET base_commission_rate = EXCLUDED.base_commission_rate;

-- Eliminar excepciones antiguas de Lenobotics (si existen)
DELETE FROM public.commission_exceptions 
WHERE client_id IN (SELECT id FROM public.clients WHERE name = 'Lenobotics');

-- Insertar excepciones para Lenobotics:
-- - Hércules: 1%
-- - Thrustmaster: 1%
-- - Resto: 3% (tasa base)
INSERT INTO public.commission_exceptions (client_id, keyword, special_rate)
SELECT id, keyword, rate
FROM public.clients,
(VALUES 
  ('Hércules', 0.01),
  ('Thrustmaster', 0.01)
) AS exceptions(keyword, rate)
WHERE name = 'Lenobotics'
ON CONFLICT (client_id, keyword) DO UPDATE SET special_rate = EXCLUDED.special_rate;

