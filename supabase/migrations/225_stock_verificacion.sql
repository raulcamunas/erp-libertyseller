-- ============================================================================
-- 225 · VERIFICAR, MEDIA HORA DESPUÉS, QUE EL STOCK SUBIDO A AMAZON ESTÁ BIEN
-- ============================================================================
--
-- El motor de sincronismo de stock sube el stock de cada cliente y se da por
-- hecho. Para los clientes que se sincronizan una vez al día (Lenobotics y
-- Shoplamp) merece la pena comprobarlo: tras enviar, se apunta una verificación
-- pendiente; media hora después una tarea vuelve a leer en directo lo que Amazon
-- tiene de cada SKU enviado, lo compara con lo que se mandó descontando las
-- ventas del intervalo, guarda el informe y avisa a Slack.
--
-- stock_verificacion_clientes   a quién se le verifica y a los cuántos minutos.
-- stock_verificaciones          una fila por envío a verificar, con su informe.
--
-- Los dos clientes se dan de alta aquí abajo por su slug. Si alguno no existe con
-- ese slug, simplemente no se inserta: se puede añadir a mano después.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stock_verificacion_clientes (
  client_id  UUID PRIMARY KEY REFERENCES public.stock_clients(id) ON DELETE CASCADE,
  minutos    INTEGER NOT NULL DEFAULT 30 CHECK (minutos BETWEEN 5 AND 720),
  activo     BOOLEAN NOT NULL DEFAULT true,
  creado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.stock_verificacion_clientes IS
  'Clientes a los que se les verifica en Amazon, tras subir su stock, que se ha aplicado bien.';

CREATE TABLE IF NOT EXISTS public.stock_verificaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.stock_clients(id) ON DELETE CASCADE,
  profile_id      UUID,
  connection_id   UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id  TEXT NOT NULL,
  batch_id        UUID NOT NULL,
  creada_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vence_at        TIMESTAMPTZ NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'en_curso', 'hecha', 'error')),
  verificada_at   TIMESTAMPTZ,
  enviados        INTEGER NOT NULL DEFAULT 0 CHECK (enviados >= 0),
  fallos          INTEGER CHECK (fallos IS NULL OR fallos >= 0),
  resumen         JSONB,
  informe         JSONB,
  slack           TEXT,
  error           TEXT,
  CONSTRAINT stock_verificaciones_error_ok CHECK (estado <> 'error' OR error IS NOT NULL)
);

COMMENT ON TABLE public.stock_verificaciones IS
  'Una verificación por envío de stock: pendiente hasta que vence, luego el informe de qué quedó bien y qué no.';

CREATE INDEX IF NOT EXISTS idx_stock_verificaciones_pendientes
  ON public.stock_verificaciones (vence_at) WHERE estado IN ('pendiente', 'en_curso');
CREATE INDEX IF NOT EXISTS idx_stock_verificaciones_cliente
  ON public.stock_verificaciones (client_id, creada_at DESC);

ALTER TABLE public.stock_verificaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_verificaciones_admin_lee ON public.stock_verificaciones;
CREATE POLICY stock_verificaciones_admin_lee
  ON public.stock_verificaciones FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_verificaciones FROM authenticated, anon;

ALTER TABLE public.stock_verificacion_clientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_verificacion_clientes FROM authenticated, anon;

-- Los dos clientes diarios
INSERT INTO public.stock_verificacion_clientes (client_id, minutos)
SELECT id, 30 FROM public.stock_clients WHERE slug IN ('lenobotics', 'shoplamp')
ON CONFLICT (client_id) DO NOTHING;

-- El reloj de la tarea que mira las verificaciones vencidas: cada 5 minutos
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('stock-verificacion', 5, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = EXCLUDED.cada_minutos,
      activo = EXCLUDED.activo,
      actualizado_at = NOW();
