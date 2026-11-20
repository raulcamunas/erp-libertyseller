-- ============================================================================
-- 332 · SEO TEST: LOS ASIN DE LOS QUE BRAND ANALYTICS NO DA DATOS
-- ============================================================================
--
-- Un informe «Search Query Performance» que acaba en FATAL se volvía a pedir cada 30 minutos para siempre y frenaba la semana, el histórico y la competencia de toda la cuenta.
-- Ahora la lectura (lib/seo/lectura.ts) parte la tanda en mitades hasta aislar el ASIN que falla; si ese ASIN da FATAL tres veces seguidas, se apunta aquí y deja de pedirse hasta que
-- cambien los productos seguidos (reiniciarLectura vacía la lista). El resto de ASIN se lee con normalidad y el periodo se cierra.
--   · seo_lecturas.asins_sin_ba   los ASIN apartados de esa cuenta y país
--
-- Solo una columna nueva en una tabla con RLS encendida y sin políticas de escritura (296): solo escribe el servidor. IDEMPOTENTE. Hace falta la 296.
-- Sin esta migración la lectura funciona igual; el ASIN que falla se salta solo en el periodo en curso.

DO $$
BEGIN
  IF to_regclass('public.seo_lecturas') IS NULL THEN
    RAISE EXCEPTION 'Falta public.seo_lecturas: lanza antes 296_seo_test.sql.';
  END IF;
END $$;

ALTER TABLE public.seo_lecturas ADD COLUMN IF NOT EXISTS asins_sin_ba TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.seo_lecturas ENABLE ROW LEVEL SECURITY;

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  (SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seo_lecturas' AND column_name = 'asins_sin_ba') AS columna_asins_sin_ba,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'seo_lecturas') AS seo_lecturas_con_rls;
