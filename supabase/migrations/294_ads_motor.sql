-- ============================================================================
-- 294 · AMAZON ADS: EL MOTOR AUTOMÁTICO DEL SOP (términos de búsqueda, propuestas y modo por cuenta)
-- ============================================================================
--
-- Tres tablas y una de estado, todas por cuenta de anunciante (`ads_profiles`):
--
--   · ads_motor_config      el interruptor de cada cuenta: apagado (por defecto) · sugiere (propone y no toca nada) · aprueba (propone y, si una persona aprueba, aplica) · autopiloto (aplica solo
--                           lo que el SOP permite sin aprobación —negativizar—, con tope diario). Pasar de «sugiere» exige la ficha de cuenta FIRMADA: se comprueba en el servidor.
--   · ads_terminos          los términos de búsqueda de los últimos 14 días, ya resumidos por campaña (no uno por día): la materia prima de las reglas. Se reemplazan en cada lectura.
--   · ads_terminos_sync     en qué punto está esa lectura por cuenta (misma idea que `ads_sincronizacion`: pide el informe, lo recoge en la pasada siguiente, nunca espera a Amazon).
--   · ads_propuestas        cada cambio que propone el motor, con su motivo y su ciclo: pendiente → aprobada → aplicada (o descartada / deshecha / error / caducada). Lo aplicado guarda los identificadores
--                           que se crearon en Amazon para poder DESHACERLO.
--
-- Nada de esto lo lee el navegador: RLS encendida y SIN políticas de escritura. Solo entra el servidor con la llave de servicio, y la lectura es solo para administradores.
--
-- El código funciona SIN esta migración: la pestaña «Propuestas» dice que falta lanzarla. Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Hacen falta la 292 y la 293.

DO $$
BEGIN
  IF to_regclass('public.ads_fichas') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_fichas: lanza antes 292_ads_cuenta_ficha_productos_estructura_log.sql.';
  END IF;
  IF to_regclass('public.ads_sincronizacion') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_sincronizacion: lanza antes 293_ads_rendimiento_diario.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ads_motor_config (
  perfil_id UUID PRIMARY KEY REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  modo TEXT NOT NULL DEFAULT 'apagado' CHECK (modo IN ('apagado', 'sugiere', 'aprueba', 'autopiloto')),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ads_terminos (
  perfil_id   UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  ad_group_id TEXT NOT NULL DEFAULT '',
  termino     TEXT NOT NULL,
  keyword     TEXT,
  match_type  TEXT,
  campaign_nombre TEXT NOT NULL DEFAULT '',
  impresiones INTEGER NOT NULL DEFAULT 0,
  clics       INTEGER NOT NULL DEFAULT 0,
  gasto       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ventas      NUMERIC(12,2) NOT NULL DEFAULT 0,
  pedidos     INTEGER NOT NULL DEFAULT 0,
  desde DATE,
  hasta DATE,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (perfil_id, campaign_id, ad_group_id, termino)
);

CREATE INDEX IF NOT EXISTS idx_ads_terminos_perfil ON public.ads_terminos (perfil_id);

CREATE TABLE IF NOT EXISTS public.ads_terminos_sync (
  perfil_id UUID PRIMARY KEY REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  estado    TEXT NOT NULL DEFAULT 'reposo' CHECK (estado IN ('reposo', 'esperando')),
  informe_id TEXT,
  desde DATE,
  hasta DATE,
  pedido_at    TIMESTAMPTZ,
  ultimo_ok_at TIMESTAMPTZ,
  filas     INTEGER,
  error     TEXT,
  intentos  INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ads_propuestas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,

  tipo TEXT NOT NULL CHECK (tipo IN ('negativizar', 'promover')),
  asin TEXT,
  termino TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_nombre TEXT NOT NULL,
  ad_group_id TEXT,
  desde_rol TEXT,
  hacia_rol TEXT,
  hacia_campaign_id TEXT,
  hacia_campaign_nombre TEXT,
  hacia_ad_group_id TEXT,
  negativizar_en_origen BOOLEAN NOT NULL DEFAULT FALSE,
  motivo TEXT NOT NULL,
  -- clics, gasto, pedidos, acos, ventas… tal y como se vieron al proponer
  metricas JSONB NOT NULL DEFAULT '{}'::jsonb,

  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'aplicada', 'descartada', 'deshecha', 'error', 'caducada')),
  error TEXT,
  -- Lo que se creó en Amazon al aplicar ({keywordId, negativeId}), para poder deshacerlo
  aplicada JSONB,
  creada_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_at TIMESTAMPTZ,
  resuelta_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- true = la aplicó el piloto automático, no una persona
  automatica BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ads_propuestas_perfil_estado ON public.ads_propuestas (perfil_id, estado, creada_at DESC);
-- Un mismo cambio no se propone dos veces mientras siga pendiente
CREATE UNIQUE INDEX IF NOT EXISTS uq_ads_propuestas_pendiente
  ON public.ads_propuestas (perfil_id, campaign_id, lower(termino), tipo) WHERE estado = 'pendiente';

ALTER TABLE public.ads_motor_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_terminos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_terminos_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_propuestas    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ads_motor_config', 'ads_terminos', 'ads_terminos_sync', 'ads_propuestas'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_lectura_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_erp_admin(auth.uid()))', t || '_lectura_admin', t);
    END IF;
  END LOOP;
END $$;

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  (SELECT count(*) = 4 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('ads_motor_config', 'ads_terminos', 'ads_terminos_sync', 'ads_propuestas') AND c.relrowsecurity) AS cuatro_tablas_con_rls,
  (SELECT count(*) = 4 FROM pg_policies WHERE policyname IN ('ads_motor_config_lectura_admin', 'ads_terminos_lectura_admin', 'ads_terminos_sync_lectura_admin', 'ads_propuestas_lectura_admin')) AS cuatro_politicas_de_lectura;
