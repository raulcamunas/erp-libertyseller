-- ==================================================================
-- 171 · LAS TARIFAS PASAN A SER MENSUALES
-- ==================================================================
--
-- Hasta ahora una tarifa era «la del ciclo 15→14» y se buscaba por coincidencia
-- EXACTA con la clave del ciclo. Eso ataba las tarifas a los ciclos de nomina y
-- hacia imposible lo que hace falta: una comision que empiece el 1 de septiembre
-- y termine el 30, que parte dos nominas por la mitad.
--
-- El cambio es de LECTURA, no de esquema: una fila ya no es «la tarifa del ciclo
-- X» sino «la tarifa que rige DESDE el dia X», y vale hasta que otra la
-- sustituye. Con eso las tarifas pasan a ser mensuales —fecha el dia 1— sin
-- tocar el motor de coste, que ya calculaba dia a dia.
--
-- Por eso esta migracion no crea ni cambia ninguna columna. Lo unico que hace es
-- CERRAR dos excepciones, y ese es todo su motivo de existir.
--
--
-- POR QUE HAY QUE CERRARLAS
-- -------------------------
-- Con la regla vieja, una excepcion personal moria al acabar su ciclo: si
-- alguien tenia 20 $/cita en el ciclo de julio y en agosto no se le ponia nada,
-- en agosto volvia a la tarifa general.
--
-- Con «rige desde», una excepcion NO muere sola: seguiria aplicandose para
-- siempre. Hay dos abiertas del ciclo del 15 de julio, las dos a 20 $/cita, y
-- las dos personas cobran HOY 15 $ porque volvieron a la general en agosto.
--
-- Sin esta migracion pasarian a cobrar 20 $ sin que nadie lo hubiera decidido.
-- Asi que se les escribe una fila el 15 de agosto con lo que cobran hoy: la
-- general vigente. Resultado: NO CAMBIA NI UN CENTIMO, ni hacia atras ni hacia
-- delante.
--
-- Si la intencion era que siguieran con los 20 $, se pone desde la pantalla de
-- Tarifas y se acabo. Lo que no puede pasar es que lo decida una migracion.
--
--
-- LA HISTORIA NO SE MUEVE
-- -----------------------
-- Comprobado sobre los datos: hay tarifa general en TODOS los ciclos desde
-- 2026-03-15, y el primer dia con horas es 2026-03-16. Asi que para cualquier
-- dia pasado, la fila que antes casaba exacto es tambien la mas reciente que ya
-- habia empezado. Mismo numero por los dos caminos.

-- Una fila de cierre para cada persona con excepcion abierta, con la tarifa
-- general que le aplica hoy. `ON CONFLICT DO NOTHING` para poder relanzarla.
INSERT INTO public.payroll_rates (period_start, user_id, hourly_rate, commission_per_appointment)
SELECT
  DATE '2026-08-15',
  abierta.user_id,
  general.hourly_rate,
  general.commission_per_appointment
FROM (
  -- Personas cuya excepcion mas reciente es anterior al 15 de agosto: las que
  -- quedarian «enganchadas» con la regla nueva.
  SELECT DISTINCT ON (user_id) user_id
  FROM public.payroll_rates
  WHERE user_id IS NOT NULL
  ORDER BY user_id, period_start DESC
) AS abierta
CROSS JOIN LATERAL (
  SELECT hourly_rate, commission_per_appointment
  FROM public.payroll_rates
  WHERE user_id IS NULL AND period_start <= DATE '2026-08-15'
  ORDER BY period_start DESC
  LIMIT 1
) AS general
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_rates r
  WHERE r.user_id = abierta.user_id AND r.period_start >= DATE '2026-08-15'
);

COMMENT ON COLUMN public.payroll_rates.period_start IS
  'El dia DESDE EL QUE rige esta tarifa, no el ciclo al que pertenece. Vale hasta que otra fila posterior la sustituye. Las mensuales llevan dia 1; las viejas llevan dia 15 y siguen rigiendo desde el 15, que es lo que hacian antes.';

-- ---------- Comprobacion ----------
DO $$
DECLARE
  enganchados INTEGER;
BEGIN
  SELECT count(*) INTO enganchados
  FROM (
    SELECT DISTINCT ON (user_id) user_id, period_start
    FROM public.payroll_rates
    WHERE user_id IS NOT NULL
    ORDER BY user_id, period_start DESC
  ) x
  WHERE x.period_start < DATE '2026-08-15';

  IF enganchados > 0 THEN
    RAISE EXCEPTION
      'Han quedado % personas con una excepcion sin cerrar. Con la regla nueva seguirian cobrandola indefinidamente.', enganchados;
  END IF;

  RAISE NOTICE 'Listo. Las tarifas son «rigen desde» y ninguna excepcion queda abierta: nadie cambia de sueldo por esta migracion.';
END $$;
