-- ==================================================================
-- 184 · UNA TARIFA POR MES, IGUAL PARA TODOS
-- ==================================================================
--
-- Dos cambios, y los dos se piden desde la pantalla:
--
--   1. Cada mes tiene SU tarifa y solo la suya. Tocar septiembre no toca
--      octubre.
--   2. No hay tarifas por persona. Todos los comerciales cobran lo mismo.
--
--
-- ============ POR QUÉ SE PROPAGABA ============
--
-- Una tarifa significaba «rige DESDE esta fecha hasta que otra la sustituya».
-- Con eso, poner 20 $ en septiembre lo ponía también en octubre, noviembre y
-- todos los meses siguientes, porque ninguno tenía fila propia. Y al revés: un
-- mes sin fila heredaba la del anterior sin decirlo, así que el número que se
-- veía podía venir de tres meses atrás.
--
-- Desde ahora la correspondencia es exacta: el día 2026-09-17 usa la fila de
-- 2026-09-01 y ninguna otra. Un mes sin fila cae a los valores por defecto,
-- que se ven en pantalla marcados en ámbar.
--
--
-- ============ QUÉ HAY HOY, Y QUÉ SE HACE CON ELLO ============
--
--   2026-03-15  general   3,5 / 15
--   2026-04-15  general   3,5 / 15
--   2026-05-15  general   3,5 / 15
--   2026-06-15  general   3,5 / 20
--   2026-06-15  PERSONAL  3,5 / 15
--   2026-07-15  general   3,5 / 15
--   2026-07-15  PERSONAL  3,5 / 20   (dos personas)
--   2026-08-01  general   3,5 / 15
--   2026-08-15  general   3,5 / 15
--   2026-09-01  general   3,5 / 20
--
-- Fechas del día 15 (del modelo viejo de ciclos 15→14) mezcladas con fechas del
-- día 1, dos filas para agosto, y tres excepciones personales.
--
--
-- ============ LO QUE CAMBIA DE VALOR, DICHO CLARO ============
--
-- Con el modelo viejo, un mes natural podía tener DOS tarifas: del 1 al 14 la
-- del ciclo anterior y del 15 en adelante la nueva. Al pasar a un valor por mes
-- hay que elegir uno, y se elige EL DE LA FILA DEL DÍA 15, que es la que regía
-- la mayor parte de ese mes. Eso mueve estos tramos:
--
--   1-14 junio       15  ->  20
--   1-14 julio       20  ->  15
--   1-14 septiembre  15  ->  20
--
-- No toca ninguna nómina ya pagada: los meses cerrados los sirve
-- `employee_month_records` —lo que se apuntó— y no el cálculo. Ver
-- employeeMonth() en lib/types/employees.ts, rama `isPastMonth`.

-- ---------- 1. Fuera las tarifas por persona ----------
DELETE FROM public.payroll_rates WHERE user_id IS NOT NULL;

-- ---------- 2. Todo al día 1 de su mes ----------
--
-- Antes de mover nada hay que resolver los choques: agosto tiene fila el día 1
-- Y el día 15. Se queda la del día 15 por lo dicho arriba —rige la mayor parte
-- del mes— y la del 1 se borra, que si no el UPDATE de abajo violaría la clave
-- única de (period_start, user_id).
DELETE FROM public.payroll_rates a
WHERE a.user_id IS NULL
  AND EXTRACT(DAY FROM a.period_start) <> 15
  AND EXISTS (
    SELECT 1 FROM public.payroll_rates b
    WHERE b.user_id IS NULL
      AND EXTRACT(DAY FROM b.period_start) = 15
      AND date_trunc('month', b.period_start) = date_trunc('month', a.period_start)
  );

UPDATE public.payroll_rates
SET period_start = date_trunc('month', period_start)::date
WHERE user_id IS NULL
  AND EXTRACT(DAY FROM period_start) <> 1;

-- ---------- 3. Rellenar los meses que quedaban colgando ----------
--
-- SIN ESTO, EL CAMBIO BAJA SUELDOS SIN QUE NADIE LO PIDA.
--
-- Hoy octubre, noviembre y diciembre no tienen fila: heredan la de septiembre,
-- o sea 20 $ por cita. En cuanto se deja de heredar caerían a la de por
-- defecto, 15 $, y nadie se enteraría hasta ver la nómina.
--
-- Así que se escribe explícitamente lo que HOY vale cada mes: el valor de la
-- última tarifa anterior, arrastrado. El resultado es idéntico a lo que se está
-- cobrando ahora, pero visible y editable en la pantalla, que es justo lo que
-- se pedía.
--
-- Hasta diciembre del último año que tenga tarifas. Más allá no se inventa
-- nada: un mes de 2027 sin tarifa sale marcado en ámbar y se rellena a mano.
INSERT INTO public.payroll_rates (period_start, user_id, hourly_rate, commission_per_appointment)
SELECT
  m.mes::date,
  NULL,
  (SELECT r.hourly_rate FROM public.payroll_rates r
    WHERE r.user_id IS NULL AND r.period_start <= m.mes
    ORDER BY r.period_start DESC LIMIT 1),
  (SELECT r.commission_per_appointment FROM public.payroll_rates r
    WHERE r.user_id IS NULL AND r.period_start <= m.mes
    ORDER BY r.period_start DESC LIMIT 1)
FROM generate_series(
  (SELECT min(period_start) FROM public.payroll_rates WHERE user_id IS NULL),
  (SELECT date_trunc('year', max(period_start)) + INTERVAL '11 months'
     FROM public.payroll_rates WHERE user_id IS NULL),
  INTERVAL '1 month'
) AS m(mes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_rates r
  WHERE r.user_id IS NULL AND r.period_start = m.mes::date
)
-- Solo si hay algo que arrastrar: sin tarifa anterior no hay nada que copiar y
-- el mes se queda vacío a propósito, con su aviso en ámbar.
AND EXISTS (
  SELECT 1 FROM public.payroll_rates r
  WHERE r.user_id IS NULL AND r.period_start <= m.mes
);

-- ---------- 4. Comprobación ----------
DO $$
DECLARE
  v_personales INTEGER;
  v_fuera_de_dia_1 INTEGER;
  v_duplicados INTEGER;
  v_total INTEGER;
BEGIN
  SELECT count(*) INTO v_personales FROM public.payroll_rates WHERE user_id IS NOT NULL;
  SELECT count(*) INTO v_fuera_de_dia_1 FROM public.payroll_rates
    WHERE EXTRACT(DAY FROM period_start) <> 1;
  SELECT count(*) INTO v_duplicados FROM (
    SELECT date_trunc('month', period_start)
    FROM public.payroll_rates WHERE user_id IS NULL
    GROUP BY 1 HAVING count(*) > 1
  ) x;
  SELECT count(*) INTO v_total FROM public.payroll_rates;

  IF v_personales > 0 OR v_fuera_de_dia_1 > 0 OR v_duplicados > 0 THEN
    RAISE EXCEPTION 'La limpieza no ha quedado bien: % personales, % fuera del dia 1, % meses duplicados.',
      v_personales, v_fuera_de_dia_1, v_duplicados;
  END IF;

  RAISE NOTICE 'Listo: % tarifas, una por mes y para todo el equipo.', v_total;
END $$;
