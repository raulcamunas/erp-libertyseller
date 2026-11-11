-- ============================================================================
-- 298 · MARKETING TEST: SEGMENTACIONES CON MÉTRICAS, PROPUESTAS DE PUJA Y PRESUPUESTO, Y TACoS
-- ============================================================================
--
--   · ads_objetivos_diario   el rendimiento de cada segmentación (keyword, ASIN o cláusula de la automática) por día, del informe «spTargeting» de Amazon Ads. Lo lee el mismo proceso que las
--                            campañas (ads-rendimiento, cada 3 h) y con la misma ventana: lo que falta de 60 días la primera vez, 14 días cada repaso, se conservan 90.
--   · ads_propuestas         admite dos tipos nuevos del motor: «puja» (subir o bajar la puja de una segmentación) y «presupuesto» (subir el de una campaña que se queda corta y rinde).
--   · ads_ventas_asin        las ventas TOTALES (orgánicas + publicidad) de cada ASIN en los últimos 7, 14 y 30 días, del informe de Ventas y tráfico de la cuenta de vendedor. Es el denominador
--                            del TACoS. Se lee una vez al día por cuenta de anunciante, con su estado en ads_ventas_sync.
--
-- Nada de esto lo lee el navegador: RLS encendida, lectura solo admin, escribe el servidor. IDEMPOTENTE. Hacen falta la 292, la 293 y la 294.

DO $$
BEGIN
  IF to_regclass('public.ads_propuestas') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_propuestas: lanza antes 294_ads_motor.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ads_objetivos_diario (
  perfil_id   UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  objetivo_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  ad_group_id TEXT NOT NULL DEFAULT '',
  texto       TEXT NOT NULL DEFAULT '',
  coincidencia TEXT,
  tipo        TEXT,
  impresiones INTEGER NOT NULL DEFAULT 0,
  clics       INTEGER NOT NULL DEFAULT 0,
  gasto       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ventas      NUMERIC(12,2) NOT NULL DEFAULT 0,
  pedidos     INTEGER NOT NULL DEFAULT 0,
  unidades    INTEGER NOT NULL DEFAULT 0,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (perfil_id, fecha, objetivo_id)
);
CREATE INDEX IF NOT EXISTS idx_ads_objetivos_campana ON public.ads_objetivos_diario (perfil_id, campaign_id, fecha);

ALTER TABLE public.ads_propuestas DROP CONSTRAINT IF EXISTS ads_propuestas_tipo_check;
ALTER TABLE public.ads_propuestas ADD CONSTRAINT ads_propuestas_tipo_check CHECK (tipo IN ('negativizar', 'promover', 'puja', 'presupuesto'));
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS objetivo_id TEXT;
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS objetivo_tipo TEXT;
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS valor_actual NUMERIC(12,2);
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS valor_nuevo NUMERIC(12,2);

CREATE TABLE IF NOT EXISTS public.ads_ventas_asin (
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  dias      INTEGER NOT NULL CHECK (dias IN (7, 14, 30)),
  asin      TEXT NOT NULL,
  desde     DATE NOT NULL,
  hasta     DATE NOT NULL,
  ventas    NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidades  INTEGER NOT NULL DEFAULT 0,
  pedidos   INTEGER NOT NULL DEFAULT 0,
  sesiones  INTEGER NOT NULL DEFAULT 0,
  moneda    TEXT,
  leido_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (perfil_id, dias, asin)
);

CREATE TABLE IF NOT EXISTS public.ads_ventas_sync (
  perfil_id UUID PRIMARY KEY REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  estado    TEXT NOT NULL DEFAULT 'reposo' CHECK (estado IN ('reposo', 'esperando')),
  informes  JSONB NOT NULL DEFAULT '[]'::jsonb,
  pedido_at    TIMESTAMPTZ,
  ultimo_ok_at TIMESTAMPTZ,
  error     TEXT,
  intentos  INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ads_objetivos_diario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_ventas_asin      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_ventas_sync      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ads_objetivos_diario', 'ads_ventas_asin', 'ads_ventas_sync'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_lectura_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_erp_admin(auth.uid()))', t || '_lectura_admin', t);
    END IF;
  END LOOP;
END $$;

-- Comprobación: tiene que salir UNA fila con las tres cosas en `true`
SELECT
  (SELECT count(*) = 3 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('ads_objetivos_diario', 'ads_ventas_asin', 'ads_ventas_sync') AND c.relrowsecurity) AS tres_tablas_con_rls,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ads_propuestas' AND column_name = 'valor_nuevo') AS propuestas_con_puja,
  (SELECT pg_get_constraintdef(oid) LIKE '%puja%' FROM pg_constraint WHERE conname = 'ads_propuestas_tipo_check') AS tipo_puja_admitido;
