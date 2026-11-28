-- ============================================================================
-- 356 · CUMPLIMIENTO: CUÁNDO SE ABRE Y SE CIERRA CADA INCIDENCIA (28 nov 2026)
-- ============================================================================
--   · cumplimiento_incidencias_eventos   una fila cada vez que un ERROR aparece («abierta») o desaparece («cerrada») en un listing, al comparar una revisión
--                                        con la anterior (lib/cumplimiento/eventos-incidencias.ts). La cerrada lleva las horas que estuvo abierta y si el
--                                        listing tenía stock. De aquí salen el tiempo de resolución y las abiertas/cerradas por semana.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cumplimiento_incidencias_eventos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  sku            TEXT NOT NULL,
  asin           TEXT,
  codigo         TEXT NOT NULL,
  evento         TEXT NOT NULL CHECK (evento IN ('abierta', 'cerrada')),
  desde          TIMESTAMPTZ NOT NULL,
  horas          NUMERIC(10,1),
  con_stock      BOOLEAN NOT NULL DEFAULT false,
  mensaje        TEXT,
  at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cumplimiento_incidencias_eventos_conexion_idx ON public.cumplimiento_incidencias_eventos (connection_id, at DESC);

ALTER TABLE public.cumplimiento_incidencias_eventos ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cumplimiento_incidencias_eventos' AND policyname = 'cumplimiento_incidencias_eventos_lectura_admin') THEN
    CREATE POLICY cumplimiento_incidencias_eventos_lectura_admin ON public.cumplimiento_incidencias_eventos FOR SELECT USING (public.is_erp_admin(auth.uid()));
  END IF;
END $$;

-- Las cifras por semana de unas conexiones (las de un cliente): abiertas, cerradas, horas medianas hasta cerrar y cuántas tenían stock
CREATE OR REPLACE FUNCTION public.cumplimiento_resolucion(p_conexiones UUID[], p_semanas INTEGER DEFAULT 8)
RETURNS TABLE (semana DATE, abiertas BIGINT, cerradas BIGINT, cerradas_con_stock BIGINT, horas_mediana NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc('week', e.at)::date AS semana,
         count(*) FILTER (WHERE e.evento = 'abierta'),
         count(*) FILTER (WHERE e.evento = 'cerrada'),
         count(*) FILTER (WHERE e.evento = 'cerrada' AND e.con_stock),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY e.horas) FILTER (WHERE e.evento = 'cerrada')::numeric
  FROM public.cumplimiento_incidencias_eventos e
  WHERE e.connection_id = ANY(p_conexiones) AND e.at >= date_trunc('week', now()) - make_interval(weeks => p_semanas - 1)
  GROUP BY 1 ORDER BY 1
$$;
REVOKE ALL ON FUNCTION public.cumplimiento_resolucion(UUID[], INTEGER) FROM PUBLIC, anon, authenticated;

-- COMPROBACIÓN · las dos tienen que decir «true»
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cumplimiento_incidencias_eventos') AS tabla,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cumplimiento_resolucion') AS funcion;
