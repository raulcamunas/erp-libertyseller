-- ============================================================================
-- 216 · FUERA EL ASISTENTE DE AMAZON: el envío se crea en Seller Central
-- ============================================================================
--
-- El ERP tenía un asistente que llamaba a la API de Amazon para crear el plan de
-- entrada: elegía opciones de empaquetado, opciones de destino y lo confirmaba.
-- Eran 1.883 líneas entre la pantalla, la ruta y el cliente de la API.
--
-- NUNCA SE USÓ. Comprobado contra producción antes de tocar nada: de catorce
-- remesas, CERO tienen inbound_plan_id, cero tienen paso_plan y cero han pasado
-- por el estado 'en_amazon'. Lo que sí hay es una remesa con el nº de envío FBA
-- escrito A MANO —FBA15MFXKKKT— que es exactamente como se trabaja de verdad.
--
-- Así que el ERP se queda siendo la herramienta que PREPARA el envío: el boceto
-- que se acuerda con el cliente, las etiquetas con el SKU, el manifiesto y el
-- Excel de embalaje. Quien lo crea en Amazon es una persona, en Seller Central,
-- subiendo esos dos ficheros. Un asistente que replica media interfaz de Amazon
-- hay que mantenerlo cada vez que Amazon la cambia, y lo que se gana es no tener
-- que abrir una pestaña.
--
--
-- ============ EL ESTADO 'en_amazon' DESAPARECE ============
--
-- El recorrido pasa de siete pasos a seis:
--
--     borrador -> aprobada -> encajando -> lista -> enviada -> cerrada
--
-- De 'lista' se va directo a 'enviada' cuando la mercancía ha salido de verdad.
-- Ninguna remesa está en 'en_amazon' hoy, así que no hay nada que migrar — pero
-- el CHECK de la columna lo permitía y conviene que deje de permitirlo: un estado
-- que ya no entiende ninguna pantalla es una remesa que se queda sin botones.
-- ============================================================================

-- ---------- La comprobación y el borrado, EN EL MISMO BLOQUE ----------
--
-- Juntos y no en dos pasos, por dos motivos que se vieron probándolo:
--
--   1. SI SE SEPARAN, EL GUARDA NO GUARDA NADA. El `RAISE EXCEPTION` aborta SU
--      sentencia; que aborte también el `ALTER TABLE … DROP COLUMN` de después
--      depende de que quien lance el fichero lo envuelva en una transacción. El
--      editor de Supabase lo hace, pero un `psql -f` sin ON_ERROR_STOP sigue
--      adelante y borra las columnas igual — comprobado, pasó en la prueba.
--
--   2. SI NO SE MIRA QUE LA COLUMNA EXISTA, NO SE PUEDE RELANZAR. La segunda vez
--      las columnas ya no están y la propia comprobación revienta con «column
--      inbound_plan_id does not exist». Todas las migraciones de este repo se
--      pueden volver a lanzar enteras, y esta tiene que poder también.
--
-- Por eso va todo dentro de un DO con SQL dinámico: o se comprueba y se borra, o
-- no se hace ninguna de las dos cosas.
DO $$
DECLARE
  COLUMNAS CONSTANT TEXT[] := ARRAY[
    'inbound_plan_id', 'paso_plan', 'packing_option_id',
    'placement_option_id', 'plan_error', 'plan_at'
  ];
  v_presentes TEXT[];
  v_con_datos INTEGER := 0;
  v_en_amazon INTEGER;
  v_col TEXT;
  v_cuenta INTEGER;
BEGIN
  SELECT array_agg(column_name::TEXT) INTO v_presentes
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'fba_remesas'
     AND column_name = ANY (COLUMNAS);

  IF v_presentes IS NULL THEN
    RAISE NOTICE 'Las columnas del asistente ya no están: no hay nada que hacer.';
  ELSE
    -- Se cuenta columna a columna y con SQL dinámico porque no todas tienen por
    -- qué existir: una base a la que le falte alguna migración intermedia haría
    -- fallar una consulta que las nombre todas de golpe.
    FOREACH v_col IN ARRAY v_presentes LOOP
      EXECUTE format('SELECT count(*) FROM public.fba_remesas WHERE %I IS NOT NULL', v_col)
        INTO v_cuenta;
      v_con_datos := v_con_datos + v_cuenta;
    END LOOP;

    SELECT count(*) INTO v_en_amazon FROM public.fba_remesas WHERE estado = 'en_amazon';

    IF v_con_datos > 0 OR v_en_amazon > 0 THEN
      RAISE EXCEPTION
        'NO se ha tocado nada: hay % dato(s) del asistente y % remesa(s) en el estado «en_amazon». '
        'Esta migración daba por hecho que nadie lo había usado. Míralo antes de borrar nada.',
        v_con_datos, v_en_amazon
        USING ERRCODE = 'check_violation';
    END IF;

    FOREACH v_col IN ARRAY v_presentes LOOP
      EXECUTE format('ALTER TABLE public.fba_remesas DROP COLUMN %I', v_col);
    END LOOP;
    RAISE NOTICE 'Quitadas % columnas del asistente.', array_length(v_presentes, 1);
  END IF;
END $$;

-- `referencia_envio` y `estado_amazon` SE QUEDAN, y no es un descuido: son el nº
-- de envío FBA que se escribe a mano y lo que Amazon contesta de él. Son la base
-- del seguimiento, que es justo lo que viene después.

-- ---------- El CHECK del estado, sin 'en_amazon' ----------
-- Se quita el CHECK viejo —el que todavía admite 'en_amazon'— Y TAMBIÉN el que
-- pone esta migración, por si ya se lanzó antes. Postgres no tiene
-- `ADD CONSTRAINT IF NOT EXISTS`, así que relanzar el fichero fallaba con
-- «constraint already exists» aunque todo lo demás fuera idempotente. Se vio
-- probándolo, no leyéndolo.
DO $$
DECLARE v_nombre TEXT;
BEGIN
  FOR v_nombre IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.fba_remesas'::regclass
       AND contype = 'c'
       AND (pg_get_constraintdef(oid) ILIKE '%en_amazon%' OR conname = 'fba_remesas_estado_check')
  LOOP
    EXECUTE format('ALTER TABLE public.fba_remesas DROP CONSTRAINT %I', v_nombre);
  END LOOP;
END $$;

ALTER TABLE public.fba_remesas
  ADD CONSTRAINT fba_remesas_estado_check
  CHECK (estado IN ('borrador', 'aprobada', 'encajando', 'lista', 'enviada', 'cerrada'));

COMMENT ON COLUMN public.fba_remesas.estado IS
  'Por dónde va el envío: borrador (el boceto que se acuerda con el cliente) -> aprobada -> '
  'encajando -> lista -> enviada -> cerrada. El paso «en_amazon» existió mientras el ERP creaba '
  'el plan de entrada por la API; se quitó en la 216 porque nunca se usó y el envío se crea en '
  'Seller Central subiendo el manifiesto y el Excel de embalaje que genera el ERP.';


-- ============================================================================
-- COMPROBACIÓN
-- ============================================================================
SELECT
  estado,
  count(*) AS remesas,
  CASE estado
    WHEN 'borrador'  THEN '1 · el boceto: el cliente y la agencia deciden qué va'
    WHEN 'aprobada'  THEN '2 · cerrado: se imprimen las etiquetas con el SKU'
    WHEN 'encajando' THEN '3 · las cajas, con sus medidas y su peso'
    WHEN 'lista'     THEN '4 · se generan los dos Excel y se sube todo a Seller Central'
    WHEN 'enviada'   THEN '5 · la mercancía ha salido'
    ELSE                  '6 · Amazon ha terminado de recibir'
  END AS que_toca_ahi
FROM public.fba_remesas
GROUP BY estado
ORDER BY 2 DESC;
