-- ============================================================================
-- 224 · EL HISTORIAL DE CADA ENVÍO A FBA: CUÁNDO CAMBIA DE ESTADO Y CUÁNDO LLEGA
-- ============================================================================
--
-- Amazon NO da por API las horas del «Progreso del envío» de Seller Central
-- (creado, en tránsito, entregado, registrado, en recepción, cerrado): solo da el
-- estado de AHORA y las unidades recibidas de AHORA. Así que el historial se
-- construye mirando: cada vez que se pregunta por un envío (cada hora mientras
-- esté vivo) y algo ha cambiado —el estado, o las unidades recibidas— se apunta
-- una fila con la hora en que se VIO el cambio.
--
-- La hora es la de la observación, no la de Amazon: con una consulta por hora, el
-- margen de error es de una hora como mucho.
--
-- Solo se escribe cuando hay cambio, así que son unas pocas filas por envío.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fba_remesa_eventos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remesa_id         UUID NOT NULL REFERENCES public.fba_remesas(id) ON DELETE CASCADE,
  visto_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado_amazon     TEXT,
  unidades_enviadas INTEGER CHECK (unidades_enviadas IS NULL OR unidades_enviadas >= 0),
  unidades_recibidas INTEGER CHECK (unidades_recibidas IS NULL OR unidades_recibidas >= 0)
);

COMMENT ON TABLE public.fba_remesa_eventos IS
  'Historial de un envío FBA: una fila cada vez que se ve cambiar su estado o las unidades recibidas.';

CREATE INDEX IF NOT EXISTS idx_fba_remesa_eventos_remesa
  ON public.fba_remesa_eventos (remesa_id, visto_at);

ALTER TABLE public.fba_remesa_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fba_remesa_eventos FROM authenticated, anon;

-- El reloj de la tarea que mira los envíos vivos: cada hora.
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('fba-seguimiento', 60, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = EXCLUDED.cada_minutos,
      activo = EXCLUDED.activo,
      actualizado_at = NOW();
