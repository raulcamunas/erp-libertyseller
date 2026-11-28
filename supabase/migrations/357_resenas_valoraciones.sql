-- ============================================================================
-- 357 · RESEÑAS: VALORACIÓN Y NÚMERO DE RESEÑAS POR PRODUCTO, CADA DÍA (28 nov 2026)
-- ============================================================================
--   · resenas_valoraciones   una foto al día, por país y ASIN, de la valoración media (estrellas) y el número de reseñas (Keepa). De los productos
--                            anunciados (PPC) y seguidos en SEO de cada cliente. Con ella: la evolución y el aviso al responsable cuando baja la nota
--                            o entran reseñas nuevas con la nota a la baja (lib/resenas/valoraciones.ts).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.resenas_valoraciones (
  pais             TEXT NOT NULL,
  asin             TEXT NOT NULL,
  dia              DATE NOT NULL,
  amazon_client_id UUID NOT NULL,
  valoracion       NUMERIC(3,2),
  num_resenas      INTEGER,
  titulo           TEXT,
  leido_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pais, asin, dia)
);
CREATE INDEX IF NOT EXISTS resenas_valoraciones_cliente_idx ON public.resenas_valoraciones (amazon_client_id, dia DESC);

ALTER TABLE public.resenas_valoraciones ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resenas_valoraciones' AND policyname = 'resenas_valoraciones_lectura_admin') THEN
    CREATE POLICY resenas_valoraciones_lectura_admin ON public.resenas_valoraciones FOR SELECT USING (public.is_erp_admin(auth.uid()));
  END IF;
END $$;

SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'resenas_valoraciones') AS tabla;
