-- ============================================================================
-- 315 · PPC: EL AGENTE (modo «agente»: vigila el gasto de hoy, decide y aplica solo, mide lo que hace y avisa)
-- ============================================================================
-- 15 nov 2026. Sobre el motor del SOP (292, 294, 295, 298, 305, 311).
--
--   · ads_motor_config     modo «agente» (lo enciende un administrador desde Marketing Test → Agente).
--   · ads_propuestas       tipo «pausar-campana»; estado «ensayada»; origen (motor | agente); retenida_*; ia_*; agente_at.
--   · ads_cambios_log      origen «agente».
--   · ads_productos        marca y fase_agente (las pone una persona).
--   · ads_agente           estado por cuenta (ensayo / activo / frenado), rampa, topes, techo congelado, ritmo, presión del día, reserva de la cuenta y sellos.
--   · ads_agente_interruptor  interruptor general de emergencia (una fila).
--   · ads_presupuesto_dia  uso del presupuesto de cada campaña: UNA fila por campaña y día local (35 días).
--   · ads_gasto_hora       gasto acumulado de la cuenta por hora local (curva del día, 35 días).
--   · ads_agente_stock_cero   lecturas de stock 0 por ASIN (para exigir dos seguidas).
--   · ads_agente_objetivos ACoS objetivo AUTOMÁTICO congelado de los productos sin uno humano.
--   · ads_agente_posturas  crecer / mantener / recortar por producto.
--   · ads_terminos_ia      clasificación de cada término por la IA (caduca a los 180 días).
--   · ads_terminos_semana  histórico semanal agregado de los términos (26 semanas).
--   · ads_efectos          antes / después (con control y ventas totales) y veredicto de cada cambio aplicado.
--   · ads_agente_ia        cada llamada a la IA con sus tokens y su coste.
--   · ads_agente_eventos   línea de tiempo del agente.
--
-- El código funciona SIN esta migración: la pestaña «Agente» dice que falta lanzarla y nada se enciende.
-- RLS encendida y SIN políticas de escritura: solo el servidor (llave de servicio); lectura solo administradores. IDEMPOTENTE.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ads_motor_config') IS NULL OR to_regclass('public.ads_propuestas') IS NULL OR to_regclass('public.ads_objetivos_diario') IS NULL
     OR to_regclass('public.ads_cambios_log') IS NULL OR to_regclass('public.ads_productos') IS NULL THEN
    RAISE EXCEPTION 'Faltan las tablas del motor: lanza antes 292, 293, 294 y 298.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ads_motor_config' AND column_name = 'umbrales') THEN
    RAISE EXCEPTION 'Falta la migración 305 (umbrales del motor): lánzala antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ads_cambios_log' AND column_name = 'propuesta_id') THEN
    RAISE EXCEPTION 'Falta la migración 311 (log auditable): lánzala antes.';
  END IF;
END $$;

-- 1) El modo «agente»
ALTER TABLE public.ads_motor_config DROP CONSTRAINT IF EXISTS ads_motor_config_modo_check;
ALTER TABLE public.ads_motor_config ADD CONSTRAINT ads_motor_config_modo_check
  CHECK (modo IN ('apagado', 'sugiere', 'aprueba', 'autopiloto', 'agente'));

-- 2) Propuestas
ALTER TABLE public.ads_propuestas DROP CONSTRAINT IF EXISTS ads_propuestas_tipo_check;
ALTER TABLE public.ads_propuestas ADD CONSTRAINT ads_propuestas_tipo_check
  CHECK (tipo IN ('negativizar', 'promover', 'puja', 'presupuesto', 'pausar', 'pausar-campana'));

ALTER TABLE public.ads_propuestas DROP CONSTRAINT IF EXISTS ads_propuestas_estado_check;
ALTER TABLE public.ads_propuestas ADD CONSTRAINT ads_propuestas_estado_check
  CHECK (estado IN ('pendiente', 'aprobada', 'aplicando', 'aplicada', 'descartada', 'deshecha', 'error', 'caducada', 'obsoleta', 'ensayada'));

ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'motor';
ALTER TABLE public.ads_propuestas DROP CONSTRAINT IF EXISTS ads_propuestas_origen_check;
ALTER TABLE public.ads_propuestas ADD CONSTRAINT ads_propuestas_origen_check CHECK (origen IN ('motor', 'agente'));
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS retenida_motivo TEXT;
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS retenida_at TIMESTAMPTZ;
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS ia_decision TEXT;
ALTER TABLE public.ads_propuestas DROP CONSTRAINT IF EXISTS ads_propuestas_ia_decision_check;
ALTER TABLE public.ads_propuestas ADD CONSTRAINT ads_propuestas_ia_decision_check CHECK (ia_decision IS NULL OR ia_decision IN ('aplicar', 'retener'));
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS ia_motivo TEXT;
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS ia_at TIMESTAMPTZ;
-- Cuándo la aplicó o ENSAYÓ el agente (topes del día). Una ensayada lleva además resuelta_at = now(): cuenta para las cuarentenas.
ALTER TABLE public.ads_propuestas ADD COLUMN IF NOT EXISTS agente_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ads_propuestas_agente_hoy ON public.ads_propuestas (perfil_id, agente_at DESC) WHERE agente_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ads_propuestas_pendientes_libres ON public.ads_propuestas (perfil_id) WHERE estado = 'pendiente' AND retenida_at IS NULL;

-- 3) Log: origen «agente»
ALTER TABLE public.ads_cambios_log DROP CONSTRAINT IF EXISTS ads_cambios_log_origen_check;
ALTER TABLE public.ads_cambios_log ADD CONSTRAINT ads_cambios_log_origen_check
  CHECK (origen IN ('estructura', 'automatico', 'manual', 'ensayo', 'agente'));
CREATE INDEX IF NOT EXISTS idx_ads_log_agente ON public.ads_cambios_log (perfil_id, creado_at DESC) WHERE origen = 'agente';

-- 4) Producto: marca y fase (las pone una persona; NULL = automático)
ALTER TABLE public.ads_productos ADD COLUMN IF NOT EXISTS marca TEXT;
ALTER TABLE public.ads_productos ADD COLUMN IF NOT EXISTS fase_agente TEXT;
ALTER TABLE public.ads_productos DROP CONSTRAINT IF EXISTS ads_productos_fase_agente_check;
ALTER TABLE public.ads_productos ADD CONSTRAINT ads_productos_fase_agente_check CHECK (fase_agente IS NULL OR fase_agente IN ('lanzamiento', 'normal'));

-- 5) El agente de cada cuenta
CREATE TABLE IF NOT EXISTS public.ads_agente (
  perfil_id UUID PRIMARY KEY REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'apagado' CHECK (estado IN ('apagado', 'ensayo', 'activo', 'frenado')),
  encendido_at TIMESTAMPTZ,
  encendido_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ensayo_hasta TIMESTAMPTZ,
  activo_desde TIMESTAMPTZ,
  rampa_desde TIMESTAMPTZ,
  frenado_at TIMESTAMPTZ,
  freno_motivo TEXT CHECK (freno_motivo IS NULL OR freno_motivo IN ('gasto_disparado', 'acos_cuenta', 'errores_amazon', 'datos_viejos', 'ventas_caidas', 'manual')),
  freno_detalle TEXT,
  ignorar_freno_motivo TEXT,
  ignorar_freno_hasta TIMESTAMPTZ,
  acos7_inicio NUMERIC(6,2),
  topes JSONB NOT NULL DEFAULT '{}'::jsonb,
  tope_ia_usd_mes NUMERIC(8,2) NOT NULL DEFAULT 2 CHECK (tope_ia_usd_mes >= 0 AND tope_ia_usd_mes <= 100),
  puja_max NUMERIC(8,2) CHECK (puja_max IS NULL OR (puja_max > 0 AND puja_max <= 100)),
  pico_eventos BOOLEAN NOT NULL DEFAULT FALSE,
  eventos_manuales JSONB NOT NULL DEFAULT '[]'::jsonb,
  presion JSONB NOT NULL DEFAULT '{}'::jsonb,
  presion_fecha DATE,
  ritmo TEXT NOT NULL DEFAULT 'normal' CHECK (ritmo IN ('recorte', 'normal', 'crecer')),
  ritmo_fecha DATE,
  ritmo_cambiado_at TIMESTAMPTZ,
  ritmo_mes_anterior TEXT CHECK (ritmo_mes_anterior IS NULL OR ritmo_mes_anterior IN ('recorte', 'normal', 'crecer')),
  -- El día (local) en que ENTRÓ en recorte y el presupuesto de cada campaña ese día ({campaignId: presupuesto}): R1 no sube por encima tras salir del recorte
  recorte_desde DATE,
  recorte_presupuestos JSONB NOT NULL DEFAULT '{}'::jsonb,
  techo_mensual NUMERIC(12,2),
  techo_automatico BOOLEAN NOT NULL DEFAULT FALSE,
  techo_congelado_at TIMESTAMPTZ,
  suma_presupuestos_inicio NUMERIC(12,2),
  uso_error TEXT,
  uso_error_at TIMESTAMPTZ,
  primera_escritura_at TIMESTAMPTZ,
  raras_sin_ia INTEGER NOT NULL DEFAULT 0,
  pensar_ya BOOLEAN NOT NULL DEFAULT FALSE,
  trabajando_hasta TIMESTAMPTZ,
  vigilar_at TIMESTAMPTZ,
  -- El último vigilar que TERMINÓ bien (con el freno ya evaluado) y los vigilar fallidos seguidos: sin un vigilar bueno reciente no se aplica nada
  vigilar_ok_at TIMESTAMPTZ,
  vigilar_fallos INTEGER NOT NULL DEFAULT 0,
  aplicar_at TIMESTAMPTZ,
  cerebro_at TIMESTAMPTZ,
  cerebro_tarde_dia DATE,
  resumen_dia DATE,
  efectos_dia DATE,
  efectos_resto BOOLEAN NOT NULL DEFAULT FALSE,
  objetivos_dia DATE,
  terminos_semana DATE,
  limpieza_dia DATE,
  calibrado_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6) El interruptor general (una sola fila)
CREATE TABLE IF NOT EXISTS public.ads_agente_interruptor (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  parado BOOLEAN NOT NULL DEFAULT FALSE,
  motivo TEXT,
  por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cambiado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.ads_agente_interruptor (id, parado) VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING;

-- 7) Uso del presupuesto: UNA fila por campaña y día local (upsert en cada lectura)
CREATE TABLE IF NOT EXISTS public.ads_presupuesto_dia (
  perfil_id   UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  fecha_local DATE NOT NULL,
  presupuesto NUMERIC(12,2),
  presupuesto_primera NUMERIC(12,2),
  uso_pct NUMERIC(7,2),
  uso_max_pct NUMERIC(7,2),
  gasto_estimado NUMERIC(12,2),
  agotada_min SMALLINT CHECK (agotada_min IS NULL OR agotada_min BETWEEN 0 AND 1439),
  agotada_por_estado BOOLEAN NOT NULL DEFAULT FALSE,
  estado_campana TEXT,
  fuente TEXT NOT NULL DEFAULT 'api' CHECK (fuente IN ('api', 'estado')),
  leido_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (perfil_id, campaign_id, fecha_local)
);
CREATE INDEX IF NOT EXISTS idx_ads_presupuesto_dia_fecha ON public.ads_presupuesto_dia (perfil_id, fecha_local);

-- 8) Gasto acumulado de la cuenta por hora local (la curva del día para proyectar)
CREATE TABLE IF NOT EXISTS public.ads_gasto_hora (
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  fecha_local DATE NOT NULL,
  hora SMALLINT NOT NULL CHECK (hora BETWEEN 0 AND 23),
  gasto_acum NUMERIC(12,2) NOT NULL DEFAULT 0,
  suma_presupuestos NUMERIC(12,2),
  leido_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (perfil_id, fecha_local, hora)
);

-- 9) Lecturas de stock 0 (dos seguidas, separadas ≥ 6 h, antes de pausar)
CREATE TABLE IF NOT EXISTS public.ads_agente_stock_cero (
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  primera_at TIMESTAMPTZ NOT NULL,
  ultima_at TIMESTAMPTZ NOT NULL,
  lecturas INTEGER NOT NULL DEFAULT 1,
  fuente TEXT,
  PRIMARY KEY (perfil_id, asin)
);

-- 10) ACoS objetivo automático (CONGELADO; revisión mensual)
CREATE TABLE IF NOT EXISTS public.ads_agente_objetivos (
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  acos_objetivo_pct NUMERIC(5,2) NOT NULL CHECK (acos_objetivo_pct > 0 AND acos_objetivo_pct <= 100),
  fuente TEXT NOT NULL CHECK (fuente IN ('equilibrio', 'acos_real', 'tacos')),
  solo_defensivo BOOLEAN NOT NULL DEFAULT TRUE,
  detalle TEXT,
  congelado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revisado_mes TEXT,
  calculado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (perfil_id, asin)
);

-- 11) Postura por producto
CREATE TABLE IF NOT EXISTS public.ads_agente_posturas (
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  postura TEXT NOT NULL CHECK (postura IN ('crecer', 'mantener', 'recortar')),
  fuente TEXT NOT NULL CHECK (fuente IN ('ia', 'reglas', 'ritmo', 'stock')),
  motivo TEXT,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (perfil_id, asin)
);

-- 12) Términos clasificados por la IA (caducan a los 180 días o si cambia el título del producto)
CREATE TABLE IF NOT EXISTS public.ads_terminos_ia (
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  termino TEXT NOT NULL,
  etiqueta TEXT NOT NULL CHECK (etiqueta IN ('relevante', 'otro_producto', 'marca_ajena', 'intencion_mala', 'dudoso')),
  confianza NUMERIC(3,2) NOT NULL CHECK (confianza >= 0 AND confianza <= 1),
  razon TEXT,
  modelo TEXT,
  titulo_hash TEXT,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  caduca_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '180 days'),
  PRIMARY KEY (perfil_id, asin, termino)
);

-- 13) Histórico semanal AGREGADO de términos (por campaña y término; los grupos se suman)
CREATE TABLE IF NOT EXISTS public.ads_terminos_semana (
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  semana DATE NOT NULL,
  campaign_id TEXT NOT NULL,
  termino TEXT NOT NULL,
  clics INTEGER NOT NULL DEFAULT 0,
  gasto NUMERIC(12,2) NOT NULL DEFAULT 0,
  ventas NUMERIC(12,2) NOT NULL DEFAULT 0,
  pedidos INTEGER NOT NULL DEFAULT 0,
  desde DATE,
  hasta DATE,
  PRIMARY KEY (perfil_id, semana, campaign_id, termino)
);

-- 14) Efectos de cada cambio aplicado
CREATE TABLE IF NOT EXISTS public.ads_efectos (
  propuesta_id UUID PRIMARY KEY REFERENCES public.ads_propuestas(id) ON DELETE CASCADE,
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  clase TEXT NOT NULL CHECK (clase IN ('negativizar', 'promover', 'puja_subir', 'puja_bajar', 'puja_bajar_sin_pedidos', 'pausar', 'presupuesto_subir', 'presupuesto_bajar', 'pausar_campana')),
  asin TEXT,
  campaign_id TEXT,
  objetivo_id TEXT,
  aplicada_dia DATE NOT NULL,
  acos_objetivo_pct NUMERIC(5,2),
  cvr NUMERIC(6,4),
  fase TEXT,
  rara_aplicada BOOLEAN NOT NULL DEFAULT FALSE,
  antes JSONB,
  rapida JSONB,
  provisional JSONB,
  despues JSONB,
  control_antes JSONB,
  control_despues JSONB,
  ventas_totales JSONB,
  veredicto TEXT CHECK (veredicto IS NULL OR veredicto IN ('mejoro', 'empeoro', 'neutro', 'sin_muestra', 'mezclado')),
  detalle TEXT,
  rapida_at TIMESTAMPTZ,
  revisado_7d_at TIMESTAMPTZ,
  medido_at TIMESTAMPTZ,
  deshecho_auto BOOLEAN NOT NULL DEFAULT FALSE,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ads_efectos_pendientes ON public.ads_efectos (perfil_id, aplicada_dia) WHERE medido_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ads_efectos_abiertos ON public.ads_efectos (perfil_id, objetivo_id, campaign_id) WHERE revisado_7d_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ads_efectos_veredicto ON public.ads_efectos (perfil_id, clase, medido_at DESC) WHERE veredicto IS NOT NULL;

-- 15) Llamadas a la IA
CREATE TABLE IF NOT EXISTS public.ads_agente_ia (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo TEXT NOT NULL DEFAULT 'cerebro' CHECK (tipo IN ('cerebro')),
  modelo TEXT,
  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_cache INTEGER NOT NULL DEFAULT 0,
  tokens_salida INTEGER NOT NULL DEFAULT 0,
  coste_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT,
  salida JSONB
);
CREATE INDEX IF NOT EXISTS idx_ads_agente_ia_mes ON public.ads_agente_ia (perfil_id, creado_at DESC);

-- 16) Línea de tiempo del agente
CREATE TABLE IF NOT EXISTS public.ads_agente_eventos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  detalle TEXT,
  datos JSONB,
  propuesta_id UUID REFERENCES public.ads_propuestas(id) ON DELETE SET NULL
);
ALTER TABLE public.ads_agente_eventos DROP CONSTRAINT IF EXISTS ads_agente_eventos_tipo_check;
ALTER TABLE public.ads_agente_eventos ADD CONSTRAINT ads_agente_eventos_tipo_check CHECK (tipo IN (
  'encendido', 'apagado', 'ensayo_saltado', 'ensayo_fin', 'veda', 'rampa', 'freno', 'reanudado', 'reanudar_rechazado', 'deshacer_freno',
  'postura', 'objetivo_auto', 'objetivo_revisado', 'techo_auto', 'ritmo', 'agotada_top', 'mover_presupuesto', 'deshacer_auto', 'deshacer_fallo',
  'calibracion', 'ia_fallo', 'ia_tope', 'stock', 'stock_vuelve', 'stock_fallo', 'uso_error', 'primera_escritura', 'parada_general', 'topes', 'producto', 'temporada'));
CREATE INDEX IF NOT EXISTS idx_ads_agente_eventos ON public.ads_agente_eventos (perfil_id, creado_at DESC);

-- 17) RLS: cerradas al navegador; lectura solo administradores
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ads_agente', 'ads_agente_interruptor', 'ads_presupuesto_dia', 'ads_gasto_hora', 'ads_agente_stock_cero', 'ads_agente_objetivos', 'ads_agente_posturas', 'ads_terminos_ia', 'ads_terminos_semana', 'ads_efectos', 'ads_agente_ia', 'ads_agente_eventos'] LOOP
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
  (SELECT pg_get_constraintdef(oid) LIKE '%agente%' FROM pg_constraint WHERE conname = 'ads_motor_config_modo_check' AND conrelid = 'public.ads_motor_config'::regclass) AS modo_agente,
  (SELECT pg_get_constraintdef(oid) LIKE '%pausar-campana%' FROM pg_constraint WHERE conname = 'ads_propuestas_tipo_check' AND conrelid = 'public.ads_propuestas'::regclass) AS tipo_pausar_campana,
  (SELECT pg_get_constraintdef(oid) LIKE '%ensayada%' FROM pg_constraint WHERE conname = 'ads_propuestas_estado_check' AND conrelid = 'public.ads_propuestas'::regclass) AS estado_ensayada,
  (SELECT count(*) = 7 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ads_propuestas'
     AND column_name IN ('origen', 'retenida_motivo', 'retenida_at', 'ia_decision', 'ia_motivo', 'ia_at', 'agente_at')) AS columnas_de_propuestas,
  (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ads_productos' AND column_name IN ('marca', 'fase_agente')) AS producto_marca_y_fase,
  (SELECT pg_get_constraintdef(oid) LIKE '%agente%' FROM pg_constraint WHERE conname = 'ads_cambios_log_origen_check' AND conrelid = 'public.ads_cambios_log'::regclass) AS log_origen_agente,
  (SELECT count(*) = 12 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity
     AND c.relname IN ('ads_agente', 'ads_agente_interruptor', 'ads_presupuesto_dia', 'ads_gasto_hora', 'ads_agente_stock_cero', 'ads_agente_objetivos', 'ads_agente_posturas', 'ads_terminos_ia', 'ads_terminos_semana', 'ads_efectos', 'ads_agente_ia', 'ads_agente_eventos')) AS doce_tablas_con_rls,
  (SELECT count(*) = 1 FROM public.ads_agente_interruptor) AS interruptor_listo;
