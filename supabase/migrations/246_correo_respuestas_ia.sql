-- ============================================================================
-- 246 · CORREO: LA IA LEE LAS RESPUESTAS DE LOS LEADS
-- ============================================================================
--
-- Cuando un lead contesta a un correo, la IA (gpt-6-luna, unas milésimas de dólar por respuesta) lee lo que dice y lo clasifica:
-- interesado, pide información, no le interesa, pide la baja, «escríbeme más adelante», te deriva a otra persona, fuera de oficina u otra cosa.
-- Según la clase y lo segura que esté, el ERP actúa en la ficha del lead:
--
--   · «No me interesa» / «no me escribáis más»  →  el lead pasa a «No le interesa» (solo si sigue sin trabajar: nunca pisa «En seguimiento» ni «Cita»).
--   · «Escríbeme en enero»                      →  rellamada puesta para esa fecha («Rellamar el»), que sale en la agenda de Cold Calling.
--   · Todo lo demás                             →  una nota en la ficha con lo que ha entendido, para que el comercial lo vea de un vistazo.
--
-- Con el motor en ENSAYO solo lo lee y lo apunta aquí (pantalla Secuencias → Flujo): no toca ninguna ficha. Se actúa solo con el envío real encendido,
-- y cada acción tiene su interruptor en Secuencias → Ajustes.
--
--   · `correo_secuencia_ajustes`   Cuatro columnas nuevas: el interruptor general de leer respuestas, los dos de qué hacer (cerrar y rellamar) y la
--                                  marca de hasta cuándo se han mirado los correos que entraban.
--   · `correo_respuestas_ia`       Una fila por correo entrante que parece la respuesta de un lead: qué se entendió, qué se hizo y cuándo. Es también la
--                                  garantía de que un mismo correo no se lee ni se actúa dos veces.
--   · `correo_respuestas_reclamar` Apunta los correos nuevos que pueden ser de un lead y reserva los que toca leer (sin que dos pasadas cojan el mismo).
--
-- TODO CERRADO AL NAVEGADOR (RLS sin políticas y permisos quitados), como el resto de `correo_secuencia_*`: lo lee y lo escribe el servidor.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo hecho.
-- El código funciona SIN esta migración: Correo y los seguimientos siguen como siempre y la lectura de respuestas simplemente no hace nada.
-- Hace falta haber lanzado antes la 245 (secuencias), la 236 (correo) y la 087 (leads de Cold Calling).
-- ============================================================================


-- ---------- Los interruptores nuevos ----------
ALTER TABLE public.correo_secuencia_ajustes
  -- Leer con IA las respuestas de los leads (en ensayo solo las apunta; en envío real también actúa)
  ADD COLUMN IF NOT EXISTS respuestas_ia BOOLEAN NOT NULL DEFAULT true,
  -- Pasar el lead a «No le interesa» cuando dice que no (con la IA segura de que es un no)
  ADD COLUMN IF NOT EXISTS respuestas_cerrar_no BOOLEAN NOT NULL DEFAULT true,
  -- Poner la rellamada cuando pide que le escribamos más adelante
  ADD COLUMN IF NOT EXISTS respuestas_rellamada BOOLEAN NOT NULL DEFAULT true,
  -- Hasta cuándo se han mirado los correos que entraban (lo apunta el propio motor)
  ADD COLUMN IF NOT EXISTS respuestas_at TIMESTAMPTZ;


-- ---------- Cada respuesta leída ----------
CREATE TABLE IF NOT EXISTS public.correo_respuestas_ia (
  -- El correo entrante. La clave primaria es la garantía de que no se lee dos veces
  mensaje_id UUID PRIMARY KEY REFERENCES public.correo_mensajes(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.cold_leads(id) ON DELETE CASCADE,
  buzon_id UUID NOT NULL REFERENCES public.correo_buzones(id) ON DELETE CASCADE,
  -- La secuencia de ese lead en ese buzón, si la hay (para decir en su ficha qué contestó)
  inscripcion_id UUID REFERENCES public.correo_secuencia_inscripciones(id) ON DELETE SET NULL,

  -- pendiente: espera su turno (o el siguiente intento) · procesando: una pasada del motor lo ha cogido · hecha: leída · fallida: la IA no pudo tras varios intentos
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesando', 'hecha', 'fallida')),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proximo_intento_at TIMESTAMPTZ,
  reclamado_at TIMESTAMPTZ,

  -- Lo que entendió la IA
  clase TEXT CHECK (clase IS NULL OR clase IN ('interesado', 'pide_info', 'no_interesa', 'baja', 'mas_tarde', 'derivacion', 'fuera_de_oficina', 'otro')),
  confianza TEXT CHECK (confianza IS NULL OR confianza IN ('alta', 'media', 'baja')),
  resumen TEXT CHECK (resumen IS NULL OR length(resumen) <= 300),
  -- La frase del correo en que se apoya, copiada tal cual: si no está de verdad en el correo, la confianza baja (así una invención no cierra un lead)
  evidencia TEXT CHECK (evidencia IS NULL OR length(evidencia) <= 400),
  -- Solo en «más adelante»: el día desde el que quiere que se le contacte
  fecha_pedida DATE,
  modelo TEXT CHECK (modelo IS NULL OR length(modelo) <= 60),

  -- Lo que se hizo (o, en ensayo, lo que se habría hecho)
  modo TEXT CHECK (modo IS NULL OR modo IN ('ensayo', 'real')),
  -- ninguna · cerrar (pasa a «No le interesa») · rellamar (pone la fecha de rellamada) · revisar (no se atreve: lo mira una persona)
  accion TEXT CHECK (accion IS NULL OR accion IN ('ninguna', 'cerrar', 'rellamar', 'revisar')),
  aplicada BOOLEAN NOT NULL DEFAULT false,
  -- La nota que se apuntó (o se habría apuntado) en la ficha del lead
  nota TEXT CHECK (nota IS NULL OR length(nota) <= 1000),

  -- Cuándo entró el correo en el ERP, y las marcas de la propia fila
  recibida_at TIMESTAMPTZ NOT NULL,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lo que toca leer ahora
CREATE INDEX IF NOT EXISTS correo_respuestas_ia_cola_idx
  ON public.correo_respuestas_ia (proximo_intento_at)
  WHERE estado = 'pendiente';
-- Las reservas muertas (el contenedor se reinició a medias)
CREATE INDEX IF NOT EXISTS correo_respuestas_ia_reservas_idx
  ON public.correo_respuestas_ia (reclamado_at)
  WHERE estado = 'procesando';
-- Lo que se ve en la pantalla de cada buzón
CREATE INDEX IF NOT EXISTS correo_respuestas_ia_buzon_idx
  ON public.correo_respuestas_ia (buzon_id, recibida_at DESC)
  WHERE estado = 'hecha';
CREATE INDEX IF NOT EXISTS correo_respuestas_ia_lead_idx ON public.correo_respuestas_ia (lead_id);

COMMENT ON TABLE public.correo_respuestas_ia IS
  'Cada correo entrante que parece la respuesta de un lead, con lo que la IA entendio (clase, confianza, frase en que se apoya), lo que se hizo en su ficha y cuando. La clave es el correo: no se lee dos veces. Cerrada al navegador.';

ALTER TABLE public.correo_respuestas_ia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_respuestas_ia FROM anon, authenticated;


-- ---------- Apuntar lo nuevo y reservar lo que toca leer ----------
--
-- UNA sola llamada hace las dos cosas, y es lo que impide que dos pasadas del motor lean el mismo correo:
--
--   1. APUNTA como pendientes los correos entrantes de personas (no los automáticos: rebotes, fuera de oficina) que han entrado desde `p_desde` y que
--      son de un lead: los escribe una de sus direcciones (`email` o `emails_extra`, la misma lista que usa el cuadro de Correo) o contestan en el
--      hilo del primer correo de su secuencia. Si una dirección está en varios leads, gana el que es de la persona dueña del buzón y, después, el
--      tocado más recientemente. Un buzón que no participa en las secuencias no se lee.
--   2. RESERVA (estado «procesando», un intento más) hasta `p_limite` pendientes cuya hora ya ha llegado, o reservas muertas de hace más de
--      `p_bloqueo_min` minutos, con `FOR UPDATE SKIP LOCKED`: la segunda pasada se salta lo que la primera tiene cogido. Devuelve el correo (el texto
--      recortado a 8.000 caracteres) para que la aplicación lo lea.
--
-- La aplicación vuelve a comprobar que quien escribe es de verdad una dirección del lead (la base filtra por texto; esto remata).
CREATE OR REPLACE FUNCTION public.correo_respuestas_reclamar(
  p_desde TIMESTAMPTZ,
  p_ahora TIMESTAMPTZ,
  p_limite INTEGER DEFAULT 8,
  p_bloqueo_min INTEGER DEFAULT 10
)
RETURNS TABLE (
  mensaje_id UUID, lead_id UUID, buzon_id UUID, inscripcion_id UUID, intentos INTEGER,
  de_direccion TEXT, asunto TEXT, texto TEXT, fecha TIMESTAMPTZ, hilo_id UUID, recibida_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  -- 1a. Por la dirección de quien escribe
  INSERT INTO public.correo_respuestas_ia (mensaje_id, lead_id, buzon_id, inscripcion_id, recibida_at)
  SELECT DISTINCT ON (m.id) m.id, l.id, m.buzon_id, i.id, m.creado_at
    FROM public.correo_mensajes m
    JOIN public.correo_buzones b ON b.id = m.buzon_id
    LEFT JOIN public.correo_secuencia_buzones sb ON sb.buzon_id = m.buzon_id
    JOIN public.cold_leads l
      ON lower(btrim(m.de_direccion)) = ANY (regexp_split_to_array(lower(coalesce(l.email, '') || ' ' || coalesce(l.emails_extra, '')), '[\s/,;]+'))
    LEFT JOIN LATERAL (
      SELECT i2.id
        FROM public.correo_secuencia_inscripciones i2
       WHERE i2.lead_id = l.id AND i2.buzon_id = m.buzon_id AND i2.primer_envio_at <= m.creado_at
       ORDER BY i2.creada_at DESC
       LIMIT 1
    ) i ON true
   WHERE m.direccion = 'entrante'
     AND NOT m.automatico
     AND m.creado_at >= p_desde
     AND m.creado_at <= p_ahora
     AND COALESCE(sb.participa, true)
     AND NOT EXISTS (SELECT 1 FROM public.correo_respuestas_ia r WHERE r.mensaje_id = m.id)
   ORDER BY m.id, (l.assigned_to = b.user_id) DESC NULLS LAST, l.updated_at DESC NULLS LAST
   LIMIT 200
  ON CONFLICT (mensaje_id) DO NOTHING;

  -- 1b. Por el hilo: contestan al primer correo de una secuencia, aunque escriba otra persona de la empresa
  INSERT INTO public.correo_respuestas_ia (mensaje_id, lead_id, buzon_id, inscripcion_id, recibida_at)
  SELECT DISTINCT ON (m.id) m.id, i.lead_id, m.buzon_id, i.id, m.creado_at
    FROM public.correo_mensajes m
    JOIN public.correo_secuencia_inscripciones i
      ON i.buzon_id = m.buzon_id AND i.hilo_id IS NOT NULL AND i.hilo_id = m.hilo_id AND i.primer_envio_at <= m.creado_at
    LEFT JOIN public.correo_secuencia_buzones sb ON sb.buzon_id = m.buzon_id
   WHERE m.direccion = 'entrante'
     AND NOT m.automatico
     AND m.creado_at >= p_desde
     AND m.creado_at <= p_ahora
     AND COALESCE(sb.participa, true)
     AND NOT EXISTS (SELECT 1 FROM public.correo_respuestas_ia r WHERE r.mensaje_id = m.id)
   ORDER BY m.id, i.creada_at DESC
   LIMIT 200
  ON CONFLICT (mensaje_id) DO NOTHING;

  -- 2. Reservar lo que toca leer
  RETURN QUERY
  WITH candidatas AS (
    SELECT r.mensaje_id
      FROM public.correo_respuestas_ia r
     WHERE (r.estado = 'pendiente' AND (r.proximo_intento_at IS NULL OR r.proximo_intento_at <= p_ahora))
        OR (r.estado = 'procesando' AND r.reclamado_at < p_ahora - make_interval(mins => p_bloqueo_min))
     ORDER BY r.recibida_at ASC
     LIMIT GREATEST(p_limite, 0)
       FOR UPDATE OF r SKIP LOCKED
  ),
  cogidas AS (
    UPDATE public.correo_respuestas_ia r
       SET estado = 'procesando',
           reclamado_at = p_ahora,
           intentos = r.intentos + 1,
           actualizada_at = p_ahora
      FROM candidatas c
     WHERE r.mensaje_id = c.mensaje_id
    RETURNING r.mensaje_id, r.lead_id, r.buzon_id, r.inscripcion_id, r.intentos, r.recibida_at
  )
  SELECT g.mensaje_id, g.lead_id, g.buzon_id, g.inscripcion_id, g.intentos,
         m.de_direccion, m.asunto, left(m.texto, 8000), m.fecha, m.hilo_id, g.recibida_at
    FROM cogidas g
    JOIN public.correo_mensajes m ON m.id = g.mensaje_id
   ORDER BY g.recibida_at ASC;
END;
$$;

COMMENT ON FUNCTION public.correo_respuestas_reclamar(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) IS
  'Apunta como pendientes los correos entrantes de personas que parecen la respuesta de un lead (su direccion o el hilo de su secuencia) y reserva hasta p_limite para leer (SKIP LOCKED: dos pasadas nunca cogen el mismo). Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.correo_respuestas_reclamar(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_respuestas_reclamar(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) TO service_role;


-- ---------- Comprobación ----------
DO $$
DECLARE
  abierta_al_navegador BOOLEAN;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'correo_secuencia_ajustes'
         AND column_name IN ('respuestas_ia', 'respuestas_cerrar_no', 'respuestas_rellamada', 'respuestas_at')) <> 4 THEN
    RAISE EXCEPTION 'Faltan columnas de los ajustes de las respuestas de los leads.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'correo_respuestas_ia') THEN
    RAISE EXCEPTION 'Falta la tabla correo_respuestas_ia.';
  END IF;

  -- Lo que no puede pasar: que se pueda leer o escribir desde el navegador
  SELECT bool_or(has_table_privilege(r, 'public.correo_respuestas_ia', 'SELECT') OR has_table_privilege(r, 'public.correo_respuestas_ia', 'INSERT') OR has_table_privilege(r, 'public.correo_respuestas_ia', 'UPDATE') OR has_table_privilege(r, 'public.correo_respuestas_ia', 'DELETE'))
         OR has_function_privilege('authenticated', 'public.correo_respuestas_reclamar(timestamptz, timestamptz, integer, integer)', 'EXECUTE')
    INTO abierta_al_navegador
    FROM unnest(ARRAY['anon', 'authenticated']) AS r;
  IF abierta_al_navegador THEN
    RAISE EXCEPTION 'Las respuestas de los leads quedan abiertas al navegador: NO se deja asi.';
  END IF;

  RAISE NOTICE 'Respuestas de los leads listas. Se leen con IA solo con el motor de secuencias encendido; en ensayo solo se apuntan, sin tocar ninguna ficha.';
END $$;
