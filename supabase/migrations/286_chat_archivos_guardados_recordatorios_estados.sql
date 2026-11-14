-- ============================================================================
-- 286 · CHAT: ARCHIVOS, FIJADOS, GUARDADOS, RECORDATORIOS, MENSAJES PROGRAMADOS, ESTADO Y BÚSQUEDA
-- ============================================================================
--
--   · Almacén privado `chat-archivos` (25 MB por archivo): los archivos de los mensajes. Se suben por el servidor y se abren con un enlace firmado que caduca.
--   · chat_mensajes.fijado_en / fijado_por: los mensajes fijados arriba de un canal.
--   · chat_guardados: tus mensajes guardados (solo los ves tú).
--   · chat_recordatorios: «recuérdamelo en una hora»: el servidor te avisa por la campana (y el móvil) cuando llega la hora.
--   · chat_programados: mensajes que salen solos a la hora elegida, como si los escribieras entonces.
--   · chat_estados: «En reunión», «De vacaciones»…, con una hora de caducidad opcional.
--   · Un índice para buscar texto dentro de los mensajes (pg_trgm). Si el proyecto no deja crearlo, se salta y la búsqueda funciona igual, solo más lenta con muchos mensajes.
--
-- Todas las tablas están cerradas al navegador (RLS sin políticas): solo el servidor las lee y escribe. Hace falta la 284. IDEMPOTENTE: se puede volver a pegar.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.chat_mensajes') IS NULL THEN
    RAISE EXCEPTION 'Falta la tabla chat_mensajes: lanza antes la migración 284_chat_del_equipo.sql.';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. El almacén de archivos (privado)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-archivos', 'chat-archivos', false, 26214400)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. Fijados
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_mensajes ADD COLUMN IF NOT EXISTS fijado_en  TIMESTAMPTZ;
ALTER TABLE public.chat_mensajes ADD COLUMN IF NOT EXISTS fijado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chat_mensajes_fijados_idx ON public.chat_mensajes (canal_id, fijado_en DESC) WHERE fijado_en IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. Guardados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_guardados (
  usuario_id UUID   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mensaje_id BIGINT NOT NULL REFERENCES public.chat_mensajes(id) ON DELETE CASCADE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, mensaje_id)
);
CREATE INDEX IF NOT EXISTS chat_guardados_usuario_idx ON public.chat_guardados (usuario_id, creado_en DESC);


-- ---------------------------------------------------------------------------
-- 4. Recordatorios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_recordatorios (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- El mensaje al que se refiere (si se borra del todo, el recordatorio sigue con su texto)
  mensaje_id BIGINT REFERENCES public.chat_mensajes(id) ON DELETE SET NULL,
  canal_id   UUID REFERENCES public.chat_canales(id) ON DELETE CASCADE,
  texto      TEXT NOT NULL DEFAULT '' CHECK (length(texto) <= 300),
  avisar_en  TIMESTAMPTZ NOT NULL,
  enviado_en TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_recordatorios_pendientes_idx ON public.chat_recordatorios (avisar_en) WHERE enviado_en IS NULL;
CREATE INDEX IF NOT EXISTS chat_recordatorios_usuario_idx    ON public.chat_recordatorios (usuario_id, avisar_en DESC);


-- ---------------------------------------------------------------------------
-- 5. Mensajes programados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_programados (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  canal_id   UUID NOT NULL REFERENCES public.chat_canales(id) ON DELETE CASCADE,
  autor_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cuerpo     TEXT NOT NULL DEFAULT '' CHECK (length(cuerpo) <= 8000),
  hilo_de    BIGINT,
  responde_a BIGINT,
  adjuntos   JSONB NOT NULL DEFAULT '[]'::jsonb,
  enviar_en  TIMESTAMPTZ NOT NULL,
  -- pendiente → enviado (o error si ya no se podía: saliste del canal, lo archivaron…) · cancelado por su autor
  estado     TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'cancelado', 'error')),
  error      TEXT,
  enviado_en TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_programados_pendientes_idx ON public.chat_programados (enviar_en) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS chat_programados_autor_idx      ON public.chat_programados (autor_id, estado, enviar_en);


-- ---------------------------------------------------------------------------
-- 6. El estado de cada persona
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_estados (
  usuario_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji          TEXT NOT NULL DEFAULT '' CHECK (length(emoji) <= 16),
  texto          TEXT NOT NULL DEFAULT '' CHECK (length(texto) <= 60),
  -- Cuándo se quita solo (NULL = hasta que lo quite quien lo puso)
  hasta          TIMESTAMPTZ,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------------------------------------------------------------------------
-- 7. Cerradas al navegador
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_guardados     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_recordatorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_programados   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_estados       ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- 8. Buscar dentro de los mensajes
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
  CREATE INDEX IF NOT EXISTS chat_mensajes_cuerpo_trgm_idx ON public.chat_mensajes USING gin (cuerpo extensions.gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se ha podido crear el índice de búsqueda (%): la búsqueda funciona igual, solo más lenta con muchos mensajes.', SQLERRM;
END $$;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las cuatro primeras columnas tienen que decir «true»; la última puede ser false sin que pase nada grave.
SELECT
  (SELECT count(*) = 4 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('chat_guardados', 'chat_recordatorios', 'chat_programados', 'chat_estados'))
    AS tiene_las_cuatro_tablas,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('chat_guardados', 'chat_recordatorios', 'chat_programados', 'chat_estados'))
    AS cerradas_al_navegador,
  (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_mensajes' AND column_name IN ('fijado_en', 'fijado_por'))
    AS con_fijados,
  (SELECT count(*) = 1 FROM storage.buckets WHERE id = 'chat-archivos')
    AS con_el_almacen,
  (SELECT count(*) = 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'chat_mensajes_cuerpo_trgm_idx')
    AS con_indice_de_busqueda;
