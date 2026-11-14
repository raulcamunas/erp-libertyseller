-- ============================================================================
-- 310 · REMESAS: ENVIAR A AMAZON DESDE EL ERP (FULFILLMENT INBOUND 2024-03-20)
-- ============================================================================
--
-- El ERP vuelve a crear el envío en Amazon, ahora hasta el final: plan, embalaje con nuestras cajas,
-- reparto por centros, transporte con el transportista asociado de Amazon (UPS) y etiquetas de caja y de
-- UPS. Con una condición de Raúl: EL CLIENTE ACEPTA EL COSTE DEL TRANSPORTE en su enlace antes de que la
-- agencia lo confirme. Y conviviendo con el camino manual de siempre (manifiesto + Seller Central).
--
--   1) EN CADA REMESA (fba_remesas):
--      · envio_modo: 'manual' (como hasta hoy, Seller Central) o 'api' (desde el ERP). Solo un
--        administrador lo cambia. Por defecto 'manual': nada cambia para ninguna remesa existente.
--      · inbound_plan_id, envio_paso (por dónde va: plan, embalaje, reparto, transporte, etiquetas…),
--        envio_error (lo último que dijo Amazon al fallar) y envio_datos (opciones, grupos, envíos,
--        fecha de recogida y contacto, en JSON).
--      · Las opciones elegidas: packing_option_id, placement_option_id, transporte_seleccion.
--      · El dinero: coste_reparto, coste_transporte, moneda_envio, transporte_caduca_at (la cotización caduca).
--      · La aceptación del cliente: transporte_aceptado_por_cliente_at + _ip + _nombre + _coste (el coste que
--        vio: si la cotización cambia, la aceptación deja de valer).
--      · La confirmación de la agencia: transporte_confirmado_at + _por, y anulable_hasta (hasta cuándo se
--        puede anular sin coste: 24 h en paquetería).
--      · envio_cajas_bloqueadas_at: desde que las cajas se mandan a Amazon NO se pueden reabrir (ni desde el
--        ERP ni desde el enlace) salvo con «Reabrir cajas» del propio envío, que obliga a regenerar el reparto.
--
--   2) fba_inbound_operaciones: CADA operación asíncrona de Amazon (createInboundPlan, confirmPlacementOption,
--      confirmTransportationOptions…) con su operationId, estado (en_curso | ok | fallo), problemas, petición
--      y respuesta resumidas, quién la lanzó y cuándo acabó. Es el motor (la pantalla pregunta por las que
--      siguen en curso) y es el rastro ante una reclamación por un cargo de UPS.
--
--   3) Un DISPARADOR en fba_remesas que impide volver de «Lista» a «Encajando» con las cajas bloqueadas:
--      la ruta ya lo comprueba, esto es la red por si alguien lo intenta por otro camino.
--
--   4) fba_envios: ciudad del centro de destino y cuándo se descargaron las etiquetas.
--
-- NO se toca el CHECK de fba_remesas.estado: el envío por API vive dentro de «Lista» (envio_paso) y al salir
-- la mercancía se marca «Enviada» como siempre, con el FBA… que ya da Amazon.
--
-- RLS: las tablas y columnas nuevas solo las lee y escribe el servidor (clave de servicio).
--
-- Se lanza en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- ============================================================================


-- ============================================================================
-- 1) COLUMNAS EN fba_remesas
-- ============================================================================

ALTER TABLE public.fba_remesas
  ADD COLUMN IF NOT EXISTS envio_modo TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS inbound_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS envio_paso TEXT NOT NULL DEFAULT 'sin_empezar',
  ADD COLUMN IF NOT EXISTS envio_error TEXT,
  ADD COLUMN IF NOT EXISTS envio_datos JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS envio_actualizado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS packing_option_id TEXT,
  ADD COLUMN IF NOT EXISTS placement_option_id TEXT,
  ADD COLUMN IF NOT EXISTS transporte_seleccion JSONB,
  ADD COLUMN IF NOT EXISTS coste_reparto NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS coste_transporte NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS moneda_envio TEXT,
  ADD COLUMN IF NOT EXISTS transporte_caduca_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transporte_aceptado_por_cliente_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transporte_aceptado_ip TEXT,
  ADD COLUMN IF NOT EXISTS transporte_aceptado_nombre TEXT,
  ADD COLUMN IF NOT EXISTS transporte_aceptado_coste NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS transporte_confirmado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transporte_confirmado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anulable_hasta TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS envio_cajas_bloqueadas_at TIMESTAMPTZ;

ALTER TABLE public.fba_remesas DROP CONSTRAINT IF EXISTS fba_remesas_envio_modo_check;
ALTER TABLE public.fba_remesas
  ADD CONSTRAINT fba_remesas_envio_modo_check CHECK (envio_modo IN ('manual', 'api'));

ALTER TABLE public.fba_remesas DROP CONSTRAINT IF EXISTS fba_remesas_envio_paso_check;
ALTER TABLE public.fba_remesas
  ADD CONSTRAINT fba_remesas_envio_paso_check CHECK (envio_paso IN (
    'sin_empezar', 'plan', 'embalaje_generar', 'embalaje_elegir', 'embalaje_confirmar', 'cajas',
    'cajas_conflicto', 'cajas_reabiertas', 'reparto_generar', 'reparto_elegir', 'reparto_confirmar',
    'transporte_datos', 'transporte_generar', 'transporte_elegir', 'transporte_cliente', 'transporte_listo',
    'ventana_generar', 'ventana_confirmar', 'transporte_confirmar', 'etiquetas', 'cancelando', 'cancelado'
  ));

COMMENT ON COLUMN public.fba_remesas.envio_modo IS
  'manual = el envío se crea en Seller Central con el manifiesto (lo de siempre). api = lo crea el ERP (solo administradores).';
COMMENT ON COLUMN public.fba_remesas.envio_paso IS
  'Por dónde va el envío por API (lib/fba/envio-amazon.ts). Los pasos con operación en marcha se siguen en fba_inbound_operaciones.';
COMMENT ON COLUMN public.fba_remesas.transporte_aceptado_por_cliente_at IS
  'Cuándo aceptó el cliente, desde su enlace, el coste del transporte (con IP, nombre y el coste que vio). Sin esto la agencia no puede confirmar el transporte.';
COMMENT ON COLUMN public.fba_remesas.anulable_hasta IS
  'Hasta cuándo se puede anular el transporte asociado sin coste (voidableUntil de Amazon; 24 h en paquetería).';
COMMENT ON COLUMN public.fba_remesas.envio_cajas_bloqueadas_at IS
  'Desde cuándo las cajas están en Amazon y no se pueden tocar. NULL = se pueden editar.';

CREATE INDEX IF NOT EXISTS fba_remesas_inbound_plan_idx
  ON public.fba_remesas (inbound_plan_id) WHERE inbound_plan_id IS NOT NULL;


-- ============================================================================
-- 2) LAS OPERACIONES ASÍNCRONAS DE AMAZON
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fba_inbound_operaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  remesa_id UUID NOT NULL REFERENCES public.fba_remesas(id) ON DELETE CASCADE,
  /** El paso del envío que la lanzó (envio_paso) */
  paso TEXT NOT NULL,
  /** El nombre de la operación de Amazon: createInboundPlan, confirmTransportationOptions… */
  operacion TEXT NOT NULL,
  operation_id TEXT,
  estado TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'ok', 'fallo')),
  problemas JSONB NOT NULL DEFAULT '[]'::jsonb,
  peticion JSONB NOT NULL DEFAULT '{}'::jsonb,
  respuesta JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT NOT NULL DEFAULT 'agencia' CHECK (actor IN ('agencia', 'enlace', 'sistema')),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  comprobaciones INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  comprobada_at TIMESTAMPTZ,
  terminada_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS fba_inbound_operaciones_remesa_idx
  ON public.fba_inbound_operaciones (remesa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fba_inbound_operaciones_en_curso_idx
  ON public.fba_inbound_operaciones (remesa_id) WHERE estado = 'en_curso';
CREATE UNIQUE INDEX IF NOT EXISTS fba_inbound_operaciones_operation_idx
  ON public.fba_inbound_operaciones (operation_id) WHERE operation_id IS NOT NULL;

COMMENT ON TABLE public.fba_inbound_operaciones IS
  'Cada operación asíncrona de la API Fulfillment Inbound 2024-03-20 lanzada por el ERP: qué paso, operationId, cómo acabó, quién la lanzó. Motor del envío por API y rastro de cada confirmación con su coste.';

ALTER TABLE public.fba_inbound_operaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fba_inbound_operaciones FROM anon, authenticated;


-- ============================================================================
-- 3) CAJAS BLOQUEADAS: NO SE VUELVE DE «LISTA» A «ENCAJANDO»
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fba_remesas_cajas_bloqueadas()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.estado = 'lista' AND NEW.estado = 'encajando' AND NEW.envio_cajas_bloqueadas_at IS NOT NULL THEN
    RAISE EXCEPTION 'Las cajas de esta remesa ya están en Amazon. Usa «Reabrir cajas» en «Enviar a Amazon» (o cancela el plan) antes de cambiarlas.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fba_remesas_cajas_bloqueadas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fba_remesas_cajas_bloqueadas ON public.fba_remesas;
CREATE TRIGGER fba_remesas_cajas_bloqueadas
  BEFORE UPDATE OF estado ON public.fba_remesas
  FOR EACH ROW EXECUTE FUNCTION public.fba_remesas_cajas_bloqueadas();


-- ============================================================================
-- 4) fba_envios: DESTINO Y ETIQUETAS
-- ============================================================================

ALTER TABLE public.fba_envios
  ADD COLUMN IF NOT EXISTS ciudad_destino TEXT,
  ADD COLUMN IF NOT EXISTS etiquetas_descargadas_at TIMESTAMPTZ;


-- ============================================================================
-- COMPROBACIÓN · en filas, que el editor de Supabase no enseña los NOTICE
-- ============================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_remesas' AND column_name = 'envio_modo')                          AS remesas_con_modo,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_remesas' AND column_name = 'envio_paso')                          AS remesas_con_paso,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_remesas' AND column_name = 'transporte_aceptado_por_cliente_at')  AS remesas_con_aceptacion,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_remesas' AND column_name = 'anulable_hasta')                      AS remesas_con_anulacion,
  to_regclass('public.fba_inbound_operaciones') IS NOT NULL                                                                                  AS operaciones_creada,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'fba_remesas_cajas_bloqueadas')                                                           AS disparador_cajas,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_envios' AND column_name = 'ciudad_destino')                       AS envios_con_ciudad;
