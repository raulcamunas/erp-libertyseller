-- ============================================================================
-- 309 · REMESAS: GUARDADOS QUE NO SE PISAN, HISTORIAL Y PROPUESTA POR ENLACE
-- ============================================================================
--
-- Cuatro cosas que van juntas porque se apoyan unas en otras:
--
--   1) GUARDAR LAS CAJAS EN UNA SOLA TRANSACCIÓN (fba_guardar_cajas).
--      Hasta ahora eran tres viajes —borrar todas, meter cajas, meter contenido— sin transacción: si
--      fallaba el segundo o el tercero, el envío se quedaba sin cajas o con cajas vacías. Y cada guardado
--      regeneraba los ids y perdía box_id_amazon, seguimiento y envio_id. Ahora va dentro de una función
--      que bloquea la remesa (FOR UPDATE), comprueba que SIGUE en «Encajando» en la misma transacción y
--      conserva esos tres datos por número de caja.
--
--   2) BLOQUEO OPTIMISTA. `cajas_version` y `lineas_version` en fba_remesas: quien guarda manda la versión
--      que tenía cargada y, si alguien ha guardado entre medias, la función lo rechaza (código 40001) y la
--      ruta contesta 409 «alguien ha cambiado esto, recarga». Antes ganaba el último que guardaba.
--
--   3) HISTORIAL (fba_remesa_historial): quién hizo qué y cuándo. Estado, líneas, cajas, enlace,
--      etiquetas, manifiesto, embalaje y lo que hace el cliente desde su enlace (con la IP). Antes solo
--      quedaban sellos sueltos que se sobrescribían.
--
--   4) LA PROPUESTA QUE VE Y TOCA EL CLIENTE POR ENLACE.
--      · En cada línea: `unidades_propuestas` (la FOTO de lo que propuso la agencia al mandársela, que el
--        cliente no puede tocar), `origen` (agencia | cliente), `anadida_por_cliente` (la marca «Nuevo») y
--        `comentario` (lo que dice el cliente de esa línea).
--      · `unidades` pasa a admitir 0: es como el cliente dice «esta no la mandes» sin borrar la línea, para
--        que la agencia vea qué se proponía. Al APROBAR se quitan las de 0 (lo hace la ruta de estado).
--      · En la remesa: cuándo se mandó la propuesta y cuándo, quién y desde qué IP dijo «Acepto». Con
--        «Acepto» NO se aprueba sola: queda «pendiente de revisión» (borrador + cliente_acepto_at) y la
--        agencia revisa las diferencias y aprueba.
--      · fba_impresiones.origen: 'erp' o 'enlace', para saber si las etiquetas las sacó el cliente.
--
-- NO se toca el CHECK de fba_remesas.estado: «pendiente de revisión» es un borrador con aceptación del
-- cliente, no un estado nuevo, y así ninguna otra pantalla que lee estados cambia.
--
-- El código llega antes que este SQL y sigue funcionando sin él: sin las funciones nuevas se guarda como
-- antes (sin bloqueo) y el portal del cliente dice que todavía no está disponible.
--
-- Se lanza en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- ============================================================================


-- ============================================================================
-- 1) COLUMNAS NUEVAS
-- ============================================================================

ALTER TABLE public.fba_remesas
  ADD COLUMN IF NOT EXISTS cajas_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lineas_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS propuesta_enviada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS propuesta_enviada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cliente_acepto_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cliente_acepto_nombre TEXT,
  ADD COLUMN IF NOT EXISTS cliente_acepto_ip TEXT,
  ADD COLUMN IF NOT EXISTS cliente_comentario TEXT;

COMMENT ON COLUMN public.fba_remesas.cajas_version IS
  'Sube con cada guardado de cajas. Quien guarda manda la que tenía: si no coincide, alguien guardó entre medias y se rechaza (409).';
COMMENT ON COLUMN public.fba_remesas.lineas_version IS
  'Sube con cada guardado de líneas (agencia o cliente). Bloqueo optimista, igual que cajas_version.';
COMMENT ON COLUMN public.fba_remesas.cliente_acepto_at IS
  'Cuándo dijo «Acepto» el cliente desde su enlace. Con estado = borrador y esto puesto, la propuesta está pendiente de revisión por la agencia.';

ALTER TABLE public.fba_remesa_lineas
  ADD COLUMN IF NOT EXISTS unidades_propuestas INTEGER,
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'agencia',
  ADD COLUMN IF NOT EXISTS anadida_por_cliente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS comentario TEXT;

ALTER TABLE public.fba_remesa_lineas DROP CONSTRAINT IF EXISTS fba_remesa_lineas_origen_check;
ALTER TABLE public.fba_remesa_lineas
  ADD CONSTRAINT fba_remesa_lineas_origen_check CHECK (origen IN ('agencia', 'cliente'));

ALTER TABLE public.fba_remesa_lineas DROP CONSTRAINT IF EXISTS fba_remesa_lineas_unidades_propuestas_check;
ALTER TABLE public.fba_remesa_lineas
  ADD CONSTRAINT fba_remesa_lineas_unidades_propuestas_check CHECK (unidades_propuestas IS NULL OR unidades_propuestas >= 0);

-- Las unidades admiten 0: «esta no la mandes» sin perder qué se proponía. Al aprobar se quitan.
ALTER TABLE public.fba_remesa_lineas DROP CONSTRAINT IF EXISTS fba_remesa_lineas_unidades_check;
ALTER TABLE public.fba_remesa_lineas
  ADD CONSTRAINT fba_remesa_lineas_unidades_check CHECK (unidades >= 0);

COMMENT ON COLUMN public.fba_remesa_lineas.unidades_propuestas IS
  'La foto de lo que propuso la agencia al mandar la propuesta. El cliente no la toca. NULL = no estaba en la propuesta (o no se ha mandado aún).';
COMMENT ON COLUMN public.fba_remesa_lineas.anadida_por_cliente IS
  'La añadió el cliente desde su enlace (solo puede elegir de su catálogo de Amazon). Sale con la marca «Nuevo».';

ALTER TABLE public.fba_impresiones
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'erp',
  ADD COLUMN IF NOT EXISTS enlace_id UUID REFERENCES public.fba_enlaces_encaje(id) ON DELETE SET NULL;

ALTER TABLE public.fba_impresiones DROP CONSTRAINT IF EXISTS fba_impresiones_origen_check;
ALTER TABLE public.fba_impresiones
  ADD CONSTRAINT fba_impresiones_origen_check CHECK (origen IN ('erp', 'enlace'));


-- ============================================================================
-- 2) HISTORIAL: QUIÉN HIZO QUÉ
-- ============================================================================
--
-- Una fila por cosa que pasa. `actor`: agencia (admin o empleado), cliente (usuario del ERP con rol
-- cliente), enlace (quien abrió el enlace público: no tiene usuario, queda la IP) o sistema (crons).
-- Los guardados automáticos (cajas, propuesta del cliente) se AGRUPAN: si la misma persona repite la
-- misma acción en pocos minutos se actualiza la fila en vez de meter otra, para que la línea de tiempo
-- no sean cien «guardó las cajas».
--
-- CERRADA AL NAVEGADOR: sin políticas y con los permisos quitados. Se lee por /api/fba con la clave de
-- servicio, después de comprobar el acceso al cliente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fba_remesa_historial (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  remesa_id UUID NOT NULL REFERENCES public.fba_remesas(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL CHECK (actor IN ('agencia', 'cliente', 'enlace', 'sistema')),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  enlace_id UUID REFERENCES public.fba_enlaces_encaje(id) ON DELETE SET NULL,
  accion TEXT NOT NULL,
  desde TEXT,
  hasta TEXT,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  veces INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS fba_remesa_historial_remesa_idx
  ON public.fba_remesa_historial (remesa_id, at DESC);

COMMENT ON TABLE public.fba_remesa_historial IS
  'Quién hizo qué en cada remesa: estado, líneas, cajas, enlace, etiquetas, Excel y lo que hace el cliente desde su enlace. Solo el servidor lo lee y lo escribe.';

ALTER TABLE public.fba_remesa_historial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fba_remesa_historial FROM anon, authenticated;


-- ============================================================================
-- 3) GUARDAR LAS CAJAS EN UNA TRANSACCIÓN, CON EL ESTADO Y LA VERSIÓN COMPROBADOS
-- ============================================================================
--
-- p_cajas: [{ numero, largoCm, anchoCm, altoCm, pesoKg, contenido: [{ sku, unidades }] }]
-- p_version: la cajas_version que tenía quien guarda. NULL = sin comprobar (compatibilidad).
-- Devuelve la versión nueva.
--
-- Errores con código propio para que la ruta los traduzca:
--   23514 (check_violation)        la remesa ya no está en «Encajando».
--   40001 (serialization_failure)  alguien guardó entre medias: recarga.
-- ============================================================================

DROP FUNCTION IF EXISTS public.fba_guardar_cajas(UUID, JSONB, INTEGER);
CREATE FUNCTION public.fba_guardar_cajas(p_remesa UUID, p_cajas JSONB, p_version INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado TEXT;
  v_version INTEGER;
  v_caja JSONB;
  v_id UUID;
  v_viejas JSONB;
BEGIN
  SELECT estado, cajas_version INTO v_estado, v_version FROM public.fba_remesas WHERE id = p_remesa FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Esa remesa ya no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado <> 'encajando' THEN
    RAISE EXCEPTION 'El envío ha pasado a «%» mientras se editaba: las cajas ya no se pueden cambiar.', v_estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_version IS NOT NULL AND p_version <> v_version THEN
    RAISE EXCEPTION 'Alguien ha cambiado las cajas mientras las editabas. Recarga para ver lo último.'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- Lo que Amazon y el transportista ya le dieron a cada caja se conserva por su número
  SELECT COALESCE(jsonb_object_agg(numero::TEXT, jsonb_build_object('box', box_id_amazon, 'seg', seguimiento, 'envio', envio_id)), '{}'::jsonb)
    INTO v_viejas
    FROM public.fba_cajas WHERE remesa_id = p_remesa;

  DELETE FROM public.fba_cajas WHERE remesa_id = p_remesa;

  FOR v_caja IN SELECT * FROM jsonb_array_elements(COALESCE(p_cajas, '[]'::jsonb)) LOOP
    INSERT INTO public.fba_cajas (remesa_id, numero, largo_cm, ancho_cm, alto_cm, peso_kg, box_id_amazon, seguimiento, envio_id)
    VALUES (
      p_remesa,
      (v_caja->>'numero')::INTEGER,
      NULLIF(v_caja->>'largoCm', '')::NUMERIC,
      NULLIF(v_caja->>'anchoCm', '')::NUMERIC,
      NULLIF(v_caja->>'altoCm', '')::NUMERIC,
      NULLIF(v_caja->>'pesoKg', '')::NUMERIC,
      v_viejas->(v_caja->>'numero')->>'box',
      v_viejas->(v_caja->>'numero')->>'seg',
      NULLIF(v_viejas->(v_caja->>'numero')->>'envio', '')::UUID
    )
    RETURNING id INTO v_id;

    INSERT INTO public.fba_caja_contenido (caja_id, sku, unidades)
    SELECT v_id, x->>'sku', (x->>'unidades')::INTEGER
    FROM jsonb_array_elements(COALESCE(v_caja->'contenido', '[]'::jsonb)) AS x
    WHERE (x->>'unidades')::INTEGER > 0;
  END LOOP;

  UPDATE public.fba_remesas SET cajas_version = cajas_version + 1, updated_at = NOW() WHERE id = p_remesa
    RETURNING cajas_version INTO v_version;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.fba_guardar_cajas(UUID, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 4) GUARDAR LAS LÍNEAS DE LA AGENCIA SIN PERDER LA FOTO DE LA PROPUESTA
-- ============================================================================
--
-- La 215 sustituye la lista entera y con ella se iban unidades_propuestas, origen, la marca «Nuevo» y el
-- comentario del cliente. Esta conserva esos cuatro datos por SKU, comprueba el estado y la versión en la
-- misma transacción y sube lineas_version. Devuelve la versión nueva.
-- ============================================================================

DROP FUNCTION IF EXISTS public.fba_guardar_lineas_v2(UUID, JSONB, INTEGER);
CREATE FUNCTION public.fba_guardar_lineas_v2(p_remesa UUID, p_lineas JSONB, p_version INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado TEXT;
  v_version INTEGER;
  v_viejas JSONB;
BEGIN
  SELECT estado, lineas_version INTO v_estado, v_version FROM public.fba_remesas WHERE id = p_remesa FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Esa remesa ya no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'El envío ha pasado a «%» mientras se editaba: las referencias ya no se pueden cambiar aquí.', v_estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_version IS NOT NULL AND p_version <> v_version THEN
    RAISE EXCEPTION 'Alguien ha cambiado las referencias mientras las editabas. Recarga para ver lo último.'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT COALESCE(jsonb_object_agg(sku, jsonb_build_object(
           'prop', unidades_propuestas, 'origen', origen, 'nuevo', anadida_por_cliente, 'com', comentario)), '{}'::jsonb)
    INTO v_viejas
    FROM public.fba_remesa_lineas WHERE remesa_id = p_remesa;

  DELETE FROM public.fba_remesa_lineas WHERE remesa_id = p_remesa;

  INSERT INTO public.fba_remesa_lineas
    (remesa_id, sku, unidades, referencia, nombre, variante, ean, fnsku, asin,
     unidades_propuestas, origen, anadida_por_cliente, comentario)
  SELECT
    p_remesa,
    l->>'sku',
    (l->>'unidades')::INTEGER,
    l->>'referencia', l->>'nombre', l->>'variante', l->>'ean', l->>'fnsku', l->>'asin',
    NULLIF(v_viejas->(l->>'sku')->>'prop', '')::INTEGER,
    COALESCE(v_viejas->(l->>'sku')->>'origen', 'agencia'),
    COALESCE((v_viejas->(l->>'sku')->>'nuevo')::BOOLEAN, FALSE),
    v_viejas->(l->>'sku')->>'com'
  FROM jsonb_array_elements(p_lineas) AS l;

  UPDATE public.fba_remesas SET lineas_version = lineas_version + 1, updated_at = NOW() WHERE id = p_remesa
    RETURNING lineas_version INTO v_version;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.fba_guardar_lineas_v2(UUID, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 5) MANDAR LA PROPUESTA AL CLIENTE: LA FOTO
-- ============================================================================
--
-- Copia `unidades` en `unidades_propuestas` en todas las líneas (lo que el cliente verá como «Propuesto»),
-- quita lo que añadió el cliente en una vuelta anterior de la marca «Nuevo» (pasa a ser parte de la
-- propuesta) y borra cualquier aceptación anterior. Solo en borrador.
-- ============================================================================

DROP FUNCTION IF EXISTS public.fba_enviar_propuesta(UUID, UUID);
CREATE FUNCTION public.fba_enviar_propuesta(p_remesa UUID, p_usuario UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado TEXT;
  v_version INTEGER;
BEGIN
  SELECT estado INTO v_estado FROM public.fba_remesas WHERE id = p_remesa FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Esa remesa ya no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se manda una propuesta en borrador (ahora está en «%»).', v_estado USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.fba_remesa_lineas WHERE remesa_id = p_remesa AND unidades = 0;
  UPDATE public.fba_remesa_lineas
     SET unidades_propuestas = unidades, origen = 'agencia', anadida_por_cliente = FALSE, comentario = NULL, updated_at = NOW()
   WHERE remesa_id = p_remesa;

  UPDATE public.fba_remesas
     SET propuesta_enviada_at = NOW(), propuesta_enviada_por = p_usuario,
         cliente_acepto_at = NULL, cliente_acepto_nombre = NULL, cliente_acepto_ip = NULL, cliente_comentario = NULL,
         lineas_version = lineas_version + 1, updated_at = NOW()
   WHERE id = p_remesa
   RETURNING lineas_version INTO v_version;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.fba_enviar_propuesta(UUID, UUID) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 6) LO QUE CAMBIA EL CLIENTE DESDE SU ENLACE
-- ============================================================================
--
-- El servidor ya ha validado y calculado el plan (lib/fba/propuesta-cliente.ts): qué líneas actualizar,
-- cuáles añadir (solo de su catálogo de Amazon, ya con nombre, ASIN y FNSKU) y cuáles quitar (solo las que
-- añadió él). Aquí se aplica de una vez, con el estado, la aceptación y la versión comprobados.
--   p_actualizar: [{ sku, unidades, comentario }]
--   p_anadir:     [{ sku, unidades, comentario, nombre, asin, fnsku }]
--   p_quitar:     [sku, …]
-- ============================================================================

DROP FUNCTION IF EXISTS public.fba_cliente_guardar_propuesta(UUID, JSONB, JSONB, JSONB, INTEGER);
CREATE FUNCTION public.fba_cliente_guardar_propuesta(p_remesa UUID, p_actualizar JSONB, p_anadir JSONB, p_quitar JSONB, p_version INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado TEXT;
  v_version INTEGER;
  v_acepto TIMESTAMPTZ;
  v_enviada TIMESTAMPTZ;
BEGIN
  SELECT estado, lineas_version, cliente_acepto_at, propuesta_enviada_at
    INTO v_estado, v_version, v_acepto, v_enviada
    FROM public.fba_remesas WHERE id = p_remesa FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Ese envío ya no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado <> 'borrador' OR v_enviada IS NULL THEN
    RAISE EXCEPTION 'La propuesta ya no se puede cambiar: la agencia la ha cerrado.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_acepto IS NOT NULL THEN
    RAISE EXCEPTION 'Ya has aceptado la propuesta: la agencia la está revisando.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_version IS NOT NULL AND p_version <> v_version THEN
    RAISE EXCEPTION 'La propuesta ha cambiado mientras la mirabas. Recarga la página para ver lo último.'
      USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE public.fba_remesa_lineas l
     SET unidades = (x->>'unidades')::INTEGER, comentario = NULLIF(x->>'comentario', ''), updated_at = NOW()
    FROM jsonb_array_elements(COALESCE(p_actualizar, '[]'::jsonb)) AS x
   WHERE l.remesa_id = p_remesa AND l.sku = x->>'sku';

  DELETE FROM public.fba_remesa_lineas
   WHERE remesa_id = p_remesa AND anadida_por_cliente
     AND sku IN (SELECT jsonb_array_elements_text(COALESCE(p_quitar, '[]'::jsonb)));

  INSERT INTO public.fba_remesa_lineas (remesa_id, sku, unidades, nombre, asin, fnsku, origen, anadida_por_cliente, comentario, unidades_propuestas)
  SELECT p_remesa, x->>'sku', (x->>'unidades')::INTEGER, x->>'nombre', x->>'asin', x->>'fnsku', 'cliente', TRUE, NULLIF(x->>'comentario', ''), NULL
    FROM jsonb_array_elements(COALESCE(p_anadir, '[]'::jsonb)) AS x
  ON CONFLICT (remesa_id, sku) DO UPDATE SET unidades = EXCLUDED.unidades, comentario = EXCLUDED.comentario, updated_at = NOW();

  UPDATE public.fba_remesas SET lineas_version = lineas_version + 1, updated_at = NOW() WHERE id = p_remesa
    RETURNING lineas_version INTO v_version;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.fba_cliente_guardar_propuesta(UUID, JSONB, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- COMPROBACIÓN · en filas, que el editor de Supabase no enseña los NOTICE
-- ============================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_remesas' AND column_name = 'cajas_version')               AS remesas_con_versiones,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_remesas' AND column_name = 'cliente_acepto_at')           AS remesas_con_aceptacion,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_remesa_lineas' AND column_name = 'unidades_propuestas')   AS lineas_con_foto,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_impresiones' AND column_name = 'origen')                  AS impresiones_con_origen,
  to_regclass('public.fba_remesa_historial') IS NOT NULL                                                                             AS historial_creado,
  to_regprocedure('public.fba_guardar_cajas(uuid, jsonb, integer)') IS NOT NULL                                                      AS funcion_cajas,
  to_regprocedure('public.fba_guardar_lineas_v2(uuid, jsonb, integer)') IS NOT NULL                                                  AS funcion_lineas,
  to_regprocedure('public.fba_enviar_propuesta(uuid, uuid)') IS NOT NULL                                                             AS funcion_enviar,
  to_regprocedure('public.fba_cliente_guardar_propuesta(uuid, jsonb, jsonb, jsonb, integer)') IS NOT NULL                            AS funcion_cliente;
