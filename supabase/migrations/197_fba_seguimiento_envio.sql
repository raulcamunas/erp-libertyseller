-- ============================================================================
-- 197 · LA LÍNEA DE TIEMPO DE UN ENVÍO
-- ============================================================================
--
-- Hasta ahora del envío solo se guardaba en qué estado estaba. Eso contesta
-- «¿por dónde va?» pero no «¿para cuándo?», que es la pregunta que hace el
-- cliente.
--
-- Amazon da las dos ventanas:
--
--   · readyToShipWindow  · cuándo sale, que es lo que le dijimos nosotros.
--   · selectedDeliveryWindow · cuándo espera recibirlo. SOLO en transporte
--     propio: con el transportista de Amazon la fecha la pone él y no se
--     negocia, así que ahí estas dos columnas se quedan vacías y no es un
--     fallo.
--
-- Y da algo que no esperaba: `trackingNumberValidationStatus`. Amazon comprueba
-- cada número de seguimiento contra el transportista, y un número que no valida
-- deja el envío esperando en el almacén sin que nadie entienda por qué. Se
-- guarda para poder enseñarlo.
-- ============================================================================

ALTER TABLE public.fba_envios
  ADD COLUMN IF NOT EXISTS sale_desde DATE,
  ADD COLUMN IF NOT EXISTS sale_hasta DATE,
  ADD COLUMN IF NOT EXISTS entrega_desde DATE,
  ADD COLUMN IF NOT EXISTS entrega_hasta DATE,
  ADD COLUMN IF NOT EXISTS visto_at TIMESTAMPTZ;

COMMENT ON COLUMN public.fba_envios.entrega_desde IS
  'Cuándo espera Amazon recibirlo. Vacío con transportista de Amazon: ahí la '
  'fecha la pone él y no se negocia.';

ALTER TABLE public.fba_cajas
  /** El número del transportista para esta caja */
  ADD COLUMN IF NOT EXISTS seguimiento_valido TEXT;

COMMENT ON COLUMN public.fba_cajas.seguimiento_valido IS
  'Lo que opina Amazon del número de seguimiento. Un número que no valida deja '
  'el envío esperando en el almacén sin que nadie entienda por qué.';
