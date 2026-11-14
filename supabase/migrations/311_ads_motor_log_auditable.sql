-- ============================================================================
-- 311 · PPC: EL MOTOR APLICA UNA SOLA VEZ, GENERA AUNQUE EL INFORME LO RECOJA OTRO, ENSAYA SIN ESCRIBIR Y DEJA UN LOG QUE SE PUEDE AUDITAR
-- ============================================================================
-- 14 nov 2026. Revisión del motor de «PPC · Amazon Ads» antes de encenderlo en un cliente (nunca ha escrito en Amazon).
--
--   · ads_propuestas      dos estados nuevos:
--                           «aplicando»  la propuesta está RECLAMADA por quien la aplica (UPDATE … WHERE estado IN ('pendiente','error') RETURNING): dos clics,
--                                        dos personas o el autopiloto más una persona ya no pueden aplicar la misma dos veces.
--                           «obsoleta»   la puja o el presupuesto de Amazon ya no es el que tenía la propuesta (alguien lo cambió): no se pisa.
--   · ads_terminos_sync   generado_at: cuándo se generaron las propuestas por última vez. Se generan cuando ultimo_ok_at (el informe de términos) es más
--                         nuevo, lo haya recogido quien lo haya recogido.
--   · ads_cambios_log     el log auditable: propuesta_id, entidad_id (keywordId, targetId, campaignId…), la petición y la respuesta de Amazon (jsonb),
--                         el código HTTP y el request id. El origen admite «ensayo» (se recorre el camino de aplicar sin escribir en Amazon).
--                         Índices para la pantalla del log (paginación por cursor y filtro por campaña).
--
-- El código funciona SIN esta migración (lo de antes: estados de reserva «aprobada», generar al recoger y el log sin las columnas nuevas).
-- Las tablas siguen cerradas al navegador (RLS sin políticas de escritura): todo pasa por el servidor. Se puede lanzar dos veces.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ads_propuestas') IS NULL OR to_regclass('public.ads_cambios_log') IS NULL OR to_regclass('public.ads_terminos_sync') IS NULL THEN
    RAISE EXCEPTION 'Faltan las tablas del motor: lanza antes 292_ads_cuenta_ficha_productos_estructura_log.sql y 294_ads_motor.sql.';
  END IF;
END $$;

-- 1) Los estados de una propuesta
ALTER TABLE public.ads_propuestas DROP CONSTRAINT IF EXISTS ads_propuestas_estado_check;
ALTER TABLE public.ads_propuestas ADD CONSTRAINT ads_propuestas_estado_check
  CHECK (estado IN ('pendiente', 'aprobada', 'aplicando', 'aplicada', 'descartada', 'deshecha', 'error', 'caducada', 'obsoleta'));

-- 2) Cuándo se generaron las propuestas de cada cuenta
ALTER TABLE public.ads_terminos_sync ADD COLUMN IF NOT EXISTS generado_at TIMESTAMPTZ;

-- 3) El log auditable
ALTER TABLE public.ads_cambios_log ADD COLUMN IF NOT EXISTS propuesta_id UUID REFERENCES public.ads_propuestas(id) ON DELETE SET NULL;
ALTER TABLE public.ads_cambios_log ADD COLUMN IF NOT EXISTS entidad_id   TEXT;
ALTER TABLE public.ads_cambios_log ADD COLUMN IF NOT EXISTS peticion     JSONB;
ALTER TABLE public.ads_cambios_log ADD COLUMN IF NOT EXISTS respuesta    JSONB;
ALTER TABLE public.ads_cambios_log ADD COLUMN IF NOT EXISTS http_status  INTEGER;
ALTER TABLE public.ads_cambios_log ADD COLUMN IF NOT EXISTS request_id   TEXT;

ALTER TABLE public.ads_cambios_log DROP CONSTRAINT IF EXISTS ads_cambios_log_origen_check;
ALTER TABLE public.ads_cambios_log ADD CONSTRAINT ads_cambios_log_origen_check
  CHECK (origen IN ('estructura', 'automatico', 'manual', 'ensayo'));

-- La pantalla pagina por (creado_at, id) y filtra por campaña y por propuesta
CREATE INDEX IF NOT EXISTS idx_ads_log_perfil_fecha_id ON public.ads_cambios_log (perfil_id, creado_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ads_log_campana ON public.ads_cambios_log (perfil_id, campaign_id, creado_at DESC) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ads_log_propuesta ON public.ads_cambios_log (propuesta_id) WHERE propuesta_id IS NOT NULL;

-- ============================================================================
-- COMPROBACIÓN · las cinco columnas tienen que decir «true»
-- ============================================================================
SELECT
  (SELECT pg_get_constraintdef(oid) LIKE '%aplicando%' AND pg_get_constraintdef(oid) LIKE '%obsoleta%' FROM pg_constraint
     WHERE conname = 'ads_propuestas_estado_check' AND conrelid = 'public.ads_propuestas'::regclass) AS estados_nuevos,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ads_terminos_sync' AND column_name = 'generado_at') AS generado_at,
  (SELECT count(*) = 6 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ads_cambios_log'
     AND column_name IN ('propuesta_id', 'entidad_id', 'peticion', 'respuesta', 'http_status', 'request_id')) AS log_auditable,
  (SELECT pg_get_constraintdef(oid) LIKE '%ensayo%' FROM pg_constraint
     WHERE conname = 'ads_cambios_log_origen_check' AND conrelid = 'public.ads_cambios_log'::regclass) AS origen_ensayo,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'ads_cambios_log') AS log_cerrado_al_navegador;
