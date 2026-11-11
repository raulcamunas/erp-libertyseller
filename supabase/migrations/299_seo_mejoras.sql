-- ============================================================================
-- 299 · SEO TEST: EVOLUCIÓN, COMPETENCIA (TOP SEARCH TERMS) Y PROPUESTAS DE FICHA CON IA
-- ============================================================================
--
--   · seo_lecturas (columnas nuevas)   qué periodos pasados ya se han leído (para rellenar el histórico unas semanas y meses hacia atrás sin repetirlos) y el estado de la lectura del informe
--                                      «Top Search Terms» de Brand Analytics (pedir → recoger en la pasada siguiente, como el resto).
--   · seo_evolucion(conexión, país)    por producto y periodo: volumen, compras y cuotas de compras e impresiones sumadas. Es la gráfica de evolución de cada producto.
--   · seo_top_terminos                 de cada búsqueda que importa a los productos seguidos, los 3 ASIN que más clics se llevan en todo Amazon, con su cuota de clics y de conversión.
--                                      El informe de Amazon es de TODO el país (millones de filas): solo se guardan las búsquedas que ya salen en el Search Query Performance de la cuenta.
--   · seo_propuestas                   las propuestas de ficha que escribe la IA (antes y después, y por qué). NUNCA se aplican solas: solo cuando una persona pulsa «Aplicar en Amazon».
--
-- RLS encendida y sin políticas de escritura: solo el servidor escribe. Lectura solo para administradores. IDEMPOTENTE. Hace falta la 296.

DO $$
BEGIN
  IF to_regclass('public.seo_lecturas') IS NULL THEN
    RAISE EXCEPTION 'Falta public.seo_lecturas: lanza antes 296_seo_test.sql.';
  END IF;
END $$;

ALTER TABLE public.seo_lecturas ADD COLUMN IF NOT EXISTS periodos_leidos TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.seo_lecturas ADD COLUMN IF NOT EXISTS top_report_id TEXT;
ALTER TABLE public.seo_lecturas ADD COLUMN IF NOT EXISTS top_desde DATE;
ALTER TABLE public.seo_lecturas ADD COLUMN IF NOT EXISTS top_hasta DATE;
ALTER TABLE public.seo_lecturas ADD COLUMN IF NOT EXISTS top_pedido_at TIMESTAMPTZ;
ALTER TABLE public.seo_lecturas ADD COLUMN IF NOT EXISTS top_ok DATE;
ALTER TABLE public.seo_lecturas ADD COLUMN IF NOT EXISTS top_error TEXT;

CREATE TABLE IF NOT EXISTS public.seo_top_terminos (
  connection_id    UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id   TEXT NOT NULL,
  periodo          TEXT NOT NULL CHECK (periodo IN ('WEEK', 'MONTH')),
  desde            DATE NOT NULL,
  hasta            DATE NOT NULL,
  consulta         TEXT NOT NULL,
  posicion         SMALLINT NOT NULL CHECK (posicion BETWEEN 1 AND 3),
  asin             TEXT NOT NULL,
  departamento     TEXT,
  rango_frecuencia INTEGER,
  cuota_clics      NUMERIC(8,6),
  cuota_conversion NUMERIC(8,6),
  PRIMARY KEY (connection_id, marketplace_id, periodo, desde, consulta, posicion)
);
CREATE INDEX IF NOT EXISTS idx_seo_top_terminos_cuenta ON public.seo_top_terminos (connection_id, marketplace_id, periodo, desde DESC);

CREATE TABLE IF NOT EXISTS public.seo_propuestas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  sku  TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aplicada', 'descartada', 'error')),
  -- {titulo, bullets[], backend} tal cual estaban y tal cual los propone la IA
  antes     JSONB NOT NULL,
  propuesta JSONB NOT NULL,
  -- {resumen, cambios:[{campo, que, porQue}], palabrasNuevas[]}
  razonamiento JSONB NOT NULL DEFAULT '{}'::jsonb,
  modelo TEXT,
  creada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creada_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aplicada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  aplicada_at  TIMESTAMPTZ,
  -- Lo que contestó Amazon al aplicar: {submissionId, issues[], estado}
  resultado JSONB,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_seo_propuestas_producto ON public.seo_propuestas (connection_id, marketplace_id, asin, creada_at DESC);

ALTER TABLE public.seo_top_terminos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_propuestas   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['seo_top_terminos', 'seo_propuestas'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_lectura_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_erp_admin(auth.uid()))', t || '_lectura_admin', t);
    END IF;
  END LOOP;
END $$;

-- La evolución de cada producto: una fila por ASIN, tipo de periodo y periodo. Cuota de compras = compras del ASIN ÷ compras de todas sus búsquedas; la de impresiones, igual.
CREATE OR REPLACE FUNCTION public.seo_evolucion(p_conexion UUID, p_mercado TEXT)
RETURNS TABLE (asin TEXT, periodo TEXT, desde DATE, hasta DATE, busquedas BIGINT, volumen BIGINT, compras_asin BIGINT, compras_total BIGINT, impresiones_asin BIGINT, impresiones_total BIGINT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT c.asin, c.periodo, c.desde, max(c.hasta), count(*), COALESCE(sum(c.volumen), 0), COALESCE(sum(c.compras_asin), 0), COALESCE(sum(c.compras_total), 0),
         COALESCE(sum(c.impresiones_asin), 0), COALESCE(sum(c.impresiones_total), 0)
  FROM public.seo_consultas c
  WHERE c.connection_id = p_conexion AND c.marketplace_id = p_mercado
  GROUP BY c.asin, c.periodo, c.desde
  ORDER BY c.asin, c.periodo, c.desde
$$;

REVOKE ALL ON FUNCTION public.seo_evolucion(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seo_evolucion(UUID, TEXT) TO service_role;

-- Comprobación: tiene que salir UNA fila con las tres cosas en `true`
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seo_lecturas' AND column_name = 'top_report_id') AS columnas_de_lectura,
  (SELECT count(*) = 2 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('seo_top_terminos', 'seo_propuestas') AND c.relrowsecurity) AS tablas_con_rls,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'seo_evolucion') AS funcion_de_evolucion;
