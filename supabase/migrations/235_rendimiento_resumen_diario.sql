-- ============================================================================
-- 235 · RENDIMIENTO COMERCIAL: EL RESUMEN POR DÍA DE TODO EL EQUIPO, PARA COMPARAR PERIODOS
-- ============================================================================
--
-- El panel «Mi rendimiento» enseñaba un día suelto. Para comparar —una semana contra la anterior, un mes, quién
-- va por delante, cómo evoluciona cada uno— hace falta mirar meses enteros de todo el equipo a la vez, y bajar al
-- navegador las miles de llamadas y notas de varios meses para sumarlas allí no es razonable. Esta función las
-- resume EN LA BASE: devuelve una fila por persona y día con sus cifras ya calculadas (unas 300 filas por cuatro
-- meses de un equipo de cinco) y el panel suma, compara y pinta.
--
--   SELECT * FROM public.rendimiento_resumen_diario('2026-10-01', '2026-10-31');
--
-- LAS REGLAS SON LAS DEL PANEL, y hay que mantenerlas iguales (viven en lib/rendimiento/metricas.ts):
--
--   · Los días son los de MADRID (Europe/Madrid), con sus cambios de hora: una llamada de las 00:30 del 22 es del 22.
--   · CONTESTADA = Rinkel dice ANSWERED y dura 10 segundos o más. Por debajo es un contestador automático y cuenta
--     como no contestada. Es una convención de lectura: en la base el estado sigue siendo el de Rinkel.
--   · CONVERSACIÓN (de teléfono) = contestada de 60 segundos o más, en cualquier sentido.
--   · WhatsApp y correos cuentan CONVERSACIONES: clientes distintos con los que se habló ese día en ese canal, por
--     muchas interacciones que se apunten. `*_apuntes` es el número de interacciones sin agrupar.
--   · RESPUESTAS = clientes distintos cuya respuesta se anotó ese día, por el canal que sea.
--   · CITAS = las que la persona creó ese día en la Agenda, sin las importadas de Google.
--
-- SE EJECUTA CON LOS PERMISOS DE QUIEN LLAMA (SECURITY INVOKER): las políticas de las tablas siguen mandando.
-- Cada comercial recibe solo lo suyo y quien supervisa al equipo recibe lo de todos, exactamente como cuando el
-- panel leía las tablas directamente. La función no abre nada nuevo.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. El panel funciona sin ella (como hasta ahora, solo con
-- el día suelto) y avisa de que faltan la semana, el mes y las comparativas.
-- ============================================================================


-- Para pedir «todo el equipo entre estas fechas» sin recorrer las tablas enteras
CREATE INDEX IF NOT EXISTS rinkel_llamadas_fecha_idx ON public.rinkel_llamadas (fecha);
CREATE INDEX IF NOT EXISTS cold_lead_notes_fecha_idx ON public.cold_lead_notes (occurred_at);
CREATE INDEX IF NOT EXISTS appointments_created_at_idx ON public.appointments (created_at);


CREATE OR REPLACE FUNCTION public.rendimiento_resumen_diario(p_desde DATE, p_hasta DATE)
RETURNS TABLE (
  user_id UUID,
  dia DATE,
  realizadas INTEGER,
  recibidas INTEGER,
  contestadas INTEGER,
  segundos INTEGER,
  conversaciones INTEGER,
  whatsapp INTEGER,
  whatsapp_apuntes INTEGER,
  correos INTEGER,
  correos_apuntes INTEGER,
  respuestas INTEGER,
  citas INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Mismas cifras que SEGUNDOS_MINIMOS_PARA_CONTESTADA y SEGUNDOS_DE_CONVERSACION de lib/rendimiento/metricas.ts
  c_contestada CONSTANT INTEGER := 10;
  c_conversacion CONSTANT INTEGER := 60;
  v_desde TIMESTAMPTZ;
  v_hasta TIMESTAMPTZ;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'El rango de días no es válido: % - %', p_desde, p_hasta;
  END IF;
  -- Un tope por si alguien pide años de golpe: la respuesta se pagina de 1.000 en 1.000 y un rango así sería enorme
  IF p_hasta - p_desde > 400 THEN
    RAISE EXCEPTION 'El rango no puede pasar de 400 días (se han pedido %).', p_hasta - p_desde + 1;
  END IF;

  -- Las 00:00 de Madrid del primer día y las 00:00 de Madrid del día siguiente al último
  v_desde := p_desde::TIMESTAMP AT TIME ZONE 'Europe/Madrid';
  v_hasta := (p_hasta + 1)::TIMESTAMP AT TIME ZONE 'Europe/Madrid';

  RETURN QUERY
  SELECT t.user_id,
         t.dia,
         sum(t.realizadas)::INTEGER,
         sum(t.recibidas)::INTEGER,
         sum(t.contestadas)::INTEGER,
         sum(t.segundos)::INTEGER,
         sum(t.conversaciones)::INTEGER,
         sum(t.whatsapp)::INTEGER,
         sum(t.whatsapp_apuntes)::INTEGER,
         sum(t.correos)::INTEGER,
         sum(t.correos_apuntes)::INTEGER,
         sum(t.respuestas)::INTEGER,
         sum(t.citas)::INTEGER
  FROM (
    -- Las llamadas de Rinkel
    SELECT l.user_id AS user_id,
           (l.fecha AT TIME ZONE 'Europe/Madrid')::DATE AS dia,
           count(*) FILTER (WHERE l.direccion = 'outbound') AS realizadas,
           count(*) FILTER (WHERE l.direccion = 'inbound') AS recibidas,
           count(*) FILTER (WHERE l.direccion = 'outbound' AND l.estado = 'ANSWERED' AND l.duracion_s >= c_contestada) AS contestadas,
           coalesce(sum(l.duracion_s) FILTER (WHERE l.estado = 'ANSWERED' AND l.duracion_s >= c_contestada), 0) AS segundos,
           count(*) FILTER (WHERE l.estado = 'ANSWERED' AND l.duracion_s >= c_conversacion) AS conversaciones,
           0::BIGINT AS whatsapp, 0::BIGINT AS whatsapp_apuntes, 0::BIGINT AS correos, 0::BIGINT AS correos_apuntes,
           0::BIGINT AS respuestas, 0::BIGINT AS citas
    FROM public.rinkel_llamadas l
    WHERE l.fecha >= v_desde AND l.fecha < v_hasta
    GROUP BY 1, 2

    UNION ALL

    -- Las interacciones de Cold Calling: se agrupan por cliente para contar conversaciones
    SELECT n.author_id,
           (n.occurred_at AT TIME ZONE 'Europe/Madrid')::DATE,
           0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT,
           count(DISTINCT n.lead_id) FILTER (WHERE n.kind = 'whatsapp'),
           count(*) FILTER (WHERE n.kind = 'whatsapp'),
           count(DISTINCT n.lead_id) FILTER (WHERE n.kind = 'email'),
           count(*) FILTER (WHERE n.kind = 'email'),
           count(DISTINCT n.lead_id) FILTER (WHERE n.es_respuesta),
           0::BIGINT
    FROM public.cold_lead_notes n
    WHERE n.occurred_at >= v_desde AND n.occurred_at < v_hasta AND n.author_id IS NOT NULL
    GROUP BY 1, 2

    UNION ALL

    -- Las citas que cada comercial agendó ese día
    SELECT a.comercial_id,
           (a.created_at AT TIME ZONE 'Europe/Madrid')::DATE,
           0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT,
           count(*)
    FROM public.appointments a
    WHERE a.created_at >= v_desde AND a.created_at < v_hasta AND a.is_external = false AND a.comercial_id IS NOT NULL
    GROUP BY 1, 2
  ) t
  GROUP BY t.user_id, t.dia
  -- Orden fijo: la respuesta se pagina, y paginar sobre un orden con empates repite y se salta filas
  ORDER BY t.dia, t.user_id;
END;
$$;

COMMENT ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) IS
  'Resumen por persona y dia (Madrid) de llamadas de Rinkel, conversaciones de WhatsApp y correo, respuestas y citas, para el panel de rendimiento. Se ejecuta con los permisos de quien llama: las politicas de las tablas siguen mandando.';

-- Solo para quien ha iniciado sesión
REVOKE ALL ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) TO service_role;


-- ---------- Comprobación ----------
DO $$
DECLARE
  filas INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rendimiento_resumen_diario'
  ) THEN
    RAISE EXCEPTION 'No se ha creado rendimiento_resumen_diario.';
  END IF;

  -- Que se puede llamar de verdad (y no solo que existe): el último mes
  SELECT count(*) INTO filas FROM public.rendimiento_resumen_diario((CURRENT_DATE - 30), CURRENT_DATE);
  RAISE NOTICE 'Resumen diario listo: el último mes devuelve % filas (una por persona y día con actividad).', filas;
END $$;
