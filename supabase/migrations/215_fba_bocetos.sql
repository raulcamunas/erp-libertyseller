-- ============================================================================
-- 215 · BOCETOS: el envío se dibuja con el cliente antes de existir
-- ============================================================================
--
-- Una remesa en borrador deja de ser «lo que la agencia va a mandar» y pasa a
-- ser un BOCETO que el cliente puede tocar: sumar referencias, quitar, cambiar
-- cantidades. Cuando los dos están de acuerdo se cierra, y a partir de ahí se
-- imprimen etiquetas y se encaja.
--
-- Se puede volver atrás —un envío cambia hasta el último día— pero volver atrás
-- DEJA RASTRO, que es lo que esta migración añade.
--
--
-- ============ POR QUÉ UNA VERSIÓN Y NO UN «se ha modificado» ============
--
-- El problema de verdad de reabrir un boceto cerrado no es saber QUE se tocó:
-- es que ya hay etiquetas impresas y pegadas en mercancía de verdad. Si se quita
-- una referencia, esas pegatinas se quedan en cajas que ya no van en el envío; si
-- se añade, faltan.
--
-- Un booleano «modificada» no responde a la única pregunta que importa el día que
-- alguien mira una caja etiquetada: ¿esta pegatina es de la versión que se va a
-- mandar? Un contador sí, porque las impresiones se guardan con el número de
-- versión que tenían (ver fba_impresiones).
--
-- Sube SOLO al reabrir, no con cada cambio dentro del borrador: mientras el
-- boceto está abierto no hay nada impreso que invalidar, y un contador que sube
-- veinte veces mientras se discute no distingue nada.
-- ============================================================================

ALTER TABLE public.fba_remesas
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS reabierta_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reabierta_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.fba_remesas.version IS
  'Sube una al reabrir un boceto ya cerrado. Las impresiones de etiquetas se guardan con la '
  'versión que tenían, así que comparar las dos dice si las pegatinas que hay pegadas siguen '
  'valiendo. No sube con cada cambio dentro del borrador: mientras está abierto no hay nada '
  'impreso que invalidar.';

COMMENT ON COLUMN public.fba_remesas.reabierta_at IS
  'Cuándo se reabrió por última vez. Con reabierta_at puesto y version > 1, la pantalla dice que '
  'este envío se cerró y se ha vuelto a tocar — que es justo lo que hay que avisar a quien ya '
  'estaba etiquetando.';


-- ============================================================================
-- CADA VEZ QUE SE IMPRIMEN ETIQUETAS, CON QUÉ VERSIÓN
-- ============================================================================
--
-- Hoy no queda ningún rastro de haber impreso. Eso convierte reabrir un boceto en
-- una decisión a ciegas: nadie sabe si hay cuatrocientas pegatinas puestas o
-- ninguna, así que o se reimprime todo por si acaso —y se tira el trabajo de una
-- tarde— o se asume que no había nada y se manda mercancía mal etiquetada.
--
-- Una fila por descarga del PDF. No se borra nunca: es el registro de algo que
-- pasó en el mundo físico.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fba_impresiones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  remesa_id UUID NOT NULL REFERENCES public.fba_remesas(id) ON DELETE CASCADE,

  /** La versión del boceto que llevaban esas etiquetas. Es el dato del registro */
  version INTEGER NOT NULL,

  /** Cuántas pegatinas salieron y en qué hoja, para poder repetir la tirada igual */
  etiquetas INTEGER NOT NULL CHECK (etiquetas >= 0),
  formato TEXT,

  /** Cuántas referencias se quedaron fuera por no tener FNSKU */
  descartadas INTEGER NOT NULL DEFAULT 0,

  impreso_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  impreso_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.fba_impresiones IS
  'Cada descarga del PDF de etiquetas de producto, con la versión del boceto que llevaba. Existe '
  'para una sola pregunta: al reabrir un envío cerrado, ¿hay pegatinas puestas que dejan de valer? '
  'No se borra: es el registro de algo que pasó en el almacén.';

CREATE INDEX IF NOT EXISTS idx_fba_impresiones_remesa
  ON public.fba_impresiones (remesa_id, impreso_at DESC);

ALTER TABLE public.fba_impresiones ENABLE ROW LEVEL SECURITY;

-- Se lee con las mismas reglas que la remesa de la que cuelga: quien puede ver
-- el envío puede ver qué se ha impreso de él. Escribir, solo el servidor con la
-- clave de servicio — las etiquetas las registra la ruta que genera el PDF, no
-- el navegador.
DROP POLICY IF EXISTS "Con acceso leen impresiones" ON public.fba_impresiones;
CREATE POLICY "Con acceso leen impresiones"
  ON public.fba_impresiones FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.fba_remesas r
      WHERE r.id = fba_impresiones.remesa_id
        AND (
          public.is_admin_or_partner(auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.fba_accesos a
            WHERE a.user_id = auth.uid() AND a.client_id = r.client_id
          )
        )
    )
  );


-- ============================================================================
-- COMPROBACIÓN · en filas, que el editor de Supabase no enseña los NOTICE
-- ============================================================================
SELECT
  r.estado,
  count(*)                                        AS remesas,
  count(*) FILTER (WHERE r.version > 1)           AS reabiertas_alguna_vez,
  COALESCE(sum(i.veces), 0)                       AS tiradas_de_etiquetas
FROM public.fba_remesas r
LEFT JOIN (
  SELECT remesa_id, count(*) AS veces FROM public.fba_impresiones GROUP BY 1
) i ON i.remesa_id = r.id
GROUP BY r.estado
ORDER BY 2 DESC;


-- ============================================================================
-- GUARDAR LAS LÍNEAS DEL BOCETO EN UNA SOLA TRANSACCIÓN
-- ============================================================================
--
-- La ruta manda la lista ENTERA, así que guardar es «borra las de antes y mete
-- estas». Hecho desde la ruta son dos viajes y dos transacciones: si el alta
-- falla después del borrado —un SKU demasiado largo, un corte de red a mitad— el
-- boceto se queda SIN NINGUNA LÍNEA y lo que había se ha perdido.
--
-- Aquí dentro las dos cosas son una. O entra la lista nueva, o se queda la vieja.
--
-- SECURITY DEFINER porque la llama el servidor con la clave de servicio, que ya
-- se salta las RLS de todas formas; se le quita el permiso de ejecución a anon y
-- a authenticated para que no sea una puerta nueva desde el navegador — las
-- escrituras de este módulo están revocadas ahí a propósito.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fba_guardar_lineas(p_remesa UUID, p_lineas JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado TEXT;
  v_metidas INTEGER;
BEGIN
  -- El estado se comprueba OTRA VEZ aquí dentro, aunque la ruta ya lo mire.
  -- Entre que la ruta lo lee y escribe pueden pasar segundos, y en esos segundos
  -- otra persona puede aprobar el envío: sin esto, las líneas cambiarían por
  -- debajo de unas etiquetas recién impresas. `FOR UPDATE` bloquea la remesa
  -- hasta que acabe la transacción, así que la carrera no existe.
  SELECT estado INTO v_estado FROM public.fba_remesas WHERE id = p_remesa FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Esa remesa ya no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION
      'El envío ha pasado a «%» mientras se editaba: las referencias ya no se pueden cambiar aquí.',
      v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.fba_remesa_lineas WHERE remesa_id = p_remesa;

  INSERT INTO public.fba_remesa_lineas
    (remesa_id, sku, unidades, referencia, nombre, variante, ean, fnsku, asin)
  SELECT
    p_remesa,
    l->>'sku',
    (l->>'unidades')::INTEGER,
    l->>'referencia',
    l->>'nombre',
    l->>'variante',
    l->>'ean',
    l->>'fnsku',
    l->>'asin'
  FROM jsonb_array_elements(p_lineas) AS l;

  GET DIAGNOSTICS v_metidas = ROW_COUNT;

  UPDATE public.fba_remesas SET updated_at = NOW() WHERE id = p_remesa;

  RETURN v_metidas;
END;
$$;

COMMENT ON FUNCTION public.fba_guardar_lineas(UUID, JSONB) IS
  'Sustituye las líneas de un boceto en una sola transacción: o entra la lista nueva, o se queda '
  'la vieja. Hecho en dos viajes desde la ruta, un fallo en el alta dejaba el boceto vacío. '
  'Vuelve a comprobar el estado con FOR UPDATE porque entre la lectura de la ruta y la escritura '
  'otra persona puede aprobar el envío.';

REVOKE ALL ON FUNCTION public.fba_guardar_lineas(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fba_guardar_lineas(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.fba_guardar_lineas(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fba_guardar_lineas(UUID, JSONB) TO service_role;
