-- =====================================================
-- TESORERÍA: reactivar a quien sigue facturando
-- =====================================================
-- La marca «activo» venía de una columna True/False del Excel que ya no
-- reflejaba la realidad: Zapaterías Basoco facturó 839 € en agosto y
-- estaba marcada como inactiva, igual que «Angel y su novia» con 600 €.
--
-- Esa marca decide si el cliente aparece en un mes vacío, así que dejarla
-- mal significa que hay que acordarse de añadirlos a mano cada mes.
-- Manda el hecho: si ha facturado en los últimos tres meses, está activo.

UPDATE public.treasury_clients c
SET is_active = true
WHERE is_active = false
  AND EXISTS (
    SELECT 1
    FROM public.treasury_client_months m
    WHERE m.client_id = c.id
      AND m.period >= (date_trunc('month', CURRENT_DATE) - INTERVAL '3 months')::date
      AND COALESCE(m.fee, 0) + COALESCE(m.commission, 0) > 0
  );
