-- =====================================================
-- TESORERÍA: dar por cobrado el histórico importado
-- =====================================================
-- El seed insertaba estas filas con paid = true, pero acabaron en false
-- porque la 096 llegó a ejecutarse en un intento en el que la 095 se
-- había deshecho sola. Resultado: la pantalla daba por pendiente de
-- cobro todo lo facturado desde diciembre.
--
-- Se marcan como cobrados los meses ya cerrados. El mes en curso se deja
-- como esté: ahí sí interesa ir marcando los cobros según entran.

UPDATE public.treasury_client_months
SET paid = true
WHERE paid = false
  AND period < date_trunc('month', CURRENT_DATE)::date;

-- Si algún mes viejo quedó de verdad sin cobrar, se desmarca a mano desde
-- la propia pantalla: la casilla de «Cobrado» de esa fila.
