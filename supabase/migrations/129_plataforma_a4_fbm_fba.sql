-- =====================================================
-- 129 · MÓDULO A4 — ANÁLISIS FBM → FBA
-- =====================================================
-- El análisis de más valor comercial de la Fase A (§3.5): de las referencias
-- que hoy envía el cliente, cuáles ganarían dinero si las guardara Amazon.
--
-- Esta migración NO crea ninguna tabla de resultados, y es a propósito. El
-- análisis se calcula AL VUELO a partir de lo que ya está guardado —el espejo
-- del catálogo, los costes de A5, las tarifas estimadas, los snapshots de precio
-- y de ranking— así que no hay ninguna serie nueva que mantener, ningún trabajo
-- nocturno que se pueda quedar parado y ningún veredicto viejo que se confunda
-- con uno de hoy. Lo que sí hace falta guardar es LO QUE NO SE PUEDE DEDUCIR DE
-- NINGÚN SITIO, que son exactamente tres cosas:
--
--   1. EL IMPUESTO DE CADA MARKETPLACE. Y son DOS datos, no uno: el tipo, y si
--      el precio de listing lo lleva dentro. En la Unión Europea sí; en Estados
--      Unidos el sales tax se añade en el pago y dividir por (1 + IVA) allí
--      hunde el margen un 20 % sin dar ningún aviso. NINGÚN endpoint de la
--      SP-API da el tipo con los roles concedidos —los informes de IVA están
--      detrás de roles fiscales restringidos— así que es forzosamente una tabla
--      de configuración VERSIONADA y CON DUEÑO: los tipos cambian por ley y el
--      margen de marzo se calcula con el tipo de marzo.
--
--   2. LOS UMBRALES DEL CLIENTE. El colchón de margen, la mejora mínima que
--      justifica mover una referencia y la rotación mínima. Todos nacen en NULL
--      y NULL significa NO RECOMENDAR. Un número inventado por el programa es
--      indistinguible de uno decidido, y aquí lo que se propone es meter
--      mercancía ajena en un almacén del que sacarla cuesta dinero.
--
--   3. A QUÉ CANAL SE PIDIÓ CADA ESTIMACIÓN DE TARIFAS. Ver el bloque 3.
--
--
-- ============ POR QUÉ NO HAY VALORES POR DEFECTO EN NINGÚN UMBRAL ============
--
-- Porque la especificación es literal: «los umbrales, los costes, las reglas de
-- margen y las excepciones por cliente las pongo yo». Un DEFAULT 10 en el
-- colchón haría que dieciséis clientes empezaran a recibir recomendaciones
-- calculadas con un número que nadie ha decidido, y no habría forma de
-- distinguir en la tabla cuáles se pusieron a mano y cuáles se heredaron.
--
-- La pantalla SÍ enseña el 10-12 % que dice la especificación, como sugerencia
-- al lado del campo vacío. Guardarla es un clic, y entonces la fila tiene fecha
-- y dueño. Esa es toda la diferencia entre un dato y una suposición.
--
-- Se lanza en el editor SQL de Supabase, después de la 123 y la 126 de costes.
-- IDEMPOTENTE: se puede volver a pegar sin romper nada.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción: si algo
-- de abajo se apoya en una tabla que no existe, el fallo llega a la mitad y
-- deshace lo anterior. Mejor negarse aquí con un mensaje que diga qué lanzar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_clients'
  ) THEN
    RAISE EXCEPTION
      'No existe public.amazon_clients. Lanza antes 118_amazon_api.sql: los umbrales de A4 son por cliente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_fees_estimados'
  ) THEN
    RAISE EXCEPTION
      'No existe public.amazon_fees_estimados. Lanza antes 123_plataforma_a1.sql: sin las tarifas estimadas no hay margen que comparar.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella las políticas RLS de abajo dejarían estas tablas abiertas, y aquí están los umbrales de negocio de tiendas ajenas.';
  END IF;
END $$;

-- =====================================================
-- 1) EL IMPUESTO POR MARKETPLACE
-- =====================================================
-- CLIENT_ID ANULABLE, Y ES EL PUNTO ENTERO DE LA TABLA:
--
--   · client_id IS NULL  -> la regla general del marketplace. Se rellena una vez
--                           y vale para los dieciséis clientes.
--   · client_id = X      -> la excepción de ese cliente. Existe porque el
--                           régimen fiscal no es solo del país: un cliente
--                           acogido a un régimen distinto, o que vende una
--                           categoría con tipo reducido, no tributa como el de
--                           al lado aunque vendan en el mismo sitio.
--
-- Resolver «cuál aplica» es: la fila del cliente si la hay, si no la general, y
-- dentro de cada una la de `valido_desde` más alto que no supere la fecha. La
-- consulta está escrita UNA vez, en lib/plataforma/fbmfba/datos.ts.
--
-- NO HAY `valido_hasta`, por lo mismo que en los costes: sería un dato derivado
-- que hay que mantener a mano y que se desincroniza el primer día que alguien
-- meta un tramo intermedio.
CREATE TABLE IF NOT EXISTS public.amazon_fiscal_marketplace (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  /** NULL = la regla general de este marketplace, para todos los clientes */
  client_id UUID REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,

  /** Desde cuándo rige. Los tipos cambian por ley y el histórico tiene que
      seguir cuadrando con lo que se le enseñó al cliente en su día */
  valido_desde DATE NOT NULL DEFAULT CURRENT_DATE,

  /**
   * Tanto por ciento. NULL = NO SE HA CONFIGURADO, que NO es cero.
   *
   * Un cero aquí significaría «aquí no se paga impuesto» y en España eso infla
   * el margen un 21 %. Mientras esté a NULL y el precio lleve impuesto dentro,
   * A4 no da número para ese marketplace y lo dice.
   */
  iva_porcentaje NUMERIC,

  /**
   * ¿El precio de listing lleva el impuesto dentro?
   *
   * TRES ESTADOS, y el NULL es imprescindible: FALSE es «aquí el impuesto va
   * fuera, lo sabemos» (Estados Unidos) y NULL es «nadie lo ha dicho». Con dos
   * estados, un marketplace sin configurar se comportaría como Estados Unidos y
   * nadie lo notaría.
   */
  precio_incluye_impuesto BOOLEAN,

  notas TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_fiscal_iva_ok
    CHECK (iva_porcentaje IS NULL OR (iva_porcentaje >= 0 AND iva_porcentaje < 100))
);

-- Un solo tramo por (cliente, marketplace, fecha). El índice va en dos piezas
-- porque en Postgres NULL nunca es igual a NULL: con un UNIQUE normal, dos filas
-- generales del mismo marketplace y la misma fecha convivirían sin dar error y
-- la resolución elegiría una al azar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_fiscal_cliente
  ON public.amazon_fiscal_marketplace(client_id, marketplace_id, valido_desde)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_fiscal_general
  ON public.amazon_fiscal_marketplace(marketplace_id, valido_desde)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_amazon_fiscal_lookup
  ON public.amazon_fiscal_marketplace(marketplace_id, valido_desde DESC);

COMMENT ON TABLE public.amazon_fiscal_marketplace IS
  'El impuesto de cada marketplace, con fecha de vigencia y dueño. Ningún endpoint de la SP-API lo da con los roles concedidos: los informes de IVA están detrás de roles fiscales restringidos. Sin esta fila, A4 no calcula margen en ese marketplace y lo dice.';

COMMENT ON COLUMN public.amazon_fiscal_marketplace.precio_incluye_impuesto IS
  'TRUE en la UE (el precio de listing lleva IVA), FALSE en EEUU (el sales tax se añade en el pago), NULL = sin configurar. Dividir por (1+IVA) donde el impuesto va fuera hunde el margen un 20 % sin dar ningún aviso.';

-- =====================================================
-- 2) LOS UMBRALES DEL CLIENTE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.amazon_fbmfba_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /**
   * REGLA 1 · EL COLCHÓN. Margen mínimo (%) que tiene que quedar EN FBA para
   * recomendar la migración. NULL = no se recomienda nada.
   *
   * No es «que dé más que hoy»: una referencia puede mejorar y quedarse en un
   * 2 %, y un 2 % vendiendo al techo que calcula Amazon significa que en cuanto
   * un competidor baje un céntimo eso es inventario parado en un almacén ajeno.
   */
  colchon_margen_pct NUMERIC,

  /** REGLA 1 (cont.) · Cuántos PUNTOS porcentuales tiene que mejorar el margen
      para que mover la referencia merezca el trabajo. NULL = no se recomienda */
  mejora_minima_puntos NUMERIC,

  /** REGLA 2 · Unidades mínimas en la ventana. NULL = la rotación no filtra */
  rotacion_minima_unidades INTEGER,
  /** La ventana de la regla 2. 30 días es el mes natural: TÉCNICO, no de negocio */
  rotacion_ventana_dias INTEGER NOT NULL DEFAULT 30,

  /** REGLA 2 (señal) · Ranking a partir del cual se da por no rotativa una
      referencia SIN datos de ventas. NULL = el ranking no descarta a nadie.
      El BSR ORDENA, NO MIDE: por eso su umbral va aparte del de unidades */
  bsr_maximo INTEGER,

  /** REGLA 4 · ¿frenar las referencias cuyas medidas no son de fiar? */
  exigir_dimensiones_fiables BOOLEAN NOT NULL DEFAULT TRUE,

  /** TÉCNICO · cuánto puede alejarse el precio al que se pidió una tarifa del
      precio que se evalúa, en %. Las tarifas se piden A UN PRECIO CONCRETO y no
      escalan de forma lineal: con 1 % se admite el ruido del redondeo y nada más */
  tolerancia_tarifa_pct NUMERIC NOT NULL DEFAULT 1,

  notas TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_fbmfba_colchon_ok
    CHECK (colchon_margen_pct IS NULL OR (colchon_margen_pct >= 0 AND colchon_margen_pct <= 100)),
  CONSTRAINT amazon_fbmfba_mejora_ok
    CHECK (mejora_minima_puntos IS NULL OR mejora_minima_puntos >= 0),
  CONSTRAINT amazon_fbmfba_rotacion_ok
    CHECK (rotacion_minima_unidades IS NULL OR rotacion_minima_unidades >= 0),
  CONSTRAINT amazon_fbmfba_ventana_ok
    CHECK (rotacion_ventana_dias BETWEEN 1 AND 365),
  CONSTRAINT amazon_fbmfba_bsr_ok
    CHECK (bsr_maximo IS NULL OR bsr_maximo > 0),
  CONSTRAINT amazon_fbmfba_tolerancia_ok
    CHECK (tolerancia_tarifa_pct >= 0 AND tolerancia_tarifa_pct <= 50)
);

-- Una configuración viva por cliente. El índice parcial permite conservar las
-- desactivadas como histórico sin que estorben.
CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_fbmfba_config_cliente
  ON public.amazon_fbmfba_config(client_id)
  WHERE is_active;

COMMENT ON TABLE public.amazon_fbmfba_config IS
  'Los umbrales del análisis FBM -> FBA de un cliente. Todo lo de negocio nace en NULL y NULL significa NO RECOMENDAR: la especificación dice que los umbrales los pone el usuario, y un número inventado es indistinguible de uno decidido.';

-- =====================================================
-- 3) A QUÉ CANAL SE PIDIÓ CADA ESTIMACIÓN DE TARIFAS
-- =====================================================
-- SIN ESTA COLUMNA, LAS TARIFAS GUARDADAS SON AMBIGUAS Y NO SE NOTA.
--
-- `getMyFeesEstimates` devuelve las tarifas DEL CANAL QUE TENGA HOY EL SKU salvo
-- que se le pida expresamente el escenario de Amazon. O sea que para una
-- referencia que hoy envía el cliente, la estimación normal NO trae la tarifa de
-- logística de Amazon —que es justo el número que decide esta migración—.
--
-- Con solo las columnas de la 123, una fila con `fba_fee` a NULL significa a la
-- vez «se pidió como envío propio, y por eso no hay tarifa de Amazon» y «se
-- pidió como FBA y Amazon no la devolvió». La primera es normal; la segunda es
-- un dato que falta. Distinguirlas después es imposible, y confundirlas hace que
-- A4 compare el escenario de hoy contra sí mismo y dé cero diferencia.
--
-- NULL sigue siendo válido: son las filas anteriores a esta migración, y se
-- tratan como «no consta», nunca como una de las dos.
ALTER TABLE public.amazon_fees_estimados
  ADD COLUMN IF NOT EXISTS canal TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_fees_estimados_canal_ok') THEN
    ALTER TABLE public.amazon_fees_estimados
      ADD CONSTRAINT amazon_fees_estimados_canal_ok
      CHECK (canal IS NULL OR canal IN ('fba', 'propio'));
  END IF;
END $$;

COMMENT ON COLUMN public.amazon_fees_estimados.canal IS
  'A qué escenario se pidió la estimación: fba = marcando el canal de Amazon, propio = el canal que ya tiene el SKU. NULL = no consta (filas anteriores a la 129). Sin esto, fba_fee a NULL significa a la vez "se pidió como envío propio" y "se pidió como FBA y no vino", que son un caso normal y un dato que falta.';

-- El índice de la consulta real de A4: «la última tarifa de este SKU en este
-- canal». Sin el canal en el índice, cada fila obliga a leer y descartar.
CREATE INDEX IF NOT EXISTS idx_amazon_fees_canal
  ON public.amazon_fees_estimados(connection_id, marketplace_id, sku, canal, fecha DESC);

-- =====================================================
-- 4) updated_at
-- =====================================================
-- La función la crea la 118 y la reutilizan A1 y A5. Se comprueba antes de
-- colgarle un trigger: si no estuviera, el CREATE TRIGGER reventaría el script
-- entero por un campo de auditoría, y `updated_at` no vale eso.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_amazon_updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS trg_amazon_fiscal_updated ON public.amazon_fiscal_marketplace;
    CREATE TRIGGER trg_amazon_fiscal_updated
      BEFORE UPDATE ON public.amazon_fiscal_marketplace
      FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

    DROP TRIGGER IF EXISTS trg_amazon_fbmfba_config_updated ON public.amazon_fbmfba_config;
    CREATE TRIGGER trg_amazon_fbmfba_config_updated
      BEFORE UPDATE ON public.amazon_fbmfba_config
      FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();
  END IF;
END $$;

-- =====================================================
-- 5) RLS — SOLO ADMIN, Y SOLO LECTURA DESDE EL NAVEGADOR
-- =====================================================
-- Mismo patrón que las tablas de A5: SELECT para admin y ni una escritura desde
-- el cliente. Todo lo que escribe pasa por las rutas de API, que comprueban la
-- sesión con requireAmazonAdmin() y usan service_role.
DO $$
DECLARE
  t TEXT;
  politica TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_fiscal_marketplace',
    'amazon_fbmfba_config'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    politica := format('Admins read %s', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', politica, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_erp_admin(auth.uid()))',
      politica, t);

    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
  END LOOP;
END $$;
