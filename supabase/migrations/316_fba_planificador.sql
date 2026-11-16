-- ============================================================================
-- 316 · REMESAS A FBA: PLANIFICADOR DE REPOSICIÓN Y ENVÍOS PROPUESTOS
-- ============================================================================
--
-- 1) fba_reposicion_config: ajustes de reposición por cliente (tabla PROPIA: no toca fba_alertas_config,
--    así una fila de ajustes nunca se confunde con un plazo puesto a mano).
-- 2) fba_reposicion_sku: caja, exclusión y cobertura propias de una referencia.
-- 3) fba_plan_pasadas: la foto de cada día del planificador por cliente (UNA por cliente y día) +
--    la vista fba_plan_ultima (última pasada por cliente, SIN líneas).
-- 4) fba_envios_propuestos (+ historial): lo que hay que enviar, con su estado, responsable y fecha límite.
-- 5) fba_plan_ia: cada revisión de la IA con su coste.
-- 6) fba_remesas.envio_propuesto_id: la remesa que nació de un envío propuesto (como mucho una).
-- 7) fba_movimientos_diarios(): el libro agregado por SKU y día (solo lectura) para no paginar miles de filas.
--
-- Todo lo escribe el servidor con la clave de servicio: RLS activado y sin permisos para authenticated/anon
-- (como la 267). Los avisos usan el tipo 'fba_alerta' de la campana, que ya existe: no se toca el CHECK.
--
-- Se lanza en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- Al final sale una fila con comprobaciones: todas deben decir true.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='fba_alertas_config') THEN
    RAISE EXCEPTION 'Falta public.fba_alertas_config: lanza antes la migración 267 (y la 291).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fba_alertas_config' AND column_name='dias_preparacion') THEN
    RAISE EXCEPTION 'A fba_alertas_config le faltan las etapas: lanza antes la migración 291.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Ajustes de reposición del cliente (tabla propia; sin fila = valores de partida o medidos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fba_reposicion_config (
  client_id                 UUID PRIMARY KEY REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  cobertura_objetivo_dias   INTEGER CHECK (cobertura_objetivo_dias IS NULL OR cobertura_objetivo_dias BETWEEN 7 AND 180),
  cobertura_max_dias        INTEGER CHECK (cobertura_max_dias IS NULL OR cobertura_max_dias BETWEEN 14 AND 365),
  multiplo_caja             INTEGER CHECK (multiplo_caja IS NULL OR multiplo_caja BETWEEN 1 AND 500),
  min_unidades_linea        INTEGER CHECK (min_unidades_linea IS NULL OR min_unidades_linea BETWEEN 1 AND 500),
  min_unidades_envio        INTEGER CHECK (min_unidades_envio IS NULL OR min_unidades_envio BETWEEN 1 AND 10000),
  ventana_agrupacion_dias   INTEGER CHECK (ventana_agrupacion_dias IS NULL OR ventana_agrupacion_dias BETWEEN 0 AND 30),
  capacidad_unidades        INTEGER CHECK (capacidad_unidades IS NULL OR capacidad_unidades BETWEEN 1 AND 10000000),
  tope_estacional           NUMERIC(4,2) CHECK (tope_estacional IS NULL OR tope_estacional BETWEEN 1 AND 8),
  -- «MM-DD»: lo que llegue a la venta después de este día se planifica con el perfil de enero (p. ej. '12-18')
  campana_hasta             TEXT CHECK (campana_hasta IS NULL OR campana_hasta ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  transporte_urgente_dias   INTEGER CHECK (transporte_urgente_dias IS NULL OR transporte_urgente_dias BETWEEN 1 AND 60),
  planificador_activo       BOOLEAN NOT NULL DEFAULT true,
  avisar_chat               BOOLEAN NOT NULL DEFAULT true,
  actualizado_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT fba_reposicion_config_cobertura_check CHECK (
    cobertura_max_dias IS NULL OR cobertura_objetivo_dias IS NULL OR cobertura_max_dias >= cobertura_objetivo_dias)
);
COMMENT ON TABLE public.fba_reposicion_config IS 'Ajustes del planificador de reposición FBA por cliente. NULL = medido o de partida (ver lib/fba/ajustes-reposicion.ts). No dice nada del plazo: eso sigue en fba_alertas_config.';

-- ---------------------------------------------------------------------------
-- 2) Ajustes por referencia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fba_reposicion_sku (
  client_id         UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  sku               TEXT NOT NULL,
  unidades_caja     INTEGER CHECK (unidades_caja IS NULL OR unidades_caja BETWEEN 1 AND 500),
  cobertura_dias    INTEGER CHECK (cobertura_dias IS NULL OR cobertura_dias BETWEEN 7 AND 180),
  excluir           BOOLEAN NOT NULL DEFAULT false,
  motivo            TEXT,
  actualizado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (client_id, sku)
);
COMMENT ON TABLE public.fba_reposicion_sku IS 'Caja, cobertura y exclusión de una referencia para el planificador de reposición FBA.';

-- ---------------------------------------------------------------------------
-- 3) Pasadas del planificador: UNA por cliente y día (un recálculo manual sustituye la del día)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fba_plan_pasadas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  connection_id UUID,
  hoy           DATE NOT NULL,
  calculado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origen        TEXT NOT NULL DEFAULT 'cron' CHECK (origen IN ('cron', 'manual')),
  -- Los clientes que no caben en el presupuesto NO escriben fila (la calidad lo dice por calculado_at)
  estado        TEXT NOT NULL CHECK (estado IN ('ok', 'provisional', 'sin_datos', 'error')),
  error         TEXT,
  hash          TEXT,
  -- La IA revisa después del cálculo, fuera del bucle: true = falta revisar este plan
  ia_pendiente  BOOLEAN NOT NULL DEFAULT false,
  plazo         JSONB NOT NULL DEFAULT '{}'::jsonb,
  calidad       JSONB NOT NULL DEFAULT '{}'::jsonb,
  resumen       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Todas las líneas. Solo se conservan 7 días: la pasada vacía las más viejas y deja resumen y calidad
  lineas        JSONB NOT NULL DEFAULT '[]'::jsonb,
  duracion_ms   INTEGER
);
ALTER TABLE public.fba_plan_pasadas ADD COLUMN IF NOT EXISTS connection_id UUID;
ALTER TABLE public.fba_plan_pasadas ADD COLUMN IF NOT EXISTS ia_pendiente BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS fba_plan_pasadas_cliente_dia ON public.fba_plan_pasadas (client_id, hoy);
CREATE INDEX IF NOT EXISTS idx_fba_plan_pasadas_cliente ON public.fba_plan_pasadas (client_id, calculado_at DESC);
CREATE INDEX IF NOT EXISTS idx_fba_plan_pasadas_ia ON public.fba_plan_pasadas (calculado_at) WHERE ia_pendiente;
COMMENT ON TABLE public.fba_plan_pasadas IS 'Una foto por cliente y día del planificador de reposición FBA. 60 días de resumen; líneas solo 7 días.';

-- La última pasada de cada cliente, SIN líneas (para el resumen global y la salud).
-- DROP antes: CREATE OR REPLACE VIEW falla si una versión anterior tenía otras columnas (nadie depende de la vista).
DROP VIEW IF EXISTS public.fba_plan_ultima;
CREATE OR REPLACE VIEW public.fba_plan_ultima WITH (security_invoker = true) AS
  SELECT DISTINCT ON (client_id) id, client_id, connection_id, hoy, calculado_at, estado, resumen, calidad, hash, ia_pendiente
  FROM public.fba_plan_pasadas
  ORDER BY client_id, calculado_at DESC;

-- ---------------------------------------------------------------------------
-- 4) Envíos propuestos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fba_envios_propuestos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  connection_id         UUID,
  -- env:<cliente>:<conexión>:<año>-W<semana de salida>. Única solo entre los ACTIVOS (índice parcial abajo)
  clave                 TEXT NOT NULL,
  estado                TEXT NOT NULL DEFAULT 'nuevo'
                          CHECK (estado IN ('nuevo','hablado','esperando_cliente','en_preparacion','enviado','descartado','caducado')),
  prioridad             TEXT NOT NULL
                          CHECK (prioridad IN ('tarde','urgente','esta_semana','proximas_2','este_mes','mas_adelante')),
  confianza             TEXT NOT NULL DEFAULT 'media' CHECK (confianza IN ('alta','media','baja','sin_datos')),
  provisional           BOOLEAN NOT NULL DEFAULT false,
  moneda                TEXT NOT NULL DEFAULT 'EUR',
  salir_antes_de        DATE NOT NULL,
  decidir_antes_de      DATE NOT NULL,
  a_la_venta            DATE,
  fecha_limite          DATE NOT NULL,
  responsable_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  unidades              INTEGER NOT NULL DEFAULT 0 CHECK (unidades >= 0),
  cajas_estimadas       INTEGER,
  euros_en_riesgo       NUMERIC,
  porque                JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- El plan de hoy (lo reescribe la pasada)
  lineas                JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Lo que se habló con el cliente (se congela al pasar a «hablado»)
  lineas_aceptadas      JSONB,
  -- La foto de la pasada anterior, para «qué ha cambiado desde ayer»
  cambios_desde_ayer    JSONB,
  plan_ya_no_lo_pide    BOOLEAN NOT NULL DEFAULT false,
  ajustes_aplicados     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ia                    JSONB,
  motivo_descarte       TEXT CHECK (motivo_descarte IS NULL OR motivo_descarte IN
                          ('cliente_sin_stock','cliente_no_quiere','ya_enviado_aparte','datos_erroneos','producto_cambia','descatalogada','otro')),
  nota                  TEXT,
  remesa_id             UUID REFERENCES public.fba_remesas(id) ON DELETE SET NULL,
  esperando_desde       DATE,
  pasada_id             UUID REFERENCES public.fba_plan_pasadas(id) ON DELETE SET NULL,
  -- Solo la suben las acciones de una persona (estado, responsable, fecha límite, nota, ajuste). El plan NUNCA.
  version               INTEGER NOT NULL DEFAULT 0,
  creado_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado_cambiado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado_cambiado_por   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Avisos ya mandados: solo se vuelve a avisar si la prioridad SUBE
  prioridad_avisada     TEXT,
  avisado_at            TIMESTAMPTZ,
  vencido_avisado_at    TIMESTAMPTZ
);
-- Por si una versión anterior de este SQL llegó a crear el UNIQUE de tabla
ALTER TABLE public.fba_envios_propuestos DROP CONSTRAINT IF EXISTS fba_envios_propuestos_client_id_clave_key;
ALTER TABLE public.fba_envios_propuestos ADD COLUMN IF NOT EXISTS connection_id UUID;
ALTER TABLE public.fba_envios_propuestos ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE public.fba_envios_propuestos ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.fba_envios_propuestos ADD COLUMN IF NOT EXISTS cambios_desde_ayer JSONB;
-- PostgREST no admite onConflict sobre un índice parcial: la reconciliación hace insert/update explícitos
-- y trata el 23505 como «otra pasada llegó antes» (vuelve a leer).
CREATE UNIQUE INDEX IF NOT EXISTS fba_envios_propuestos_clave_activa
  ON public.fba_envios_propuestos (client_id, clave)
  WHERE estado IN ('nuevo','hablado','esperando_cliente','en_preparacion');
CREATE INDEX IF NOT EXISTS idx_fba_envios_propuestos_activos
  ON public.fba_envios_propuestos (estado, fecha_limite) WHERE estado IN ('nuevo','hablado','esperando_cliente','en_preparacion');
CREATE INDEX IF NOT EXISTS idx_fba_envios_propuestos_cliente ON public.fba_envios_propuestos (client_id, estado);
CREATE INDEX IF NOT EXISTS idx_fba_envios_propuestos_remesa ON public.fba_envios_propuestos (remesa_id) WHERE remesa_id IS NOT NULL;
COMMENT ON TABLE public.fba_envios_propuestos IS 'Envíos a FBA que propone el planificador (qué, cuánto y antes de cuándo) y su gestión por el equipo.';

CREATE TABLE IF NOT EXISTS public.fba_envios_propuestos_historial (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_propuesto_id  UUID NOT NULL REFERENCES public.fba_envios_propuestos(id) ON DELETE CASCADE,
  cuando              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quien               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- crear, actualizar_plan (solo si cambian las unidades > 10 % o la prioridad), estado, responsable,
  -- fecha_limite, nota, convertir, ajuste_ia, caducar, remesa_borrada, desenlazar
  accion              TEXT NOT NULL,
  de                  TEXT,
  a                   TEXT,
  nota                TEXT,
  datos               JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_fba_envios_propuestos_historial ON public.fba_envios_propuestos_historial (envio_propuesto_id, cuando DESC);

-- ---------------------------------------------------------------------------
-- 5) Revisiones de la IA y su coste
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fba_plan_ia (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  pasada_id        UUID REFERENCES public.fba_plan_pasadas(id) ON DELETE SET NULL,
  origen           TEXT NOT NULL DEFAULT 'cron' CHECK (origen IN ('cron', 'manual')),
  pedido_por       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  hash_plan        TEXT,
  modelo           TEXT,
  tokens_entrada   INTEGER,
  tokens_salida    INTEGER,
  coste_usd        NUMERIC(10,6),
  respuesta        JSONB,
  ajustes_validos  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ajustes_rechazados JSONB NOT NULL DEFAULT '[]'::jsonb,
  aviso            TEXT,
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fba_plan_ia_cliente ON public.fba_plan_ia (client_id, creado_at DESC);

-- ---------------------------------------------------------------------------
-- 6) La remesa que nació de un envío propuesto (como mucho UNA por envío propuesto)
-- ---------------------------------------------------------------------------
ALTER TABLE public.fba_remesas
  ADD COLUMN IF NOT EXISTS envio_propuesto_id UUID REFERENCES public.fba_envios_propuestos(id) ON DELETE SET NULL;
DROP INDEX IF EXISTS public.idx_fba_remesas_envio_propuesto;
CREATE UNIQUE INDEX IF NOT EXISTS fba_remesas_envio_propuesto_unico
  ON public.fba_remesas (envio_propuesto_id) WHERE envio_propuesto_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7) El libro agregado por SKU y día (solo lectura; lo usan ritmo, ventas y estacionalidad)
-- ---------------------------------------------------------------------------
-- DROP antes: CREATE OR REPLACE FUNCTION no deja cambiar las columnas que devuelve si una versión anterior era distinta.
DROP FUNCTION IF EXISTS public.fba_movimientos_diarios(UUID, TEXT, DATE, DATE);
CREATE OR REPLACE FUNCTION public.fba_movimientos_diarios(
  p_conexion UUID, p_mercado TEXT, p_desde DATE, p_hasta DATE
) RETURNS TABLE (sku TEXT, fecha DATE, tipo TEXT, disposicion TEXT, cantidad BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT m.sku, m.fecha, m.tipo, m.disposicion, SUM(m.cantidad)::BIGINT
  FROM public.fba_movimientos m
  WHERE m.connection_id = p_conexion AND m.marketplace_id = p_mercado
    AND m.fecha BETWEEN p_desde AND p_hasta
  GROUP BY m.sku, m.fecha, m.tipo, m.disposicion
  ORDER BY m.fecha, m.sku
$$;
COMMENT ON FUNCTION public.fba_movimientos_diarios(UUID, TEXT, DATE, DATE) IS 'Libro FBA agregado por SKU, día, tipo y disposición. Solo lectura, solo para el servidor.';

-- ---------------------------------------------------------------------------
-- Seguridad: solo el servidor (clave de servicio)
-- ---------------------------------------------------------------------------
ALTER TABLE public.fba_reposicion_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_reposicion_sku               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_plan_pasadas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_envios_propuestos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_envios_propuestos_historial  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_plan_ia                      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fba_reposicion_config           FROM authenticated, anon;
REVOKE ALL ON public.fba_reposicion_sku              FROM authenticated, anon;
REVOKE ALL ON public.fba_plan_pasadas                FROM authenticated, anon;
REVOKE ALL ON public.fba_plan_ultima                 FROM authenticated, anon;
REVOKE ALL ON public.fba_envios_propuestos           FROM authenticated, anon;
REVOKE ALL ON public.fba_envios_propuestos_historial FROM authenticated, anon;
REVOKE ALL ON public.fba_plan_ia                     FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.fba_movimientos_diarios(UUID, TEXT, DATE, DATE) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.fba_movimientos_diarios(UUID, TEXT, DATE, DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- Comprobación: todas deben salir true
-- ---------------------------------------------------------------------------
SELECT
  to_regclass('public.fba_reposicion_config')            IS NOT NULL AS config_ok,
  to_regclass('public.fba_reposicion_sku')               IS NOT NULL AS sku_ok,
  to_regclass('public.fba_plan_pasadas')                 IS NOT NULL AS pasadas_ok,
  to_regclass('public.fba_plan_pasadas_cliente_dia')     IS NOT NULL AS pasada_por_dia_ok,
  to_regclass('public.fba_plan_ultima')                  IS NOT NULL AS vista_ultima_ok,
  to_regclass('public.fba_envios_propuestos')            IS NOT NULL AS envios_ok,
  to_regclass('public.fba_envios_propuestos_clave_activa') IS NOT NULL AS clave_activa_ok,
  to_regclass('public.fba_envios_propuestos_historial')  IS NOT NULL AS historial_ok,
  to_regclass('public.fba_plan_ia')                      IS NOT NULL AS ia_ok,
  to_regclass('public.fba_remesas_envio_propuesto_unico') IS NOT NULL AS remesa_unica_ok,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fba_envios_propuestos' AND column_name='version') AS version_ok,
  to_regprocedure('public.fba_movimientos_diarios(uuid, text, date, date)') IS NOT NULL AS funcion_diaria_ok,
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.fba_envios_propuestos'::regclass AND conname = 'fba_envios_propuestos_client_id_clave_key') AS sin_unique_viejo_ok;
