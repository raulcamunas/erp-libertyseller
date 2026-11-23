-- ============================================================================
-- 334 · SEO TEST: LOS ITEM HIGHLIGHTS PUESTOS A MANO
-- ============================================================================
--
-- La API de Amazon no devuelve los Item Highlights de muchos tipos de producto (Opinas, SIGNAGE): el ERP no sabía qué había en ellos y daba por «falta en la ficha»
-- palabras que sí estaban. Ahora un administrativo los copia de Seller Central y los pega en «Ficha»: el ERP los usa en las recomendaciones (qué palabras faltan,
-- Helium 10, propuesta con IA) mientras Amazon no los dé. Si un día Amazon los devuelve, mandan los de Amazon.
--   · seo_fichas.highlights_manual       el texto pegado
--   · seo_fichas.highlights_manual_at    cuándo
--   · seo_fichas.highlights_manual_por   quién
-- Van aparte de `highlights` (lo que lee de Amazon) porque cada lectura de la ficha reescribe esa columna.
--
-- Columnas nuevas en una tabla con RLS y sin políticas de escritura (296): solo escribe el servidor. IDEMPOTENTE. Hace falta la 296.
-- Sin esta migración todo funciona igual; solo no se pueden guardar los highlights a mano.

DO $$
BEGIN
  IF to_regclass('public.seo_fichas') IS NULL THEN
    RAISE EXCEPTION 'Falta public.seo_fichas: lanza antes 296_seo_test.sql.';
  END IF;
END $$;

ALTER TABLE public.seo_fichas ADD COLUMN IF NOT EXISTS highlights_manual TEXT CHECK (highlights_manual IS NULL OR length(highlights_manual) <= 1000);
ALTER TABLE public.seo_fichas ADD COLUMN IF NOT EXISTS highlights_manual_at TIMESTAMPTZ;
ALTER TABLE public.seo_fichas ADD COLUMN IF NOT EXISTS highlights_manual_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.seo_fichas ENABLE ROW LEVEL SECURITY;

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seo_fichas' AND column_name IN ('highlights_manual', 'highlights_manual_at', 'highlights_manual_por')) AS columnas_creadas,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'seo_fichas') AS seo_fichas_con_rls;
