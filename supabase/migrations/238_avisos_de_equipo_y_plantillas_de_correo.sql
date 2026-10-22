-- ============================================================================
-- 238 · AVISOS DE EQUIPO (llamadas y citas) Y PLANTILLAS DE CORREO
-- ============================================================================
--
-- DOS COSAS QUE NO SE PARECEN Y VAN EN UN SOLO FICHERO PARA PEGARLO UNA VEZ:
--
--
-- 1) AVISOS DE EQUIPO: lo que un compañero hace y se celebra abajo a la derecha de la pantalla de todos.
--
--    · `avisos_equipo`  Una fila por noticia. La rellenan DOS DISPARADORES; nadie escribe a mano y el navegador no puede insertar.
--                         - `hito_llamadas`: alguien llega HOY a 20, 40, 60, 80 o 100 llamadas realizadas (salientes de Rinkel, lo
--                           mismo que cuenta «llamadas realizadas» en Mi rendimiento). Si un lote de llamadas cruza dos hitos de golpe,
--                           avisa solo del más alto, y nunca de uno más bajo que el que ya se avisó ese día.
--                         - `cita_agendada`: alguien agenda una cita en la Agenda Comercial (no las que entran de Google Calendar).
--    · Llega al navegador por el canal en tiempo real (la tabla entra en la publicación `supabase_realtime`) y la pantalla enseña un aviso
--      a todos MENOS a quien lo ha hecho. Cada persona puede silenciarlos desde el panel de Notificaciones.
--    · LA LEEN SOLO admin y employees del equipo comercial (`recibe_avisos_de_equipo`): un partner o un cliente son gente de fuera y no
--      ven cuántas llamadas hace el equipo. Lo decide la política de la tabla, no la pantalla.
--    · Se borra lo que tenga más de 30 días. Los avisos son un instante, no un historial.
--    · LOS DISPARADORES NUNCA TUMBAN LO QUE LOS LANZA: si por lo que sea el aviso no se puede escribir, la llamada se guarda igual y la cita
--      se crea igual (cada función se come su propio error). Un aviso no vale una llamada perdida.
--
--
-- 2) PLANTILLAS DE CORREO: textos predefinidos para escribir en un par de clics.
--
--    · `plantillas_correo`  Nombre, asunto y texto, con campos entre llaves que se rellenan solos al usarla: {{empresa}} (de la ficha del
--                           lead, si se escribe desde Cold Calling), {{mi_nombre}} y {{mi_correo}}. {{nombre}} lo escribe quien envía.
--    · Una plantilla es PERSONAL (user_id = quien la crea) o DEL EQUIPO (user_id NULL, solo las crea y toca un administrador y las ve todo
--      el mundo). Cada persona ve las suyas y las del equipo, y toca solo las suyas.
--    · NO LLEVA EL PREFIJO `correo_` a propósito: el comprobante de la migración 236 exige que NINGUNA tabla `correo_%` se pueda leer desde
--      el navegador, y esta sí (con su política). Con ese nombre, volver a pegar la 236 fallaría.
--
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- El código funciona sin esta migración: sin ella simplemente no hay avisos de equipo y las plantillas avisan de que falta lanzarla.
-- ============================================================================


-- ---------- Quién recibe los avisos del equipo ----------
--
-- Admin, o employee que sea comercial o tenga Cold Calling o la Agenda. Un partner (figura externa) y un cliente, no.
CREATE OR REPLACE FUNCTION public.recibe_avisos_de_equipo(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND (
        p.role = 'admin'
        OR (
          p.role = 'employee'
          AND (
            p.is_comercial = true
            OR EXISTS (
              SELECT 1 FROM public.user_app_permissions up
              WHERE up.user_id = p.id AND up.app_id IN ('cold-calling', 'agenda') AND up.can_access = true
            )
          )
        )
      )
  );
$$;

COMMENT ON FUNCTION public.recibe_avisos_de_equipo(UUID) IS
  'true si esta persona recibe los avisos del equipo (hitos de llamadas, citas agendadas): admin, o employee comercial o con Cold Calling o la Agenda. Un partner o un cliente no.';

REVOKE ALL ON FUNCTION public.recibe_avisos_de_equipo(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recibe_avisos_de_equipo(UUID) TO authenticated, service_role;


-- ---------- Los avisos ----------
CREATE TABLE IF NOT EXISTS public.avisos_equipo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  tipo TEXT NOT NULL CHECK (tipo IN ('hito_llamadas', 'cita_agendada')),

  -- Quien lo ha hecho. CASCADE: si esa persona se borra, sus avisos no tienen sentido
  usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Su nombre de pila en el momento (el aviso es una frase, no una ficha)
  usuario_nombre TEXT NOT NULL,

  -- Solo en los hitos: el día de Madrid y la cifra (20, 40, 60, 80 o 100)
  dia DATE,
  cifra INTEGER CHECK (cifra IS NULL OR cifra > 0),
  -- Solo en las citas: con quién (la empresa del lead)
  detalle TEXT,

  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT avisos_equipo_hito_completo CHECK (tipo <> 'hito_llamadas' OR (dia IS NOT NULL AND cifra IS NOT NULL))
);

-- Un hito, una vez por persona y día: dos lecturas a la vez no pueden avisar dos veces del mismo
CREATE UNIQUE INDEX IF NOT EXISTS avisos_equipo_hito_unico
  ON public.avisos_equipo (usuario_id, dia, cifra)
  WHERE tipo = 'hito_llamadas';

CREATE INDEX IF NOT EXISTS avisos_equipo_creado_idx
  ON public.avisos_equipo (creado_at DESC);

COMMENT ON TABLE public.avisos_equipo IS
  'Noticias del equipo que se celebran en pantalla (hitos de llamadas del dia, citas agendadas). Las escriben dos disparadores; las leen admin y employees del equipo comercial por el canal en tiempo real. Se borran a los 30 dias.';

ALTER TABLE public.avisos_equipo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Los avisos del equipo los ve el equipo" ON public.avisos_equipo;
CREATE POLICY "Los avisos del equipo los ve el equipo"
  ON public.avisos_equipo FOR SELECT
  TO authenticated
  USING (public.recibe_avisos_de_equipo(auth.uid()));

-- Solo escriben los disparadores (SECURITY DEFINER): el navegador no inserta, no cambia ni borra avisos
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.avisos_equipo FROM anon, authenticated;
-- Y sin sesión, nada: ni leerlos
REVOKE ALL ON public.avisos_equipo FROM anon;

-- El canal en tiempo real: sin esto la pantalla no se entera de los avisos nuevos
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'avisos_equipo'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.avisos_equipo;
  END IF;
END $$;


-- ---------- Disparador 1: llamadas HOY -> hitos de 20 en 20 hasta 100 ----------
--
-- A NIVEL DE SENTENCIA y con la tabla de filas nuevas (`nuevas`): una lectura de Rinkel inserta decenas de llamadas de golpe y se mira UNA
-- vez cuántas lleva la persona hoy, no una por fila. Solo se disparan las INSERCIONES de verdad: un upsert que repite una llamada que ya
-- estaba no la inserta (la actualiza), así que releer el solape de tres días no cuenta nada dos veces.
--
-- Cuenta lo mismo que «llamadas realizadas» de Mi rendimiento: las SALIENTES del día de Madrid.
-- Solo mira llamadas de las últimas 3 horas: la importación del histórico de una cuenta recién vinculada no avisa de lo de hace meses.
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
    SELECT count(*)::INTEGER INTO v_total
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
  'Tras insertar llamadas de Rinkel: si una persona llega hoy a 20, 40, 60, 80 o 100 salientes, deja un aviso para el equipo (solo el hito mas alto nuevo). Nunca falla: si no puede avisar, la llamada se guarda igual.';

REVOKE ALL ON FUNCTION public.avisar_hitos_de_llamadas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_avisar_hitos_de_llamadas ON public.rinkel_llamadas;
CREATE TRIGGER trg_avisar_hitos_de_llamadas
  AFTER INSERT ON public.rinkel_llamadas
  REFERENCING NEW TABLE AS nuevas
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.avisar_hitos_de_llamadas();


-- ---------- Disparador 2: una cita agendada ----------
--
-- Solo las que agenda una persona desde el ERP: las que entran de Google Calendar (`is_external`) o no tienen comercial no avisan, ni las
-- canceladas, ni una fila de hace más de 10 minutos (una carga masiva o un script que reinserta citas antiguas no llena la pantalla de avisos).
CREATE OR REPLACE FUNCTION public.avisar_cita_agendada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nombre TEXT;
  v_con TEXT;
BEGIN
  IF NEW.comercial_id IS NULL OR COALESCE(NEW.is_external, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF NEW.created_at < NOW() - INTERVAL '10 minutes' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
           NULLIF(split_part(trim(COALESCE(p.full_name, '')), ' ', 1), ''),
           NULLIF(split_part(COALESCE(p.email, ''), '@', 1), ''),
           'Alguien')
    INTO v_nombre
  FROM public.profiles p
  WHERE p.id = NEW.comercial_id;

  -- Con quién: la empresa; si no la hay, el nombre que se le puso al lead. Nada de teléfonos ni correos en un aviso que ve todo el equipo
  v_con := NULLIF(trim(COALESCE(NULLIF(trim(COALESCE(NEW.lead_company, '')), ''), NEW.lead_name, '')), '');

  INSERT INTO public.avisos_equipo (tipo, usuario_id, usuario_nombre, detalle)
  VALUES ('cita_agendada', NEW.comercial_id, COALESCE(v_nombre, 'Alguien'), left(v_con, 120));

  DELETE FROM public.avisos_equipo WHERE creado_at < NOW() - INTERVAL '30 days';

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Un aviso no vale una cita perdida: si algo falla, la cita se crea igual
  RAISE WARNING 'avisar_cita_agendada: % (%)', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.avisar_cita_agendada() IS
  'Tras crear una cita desde el ERP (no las de Google Calendar): deja un aviso para el equipo con quien la agendo y con que empresa. Nunca falla: si no puede avisar, la cita se crea igual.';

REVOKE ALL ON FUNCTION public.avisar_cita_agendada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_avisar_cita_agendada ON public.appointments;
CREATE TRIGGER trg_avisar_cita_agendada
  AFTER INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.avisar_cita_agendada();


-- ---------- Plantillas de correo ----------
CREATE TABLE IF NOT EXISTS public.plantillas_correo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- De quién es. NULL = del equipo: solo un administrador las crea y las toca, y las ve todo el mundo
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,

  nombre TEXT NOT NULL CHECK (char_length(trim(nombre)) BETWEEN 1 AND 80),
  -- Pueden llevar {{empresa}}, {{nombre}}, {{mi_nombre}} y {{mi_correo}}
  asunto TEXT NOT NULL DEFAULT '' CHECK (char_length(asunto) <= 300),
  texto TEXT NOT NULL DEFAULT '' CHECK (char_length(texto) <= 20000),

  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un nombre, una plantilla por dueño (y una por nombre entre las del equipo): guardar «Apertura de canal» otra vez la actualiza, no la duplica
CREATE UNIQUE INDEX IF NOT EXISTS plantillas_correo_nombre_unico
  ON public.plantillas_correo (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(nombre)));

CREATE INDEX IF NOT EXISTS plantillas_correo_usuario_idx
  ON public.plantillas_correo (user_id);

COMMENT ON TABLE public.plantillas_correo IS
  'Plantillas de correo con campos entre llaves ({{empresa}}, {{nombre}}, {{mi_nombre}}, {{mi_correo}}). user_id NULL = del equipo (las toca solo un admin). Cada persona ve las suyas y las del equipo y toca solo las suyas.';

ALTER TABLE public.plantillas_correo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver mis plantillas y las del equipo" ON public.plantillas_correo;
CREATE POLICY "Ver mis plantillas y las del equipo"
  ON public.plantillas_correo FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Crear mis plantillas, o las del equipo si soy admin" ON public.plantillas_correo;
CREATE POLICY "Crear mis plantillas, o las del equipo si soy admin"
  ON public.plantillas_correo FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  );

DROP POLICY IF EXISTS "Cambiar mis plantillas, o las del equipo si soy admin" ON public.plantillas_correo;
CREATE POLICY "Cambiar mis plantillas, o las del equipo si soy admin"
  ON public.plantillas_correo FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  );

DROP POLICY IF EXISTS "Borrar mis plantillas, o las del equipo si soy admin" ON public.plantillas_correo;
CREATE POLICY "Borrar mis plantillas, o las del equipo si soy admin"
  ON public.plantillas_correo FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  );

REVOKE ALL ON public.plantillas_correo FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantillas_correo TO authenticated;

-- La hora de la última modificación se pone sola
CREATE OR REPLACE FUNCTION public.plantillas_correo_tocada()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.actualizada_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.plantillas_correo_tocada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_plantillas_correo_tocada ON public.plantillas_correo;
CREATE TRIGGER trg_plantillas_correo_tocada
  BEFORE UPDATE ON public.plantillas_correo
  FOR EACH ROW
  EXECUTE FUNCTION public.plantillas_correo_tocada();


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO ENSEÑA los NOTICE. Lo que falle revienta con un error; lo que salga bien se lee en la fila de abajo, y las tres
-- columnas tienen que decir «sí».
DO $$
DECLARE
  disparadores INTEGER;
BEGIN
  SELECT count(*) INTO disparadores
  FROM pg_trigger t
  WHERE NOT t.tgisinternal
    AND t.tgname IN ('trg_avisar_hitos_de_llamadas', 'trg_avisar_cita_agendada', 'trg_plantillas_correo_tocada');
  IF disparadores <> 3 THEN
    RAISE EXCEPTION 'Faltan disparadores de la 238: hay % de 3.', disparadores;
  END IF;

  -- Lo que no puede pasar: que el navegador pueda escribir en los avisos del equipo
  IF has_table_privilege('authenticated', 'public.avisos_equipo', 'INSERT')
     OR has_table_privilege('authenticated', 'public.avisos_equipo', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.avisos_equipo', 'DELETE') THEN
    RAISE EXCEPTION 'avisos_equipo se puede escribir desde el navegador: NO se deja así.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'plantillas_correo' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'plantillas_correo no tiene activada la seguridad por filas.';
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_avisar_hitos_de_llamadas', 'trg_avisar_cita_agendada', 'trg_plantillas_correo_tocada')) = 3
    AS disparadores_puestos,
  NOT has_table_privilege('authenticated', 'public.avisos_equipo', 'INSERT')
    AS avisos_cerrados_a_escritura_del_navegador,
  EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'avisos_equipo')
    AS avisos_en_tiempo_real;
