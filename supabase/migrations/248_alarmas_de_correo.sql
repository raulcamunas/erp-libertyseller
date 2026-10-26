-- ============================================================================
-- 248 · LA CAMPANA ADMITE LOS AVISOS DE LA SALUD DE LAS SECUENCIAS DE CORREO
-- ============================================================================
--
-- La pestaña «Salud» de Correo → Secuencias enseña cómo van los buzones y el motor de seguimientos. Lo más grave (un buzón sin conexión, el motor
-- parado, envíos fallidos, rebotes por encima del límite) además llega a la CAMPANA de las Notificaciones: a los administradores y, si el problema es
-- de un buzón, también a su dueño. Se escribe en `notifications` con el tipo `alarma_correo`.
--
-- Esta migración solo AMPLÍA la restricción de tipos de `notifications` para que admita ese tipo nuevo (conserva todos los de antes: los de
-- comentarios, menciones, tareas, web leads, stock y Amazon). No toca datos ni políticas.
--
-- El código funciona SIN esta migración: la pantalla de Salud enseña las alarmas igual; lo único que no hace es escribir en la campana (la base
-- rechaza el tipo, el vigía lo apunta una vez en el registro y no insiste durante una hora).
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

  -- Antes de cambiar la restricción, se comprueba que ningún aviso que ya existe se quedaría fuera de la lista nueva. Si lo hubiera, lo dice (con
  -- el tipo) en vez de fallar con un mensaje de la base, y no cambia nada.
  SELECT string_agg(DISTINCT type, ', ') INTO desconocidos
  FROM public.notifications
  WHERE type NOT IN ('comment', 'mention', 'task_assigned', 'task_updated', 'web_lead', 'freno_stock', 'fallo_stock', 'fallo_amazon', 'job_amazon', 'alarma_correo',
                     'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead');
  IF desconocidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay avisos en la campana de un tipo que esta migracion no conoce (%). Anadelo a la lista de abajo antes de lanzarla.', desconocidos;
  END IF;

  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
      'freno_stock', 'fallo_stock',
      'fallo_amazon', 'job_amazon',
      'alarma_correo',
      -- Los de la migración 251 (los avisos de correo de cada persona): están aquí para que volver a lanzar ESTA migración después de la 251 no los quite
      'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead'
    ));
END $$;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO ENSEÑA los NOTICE. Lo que falle revienta con un error; lo que salga bien se lee en la fila de abajo, y las dos columnas
-- tienen que decir «true».
SELECT
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass AND pg_get_constraintdef(oid) LIKE '%alarma_correo%')
    AS la_campana_admite_alarma_correo,
  (SELECT bool_and(pg_get_constraintdef(oid) LIKE '%' || t || '%')
     FROM pg_constraint, unnest(ARRAY['comment', 'mention', 'task_assigned', 'task_updated', 'web_lead', 'freno_stock', 'fallo_stock', 'fallo_amazon', 'job_amazon']) AS t
    WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass)
    AS y_conserva_los_tipos_de_antes;
