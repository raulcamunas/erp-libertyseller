-- ============================================================================
-- 251 · LA CAMPANA AVISA A CADA UNO DE LO SUYO EN EL CORREO
-- ============================================================================
--
-- La campana de las Notificaciones (el panel de la barra lateral) va a avisar a cada empleado, y solo de lo SUYO, de lo importante que pasa en su
-- correo: le ha llegado un correo de una persona, un correo suyo ha rebotado, un seguimiento automático se ha pausado o parado, o un lead le ha
-- contestado algo que hay que atender (quiere avanzar, pide información…). Antes la campana solo avisaba de leads web, de Amazon y de las alarmas
-- de la salud de las secuencias.
--
-- Esta migración prepara `notifications` para eso. NO toca ni borra ningún aviso que ya exista:
--
--   · `clave`  Una marca para no repetir un aviso. Un correo concreto avisa UNA vez aunque lo lean dos procesos a la vez; y un aviso se puede
--              «mejorar» después (el correo de un lead que contesta avisa primero como «correo nuevo» y, cuando la IA lo ha leído, pasa a decir
--              «Fulano está interesado») escribiendo otra vez con la misma clave. Los avisos de antes se quedan con la clave vacía.
--   · `datos`  Lo que hace falta para llevarte al sitio al pulsar el aviso: de qué buzón, hilo o secuencia es.
--   · Los TIPOS nuevos en la restricción de `notifications`: correo_nuevo, correo_rebote, secuencia_pausada, secuencia_parada y respuesta_lead
--     (conserva todos los de antes, incluido `alarma_correo`: esta migración incluye lo de la 248, así que da igual si ya estaba lanzada o no).
--   · Dos índices: uno único sobre (user_id, clave) y otro para pintar rápido lo que cada persona no ha leído.
--
-- El código funciona SIN esta migración: el correo, los seguimientos y la campana siguen como siempre; lo único que no ocurre es que se escriban
-- los avisos nuevos (la base los rechaza, se apunta una vez en el registro y no se insiste durante una hora).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- Hace falta la tabla `notifications` (migración 040).
-- ============================================================================


DO $$
DECLARE
  desconocidos TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    RAISE EXCEPTION 'No existe public.notifications (la crea la migración 040): sin ella no hay campana a la que avisar.';
  END IF;

  -- Antes de cambiar nada, se comprueba que ningún aviso que ya existe se quedaría fuera de la lista nueva. Si lo hubiera, lo dice (con el tipo)
  -- en vez de fallar con un mensaje de la base, y no cambia nada.
  SELECT string_agg(DISTINCT type, ', ') INTO desconocidos
  FROM public.notifications
  WHERE type NOT IN (
    'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
    'freno_stock', 'fallo_stock', 'fallo_amazon', 'job_amazon',
    'alarma_correo',
    'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead'
  );
  IF desconocidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay avisos en la campana de un tipo que esta migracion no conoce (%). Anadelo a la lista de abajo antes de lanzarla.', desconocidos;
  END IF;

  ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS clave TEXT;
  ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS datos JSONB;

  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
      'freno_stock', 'fallo_stock',
      'fallo_amazon', 'job_amazon',
      'alarma_correo',
      'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead'
    ));
END $$;

-- Un aviso con clave no se repite para la misma persona. Los que no la tienen (todos los de antes) no chocan entre sí: en un índice único los
-- vacíos cuentan como distintos. Tiene que ser un índice ENTERO (no parcial) para que `upsert … onConflict: 'user_id,clave'` lo encuentre.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_usuario_clave_idx ON public.notifications (user_id, clave);

-- Lo que cada persona no ha leído, lo último primero: lo que pinta el número de la campana y la lista
CREATE INDEX IF NOT EXISTS notifications_usuario_sin_leer_idx ON public.notifications (user_id, created_at DESC) WHERE read = false;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO ENSEÑA los NOTICE. Lo que falle revienta con un error; lo que salga bien se lee en la fila de abajo, y las cuatro
-- columnas tienen que decir «true».
SELECT
  (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name IN ('clave', 'datos'))
    AS tiene_clave_y_datos,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notifications' AND indexname = 'notifications_usuario_clave_idx')
    AS tiene_el_indice_de_la_clave,
  (SELECT bool_and(pg_get_constraintdef(oid) LIKE '%' || t || '%')
     FROM pg_constraint, unnest(ARRAY['correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead']) AS t
    WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass)
    AS admite_los_tipos_nuevos,
  (SELECT bool_and(pg_get_constraintdef(oid) LIKE '%' || t || '%')
     FROM pg_constraint, unnest(ARRAY['comment', 'mention', 'task_assigned', 'task_updated', 'web_lead', 'freno_stock', 'fallo_stock', 'fallo_amazon', 'job_amazon', 'alarma_correo']) AS t
    WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass)
    AS y_conserva_los_de_antes;
