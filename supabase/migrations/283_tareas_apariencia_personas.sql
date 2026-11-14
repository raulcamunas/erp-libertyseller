-- ============================================================================
-- 283 · Icono y color de cada persona en Tareas de clientes
-- ============================================================================
-- Cada persona elige un icono y un color (Mi día → «Tu perfil»). Son exclusivos: dos personas no pueden tener el mismo. Los índices únicos lo garantizan aunque dos personas
-- pulsen a la vez; el NULL (no ha elegido) no cuenta. Se puede lanzar las veces que se quiera.

ALTER TABLE public.tc_preferencias ADD COLUMN IF NOT EXISTS avatar_color  TEXT;
ALTER TABLE public.tc_preferencias ADD COLUMN IF NOT EXISTS avatar_icono  TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tc_preferencias_avatar_color_uq ON public.tc_preferencias (avatar_color) WHERE avatar_color IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tc_preferencias_avatar_icono_uq ON public.tc_preferencias (avatar_icono) WHERE avatar_icono IS NOT NULL;

-- COMPROBACIÓN: las dos columnas tienen que decir «true»
SELECT
  (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tc_preferencias' AND column_name IN ('avatar_color', 'avatar_icono')) AS tiene_las_dos_columnas,
  (SELECT count(*) = 2 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('tc_preferencias_avatar_color_uq', 'tc_preferencias_avatar_icono_uq')) AS tiene_los_dos_indices;
