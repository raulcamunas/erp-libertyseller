-- ============================================================================
-- 253 · TRANSCRIPCIÓN DE LLAMADAS: QUIÉN HABLA («COMERCIAL» Y «CLIENTE»)
-- ============================================================================
--
-- La transcripción entera de una llamada (migración 244) es un texto corrido: el modelo de voz no dice quién habla. Con esto, un segundo paso de la IA de
-- texto reparte la transcripción en TURNOS y dice de quién es cada uno, y la ficha del lead la enseña como una conversación:
--
--     Comercial  Buenas tardes, ¿hablo con la tienda…?
--     Cliente    Sí, dime.
--
-- Se hace APARTE del resumen, en el mismo proceso (`rinkel-transcribir`, cada dos minutos): coge las llamadas ya resumidas que son conversación y todavía no
-- tienen turnos, las más nuevas primero. Así el resumen no depende de esto, las llamadas que ya estaban transcritas se separan solas en unos minutos, y un
-- fallo de la IA no estropea nada: se reintenta hasta 10 veces (con 10 minutos entre una y otra: aguanta una caída de más de una hora) y, si no sale, la
-- transcripción se queda corrida como hasta ahora. Cuesta unos 0,0003 $ por llamada (la IA solo contesta una lista corta de números, no reescribe la conversación).
--
--   · `turnos`            [{"quien": "comercial" | "cliente", "texto": "…"}] en el orden en que se habló. NULL = todavía sin separar. [] = no hay nada que
--                         separar (una sola frase, o demasiado larga) y no se vuelve a intentar.
--   · `turnos_intentos`   Cuántas veces se ha intentado (al llegar a 10 se deja; el límite vive en el código, INTENTOS_DE_TURNOS).
--   · `turnos_intento_at` Cuándo fue el último intento: separa los intentos en el tiempo.
--   · `modelo_turnos`, `coste_turnos_usd`  Con qué modelo y cuánto costó, para saber a dónde va el dinero.
--
-- Las ve quien ya ve la llamada (la política de la 244 no cambia) y solo escribe el servidor.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo hecho.
-- El código funciona SIN esta migración: la transcripción sigue saliendo corrida y el proceso avisa en Sistema de que falta lanzarla.
-- Hace falta haber lanzado antes la 244.
-- ============================================================================


ALTER TABLE public.rinkel_transcripciones
  ADD COLUMN IF NOT EXISTS turnos JSONB,
  ADD COLUMN IF NOT EXISTS turnos_intentos INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS turnos_intento_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS modelo_turnos TEXT,
  ADD COLUMN IF NOT EXISTS coste_turnos_usd NUMERIC(10, 5);

-- Los CHECK se añaden aparte para que pegar la migración otra vez no falle porque ya existan
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rinkel_transcripciones_turnos_es_lista') THEN
    ALTER TABLE public.rinkel_transcripciones
      ADD CONSTRAINT rinkel_transcripciones_turnos_es_lista CHECK (turnos IS NULL OR jsonb_typeof(turnos) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rinkel_transcripciones_turnos_intentos_positivos') THEN
    ALTER TABLE public.rinkel_transcripciones
      ADD CONSTRAINT rinkel_transcripciones_turnos_intentos_positivos CHECK (turnos_intentos >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.rinkel_transcripciones.turnos IS
  'La transcripcion entera repartida en turnos: [{"quien": "comercial"|"cliente", "texto": "..."}]. NULL = sin separar todavia; [] = nada que separar. Lo deduce la IA por lo que se dice: puede equivocarse.';

-- «Qué conversaciones faltan por separar»: pocas filas, solo las pendientes
CREATE INDEX IF NOT EXISTS rinkel_transcripciones_turnos_pendientes_idx
  ON public.rinkel_transcripciones (hecha_at DESC)
  WHERE estado = 'hecha' AND tipo = 'conversacion' AND turnos IS NULL;


-- ---------- Comprobación ----------
DO $$
DECLARE
  columnas INTEGER;
  pendientes INTEGER;
BEGIN
  SELECT count(*) INTO columnas
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'rinkel_transcripciones'
    AND column_name IN ('turnos', 'turnos_intentos', 'turnos_intento_at', 'modelo_turnos', 'coste_turnos_usd');
  IF columnas <> 5 THEN
    RAISE EXCEPTION 'Faltan columnas de los turnos en rinkel_transcripciones (hay %, tienen que ser 5). ¿Se lanzó la 244?', columnas;
  END IF;

  SELECT count(*) INTO pendientes
  FROM public.rinkel_transcripciones
  WHERE estado = 'hecha' AND tipo = 'conversacion' AND turnos IS NULL;
  RAISE NOTICE 'Listo. Conversaciones ya transcritas que se separaran solas en los proximos minutos: %.', pendientes;
END $$;
