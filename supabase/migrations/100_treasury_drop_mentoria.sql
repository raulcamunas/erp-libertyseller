-- =====================================================
-- TESORERÍA: fuera la categoría «Mentoría»
-- =====================================================
-- Ese gasto ya no existe. Los importes históricos no se borran — marzo a
-- junio tenían mentoría y quitarlos falsearía aquellos meses — sino que
-- pasan a «Otros gastos», conservando el concepto para saber qué eran.
--
-- Si se borrara la categoría sin mover las filas, esos gastos dejarían de
-- pintarse pero seguirían sumando al total del mes: el desglose no
-- cuadraría con la cifra de arriba.

UPDATE public.treasury_expenses
SET category = 'otros'
WHERE category = 'mentoria';
