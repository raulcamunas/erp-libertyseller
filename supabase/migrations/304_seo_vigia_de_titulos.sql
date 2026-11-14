-- ============================================================================
-- 304 · SEO TEST: EL VIGÍA DE TÍTULOS
-- ============================================================================
--
-- Desde el 27 jul 2026 Amazon reescribe con su IA los títulos que no cumplen la norma (75 caracteres) y el propietario de la marca tiene 14 días para aceptar, editar o rechazar el cambio en
-- Seller Central › Review Listing Changes. Si nadie lo mira, el título que posiciona lo decide Amazon.
--
-- SEO Test ya lee la ficha de cada producto una vez al día, pero solo guardaba la última: no había con qué comparar. Aquí se guarda el título ANTERIOR y cuándo cambió:
--   · seo_fichas.titulo_anterior     el título que había antes del último cambio detectado
--   · seo_fichas.titulo_cambiado_at  cuándo se detectó ese cambio
-- Con ellos, «Qué hacer hoy» avisa de un título que ha cambiado sin un cambio nuestro (sin una propuesta aplicada desde el ERP en esos días), con el plazo de 14 días.
--
-- Solo columnas nuevas en una tabla que ya tiene RLS encendida y sin políticas de escritura (296): solo escribe el servidor. IDEMPOTENTE. Hace falta la 296.
-- Sin esta migración la pantalla funciona igual; simplemente no hay vigía.

DO $$
BEGIN
  IF to_regclass('public.seo_fichas') IS NULL THEN
    RAISE EXCEPTION 'Falta public.seo_fichas: lanza antes 296_seo_test.sql.';
  END IF;
END $$;

ALTER TABLE public.seo_fichas ADD COLUMN IF NOT EXISTS titulo_anterior TEXT;
ALTER TABLE public.seo_fichas ADD COLUMN IF NOT EXISTS titulo_cambiado_at TIMESTAMPTZ;

ALTER TABLE public.seo_fichas ENABLE ROW LEVEL SECURITY;

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seo_fichas' AND column_name IN ('titulo_anterior', 'titulo_cambiado_at')) AS columnas_del_vigia,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'seo_fichas') AS seo_fichas_con_rls;
