-- ==================================================================
-- 185 · LAS CITAS A MANO VUELVEN A LA TARIFA DE SU MES
-- ==================================================================
--
-- Las once citas manuales que hay en la base llevan TODAS un importe de 20 $
-- escrito en `commission`, y ese importe manda sobre la tarifa del mes.
--
-- No lo escribió nadie: lo precargaba la pantalla. Al pulsar «Añadir», el campo
-- venía relleno con `rate.commission`, que es la tarifa del ÚLTIMO día del
-- ciclo — o sea la del SEGUNDO mes, fuera cual fuera la fecha de la cita. Y un
-- importe escrito en esa casilla se guarda fijo para siempre.
--
-- Consecuencia con las tarifas de hoy (agosto 15, septiembre 25): una cita del
-- 20 de agosto añadida a mano se guardaba a 25, diez euros por encima de lo que
-- le toca, y ninguna corrección posterior de la tarifa la alcanzaba.
--
-- El origen ya está tapado (components/payroll/HoursTracker.tsx: la casilla
-- nace vacía). Esto arregla lo que quedó grabado.
--
--
-- ============ QUÉ IMPORTES CAMBIAN ============
--
-- `commission = NULL` significa «usa la tarifa del mes de tu fecha». Con las
-- tarifas que hay ahora:
--
--     9 citas de julio 2026       20  ->  15   (julio está a 15)
--     1 cita  del 15 agosto       20  ->  15   (agosto está a 15)
--     1 cita  del 14 septiembre   20  ->  25   (septiembre está a 25)
--
-- Julio está cerrado y pagado: lo que cobró esa gente lo sirve
-- `employee_month_records`, no este cálculo, así que no se le quita dinero a
-- nadie. Lo que cambia es lo que enseñan las pantallas de coste para esos
-- meses, que pasa a coincidir con la tarifa que regía.
--
-- Si alguna de estas citas era una excepción de verdad, se le vuelve a escribir
-- su importe desde «Mis Horas» y vuelve a mandar.

UPDATE public.payroll_manual_appointments
SET commission = NULL
WHERE commission IS NOT NULL;

DO $$
DECLARE
  v_quedan INTEGER;
  v_total INTEGER;
BEGIN
  SELECT count(*) INTO v_total FROM public.payroll_manual_appointments;
  SELECT count(*) INTO v_quedan FROM public.payroll_manual_appointments
    WHERE commission IS NOT NULL;
  RAISE NOTICE 'Citas a mano: % en total, % con importe fijo (deberia ser 0).', v_total, v_quedan;
END $$;
