-- ============================================================================
-- 355 · PPC: AJUSTE POR UBICACIÓN Y BUY BOX (28 nov 2026)
-- ============================================================================
--   · ads_propuestas      admite el tipo «ubicacion»: subir o bajar el ajuste de puja de una campaña en una ubicación (arriba de la búsqueda,
--                         resto de la búsqueda, páginas de producto). `objetivo_tipo` = la ubicación de Amazon (PLACEMENT_TOP…), `valor_actual` y
--                         `valor_nuevo` = el porcentaje.
--   · ads_ubicaciones     el último informe de rendimiento por campaña y ubicación (14 días que acaban 3 antes de la lectura), y el que está pedido.
--                         Una fila por cuenta: las filas del informe van en `filas` (jsonb).
--   · ads_agente_buybox   la Buy Box de cada ASIN anunciado, leída cada hora por el agente. Sin ella (u hasta 7 días después de recuperarla) el
--                         agente no toca pujas, pausas, presupuestos ni ubicaciones de ese producto: lo que cae no es culpa de las keywords.
-- ============================================================================

ALTER TABLE public.ads_propuestas DROP CONSTRAINT IF EXISTS ads_propuestas_tipo_check;
ALTER TABLE public.ads_propuestas ADD CONSTRAINT ads_propuestas_tipo_check
  CHECK (tipo IN ('negativizar', 'promover', 'puja', 'presupuesto', 'pausar', 'pausar-campana', 'ubicacion'));

CREATE TABLE IF NOT EXISTS public.ads_ubicaciones (
  perfil_id  UUID PRIMARY KEY REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  -- El informe pedido y aún sin recoger
  report_id  TEXT,
  pedido_at  TIMESTAMPTZ,
  pedido_desde DATE,
  pedido_hasta DATE,
  -- El último recogido
  desde      DATE,
  hasta      DATE,
  filas      JSONB NOT NULL DEFAULT '[]'::jsonb,
  leido_at   TIMESTAMPTZ,
  error      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ads_agente_buybox (
  perfil_id  UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  asin       TEXT NOT NULL,
  -- nuestra | de_otro | nadie | desconocido (lib/plataforma/buybox/tipos.ts)
  estado     TEXT NOT NULL,
  -- Desde cuándo NO es nuestra (null = es nuestra)
  sin_desde  TIMESTAMPTZ,
  -- Cuándo se recuperó por última vez y cuántas horas duró esa pérdida (si pasó de 24 h, congela 7 días más)
  recuperada_at TIMESTAMPTZ,
  perdida_horas NUMERIC(8,1),
  -- Cuándo se avisó de la pérdida (uno por episodio)
  avisada_at TIMESTAMPTZ,
  leida_at   TIMESTAMPTZ NOT NULL,
  detalle    TEXT,
  PRIMARY KEY (perfil_id, asin)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ads_ubicaciones', 'ads_agente_buybox'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_lectura_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_erp_admin(auth.uid()))', t || '_lectura_admin', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- COMPROBACIÓN · todas las columnas tienen que decir «true»
-- ============================================================================
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%ubicacion%' FROM pg_constraint WHERE conname = 'ads_propuestas_tipo_check' AND conrelid = 'public.ads_propuestas'::regclass) AS tipo_ubicacion,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ads_ubicaciones') AS tabla_ubicaciones,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ads_agente_buybox') AS tabla_buybox;
