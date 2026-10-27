-- ============================================================================
-- 258 · CRM DE CLIENTES, EL HUB: LA LÍNEA DE FASES, LAS NOTAS DE REUNIÓN DE GEMINI Y EL PLAN DE PROPUESTA
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo guardado.
-- NO toca ninguna ficha, ninguna cita, ninguna comisión ni ningún presupuesto: solo AÑADE dos tablas y una columna, y un disparador que anota los cambios de fase.
-- Hace falta haber lanzado antes la 080 (crm_clients), la 153 (preguntas) y la 212 (puede_ver_equipo_comercial).
--
--
-- ============ QUÉ SE QUIERE ============
--
-- El CRM deja de ser una lista con una ficha larga y pasa a ser el HUB de cada cliente: en qué fase está (con la línea visual y desde cuándo), lo que se habló en la
-- reunión —las notas que Google Meet / Gemini manda por correo, leídas, desglosadas y explicadas por la IA— y qué propuesta se le va a hacer. Esto es la base de lo que
-- vendrá después: generar la propuesta sola y editarla en visual para sacarla en PDF.
--
--
-- ============ CÓMO ESTÁ HECHO Y POR QUÉ ASÍ ============
--
-- 1) LAS FASES YA EXISTÍAN (`crm_clients.stage`), LO QUE NO EXISTÍA ES SU HISTORIA. La línea de fases tiene que decir «lleva 9 días en Propuesta enviada» y «entró en
--    Negociación el 14 oct», y de eso la base no guardaba nada: cada cambio pisaba el anterior. Un disparador sobre crm_clients anota ahora cada cambio en
--    `crm_etapas_historial`. De los clientes que ya hay solo se sabe la fase de hoy, así que se les crea UNA fila marcada `recuperado` (la fecha es aproximada y la
--    pantalla lo dice).
--
-- 2) LAS NOTAS DE GEMINI VIVEN EN SU PROPIA TABLA (`crm_notas_reunion`), no en `appointments`. Un cliente puede tener varias reuniones (una cita reagendada, una segunda
--    sesión) y cada una trae su nota; y la nota guarda mucho más que un texto: lo que Gemini resumió, el detalle, la transcripción entera y el análisis de la IA. Se casa
--    con la cita por el evento del calendario, por el correo del invitado o por el nombre (la columna `metodo_cita` dice cómo se supo); si no hay manera, queda como
--    `sin_cita` y se asigna a mano en la pantalla.
--
--    SOLO ENTRAN LAS REUNIONES CON CLIENTES. Las reuniones internas del equipo («Reunión Semanal», «Onboarding de Jhanna»…) también generan nota de Gemini, y no
--    tienen nada que hacer en el CRM de un cliente: el servidor no guarda NADA de su contenido. De ellas solo se apunta el id del correo y su título, con estado
--    'ignorada', para no volver a mirarlas en cada pasada (lib/crm/gemini/).
--
-- 3) LAS DOS TABLAS NUEVAS SE ESCRIBEN SOLO DESDE EL SERVIDOR. Nadie escribe desde el navegador: la lectura de Gemini y el análisis de la IA van con la clave de servicio, y
--    asignar una nota a otro cliente pasa por una ruta que comprueba que quien lo pide es dirección. Por eso no hay políticas de INSERT/UPDATE/DELETE: con RLS activada y
--    sin política, el navegador no puede escribir. Leer, en cambio, puede quien ya lee el CRM (admin, partner y quien supervisa al equipo comercial, la 212).
--
-- 4) EL PLAN DE PROPUESTA VA EN UNA COLUMNA JSONB (`crm_clients.propuesta_plan`), como ya van las respuestas del guion (`preguntas`, la 153): son los servicios que se
--    van a proponer, el enfoque y los riesgos, y la forma vive en el código (lib/crm/propuesta.ts). Cambiarla no es una migración. El UPDATE de crm_clients sigue siendo
--    de dirección (la 080): quien supervisa lo ve, no lo cambia.
--
--
-- ============ LO QUE NO CAMBIA ============
--
-- Las comisiones se siguen calculando sobre `appointments.status = 'qualified'`. Ni las fases ni las notas devengan nada.


-- ---------- 1. LA HISTORIA DE LAS FASES ----------
CREATE TABLE IF NOT EXISTS public.crm_etapas_historial (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
  etapa        TEXT NOT NULL CHECK (etapa IN (
                 'nuevo', 'seguimiento', 'propuesta_enviada', 'revision_propuesta', 'negociacion', 'ganado', 'perdido'
               )),
  -- Desde cuándo está en esa fase. La fase termina cuando empieza la siguiente fila del mismo cliente
  desde        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cambiado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- 'alta': la ficha nació en esa fase · 'manual': alguien la movió · 'recuperado': la ficha ya existía y solo se sabe la fase de hoy (fecha aproximada)
  origen       TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('alta', 'manual', 'recuperado'))
);

CREATE INDEX IF NOT EXISTS idx_crm_etapas_cliente ON public.crm_etapas_historial (client_id, desde);

COMMENT ON TABLE public.crm_etapas_historial IS
  'Cada cambio de fase de una ficha del CRM, con cuándo y quién. Lo escribe el disparador de crm_clients; la línea de fases del hub la lee para decir desde cuándo está cada cliente en cada fase.';

-- El disparador. SECURITY DEFINER porque quien mueve la fase es el navegador de un administrador (RLS) y esta tabla no tiene políticas de escritura: tiene que escribir el dueño
-- de la función. `auth.uid()` es NULL cuando escribe el servidor con la clave de servicio, y entonces `cambiado_por` queda vacío.
CREATE OR REPLACE FUNCTION public.crm_registra_etapa()
RETURNS TRIGGER AS $$
DECLARE
  quien UUID;
BEGIN
  -- Solo se guarda un autor que exista en profiles: una clave foránea rota haría fallar el UPDATE de la ficha entera por culpa de una anotación
  SELECT p.id INTO quien FROM public.profiles p WHERE p.id = auth.uid();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.crm_etapas_historial (client_id, etapa, desde, cambiado_por, origen)
    VALUES (NEW.id, NEW.stage, COALESCE(NEW.created_at, NOW()), quien, 'alta');
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.crm_etapas_historial (client_id, etapa, desde, cambiado_por, origen)
    VALUES (NEW.id, NEW.stage, NOW(), quien, 'manual');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_crm_registra_etapa ON public.crm_clients;
CREATE TRIGGER trg_crm_registra_etapa
  AFTER INSERT OR UPDATE OF stage ON public.crm_clients
  FOR EACH ROW EXECUTE FUNCTION public.crm_registra_etapa();

-- Las fichas que ya existen: UNA fila con la fase de hoy, marcada como recuperada. `nuevo` desde que nació; el resto, desde la última vez que se tocó la ficha (es lo más
-- parecido a «desde cuándo» que se conserva) o, si está cerrado, desde que se cerró.
INSERT INTO public.crm_etapas_historial (client_id, etapa, desde, origen)
SELECT c.id,
       c.stage,
       CASE
         WHEN c.stage = 'nuevo'                              THEN c.created_at
         WHEN c.stage = 'ganado' AND c.closed_at IS NOT NULL THEN c.closed_at
         ELSE COALESCE(c.updated_at, c.created_at)
       END,
       'recuperado'
  FROM public.crm_clients c
 WHERE NOT EXISTS (SELECT 1 FROM public.crm_etapas_historial h WHERE h.client_id = c.id);

ALTER TABLE public.crm_etapas_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver el historial de fases del crm" ON public.crm_etapas_historial;
CREATE POLICY "Ver el historial de fases del crm"
  ON public.crm_etapas_historial FOR SELECT
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()));


-- ---------- 2. LAS NOTAS DE REUNIÓN (GEMINI) ----------
CREATE TABLE IF NOT EXISTS public.crm_notas_reunion (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A qué cliente y a qué cita pertenece. Vacíos mientras no se sepa (estado 'sin_cita'); si se borra la ficha o la cita, la nota se conserva suelta
  client_id        UUID REFERENCES public.crm_clients(id) ON DELETE SET NULL,
  appointment_id   UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  -- pendiente: casada con un cliente, falta el análisis · procesada: analizada · sin_cita: reunión con cliente que no se pudo casar con ninguna cita · error: el análisis
  -- falló y no se va a reintentar (ver `error`) · ignorada: reunión interna del equipo; solo se apunta el id del correo y el título para no volver a leerla
  estado           TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesada', 'sin_cita', 'error', 'ignorada')),
  fuente           TEXT NOT NULL DEFAULT 'gemini',
  -- De dónde sale: el correo de Gemini, el documento «Notas de Gemini» de Drive y el evento del calendario. Con ellos no se lee dos veces lo mismo
  gmail_message_id TEXT,
  drive_file_id    TEXT,
  google_event_id  TEXT,
  titulo           TEXT NOT NULL,
  fecha_reunion    TIMESTAMPTZ,
  invitados        TEXT[] NOT NULL DEFAULT '{}',
  -- Lo que escribió Gemini, tal cual: el resumen, los temas, los pasos siguientes que propone, el detalle largo y la transcripción
  resumen          TEXT,
  temas            JSONB NOT NULL DEFAULT '[]'::jsonb,
  proximos_pasos   JSONB NOT NULL DEFAULT '[]'::jsonb,
  detalle          TEXT,
  transcripcion    TEXT,
  -- true si se leyó el documento de Drive (con detalle y transcripción); false si solo se pudo leer el correo (resumen y pasos). Una nota incompleta se completa sola
  -- cuando el servidor llega al documento
  completa         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Cómo se casó con la cita: 'evento' (el del calendario), 'invitado' (el correo del lead), 'nombre' (el del título) o 'manual' (lo asignó una persona)
  metodo_cita      TEXT CHECK (metodo_cita IN ('evento', 'invitado', 'nombre', 'manual')),
  -- El desglose de la IA (forma en lib/crm/gemini/analisis.ts), con qué modelo y cuándo
  analisis         JSONB,
  analisis_modelo  TEXT,
  analisis_en      TIMESTAMPTZ,
  -- Cuántas veces se ha intentado analizar sin conseguirlo: el servidor reintenta unas cuantas veces y luego la deja en 'error' en vez de gastar dinero para siempre
  analisis_intentos INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  creada_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_notas_gmail ON public.crm_notas_reunion (gmail_message_id) WHERE gmail_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_notas_drive ON public.crm_notas_reunion (drive_file_id)    WHERE drive_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_notas_cliente ON public.crm_notas_reunion (client_id, fecha_reunion DESC);
CREATE INDEX IF NOT EXISTS idx_crm_notas_pendientes ON public.crm_notas_reunion (estado) WHERE estado IN ('pendiente', 'sin_cita', 'error');

COMMENT ON TABLE public.crm_notas_reunion IS
  'Las notas de Gemini de las reuniones con clientes: lo que escribió Gemini (resumen, detalle, transcripción) y el desglose de la IA. Se escribe solo desde el servidor (lib/crm/gemini/); el navegador la lee si puede ver el CRM.';

CREATE OR REPLACE FUNCTION public.crm_notas_actualizada()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizada_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_notas_actualizada ON public.crm_notas_reunion;
CREATE TRIGGER trg_crm_notas_actualizada
  BEFORE UPDATE ON public.crm_notas_reunion
  FOR EACH ROW EXECUTE FUNCTION public.crm_notas_actualizada();

ALTER TABLE public.crm_notas_reunion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver las notas de reunion del crm" ON public.crm_notas_reunion;
CREATE POLICY "Ver las notas de reunion del crm"
  ON public.crm_notas_reunion FOR SELECT
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()));


-- ---------- 3. EL PLAN DE PROPUESTA ----------
ALTER TABLE public.crm_clients
  ADD COLUMN IF NOT EXISTS propuesta_plan JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.crm_clients.propuesta_plan IS
  'Lo que se le va a proponer a este cliente: enfoque, servicios con su precio y riesgos. La forma vive en lib/crm/propuesta.ts; aquí solo se guarda lo escrito, así que cambiarla no pierde nada.';


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE (el editor de Supabase no enseña los NOTICE)
-- ============================================================================
-- Tiene que salir UNA fila con: las dos tablas creadas, el disparador puesto, la columna nueva, las dos políticas de lectura, y tantas fichas con historial como fichas hay.
SELECT
  to_regclass('public.crm_etapas_historial') IS NOT NULL                                                        AS tabla_historial,
  to_regclass('public.crm_notas_reunion') IS NOT NULL                                                           AS tabla_notas,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_registra_etapa' AND NOT tgisinternal)                AS disparador_de_fases,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'crm_clients' AND column_name = 'propuesta_plan')     AS columna_plan,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN ('crm_etapas_historial', 'crm_notas_reunion'))                                           AS politicas_de_lectura,
  (SELECT count(*) FROM public.crm_clients)                                                                     AS fichas,
  (SELECT count(DISTINCT client_id) FROM public.crm_etapas_historial)                                           AS fichas_con_historial;
