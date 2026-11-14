-- ============================================================================
-- 285 · CHAT: RESPONDER CITANDO UN MENSAJE
-- ============================================================================
-- Además de los hilos, en un canal se puede responder a un mensaje concreto: el nuevo mensaje lleva arriba una cita (quién y qué decía) y pulsarla lleva al original. Es una sola
-- columna: el id del mensaje citado. Si el original se borra del todo, la cita se quita sola (ON DELETE SET NULL); si solo se «elimina», la cita dice «mensaje eliminado».
-- Se puede lanzar las veces que se quiera. Hace falta la 284.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.chat_mensajes') IS NULL THEN
    RAISE EXCEPTION 'Falta la tabla chat_mensajes: lanza antes la migración 284_chat_del_equipo.sql.';
  END IF;
END $$;

ALTER TABLE public.chat_mensajes ADD COLUMN IF NOT EXISTS responde_a BIGINT REFERENCES public.chat_mensajes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chat_mensajes_responde_idx ON public.chat_mensajes (responde_a) WHERE responde_a IS NOT NULL;

-- COMPROBACIÓN: tiene que salir «true»
SELECT (SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_mensajes' AND column_name = 'responde_a') AS tiene_la_columna;
