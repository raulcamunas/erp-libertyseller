-- ============================================================================
-- 287 · CHAT: AVISOS POR CANAL, HORA LOCAL, ENCUESTAS, CANALES DE ANUNCIOS E IMPORTAR DE SLACK
-- ============================================================================
--
--   · chat_miembros.avisos: cuánto quieres que te avise cada canal (todo · solo menciones · nada). Sin valor, se usa el de siempre (directos: todo; canales: menciones).
--   · chat_perfiles: la zona horaria de cada persona, para ver «allí son las 22:40».
--   · chat_canales.anuncios: canales donde solo publican quienes los administran (el resto reacciona y responde en hilos).
--   · chat_mensajes.encuesta + chat_votos: encuestas dentro de un canal.
--   · chat_mensajes.autor_externo / origen_id y chat_canales.origen_id: lo que hace falta para IMPORTAR el historial de Slack (quién lo escribió si no es del ERP, y de dónde viene cada
--     mensaje, para que volver a importar el mismo fichero no duplique nada).
--
-- Cerradas al navegador (RLS sin políticas). Hace falta la 284. IDEMPOTENTE: se puede volver a pegar.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.chat_mensajes') IS NULL THEN
    RAISE EXCEPTION 'Falta la tabla chat_mensajes: lanza antes la migración 284_chat_del_equipo.sql.';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. Avisos por canal
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_miembros ADD COLUMN IF NOT EXISTS avisos TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_miembros_avisos_check') THEN
    ALTER TABLE public.chat_miembros ADD CONSTRAINT chat_miembros_avisos_check CHECK (avisos IS NULL OR avisos IN ('todo', 'menciones', 'nada'));
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 2. La zona horaria de cada persona
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_perfiles (
  usuario_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  zona           TEXT NOT NULL CHECK (length(zona) BETWEEN 3 AND 60),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------------------------------------------------------------------------
-- 3. Canales de anuncios y origen de lo importado
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_canales ADD COLUMN IF NOT EXISTS anuncios  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.chat_canales ADD COLUMN IF NOT EXISTS origen_id TEXT;
-- Un índice único normal (no parcial): los NULL no chocan entre sí y así se puede usar para «si ya existe, no lo repitas»
CREATE UNIQUE INDEX IF NOT EXISTS chat_canales_origen_uq ON public.chat_canales (origen_id);


-- ---------------------------------------------------------------------------
-- 4. Encuestas
-- ---------------------------------------------------------------------------
-- {pregunta, opciones: [..], multiple: bool, cerrada: bool}
ALTER TABLE public.chat_mensajes ADD COLUMN IF NOT EXISTS encuesta JSONB;

CREATE TABLE IF NOT EXISTS public.chat_votos (
  mensaje_id BIGINT   NOT NULL REFERENCES public.chat_mensajes(id) ON DELETE CASCADE,
  usuario_id UUID     NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opcion     SMALLINT NOT NULL CHECK (opcion BETWEEN 0 AND 9),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mensaje_id, usuario_id, opcion)
);


-- ---------------------------------------------------------------------------
-- 5. Importar de Slack
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_mensajes ADD COLUMN IF NOT EXISTS autor_externo TEXT;
ALTER TABLE public.chat_mensajes ADD COLUMN IF NOT EXISTS origen_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS chat_mensajes_origen_uq ON public.chat_mensajes (canal_id, origen_id);


-- ---------------------------------------------------------------------------
-- 6. Cerradas al navegador
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_votos    ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las seis columnas tienen que decir «true».
SELECT
  (SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_miembros' AND column_name = 'avisos') AS con_avisos,
  (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_canales' AND column_name IN ('anuncios', 'origen_id')) AS con_anuncios_y_origen,
  (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_mensajes' AND column_name IN ('encuesta', 'autor_externo', 'origen_id')) AS con_encuestas_e_importacion,
  (SELECT count(*) = 2 FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('chat_perfiles', 'chat_votos')) AS con_las_dos_tablas,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('chat_perfiles', 'chat_votos')) AS cerradas_al_navegador,
  (SELECT count(*) = 2 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('chat_canales_origen_uq', 'chat_mensajes_origen_uq')) AS con_indices_de_origen;
