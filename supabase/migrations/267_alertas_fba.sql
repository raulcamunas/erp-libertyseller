-- ============================================================================
-- 267 · ALERTAS DE LOGÍSTICA FBA: ROTURA DE STOCK, ENVÍOS ATASCADOS, DESCUADRES Y STOCK PARADO
-- ============================================================================
--
-- Remesas a FBA ya calculaba la cobertura, la antigüedad y el estado de cada envío, pero había que entrar cliente por cliente a mirarlo. Esto añade
-- lo que faltaba: que el ERP AVISE. Una pasada diaria (cron `fba-alertas`) revisa cada cliente conectado y guarda lo que va mal; la pantalla
-- «Alertas FBA» lo enseña de todos los clientes a la vez y la campana avisa a la agencia de lo grave.
--
--   · `fba_alertas_config`      El plazo de reposición de cada cliente, A MANO: los días que pasan desde que se pide la mercancía hasta que está a la
--                               venta (producción + transporte + recepción en Amazon). Lo pone el equipo; el sistema no lo adivina. Sin fila, se usa un
--                               plazo de partida y la pantalla avisa de que está sin configurar.
--   · `fba_alertas_plazo_sku`   Un plazo distinto para una referencia concreta (la que se fabrica en otro sitio, o la que se envía por avión). Opcional.
--   · `fba_alertas`             Las alertas, con su estado (abierta, resuelta, silenciada). Una por (cliente, clave): la pasada diaria la crea, la
--                               actualiza mientras siga pasando y la da por resuelta cuando deja de pasar. Silenciar una la esconde hasta una fecha.
--   · `fba_alertas_estado`      Cuándo se calcularon por última vez las alertas de cada cliente y si falló (sin conexión, sin leer el libro…). Sirve
--                               para que la pasada diaria empiece por el que lleva más tiempo sin mirarse, y para que la pantalla lo diga.
--   · El tipo `fba_alerta` y `fba_resumen` en la campana (`notifications`).
--
-- TODO ESTO ES NUEVO: NO TOCA NI BORRA NADA QUE YA EXISTA (salvo ampliar la lista de tipos de `notifications`, conservando los de antes).
-- Las tablas están cerradas al navegador: se leen y escriben desde el servidor, que es quien comprueba qué cliente puede ver cada persona.
-- El código funciona SIN esta migración: la pantalla dice que falta lanzarla y nada más se rompe.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- Hace falta `amazon_clients`, `fba_remesas`, `notifications` (migración 251) y `cron_config`.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- El plazo de reposición de cada cliente, a mano
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fba_alertas_config (
  client_id              UUID PRIMARY KEY REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  -- Días desde que se pide la mercancía hasta que está a la venta en Amazon
  plazo_reposicion_dias  INTEGER NOT NULL DEFAULT 45 CHECK (plazo_reposicion_dias BETWEEN 1 AND 365),
  -- Días de antelación con los que se avisa de «reponer pronto», por encima del plazo
  antelacion_dias        INTEGER NOT NULL DEFAULT 14 CHECK (antelacion_dias BETWEEN 0 AND 120),
  -- false = se calculan y se ven las alertas de este cliente pero no suena la campana
  avisar                 BOOLEAN NOT NULL DEFAULT true,
  actualizado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por        UUID
);

COMMENT ON TABLE public.fba_alertas_config IS
  'Plazo de reposición (a mano) de cada cliente de Amazon y cómo se le avisa. Alertas FBA.';

CREATE TABLE IF NOT EXISTS public.fba_alertas_plazo_sku (
  client_id              UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  sku                    TEXT NOT NULL,
  plazo_reposicion_dias  INTEGER NOT NULL CHECK (plazo_reposicion_dias BETWEEN 1 AND 365),
  actualizado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, sku)
);

COMMENT ON TABLE public.fba_alertas_plazo_sku IS
  'Plazo de reposición de una referencia concreta, si es distinto del de su cliente. Alertas FBA.';


-- ---------------------------------------------------------------------------
-- Las alertas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fba_alertas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  -- Qué alerta es dentro del cliente: «reposicion:SKU», «envio:ID:atascado», «parado»… La misma clave es la misma alerta de un día para otro
  clave              TEXT NOT NULL,
  tipo               TEXT NOT NULL,
  severidad          TEXT NOT NULL CHECK (severidad IN ('critica', 'alta', 'media', 'info')),
  sku                TEXT,
  remesa_id          UUID REFERENCES public.fba_remesas(id) ON DELETE CASCADE,
  titulo             TEXT NOT NULL,
  detalle            TEXT,
  -- Dinero en juego (ventas que se perderían, valor parado…), para ordenar dentro de la misma gravedad
  impacto            NUMERIC NOT NULL DEFAULT 0,
  datos              JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado             TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'resuelta', 'silenciada')),
  primera_vez_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_vez_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_at        TIMESTAMPTZ,
  silenciada_hasta   DATE,
  -- La gravedad con la que se avisó por la campana por última vez: solo se vuelve a avisar si SUBE
  severidad_avisada  TEXT,
  avisada_at         TIMESTAMPTZ,
  UNIQUE (client_id, clave)
);

COMMENT ON TABLE public.fba_alertas IS
  'Alertas de logística FBA por cliente: rotura de stock, envíos atascados o incompletos, descuadres, stock parado y antiguo. Las crea y las cierra la pasada diaria fba-alertas.';

CREATE TABLE IF NOT EXISTS public.fba_alertas_estado (
  client_id      UUID PRIMARY KEY REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  calculado_at   TIMESTAMPTZ,
  -- Por qué no se pudo calcular (NULL = bien)
  error          TEXT,
  -- Cuántas alertas abiertas dejó el último cálculo
  abiertas       INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.fba_alertas_estado IS
  'Cuándo se calcularon por última vez las alertas FBA de cada cliente y si falló.';

CREATE INDEX IF NOT EXISTS idx_fba_alertas_cliente_estado ON public.fba_alertas (client_id, estado);
CREATE INDEX IF NOT EXISTS idx_fba_alertas_abiertas ON public.fba_alertas (estado, severidad) WHERE estado <> 'resuelta';

ALTER TABLE public.fba_alertas_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_alertas_plazo_sku ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_alertas_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fba_alertas_config FROM authenticated, anon;
REVOKE ALL ON public.fba_alertas_plazo_sku FROM authenticated, anon;
REVOKE ALL ON public.fba_alertas FROM authenticated, anon;
REVOKE ALL ON public.fba_alertas_estado FROM authenticated, anon;


-- ---------------------------------------------------------------------------
-- La campana: los tipos nuevos (conserva TODOS los de antes)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  desconocidos TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    RAISE EXCEPTION 'No existe public.notifications (la crea la migración 040): sin ella no hay campana a la que avisar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'clave') THEN
    RAISE EXCEPTION 'A public.notifications le falta la columna clave: lanza antes la migración 251_campana_avisos_de_correo.sql.';
  END IF;

  -- Antes de cambiar nada, se comprueba que ningún aviso que ya existe se quedaría fuera de la lista nueva
  SELECT string_agg(DISTINCT type, ', ') INTO desconocidos
  FROM public.notifications
  WHERE type NOT IN (
    'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
    'freno_stock', 'fallo_stock', 'fallo_amazon', 'job_amazon',
    'alarma_correo',
    'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead',
    'fba_alerta', 'fba_resumen'
  );
  IF desconocidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay avisos en la campana de un tipo que esta migracion no conoce (%). Anadelo a la lista de abajo antes de lanzarla.', desconocidos;
  END IF;

  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
      'freno_stock', 'fallo_stock',
      'fallo_amazon', 'job_amazon',
      'alarma_correo',
      'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead',
      'fba_alerta', 'fba_resumen'
    ));
END $$;


-- ---------------------------------------------------------------------------
-- El reloj de la pasada diaria
-- ---------------------------------------------------------------------------
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('fba-alertas', 1440, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = EXCLUDED.cada_minutos,
      activo = EXCLUDED.activo,
      actualizado_at = NOW();


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las cuatro columnas tienen que decir «true».
SELECT
  (SELECT count(*) = 4 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('fba_alertas_config', 'fba_alertas_plazo_sku', 'fba_alertas', 'fba_alertas_estado'))
    AS tiene_las_cuatro_tablas,
  (SELECT bool_and(pg_get_constraintdef(oid) LIKE '%' || t || '%')
     FROM pg_constraint, unnest(ARRAY['fba_alerta', 'fba_resumen']) AS t
    WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass)
    AS la_campana_admite_los_tipos_nuevos,
  (SELECT bool_and(pg_get_constraintdef(oid) LIKE '%' || t || '%')
     FROM pg_constraint, unnest(ARRAY['comment', 'web_lead', 'freno_stock', 'alarma_correo', 'correo_nuevo', 'respuesta_lead']) AS t
    WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass)
    AS y_conserva_los_de_antes,
  EXISTS (SELECT 1 FROM public.cron_config WHERE tarea = 'fba-alertas' AND activo)
    AS el_reloj_esta_puesto;
