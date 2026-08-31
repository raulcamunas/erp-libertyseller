-- ==================================================================
-- 168 · QUE SE SEPA POR QUE NO SE PUBLICARON LOS PRECIOS
-- ==================================================================
--
-- `publicado_at` dice cuando se publico por ultima vez. No dice nada de las
-- veces que NO se publico, que es justo lo que hay que saber cuando alguien
-- enciende el interruptor y no pasa nada.
--
-- Y son varias razones distintas, cada una con su arreglo:
--
--   · Esta apagado.
--   · El motor no tiene cuenta de Amazon o pais.
--   · No ha entrado ninguna pasada de stock desde la ultima publicacion.
--   · No habia ningun precio que cambiar.
--   · Reventó, y con que mensaje.
--
-- Todas ellas acababan en la misma nada: el cron lo escribia en su registro del
-- servidor y la pantalla no decia ni pio. La primera vez que paso, la unica
-- forma de averiguarlo fue leer el codigo.
--
--
-- POR QUE EN LA CONFIG Y NO EN UNA TABLA DE INTENTOS
-- --------------------------------------------------
-- Porque solo interesa EL ULTIMO. Un historial de intentos serian filas cada
-- media hora diciendo casi siempre lo mismo, y la pregunta que se hace de verdad
-- —«¿por que no ha publicado?»— se contesta con el ultimo, no con los cien
-- anteriores. Las publicaciones que SI ocurren ya dejan su rastro entero en
-- amazon_submissions y salen en el historial por la vista de la 167.
--
-- Se escribe sobre la misma fila unica, asi que no crece nada.

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicado_motivo TEXT;

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicado_intento_at TIMESTAMPTZ;

COMMENT ON COLUMN public.entrais_config.publicado_motivo IS
  'Que paso en el ultimo intento REAL de publicar precios, con sus palabras. Los saltos de rutina («todavia no le toca») NO se escriben aqui: llenarian la columna de ruido cada minuto y taparian el motivo que importa.';
COMMENT ON COLUMN public.entrais_config.publicado_intento_at IS
  'Cuando fue ese intento. Distinto de publicado_at, que solo se mueve cuando de verdad se publico algo.';

-- ---------- Comprobacion ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entrais_config'
      AND column_name = 'publicado_motivo'
  ) THEN
    RAISE EXCEPTION 'La columna publicado_motivo no se ha creado.';
  END IF;
  RAISE NOTICE 'Listo. A partir de ahora la pantalla dira por que no publico, en vez de callarse.';
END $$;
