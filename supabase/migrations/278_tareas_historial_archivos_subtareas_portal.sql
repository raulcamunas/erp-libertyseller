-- ============================================================================
-- 278 · TAREAS DE CLIENTES: HISTORIAL DEL CUERPO, ARCHIVOS, SUBTAREAS, DEPENDENCIAS, PROPIEDADES PROPIAS, PANEL DEL CLIENTE Y TAREAS AUTOMÁTICAS
-- ============================================================================
--
--   · tc_versiones         Copias del cuerpo de cada tarea (se guarda una antes de pisarlo) para verlas y restaurarlas.
--   · tc_adjuntos          Los archivos adjuntos de una tarea (el archivo en sí vive en el almacén privado `tareas-archivos`, ya creado en la 275).
--   · tc_subtareas         Los pasos pequeños de una tarea (título, hecha, quién, para cuándo).
--   · tc_enlaces_cliente   El enlace secreto del panel que ve cada cliente (solo lectura, solo lo marcado «Ve el cliente»).
--   · tc_auto_config       Qué fuentes (alertas de FBA, listings suprimidos) abren tareas solas, en qué columna y para quién. Nacen APAGADAS.
--   · tc_tareas, columnas nuevas: contadores de subtareas y archivos, `bloqueada_por` (de qué tareas depende), `propiedades` (las columnas propias de la base de Notion
--     de ese cliente) y `origen_ref` (la clave de una tarea creada por el ERP, única por cliente: impide crear dos veces lo mismo).
--
-- NO TOCA NI BORRA NADA QUE YA EXISTA. Todas las tablas nuevas están cerradas al navegador (RLS sin políticas): se leen y escriben desde el servidor, que es quien comprueba
-- el acceso por cliente (277). El código funciona SIN esta migración: cada pantalla dice que falta lanzarla y nada más se rompe.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni borrar nada.
-- Hace falta la 275 (tc_clientes, tc_tareas, tc_toca_actualizado).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas de las tareas
-- ---------------------------------------------------------------------------
ALTER TABLE public.tc_tareas ADD COLUMN IF NOT EXISTS subtareas_total  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tc_tareas ADD COLUMN IF NOT EXISTS subtareas_hechas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tc_tareas ADD COLUMN IF NOT EXISTS adjuntos_total   INTEGER NOT NULL DEFAULT 0;
-- Las tareas que tienen que estar hechas antes de ésta (del mismo cliente; sin círculos: lo comprueba el servidor)
ALTER TABLE public.tc_tareas ADD COLUMN IF NOT EXISTS bloqueada_por    UUID[]  NOT NULL DEFAULT '{}';
-- Los valores de las columnas propias de la base de Notion de ese cliente, por nombre: {"Prioridad": "Alta", "Horas": 3, ...}
ALTER TABLE public.tc_tareas ADD COLUMN IF NOT EXISTS propiedades      JSONB   NOT NULL DEFAULT '{}'::jsonb;
-- La clave de una tarea que ha creado el propio ERP («fba:reposicion:SKU», «cumpl:2026-W45»)
ALTER TABLE public.tc_tareas ADD COLUMN IF NOT EXISTS origen_ref       TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tc_tareas_origen_ref_uq ON public.tc_tareas (cliente_id, origen_ref) WHERE origen_ref IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 2. Versiones del cuerpo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_versiones (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tarea_id       UUID NOT NULL REFERENCES public.tc_tareas(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL DEFAULT '',
  contenido      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- La huella del cuerpo (la misma que usa la sincronización): para no guardar dos veces lo mismo
  huella         TEXT NOT NULL DEFAULT '',
  -- {bloques, palabras, extracto}
  resumen        JSONB NOT NULL DEFAULT '{}'::jsonb,
  origen         TEXT NOT NULL DEFAULT 'erp' CHECK (origen IN ('erp', 'notion', 'restaurar')),
  usuario_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  usuario_nombre TEXT NOT NULL DEFAULT '',
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tc_versiones_tarea_idx ON public.tc_versiones (tarea_id, creado_en DESC);


-- ---------------------------------------------------------------------------
-- 3. Archivos adjuntos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_adjuntos (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tarea_id        UUID NOT NULL REFERENCES public.tc_tareas(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  -- La ruta dentro del almacén privado `tareas-archivos`
  ruta            TEXT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'application/octet-stream',
  tamano          BIGINT NOT NULL DEFAULT 0 CHECK (tamano >= 0),
  subido_por      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subido_nombre   TEXT NOT NULL DEFAULT '',
  visible_cliente BOOLEAN NOT NULL DEFAULT false,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tc_adjuntos_tarea_idx ON public.tc_adjuntos (tarea_id, creado_en DESC);


-- ---------------------------------------------------------------------------
-- 4. Subtareas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_subtareas (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tarea_id       UUID NOT NULL REFERENCES public.tc_tareas(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  hecha          BOOLEAN NOT NULL DEFAULT false,
  responsable_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  fecha          DATE,
  orden          INTEGER NOT NULL DEFAULT 0,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tc_subtareas_tarea_idx ON public.tc_subtareas (tarea_id, orden);

DROP TRIGGER IF EXISTS trg_tc_subtareas_actualizado ON public.tc_subtareas;
CREATE TRIGGER trg_tc_subtareas_actualizado BEFORE UPDATE ON public.tc_subtareas FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();


-- ---------------------------------------------------------------------------
-- 5. El enlace del panel del cliente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_enlaces_cliente (
  cliente_id      UUID PRIMARY KEY REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  -- 256 bits de azar (43 caracteres): ES la credencial. Se guarda tal cual para poder volver a copiar el enlace
  token           TEXT NOT NULL UNIQUE,
  activo          BOOLEAN NOT NULL DEFAULT true,
  aperturas       INTEGER NOT NULL DEFAULT 0,
  ultima_apertura TIMESTAMPTZ,
  creado_por      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_tc_enlaces_cliente_actualizado ON public.tc_enlaces_cliente;
CREATE TRIGGER trg_tc_enlaces_cliente_actualizado BEFORE UPDATE ON public.tc_enlaces_cliente FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();


-- ---------------------------------------------------------------------------
-- 6. Las tareas que crea el ERP
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_auto_config (
  fuente         TEXT PRIMARY KEY CHECK (fuente IN ('fba', 'cumplimiento')),
  -- Nacen APAGADAS: las enciende un administrador
  activa         BOOLEAN NOT NULL DEFAULT false,
  -- En qué columna caen (vacío = la primera pendiente de ese cliente)
  estado         TEXT,
  responsables   UUID[] NOT NULL DEFAULT '{}',
  ultima_pasada  TIMESTAMPTZ,
  ultimo_resumen TEXT,
  actualizado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------------------------------------------------------------------------
-- 7. Seguridad: cerradas al navegador (sin políticas); todo pasa por el servidor
-- ---------------------------------------------------------------------------
ALTER TABLE public.tc_versiones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_adjuntos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_subtareas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_enlaces_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_auto_config     ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las cuatro columnas tienen que decir «true».
SELECT
  (SELECT count(*) = 5 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('tc_versiones', 'tc_adjuntos', 'tc_subtareas', 'tc_enlaces_cliente', 'tc_auto_config'))
    AS tiene_las_cinco_tablas,
  (SELECT count(*) = 6 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tc_tareas'
      AND column_name IN ('subtareas_total', 'subtareas_hechas', 'adjuntos_total', 'bloqueada_por', 'propiedades', 'origen_ref'))
    AS tc_tareas_tiene_las_seis_columnas,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'tc_tareas_origen_ref_uq')
    AS no_se_crea_dos_veces_la_misma_tarea_automatica,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('tc_versiones', 'tc_adjuntos', 'tc_subtareas', 'tc_enlaces_cliente', 'tc_auto_config'))
    AS y_estan_cerradas_al_navegador;
