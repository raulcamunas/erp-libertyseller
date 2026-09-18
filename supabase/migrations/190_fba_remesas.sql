-- ============================================================================
-- 190 · REMESAS A FBA Y EL LIBRO MAYOR QUE LAS CONSUME
-- ============================================================================
--
-- Qué mandamos a los almacenes de Amazon, y cuánto queda vivo de cada envío.
--
-- Sustituye a un Excel con una pestaña por envío (ShoesF: 9 pestañas, 375
-- líneas, 1.200 unidades) donde la columna «Unidades Vendidas» había que
-- rellenarla a mano. Siete de los nueve envíos estaban a cero. La estructura
-- era buena; lo que no se sostiene es teclear las ventas.
--
--
-- ============ POR QUÉ HAY UNA TABLA DE MOVIMIENTOS Y NO UN CONTADOR ============
--
-- La tentación es guardar «quedan N» en la línea e ir restando. No se hace, y
-- es la decisión de diseño más importante de aquí:
--
--   · Un contador DERIVA. Una pasada que falla a medias, un día que se procesa
--     dos veces, una corrección tardía de Amazon — y el número deja de cuadrar
--     sin que nadie sepa desde cuándo.
--   · Un contador NO SE AUDITA. Cuando el cliente pregunte «¿por qué dices que
--     quedan 3?», la respuesta tiene que ser una lista de movimientos con sus
--     fechas, no un entero.
--   · Un contador NO SE ARREGLA. Si mañana corriges la fecha de una remesa mal
--     metida, el reparto entero tiene que recalcularse solo.
--
-- Así que aquí solo se guardan HECHOS: lo que se envió y lo que Amazon dice que
-- ha pasado. El reparto FIFO se calcula al vuelo cada vez, y siempre está bien.
--
--
-- ============ LO QUE EL LIBRO MAYOR TRAE Y LO QUE NO ============
--
-- Medido sobre 259 movimientos reales de Creative Toys en 7 días:
--
--   Shipments        180   sin referencia
--   WhseTransfers     57   sin referencia   <- NO SON CONSUMO. Ver abajo.
--   CustomerReturns   10   sin referencia
--   Adjustments        8   CON referencia
--   Receipts           2   CON referencia   <- el identificador del envío
--   VendorReturns      2   sin referencia
--
-- Dos consecuencias que decidieron el diseño:
--
--   1. Las ENTRADAS traen el identificador del envío, así que una remesa se
--      puede reconocer sola cuando llega. Por eso `referencia_envio`.
--   2. Las DEVOLUCIONES NO traen el del pedido, y las ventas tampoco: no hay
--      forma de emparejar una devolución con su venta. Hace falta una
--      convención, y va en el motor, no aquí.
--
-- WhseTransfers es el 22 % de los movimientos y son traslados entre almacenes
-- de Amazon: no se ha vendido nada. Contarlos como consumo se comería las
-- remesas sin que nadie entendiera por qué, y sin dar ningún error.
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 1) La remesa: un envío a Amazon                                     */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.fba_remesas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /**
   * La conexión puede NO EXISTIR, y es un caso normal, no un error.
   *
   * ShoesF —el cliente para el que se hacía el Excel— tiene ficha pero no tiene
   * autorización de la API. Sus remesas se llevan igual: lo que se pierde es que
   * las ventas entren solas. El día que se conecte, empiezan a entrar y lo ya
   * apuntado sigue valiendo.
   *
   * SET NULL y no CASCADE: si un cliente revoca el acceso, el histórico de lo
   * que le mandamos TIENE que sobrevivir.
   */
  connection_id UUID REFERENCES public.amazon_connections(id) ON DELETE SET NULL,
  marketplace_id TEXT NOT NULL,

  /** Como lo llama el equipo. En el Excel era el nombre de la pestaña */
  nombre TEXT,

  /**
   * EL DÍA QUE SALE LA MERCANCÍA, y el origen del reparto: las ventas
   * anteriores a esta fecha no consumen esta remesa.
   *
   * No es la fecha de llegada a Amazon, que no se sabe al crearla. Cuando el
   * libro mayor confirme la entrada se guardará en `llegada_at`, y entonces el
   * motor puede afinar. Hasta entonces manda esta.
   */
  fecha_envio DATE NOT NULL,

  /**
   * El identificador del envío en Amazon (el «Reference ID» de un Receipt).
   * Se puede escribir a mano al crearla, o lo rellena solo el motor cuando
   * reconoce la entrada en el libro mayor.
   */
  referencia_envio TEXT,
  llegada_at TIMESTAMPTZ,

  nota TEXT,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.fba_remesas IS
  'Un envío a los almacenes de Amazon. El reparto FIFO NO se guarda aquí: se '
  'calcula al vuelo desde fba_movimientos.';

CREATE INDEX IF NOT EXISTS fba_remesas_cliente_fecha_idx
  ON public.fba_remesas (client_id, fecha_envio DESC);
CREATE INDEX IF NOT EXISTS fba_remesas_conexion_idx
  ON public.fba_remesas (connection_id) WHERE connection_id IS NOT NULL;


/* ------------------------------------------------------------------ */
/* 2) Las líneas: una por referencia dentro de la remesa               */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.fba_remesa_lineas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  remesa_id UUID NOT NULL REFERENCES public.fba_remesas(id) ON DELETE CASCADE,

  /**
   * El SKU del vendedor. TIENE que ser el mismo que Amazon devuelve en la
   * columna MSKU del libro mayor, porque es por donde se cruzan las ventas.
   * En el Excel de ShoesF es la columna FBASKU (FBA047768-40).
   */
  sku TEXT NOT NULL,
  unidades INTEGER NOT NULL CHECK (unidades > 0),

  /**
   * DESCRIPTIVOS, TODOS OPCIONALES.
   *
   * Cuando el cliente está conectado salen del espejo del catálogo y no hace
   * falta escribirlos. Cuando no lo está —ShoesF— se escriben aquí, porque si
   * no la pantalla sería una lista de códigos.
   *
   * `variante` es la talla en el caso de las zapatillas. Se llama así y no
   * `talla` porque el siguiente cliente tendrá colores, capacidades o voltajes,
   * y una columna que se llama «talla» con un voltaje dentro se lee mal.
   */
  referencia TEXT,
  nombre TEXT,
  variante TEXT,
  ean TEXT,
  fnsku TEXT,
  asin TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /** Un SKU no puede ir dos veces en la misma remesa: serían dos lotes del
      mismo lote y el reparto no sabría cuál consumir primero */
  UNIQUE (remesa_id, sku)
);

CREATE INDEX IF NOT EXISTS fba_remesa_lineas_sku_idx
  ON public.fba_remesa_lineas (sku);


/* ------------------------------------------------------------------ */
/* 3) El libro mayor, copiado                                          */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.fba_movimientos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,

  /** El día de negocio. Es por lo que se ordena el consumo */
  fecha DATE NOT NULL,
  ocurrido_at TIMESTAMPTZ,

  /**
   * Tal y como lo llama Amazon, SIN traducir y SIN filtrar aquí.
   *
   * Qué cuenta como consumo y qué no lo decide el motor, no la base: el día que
   * Amazon añada un tipo nuevo, quiero que llegue a la tabla y se vea, no que un
   * CHECK lo tire y nos enteremos por un descuadre seis meses después.
   */
  tipo TEXT NOT NULL,

  /** Viene relleno en Receipts y Adjustments. En ventas y devoluciones, no */
  referencia TEXT,

  /** Con signo, como lo manda Amazon */
  cantidad INTEGER NOT NULL,

  /** SELLABLE, DEFECTIVE, CUSTOMER_DAMAGED, WAREHOUSE_DAMAGED… Es lo que
      distingue una devolución que vuelve vendible de una que no */
  disposicion TEXT,
  motivo TEXT,
  centro TEXT,
  pais TEXT,

  leido_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.fba_movimientos IS
  'Copia del informe GET_LEDGER_DETAIL_VIEW_DATA. Solo inserción: la pasada '
  'borra la ventana de fechas que va a releer y la vuelve a escribir entera, '
  'que es lo que la hace repetible sin duplicar. Amazon no da identificador de '
  'fila, así que no hay clave natural con la que deduplicar.';

CREATE INDEX IF NOT EXISTS fba_movimientos_reparto_idx
  ON public.fba_movimientos (connection_id, marketplace_id, sku, fecha);
CREATE INDEX IF NOT EXISTS fba_movimientos_ventana_idx
  ON public.fba_movimientos (connection_id, marketplace_id, fecha);
CREATE INDEX IF NOT EXISTS fba_movimientos_referencia_idx
  ON public.fba_movimientos (referencia) WHERE referencia IS NOT NULL;


/* ------------------------------------------------------------------ */
/* 4) Hasta dónde se ha leído el libro mayor de cada cuenta            */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.fba_lecturas (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,

  /** El día más reciente que se ha leído entero */
  leido_hasta DATE,
  ultimo_informe TEXT,
  ultimo_intento_at TIMESTAMPTZ,
  ultimo_error TEXT,

  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (connection_id, marketplace_id)
);


/* ------------------------------------------------------------------ */
/* 5) RLS · el mismo listón y el mismo patrón que la 118              */
/* ------------------------------------------------------------------ */
--
-- Solo LECTURA para admin, y las escrituras REVOCADAS para todo el mundo.
--
-- Es el patrón de la 118 y no un exceso: todo lo que escribe aquí es servidor
-- —la pasada del libro mayor y las rutas de /api/fba, que ya comprueban admin—,
-- y usa la clave de servicio, que se salta RLS. Dejar abierto el INSERT desde el
-- navegador solo añadiría una puerta que nadie usa.

ALTER TABLE public.fba_remesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_remesa_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_lecturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins leen remesas" ON public.fba_remesas;
CREATE POLICY "Admins leen remesas"
  ON public.fba_remesas FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins leen lineas de remesa" ON public.fba_remesa_lineas;
CREATE POLICY "Admins leen lineas de remesa"
  ON public.fba_remesa_lineas FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins leen movimientos" ON public.fba_movimientos;
CREATE POLICY "Admins leen movimientos"
  ON public.fba_movimientos FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins leen lecturas" ON public.fba_lecturas;
CREATE POLICY "Admins leen lecturas"
  ON public.fba_lecturas FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_remesas FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_remesa_lineas FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_movimientos FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_lecturas FROM authenticated, anon;
