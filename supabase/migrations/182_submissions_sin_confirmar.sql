-- ==================================================================
-- 182 · DEJAR DE RELEER 136.000 ENVÍOS CADA QUINCE MINUTOS
-- ==================================================================
--
-- La organización se ha pasado de cuota de SALIDA DE DATOS (egress) y está en
-- periodo de gracia. Esta migración y el cambio que la acompaña son la causa.
--
--
-- ============ LA CUENTA ============
--
-- `confirmSubmissions()` corre en cada refresco de catálogo —cada quince
-- minutos— y lee TODO lo que esté en 'pendiente' o 'aceptado', sin límite de
-- fecha, para ver si el espejo ya refleja el valor enviado.
--
-- Medido contra la base real:
--
--     filas en 'aceptado'           136.609
--     filas en 'pendiente'              138
--     bytes por fila (4 columnas)       100
--     por lectura                      13,6 MB
--     x96 lecturas al día               1,31 GB/día
--     al mes                              39 GB      (el plan da 5)
--
-- Ocho veces la cuota, de UNA sola consulta.
--
--
-- ============ POR QUÉ HAY 136.609 ATASCADAS ============
--
-- Un envío pasa a 'confirmado' cuando el espejo del catálogo coincide con el
-- valor que se mandó. Si el precio VUELVE A CAMBIAR antes de esa comprobación
-- —y con un motor que recalcula cada hora, cambia—, ya no coincide nunca: se
-- queda en 'aceptado' para siempre y se relee cada quince minutos, cada día,
-- para volver a no coincidir.
--
-- El índice parcial de la 118 lo daba por imposible: «son unas pocas filas
-- dentro de una tabla que crece para siempre». Ya no.
--
--
-- ============ QUÉ SE HACE ============
--
-- 1. Las viejas se cierran como 'caducado': ya no se van a confirmar nunca y no
--    tienen por qué seguir leyéndose. NO se borran —son el registro de lo que
--    se le mandó a la tienda de un cliente— solo salen del índice de trabajo.
--
-- 2. El código deja de mirar más atrás de SEIS horas (lib/amazon/data.ts).

-- ---------- 1. Un estado más ----------
ALTER TABLE public.amazon_submissions
  DROP CONSTRAINT IF EXISTS amazon_submissions_status_check;

ALTER TABLE public.amazon_submissions
  ADD CONSTRAINT amazon_submissions_status_check
  CHECK (status IN ('pendiente', 'aceptado', 'confirmado', 'invalido', 'error', 'caducado'));

COMMENT ON COLUMN public.amazon_submissions.status IS
  'pendiente -> se va a mandar. aceptado -> Amazon lo cogió. confirmado -> el espejo ya lo refleja. '
  'invalido/error -> Amazon lo rechazó. caducado -> salió hacia Amazon y nunca llegó a cuadrar con '
  'el espejo; se deja de comprobar, pero el registro se conserva.';

-- ---------- 2. Cerrar lo que lleva más de dos días sin cuadrar ----------
--
-- Seis horas, y el número está medido. El catálogo se refresca cada quince
-- minutos, así que un envío que iba a cuadrar cuadró en la primera media hora.
-- Contado contra la base real, lo que cuesta releer cada ventana cada 15 min:
--
--      6 h    2.729 filas    0,79 GB/mes   <- esta
--     24 h   11.402 filas    3,28 GB/mes
--     48 h   22.415 filas    6,46 GB/mes   (se pasa del plan)
--    sin    136.740 filas       39 GB/mes   (lo que hay hoy)
--
-- Por tramos de 20.000 para no tener un UPDATE de 136.000 filas colgando la
-- transacción del editor SQL.
DO $$
DECLARE
  v_total INTEGER := 0;
  v_tramo INTEGER;
BEGIN
  LOOP
    WITH viejas AS (
      SELECT id FROM public.amazon_submissions
      WHERE status IN ('pendiente', 'aceptado')
        AND sent_at < NOW() - INTERVAL '6 hours'
      LIMIT 20000
    )
    UPDATE public.amazon_submissions s
    SET status = 'caducado'
    FROM viejas
    WHERE s.id = viejas.id;

    GET DIAGNOSTICS v_tramo = ROW_COUNT;
    v_total := v_total + v_tramo;
    EXIT WHEN v_tramo = 0;
  END LOOP;

  RAISE NOTICE 'Cerradas % filas que llevaban mas de 6 h sin cuadrar.', v_total;
END $$;

-- ---------- 3. El índice, con la fecha dentro ----------
--
-- La consulta ahora filtra por `sent_at`, así que tiene que estar en el índice:
-- sin ella, Postgres encuentra las filas por conexión y descarta por fecha
-- después, que es justo el trabajo que se quiere evitar.
DROP INDEX IF EXISTS public.idx_amazon_submissions_sin_confirmar;

CREATE INDEX IF NOT EXISTS idx_amazon_submissions_sin_confirmar
  ON public.amazon_submissions(connection_id, marketplace_id, sent_at DESC)
  WHERE status IN ('pendiente', 'aceptado');

DO $$
DECLARE
  v_abiertas INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_abiertas FROM public.amazon_submissions
  WHERE status IN ('pendiente', 'aceptado');
  RAISE NOTICE 'Quedan % envios por confirmar (antes: 136.747). Eso es lo que se relee cada 15 min.', v_abiertas;
END $$;
