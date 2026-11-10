-- ============================================================================
-- 293 · AMAZON ADS: EL RENDIMIENTO DIARIO DE LAS CAMPAÑAS, GUARDADO (Marketing Test)
-- ============================================================================
--
-- Hasta ahora, abrir «Resumen» o «Campañas» pedía el informe a Amazon en ese momento y tardaba de uno a dos minutos. Un proceso automático (`ads-rendimiento`) lo trae cada 3 horas para cada cuenta
-- de anunciante en uso y asignada, y la pantalla lee de aquí al instante. Dos tablas:
--
--   · ads_rendimiento_diario  una fila por cuenta, día y campaña: impresiones, clics, gasto, ventas y pedidos (ventas y pedidos a 7 días, como la consola). Se sobrescribe: Amazon corrige las ventas
--                             atribuidas durante unos 14 días, así que cada pasada vuelve a leer los últimos 14 y los pisa. La primera vez trae 60 días. Se conservan 90.
--   · ads_sincronizacion      por cuenta, en qué punto está la lectura: en reposo, o esperando a que Amazon termine un informe (se guardan sus identificadores y se pregunta en la pasada
--                             siguiente: el proceso nunca se queda esperando), cuándo se terminó la última y el error si lo hubo.
--
-- Nada de esto lo lee el navegador: RLS encendida y SIN políticas de escritura. Solo entra el servidor con la llave de servicio, y la lectura es solo para administradores.
--
-- Además deja el reloj del proceso en `cron_config` (cada 2 minutos: es la cadencia con la que se recogen los informes pendientes; cada cuánto se EMPIEZA una lectura nueva —3 horas— está en el código).
-- Se puede cambiar o apagar desde Amazon API · Sistema.
--
-- El código funciona SIN esta migración: la pantalla dice que falta lanzarla. Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Hacen falta la 148 (`ads_profiles`) y la 137 (`cron_config`).

DO $$
BEGIN
  IF to_regclass('public.ads_profiles') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_profiles: lanza antes 148_ads_api.sql.';
  END IF;
  IF to_regclass('public.cron_config') IS NULL THEN
    RAISE EXCEPTION 'Falta public.cron_config: lanza antes la migración de los procesos automáticos (137).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ads_rendimiento_diario (
  perfil_id   UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  campaign_id TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  impresiones INTEGER NOT NULL DEFAULT 0,
  clics       INTEGER NOT NULL DEFAULT 0,
  gasto       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ventas      NUMERIC(12,2) NOT NULL DEFAULT 0,
  pedidos     INTEGER NOT NULL DEFAULT 0,
  unidades    INTEGER NOT NULL DEFAULT 0,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (perfil_id, fecha, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_ads_rendimiento_perfil_fecha ON public.ads_rendimiento_diario (perfil_id, fecha DESC);

CREATE TABLE IF NOT EXISTS public.ads_sincronizacion (
  perfil_id UUID PRIMARY KEY REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  -- reposo = nada en curso · esperando = hay informes pedidos a Amazon que todavía no están listos
  estado    TEXT NOT NULL DEFAULT 'reposo' CHECK (estado IN ('reposo', 'esperando')),
  -- [{ "id": "…", "desde": "2026-10-28", "hasta": "2026-11-10" }] mientras se espera
  informes  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Cuándo se pidieron los informes o, si falló, cuándo fue el último intento (para no reintentar cada minuto)
  pedido_at    TIMESTAMPTZ,
  ultimo_ok_at TIMESTAMPTZ,
  datos_desde  DATE,
  datos_hasta  DATE,
  error     TEXT,
  intentos  INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ads_rendimiento_diario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_sincronizacion     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ads_rendimiento_diario', 'ads_sincronizacion'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_lectura_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_erp_admin(auth.uid()))', t || '_lectura_admin', t);
    END IF;
  END LOOP;
END $$;

-- El reloj del proceso (cada 2 minutos recoge los informes pendientes; una lectura nueva por cuenta empieza cada 3 horas)
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('ads-rendimiento', 2, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = EXCLUDED.cada_minutos,
      activo = EXCLUDED.activo,
      actualizado_at = NOW();

-- Comprobación: tiene que salir UNA fila con las tres cosas en `true`
SELECT
  (SELECT count(*) = 2 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('ads_rendimiento_diario', 'ads_sincronizacion') AND c.relrowsecurity) AS dos_tablas_con_rls,
  (SELECT count(*) = 2 FROM pg_policies WHERE policyname IN ('ads_rendimiento_diario_lectura_admin', 'ads_sincronizacion_lectura_admin')) AS dos_politicas_de_lectura,
  EXISTS (SELECT 1 FROM public.cron_config WHERE tarea = 'ads-rendimiento') AS reloj_puesto;
