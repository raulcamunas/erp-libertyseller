-- ============================================================================
-- 301 · EL AVISO DE LAS FACTURAS QUE LLEVAN DÍAS SIN PAGAR
-- ============================================================================
-- Facturación → Cobros ya enseña cuántos días laborables lleva cada factura sin pagar y deja mandar un recordatorio de pago con la
-- factura (eso no necesita nada de la base: el recordatorio queda en facturacion_registro como un envío con detalle.recordatorio).
--
-- Esto es solo para el AVISO en la campana: una vez al día, en horario de oficina, a cada administrador, una vez por factura que lleve
-- 3 días laborables o más vencida y sin recordatorio (app/api/facturacion/cron-impagadas). Hace dos cosas:
--   1. La campana admite el tipo nuevo 'factura_impagada'.
--   2. El reloj de la tarea: una vez al día (1440 min). Sin esta fila la ruta no hace nada.
-- ============================================================================

DO $$
DECLARE
  desconocidos TEXT;
BEGIN
  SELECT string_agg(DISTINCT type, ', ') INTO desconocidos
  FROM public.notifications
  WHERE type NOT IN (
    'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
    'freno_stock', 'fallo_stock', 'fallo_amazon', 'job_amazon',
    'alarma_correo',
    'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead',
    'fba_alerta', 'fba_resumen',
    'factura_impagada'
  );
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
      'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead',
      'fba_alerta', 'fba_resumen',
      'factura_impagada'
    ));
END $$;


-- ---------------------------------------------------------------------------
-- El reloj: una vez al día
-- ---------------------------------------------------------------------------
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('facturas-impagadas', 1440, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = EXCLUDED.cada_minutos,
      activo = EXCLUDED.activo,
      actualizado_at = NOW();


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las tres columnas tienen que decir «true».
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%factura_impagada%'
     FROM pg_constraint
    WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass)
    AS la_campana_admite_el_tipo_nuevo,
  (SELECT bool_and(pg_get_constraintdef(oid) LIKE '%' || t || '%')
     FROM pg_constraint, unnest(ARRAY['comment', 'web_lead', 'freno_stock', 'alarma_correo', 'correo_nuevo', 'respuesta_lead', 'fba_alerta', 'fba_resumen']) AS t
    WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass)
    AS y_conserva_los_de_antes,
  EXISTS (SELECT 1 FROM public.cron_config WHERE tarea = 'facturas-impagadas' AND activo)
    AS el_reloj_esta_puesto;
