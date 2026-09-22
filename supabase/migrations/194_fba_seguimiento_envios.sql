-- ============================================================================
-- 194 · SEGUIMIENTO DEL ENVÍO: EN QUÉ PUNTO ESTÁ Y QUÉ HA LLEGADO DE VERDAD
-- ============================================================================
--
-- El libro mayor ya dice cuándo ENTRAN las unidades. Lo que no dice es nada de
-- lo de antes: si el envío sigue en tu almacén, si va de camino, o si Amazon lo
-- está metiendo en estantería. Eso lo da la Fulfillment Inbound API, y hasta
-- hoy la remesa solo sabía decir «sin confirmar».
--
--
-- ============ LO QUE DE VERDAD APORTA: unidades_recibidas ============
--
-- Amazon devuelve, POR REFERENCIA, cuántas unidades dice que le mandaste y
-- cuántas ha registrado. Mandaste 100 y ha recibido 97: tres unidades perdidas,
-- con nombre y apellidos.
--
-- Hoy esa diferencia solo aparece semanas después, como un descuadre en el
-- reparto que nadie sabe de dónde viene y que es imposible reclamar porque ya
-- no se sabe de qué envío salió. Guardándola aquí, la reclamación tiene fecha,
-- envío y SKU.
--
-- Va en la LÍNEA y no solo en la cabecera: un envío al que le faltan tres
-- unidades no es el problema. El problema es de QUÉ talla faltan.
-- ============================================================================

ALTER TABLE public.fba_remesas
  /** WORKING, SHIPPED, IN_TRANSIT, RECEIVING, CLOSED… Tal y como lo llama
      Amazon, sin traducir: la traducción es cosa de la pantalla, y el día que
      añadan un estado nuevo quiero verlo, no que un CHECK lo rechace */
  ADD COLUMN IF NOT EXISTS estado_amazon TEXT,
  /** Cuándo se preguntó por última vez. NULL = nunca */
  ADD COLUMN IF NOT EXISTS seguimiento_at TIMESTAMPTZ,
  /** Por qué no se pudo preguntar. Se guarda para que la pantalla lo diga sin
      que nadie tenga que mirar los registros del contenedor */
  ADD COLUMN IF NOT EXISTS seguimiento_error TEXT;

COMMENT ON COLUMN public.fba_remesas.estado_amazon IS
  'Estado del envío según la Fulfillment Inbound API. Solo se puede consultar '
  'si la remesa tiene referencia_envio: sin el número, Amazon no sabe de cuál '
  'le hablamos.';

ALTER TABLE public.fba_remesa_lineas
  /**
   * Lo que Amazon dice que ha recibido de esta referencia.
   *
   * NULL no es cero: es «todavía no lo hemos preguntado, o el envío no tiene
   * número». Un cero de verdad —lo mandamos y no ha llegado nada— es un dato
   * muy distinto y tiene que poder distinguirse.
   */
  ADD COLUMN IF NOT EXISTS unidades_recibidas INTEGER;

-- Los envíos con número y todavía vivos: es exactamente lo que la pasada
-- nocturna recorre, y sin esto recorrería las 10 de ShoesF más las que vengan.
CREATE INDEX IF NOT EXISTS fba_remesas_seguimiento_idx
  ON public.fba_remesas (connection_id, estado_amazon)
  WHERE referencia_envio IS NOT NULL;
