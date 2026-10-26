-- ============================================================================
-- 252 · RENDIMIENTO COMERCIAL: UN CLIENTE, UNA LLAMADA AL DÍA
-- ============================================================================
--
-- «Mi rendimiento» contaba CADA intento: llamar tres veces a un cliente que no contesta eran tres llamadas hechas. Lo que quiere medirse es con
-- cuántos CLIENTES se ha hablado o se ha intentado hablar, así que desde esta migración:
--
--   · LLAMADAS HECHAS = clientes distintos a los que llamó la persona ese día. Un cliente llamado tres veces es UNA, aunque a la tercera contestara y
--     hablaran un minuto. Al día siguiente, otra llamada al mismo cliente (una rellamada, otro momento) vuelve a contar.
--   · CONTESTADAS = clientes que contestaron en algún intento ese día (la llamada dura 10 segundos o más; un contestador no cuenta).
--   · CONVERSACIONES = clientes con una llamada contestada de 60 segundos o más ese día (en cualquier sentido).
--   · INTENTOS (columna nueva) = las llamadas salientes sin agrupar. El panel las enseña debajo de la cifra, como los apuntes de WhatsApp.
--   · RECIBIDAS y el TIEMPO AL TELÉFONO no cambian: las recibidas se cuentan una a una y el tiempo es tiempo (se suma entero).
--
-- «CLIENTE» es el lead de Cold Calling al que se llamó (`lead_id`) y, si la llamada no está enlazada a ninguno, su número de teléfono; si tampoco hay número
-- (lo ocultó), la propia llamada. La clave es `COALESCE(lead_id::text, numero, id::text)`, por persona y día de Madrid, y es la misma que usa el navegador en
-- `clienteDeLaLlamada` (lib/rendimiento/metricas.ts): si se cambia aquí, hay que cambiarla allí.
--
-- LAS CIFRAS DE TODO EL HISTÓRICO CAMBIAN, porque se calculan al leer: una semana que se vio con 404 llamadas pasa a tener las de clientes distintos.
--
-- También cambia el aviso de equipo «X lleva 40 llamadas hoy» (migración 238): ahora cuenta clientes distintos, lo mismo que la tarjeta.
--
-- La función cambia de columnas (gana `intentos`), así que se borra y se vuelve a crear con sus permisos. Mientras no se lance, el panel funciona como
-- hasta ahora (cuenta cada llamada) y el calendario también, para no contradecirse con las tarjetas.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- ============================================================================


-- ---------- 1) El resumen diario ----------

DROP FUNCTION IF EXISTS public.rendimiento_resumen_diario(DATE, DATE);

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
  citas INTEGER,
  intentos INTEGER
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
         sum(t.citas)::INTEGER,
         sum(t.intentos)::INTEGER
  FROM (
    -- Las llamadas de Rinkel: UN CLIENTE CUENTA UNA VEZ AL DÍA (ver arriba). Cada persona y día es un grupo, así que `count(DISTINCT cliente)` es «clientes de ese día»
    SELECT l.user_id AS user_id,
           (l.fecha AT TIME ZONE 'Europe/Madrid')::DATE AS dia,
           count(DISTINCT COALESCE(l.lead_id::text, l.numero, l.id::text)) FILTER (WHERE l.direccion = 'outbound') AS realizadas,
           count(*) FILTER (WHERE l.direccion = 'inbound') AS recibidas,
           count(DISTINCT COALESCE(l.lead_id::text, l.numero, l.id::text)) FILTER (WHERE l.direccion = 'outbound' AND l.estado = 'ANSWERED' AND l.duracion_s >= c_contestada) AS contestadas,
           coalesce(sum(l.duracion_s) FILTER (WHERE l.estado = 'ANSWERED' AND l.duracion_s >= c_contestada), 0) AS segundos,
           count(DISTINCT COALESCE(l.lead_id::text, l.numero, l.id::text)) FILTER (WHERE l.estado = 'ANSWERED' AND l.duracion_s >= c_conversacion) AS conversaciones,
           0::BIGINT AS whatsapp, 0::BIGINT AS whatsapp_apuntes, 0::BIGINT AS correos, 0::BIGINT AS correos_apuntes,
           0::BIGINT AS respuestas, 0::BIGINT AS citas,
           count(*) FILTER (WHERE l.direccion = 'outbound') AS intentos
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
           0::BIGINT,
           0::BIGINT
    FROM public.cold_lead_notes n
    WHERE n.occurred_at >= v_desde AND n.occurred_at < v_hasta AND n.author_id IS NOT NULL
    GROUP BY 1, 2

    UNION ALL

    -- Las citas que cada comercial agendó ese día
    SELECT a.comercial_id,
           (a.created_at AT TIME ZONE 'Europe/Madrid')::DATE,
           0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT,
           count(*),
           0::BIGINT
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
  'Resumen por persona y dia (Madrid) de llamadas de Rinkel (un cliente cuenta una vez al dia; intentos = las salientes sin agrupar), conversaciones de WhatsApp y correo, respuestas y citas, para el panel de rendimiento. Se ejecuta con los permisos de quien llama: las politicas de las tablas siguen mandando.';

-- Solo para quien ha iniciado sesión
REVOKE ALL ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rendimiento_resumen_diario(DATE, DATE) TO service_role;


-- ---------- 2) Los avisos de equipo «X lleva N llamadas hoy» ----------
--
-- Misma función que la de la migración 238, con una sola diferencia: lo que se cuenta es CLIENTES DISTINTOS llamados hoy (lo mismo que la tarjeta «Llamadas
-- hechas»), no cada llamada. Si hace falta, se pega esta migración entera: no cambia nada más.
CREATE OR REPLACE FUNCTION public.avisar_hitos_de_llamadas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoy DATE := (NOW() AT TIME ZONE 'Europe/Madrid')::date;
  r RECORD;
  v_total INTEGER;
  v_hito INTEGER;
  v_nombre TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT n.user_id
    FROM nuevas n
    WHERE n.direccion = 'outbound'
      AND n.fecha >= NOW() - INTERVAL '3 hours'
      AND (n.fecha AT TIME ZONE 'Europe/Madrid')::date = v_hoy
  LOOP
    SELECT count(DISTINCT COALESCE(l.lead_id::text, l.numero, l.id::text))::INTEGER INTO v_total
    FROM public.rinkel_llamadas l
    WHERE l.user_id = r.user_id
      AND l.direccion = 'outbound'
      AND (l.fecha AT TIME ZONE 'Europe/Madrid')::date = v_hoy;

    -- El mayor múltiplo de 20 que lleva, con tope en 100
    v_hito := LEAST(100, (v_total / 20) * 20);
    CONTINUE WHEN v_hito < 20;

    -- Solo si es MÁS ALTO que el último hito avisado hoy: si un lote cruza el 20 y el 40 avisa del 40, y una lectura que llega tarde con
    -- una cuenta más baja no avisa «al revés»
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.avisos_equipo a
      WHERE a.usuario_id = r.user_id AND a.tipo = 'hito_llamadas' AND a.dia = v_hoy AND a.cifra >= v_hito
    );

    SELECT COALESCE(
             NULLIF(split_part(trim(COALESCE(p.full_name, '')), ' ', 1), ''),
             NULLIF(split_part(COALESCE(p.email, ''), '@', 1), ''),
             'Alguien')
      INTO v_nombre
    FROM public.profiles p
    WHERE p.id = r.user_id;

    INSERT INTO public.avisos_equipo (tipo, usuario_id, usuario_nombre, dia, cifra)
    VALUES ('hito_llamadas', r.user_id, COALESCE(v_nombre, 'Alguien'), v_hoy, v_hito)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Los avisos son un instante: lo de hace más de un mes se va
  DELETE FROM public.avisos_equipo WHERE creado_at < NOW() - INTERVAL '30 days';

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Un aviso no vale una llamada perdida: si algo falla, la lectura de Rinkel sigue guardando sus llamadas
  RAISE WARNING 'avisar_hitos_de_llamadas: % (%)', SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.avisar_hitos_de_llamadas() IS
  'Tras insertar llamadas de Rinkel: si una persona llega hoy a 20, 40, 60, 80 o 100 CLIENTES distintos llamados (lo que cuenta la tarjeta Llamadas hechas), deja un aviso para el equipo (solo el hito mas alto nuevo). Nunca falla: si no puede avisar, la llamada se guarda igual.';

REVOKE ALL ON FUNCTION public.avisar_hitos_de_llamadas() FROM PUBLIC, anon, authenticated;


-- ---------- Comprobación ----------
DO $$
DECLARE
  filas INTEGER;
  tiene_intentos BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rendimiento_resumen_diario'
      AND pg_get_function_result(p.oid) LIKE '%intentos integer%'
  ) INTO tiene_intentos;
  IF NOT tiene_intentos THEN
    RAISE EXCEPTION 'rendimiento_resumen_diario no devuelve la columna intentos.';
  END IF;

  -- Que se puede llamar de verdad (y no solo que existe): el último mes
  SELECT count(*) INTO filas FROM public.rendimiento_resumen_diario((CURRENT_DATE - 30), CURRENT_DATE);
  RAISE NOTICE 'Resumen diario listo: el último mes devuelve % filas (una por persona y día con actividad). Un cliente cuenta una vez al día.', filas;

  -- Y que el aviso de hitos sigue enganchado a las llamadas
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_avisar_hitos_de_llamadas' AND NOT tgisinternal) THEN
    RAISE NOTICE 'Aviso: el disparador de los hitos de llamadas no existe (¿no se ha lanzado la 238?). Es independiente de esta migración.';
  END IF;
END $$;
