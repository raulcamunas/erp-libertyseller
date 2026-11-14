-- ============================================================================
-- 279 · TAREAS DE CLIENTES: «MI DÍA» (BRIEFING PERSONAL Y ANOTACIONES) Y TAREAS PROPUESTAS DESDE LAS REUNIONES DE GEMINI
-- ============================================================================
--
--   · tc_briefings          El briefing de cada persona y día: el plan (una checklist, cada punto puede enlazar una tarea) y la revisión de final de día.
--                           Sustituye a las páginas «Briefing de <día>» que cada persona tenía en Notion.
--   · tc_notas_personales   El bloc de anotaciones de cada persona.
--   · tc_reuniones          Las reuniones de seguimiento con un cliente (notas de Gemini) de las que se sacan tareas: de qué cliente, qué día y qué se habló.
--   · tc_propuestas         Las tareas que la IA propone tras una reunión. El equipo elige las buenas (con columna, responsables y fecha) y descarta las malas.
--
-- NO TOCA NI BORRA NADA QUE YA EXISTA. Todas las tablas están cerradas al navegador (RLS sin políticas): todo pasa por el servidor, que comprueba el acceso por cliente (277).
-- El código funciona SIN esta migración: cada pantalla dice que falta lanzarla y nada más se rompe.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni borrar nada.
-- Hace falta la 275 (tc_clientes, tc_tareas, tc_toca_actualizado).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. El briefing de cada persona y día
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_briefings (
  usuario_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dia            DATE NOT NULL,
  -- [{id, texto, hecho, tarea_id, cliente_id}]
  plan           JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Cómo fue el día, escrito por la persona (o rellenado con lo que hizo y corregido)
  revision       TEXT NOT NULL DEFAULT '',
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, dia)
);
CREATE INDEX IF NOT EXISTS tc_briefings_dia_idx ON public.tc_briefings (dia DESC);

DROP TRIGGER IF EXISTS trg_tc_briefings_actualizado ON public.tc_briefings;
CREATE TRIGGER trg_tc_briefings_actualizado BEFORE UPDATE ON public.tc_briefings FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();


-- ---------------------------------------------------------------------------
-- 2. Las anotaciones personales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_notas_personales (
  usuario_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  texto          TEXT NOT NULL DEFAULT '',
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_tc_notas_personales_actualizado ON public.tc_notas_personales;
CREATE TRIGGER trg_tc_notas_personales_actualizado BEFORE UPDATE ON public.tc_notas_personales FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();


-- ---------------------------------------------------------------------------
-- 3. Las reuniones de seguimiento de las que se sacan tareas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_reuniones (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id       UUID NOT NULL REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  -- De dónde sale: el correo de Gemini (único: una reunión no se lee dos veces) y el documento de Drive
  gmail_message_id TEXT UNIQUE,
  drive_file_id    TEXT,
  titulo           TEXT NOT NULL,
  fecha_reunion    TIMESTAMPTZ,
  -- pendiente: falta analizarla · analizada: ya hay propuestas · sin_propuestas: la IA no encontró tareas · error: falló y no se reintenta más
  estado           TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'analizada', 'sin_propuestas', 'error')),
  resumen          TEXT,
  intentos         INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  modelo           TEXT,
  coste_usd        NUMERIC NOT NULL DEFAULT 0,
  creada_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analizada_en     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tc_reuniones_cliente_idx ON public.tc_reuniones (cliente_id, fecha_reunion DESC);


-- ---------------------------------------------------------------------------
-- 4. Las tareas propuestas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_propuestas (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reunion_id   UUID NOT NULL REFERENCES public.tc_reuniones(id) ON DELETE CASCADE,
  cliente_id   UUID NOT NULL REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  titulo       TEXT NOT NULL,
  -- En qué columna caería: «En progreso» (lo hacemos nosotros) o «Backlog» (lo hace o decide el cliente)
  columna      TEXT NOT NULL DEFAULT 'En progreso',
  departamento TEXT,
  -- Los pasos concretos (solo en las de «En progreso») y la frase de contexto
  subtareas    JSONB NOT NULL DEFAULT '[]'::jsonb,
  contexto     TEXT NOT NULL DEFAULT '',
  orden        INTEGER NOT NULL DEFAULT 0,
  estado       TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'descartada')),
  tarea_id     UUID REFERENCES public.tc_tareas(id) ON DELETE SET NULL,
  decidida_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decidida_en  TIMESTAMPTZ,
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tc_propuestas_cliente_idx ON public.tc_propuestas (cliente_id, estado, creada_en DESC);
CREATE INDEX IF NOT EXISTS tc_propuestas_reunion_idx ON public.tc_propuestas (reunion_id, orden);


-- ---------------------------------------------------------------------------
-- 5. Seguridad: cerradas al navegador (sin políticas); todo pasa por el servidor
-- ---------------------------------------------------------------------------
ALTER TABLE public.tc_briefings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_notas_personales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_reuniones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_propuestas       ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las dos columnas tienen que decir «true».
SELECT
  (SELECT count(*) = 4 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('tc_briefings', 'tc_notas_personales', 'tc_reuniones', 'tc_propuestas'))
    AS tiene_las_cuatro_tablas,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('tc_briefings', 'tc_notas_personales', 'tc_reuniones', 'tc_propuestas'))
    AS y_estan_cerradas_al_navegador;
