-- ==================================================================
-- 180 · SABER QUÉ PRECIO SE LE MANDÓ YA A AMAZON
-- ==================================================================
--
-- Para que un reintento no vuelva a mandar lo que acaba de salir.
--
--
-- ============ EL PROBLEMA, EN ORDEN ============
--
-- 1. sendChanges() NO toca el espejo del catálogo. Lo dice su propio comentario:
--    «el cambio está aplicado en Amazon y aquí sigue constando como pendiente:
--    el siguiente refresco lo vuelve a mandar». El espejo se refresca en la
--    pasada de catálogo, cada quince minutos.
--
-- 2. El motor decide qué mandar comparando el precio calculado con `pvp_actual`,
--    que sale de ese espejo.
--
-- 3. Por tanto, durante los quince minutos siguientes a un envío, esos SKU
--    SIGUEN saliendo como que hay que mandarlos.
--
-- Mientras la publicación iba una vez cada quince minutos eso no se notaba. Con
-- la pasada propia —que corre cada minuto para poder retomar lo que quedó a
-- medias— sí: un catálogo que no cupiera en una sola pasada reenviaría los
-- mismos 2.900 precios cada minuto durante un cuarto de hora, unas 43.000
-- llamadas a Amazon para reescribir lo mismo, y la cola de los que faltaban no
-- llegaría nunca.
--
-- Con estas dos columnas el filtro sabe distinguir «hay que mandarlo» de «ya se
-- mandó y Amazon todavía no lo ha confirmado».
ALTER TABLE public.entrais_precios
  ADD COLUMN IF NOT EXISTS enviado_precio NUMERIC;

ALTER TABLE public.entrais_precios
  ADD COLUMN IF NOT EXISTS enviado_at TIMESTAMPTZ;

COMMENT ON COLUMN public.entrais_precios.enviado_precio IS
  'El último precio que Amazon ACEPTÓ para este SKU. Se compara con el calculado '
  'para no reenviar lo mismo mientras el espejo del catálogo no se ha refrescado.';

COMMENT ON COLUMN public.entrais_precios.enviado_at IS
  'Cuándo se aceptó. Pasada la ventana de espera se vuelve a intentar aunque '
  'coincida: si a estas alturas sigue sin cuadrar, es que no se aplicó.';

-- Para el filtro de candidatos, que mira estas dos en cada pasada.
CREATE INDEX IF NOT EXISTS idx_entrais_precios_enviado_at
  ON public.entrais_precios(enviado_at);

DO $$
BEGIN
  RAISE NOTICE 'Listo. Ahora una pasada de precios no reenvia lo que acaba de mandar la anterior.';
END $$;
