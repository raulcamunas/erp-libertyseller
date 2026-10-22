-- ============================================================================
-- 237 · COLD CALLING: CADA LLAMADA DE RINKEL SE APUNTA SOLA EN SU LEAD
-- ============================================================================
--
-- Hasta ahora una llamada hecha desde Rinkel y el lead al que se llamaba no se hablaban: el comercial colgaba, abría
-- la ficha, sumaba un intento a mano y escribía una nota. La migración 234 ya guardaba en `rinkel_llamadas.lead_id`
-- a qué lead de Cold Calling se llamó (casando el teléfono), pero nada más pasaba con ese dato.
--
-- A partir de esta migración, cuando una llamada queda enlazada con un lead —al importarla o más tarde, si el lead se
-- crea o cambia de teléfono después—:
--
--   · `call_attempts` sube uno si la llamada es SALIENTE (una entrante no es un intento nuestro).
--   · `last_contacted_at` pasa a ser la fecha de la llamada si es posterior: una saliente, o una entrante que se
--     contestó de verdad (10 segundos o más; por debajo es un contestador, igual que en «Mi rendimiento»).
--   · Un lead «Sin contactar» al que se llama y NO contesta nadie (o salta un contestador) pasa solo a «No contesta».
--     Es lo ÚNICO que cambia de estado a solas: que alguien conteste no dice si le interesa, eso lo decide la persona.
--
-- La llamada en sí NO se copia a las notas: sigue viviendo en `rinkel_llamadas` y la ficha del lead la enseña mezclada
-- con las notas en su historial (con su grabación). Así no hay dos apuntes de lo mismo ni nada que se desincronice.
--
-- UNA LLAMADA SE CUENTA UNA SOLA VEZ. `efecto_aplicado` dice «esta llamada ya está contada en su lead»:
--   · lo que ya estaba guardado al lanzar esto se da por contado (el comercial lo apuntó a mano mientras tanto), y los
--     intentos de cada lead se ajustan UNA vez a «lo mayor entre lo que había y las salientes enlazadas», sin sumar;
--   · el aviso de una llamada nueva se hace en un trigger AFTER INSERT, que solo salta para filas que de verdad se
--     insertan: las que Rinkel vuelve a mandar en el solape de tres días (un upsert que acaba en UPDATE) no cuentan otra vez;
--   · enlazar más tarde una llamada que se guardó sin lead (porque el lead no existía aún) sí la cuenta, una vez.
--
-- `cold_vincular_llamadas` es lo que usa el servidor para enlazar llamadas ya guardadas con su lead de golpe (el repaso
-- de la pantalla de Cold Calling): en modo histórico las enlaza SIN contarlas, porque son anteriores.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni contar dos veces.
-- El código funciona sin esta migración: las llamadas se siguen importando y enlazando; solo faltan los contadores.
-- ============================================================================


-- ---------- La marca de «esta llamada ya se ha contado en su lead» ----------
--
-- Solo la primera vez que se lanza: añadirla, dar por contado lo que ya había y ajustar los intentos. Una segunda
-- vez no vuelve a marcar nada (las llamadas nuevas sin lead que esperan su enlace perderían su cuenta).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rinkel_llamadas' AND column_name = 'efecto_aplicado'
  ) THEN
    ALTER TABLE public.rinkel_llamadas
      ADD COLUMN efecto_aplicado BOOLEAN NOT NULL DEFAULT false;

    -- Todo lo guardado hasta hoy se da por contado: el comercial lo fue apuntando a mano
    UPDATE public.rinkel_llamadas SET efecto_aplicado = true;

    -- Los intentos y el último contacto de cada lead se ajustan UNA vez a lo que dice Rinkel, sin sumar encima de lo
    -- apuntado a mano: GREATEST (que ignora los nulos) se queda con lo mayor
    WITH reales AS (
      SELECT
        lead_id,
        count(*) FILTER (WHERE direccion = 'outbound') AS salientes,
        max(fecha) FILTER (WHERE direccion = 'outbound' OR (estado = 'ANSWERED' AND duracion_s >= 10)) AS ultima
      FROM public.rinkel_llamadas
      WHERE lead_id IS NOT NULL
      GROUP BY lead_id
    )
    UPDATE public.cold_leads l
    SET call_attempts = GREATEST(l.call_attempts, r.salientes),
        last_contacted_at = GREATEST(l.last_contacted_at, r.ultima)
    FROM reales r
    WHERE l.id = r.lead_id
      AND (l.call_attempts < r.salientes OR l.last_contacted_at IS NULL OR l.last_contacted_at < r.ultima);
  END IF;
END $$;

COMMENT ON COLUMN public.rinkel_llamadas.efecto_aplicado IS
  'true = esta llamada ya esta contada en su lead de Cold Calling (intentos, ultimo contacto y, si no contesto nadie, el paso de «Sin contactar» a «No contesta»). Lo pone el trigger al enlazarla; las anteriores a la migracion 237 nacen contadas.';


-- ---------- Lo que pasa en el lead cuando se le enlaza una llamada ----------
CREATE OR REPLACE FUNCTION public.cold_llamada_en_su_lead()
RETURNS TRIGGER AS $$
DECLARE
  saliente BOOLEAN;
  contestada BOOLEAN;
BEGIN
  -- Las condiciones del WHEN de los triggers ya lo aseguran; aquí se repite por si alguien llama a la función a mano
  IF NEW.lead_id IS NULL OR NEW.efecto_aplicado THEN
    RETURN NULL;
  END IF;

  saliente := (NEW.direccion = 'outbound');
  -- La misma regla que «Mi rendimiento» (SEGUNDOS_MINIMOS_PARA_CONTESTADA en lib/rendimiento/metricas.ts y la función
  -- rendimiento_resumen_diario de la migración 235): ANSWERED y 10 segundos o más. Si cambia allí, cambia aquí
  contestada := (NEW.estado = 'ANSWERED' AND NEW.duracion_s >= 10);

  UPDATE public.cold_leads l
  SET call_attempts = l.call_attempts + CASE WHEN saliente THEN 1 ELSE 0 END,
      last_contacted_at = CASE
        WHEN saliente OR contestada THEN GREATEST(l.last_contacted_at, NEW.fecha)
        ELSE l.last_contacted_at
      END,
      status = CASE
        WHEN saliente AND NOT contestada AND l.status = 'pendiente' THEN 'no_contesta'
        ELSE l.status
      END
  WHERE l.id = NEW.lead_id;

  -- Contada: ni el solape de tres días ni un repaso posterior la vuelven a sumar
  UPDATE public.rinkel_llamadas SET efecto_aplicado = true WHERE id = NEW.id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.cold_llamada_en_su_lead() IS
  'Trigger de rinkel_llamadas: al enlazar una llamada con un lead de Cold Calling suma el intento (si es saliente), pone el ultimo contacto y, si no contesto nadie y el lead estaba «Sin contactar», lo pasa a «No contesta». Cuenta cada llamada una sola vez (efecto_aplicado).';

REVOKE ALL ON FUNCTION public.cold_llamada_en_su_lead() FROM PUBLIC, anon, authenticated;

-- AFTER INSERT y no BEFORE: un upsert cuya fila ya existe dispara el BEFORE INSERT de la fila propuesta aunque luego
-- se resuelva como UPDATE, y contaría dos veces cada llamada del solape. El AFTER INSERT solo salta si se inserta.
DROP TRIGGER IF EXISTS rinkel_llamadas_apunta_en_el_lead ON public.rinkel_llamadas;
CREATE TRIGGER rinkel_llamadas_apunta_en_el_lead
  AFTER INSERT ON public.rinkel_llamadas
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL AND NOT NEW.efecto_aplicado)
  EXECUTE FUNCTION public.cold_llamada_en_su_lead();

-- Una llamada que se guardó sin lead y se enlaza después (el lead se creó o cambió de teléfono)
DROP TRIGGER IF EXISTS rinkel_llamadas_reapunta_en_el_lead ON public.rinkel_llamadas;
CREATE TRIGGER rinkel_llamadas_reapunta_en_el_lead
  AFTER UPDATE OF lead_id ON public.rinkel_llamadas
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL AND NOT NEW.efecto_aplicado AND NEW.lead_id IS DISTINCT FROM OLD.lead_id)
  EXECUTE FUNCTION public.cold_llamada_en_su_lead();


-- ---------- Enlazar llamadas ya guardadas con su lead, de golpe ----------
--
-- Lo llama el servidor (con la clave de servicio) con los pares {llamada, lead} que ha calculado casando teléfonos.
-- Solo toca llamadas SIN lead: nunca rompe un enlace que ya existe.
--
-- p_historico = true: son llamadas antiguas, se enlazan SIN contarlas en el lead (el comercial ya las apuntó a mano
-- cuando ocurrieron). false: son recientes y se cuentan, una vez.
CREATE OR REPLACE FUNCTION public.cold_vincular_llamadas(p_pares JSONB, p_historico BOOLEAN DEFAULT false)
RETURNS INTEGER AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE public.rinkel_llamadas c
  SET lead_id = x.lead,
      efecto_aplicado = CASE WHEN p_historico THEN true ELSE c.efecto_aplicado END
  FROM jsonb_to_recordset(p_pares) AS x(llamada UUID, lead UUID)
  WHERE c.id = x.llamada
    AND c.lead_id IS NULL
    AND EXISTS (SELECT 1 FROM public.cold_leads l WHERE l.id = x.lead);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.cold_vincular_llamadas(JSONB, BOOLEAN) IS
  'Enlaza llamadas de rinkel_llamadas que aun no tienen lead con su lead de Cold Calling. p_pares: [{"llamada": uuid, "lead": uuid}]. Solo la usa el servidor (clave de servicio). En modo historico no las cuenta en el lead.';

REVOKE ALL ON FUNCTION public.cold_vincular_llamadas(JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cold_vincular_llamadas(JSONB, BOOLEAN) TO service_role;

-- La ficha de un lead pide «las llamadas de este lead, de la última a la primera». Ya hay un índice parcial por
-- lead_id (migración 234); este añade la fecha para no ordenar al leer
CREATE INDEX IF NOT EXISTS rinkel_llamadas_lead_fecha_idx
  ON public.rinkel_llamadas (lead_id, fecha DESC)
  WHERE lead_id IS NOT NULL;


-- ---------- Comprobación ----------
DO $$
DECLARE
  salientes_enlazadas INTEGER;
  enlazadas INTEGER;
  leads_con_intentos INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rinkel_llamadas' AND column_name = 'efecto_aplicado'
  ) THEN
    RAISE EXCEPTION 'No se ha creado rinkel_llamadas.efecto_aplicado.';
  END IF;

  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.rinkel_llamadas'::regclass
        AND tgname IN ('rinkel_llamadas_apunta_en_el_lead', 'rinkel_llamadas_reapunta_en_el_lead')) <> 2 THEN
    RAISE EXCEPTION 'Faltan los dos triggers que apuntan la llamada en su lead.';
  END IF;

  IF has_function_privilege('authenticated', 'public.cold_vincular_llamadas(jsonb, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'cold_vincular_llamadas se puede llamar desde el navegador: NO se deja asi.';
  END IF;

  SELECT count(*) INTO enlazadas FROM public.rinkel_llamadas WHERE lead_id IS NOT NULL;
  SELECT count(*) INTO salientes_enlazadas FROM public.rinkel_llamadas WHERE lead_id IS NOT NULL AND direccion = 'outbound';
  SELECT count(*) INTO leads_con_intentos FROM public.cold_leads WHERE call_attempts > 0;

  RAISE NOTICE 'Cold Calling listo: % llamadas enlazadas con un lead (% salientes) y % leads con intentos. Desde ahora cada llamada nueva se apunta sola.', enlazadas, salientes_enlazadas, leads_con_intentos;
END $$;
