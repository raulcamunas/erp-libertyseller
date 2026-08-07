-- =====================================================
-- AMAZON API (Selling Partner API) — NÚCLEO
-- =====================================================
-- Hoy el stock de un cliente llega a Amazon por fichero: el cliente manda el
-- volcado de su ERP, el módulo «Sincronismo de stock» lo cruza contra su tabla
-- de mapeo y escupe un Excel que alguien sube a mano a Seller Central. Funciona
-- y no se toca (migración 106), pero tiene dos techos: hay que estar delante
-- para subirlo, y el precio no se toca nunca porque no cabe en ese fichero.
--
-- Estas tablas son el otro camino: hablar con la Selling Partner API de Amazon
-- directamente, leer el catálogo del cliente cada 15 minutos y poder cambiarle
-- el precio y el stock desde el ERP.
--
-- LA IDEA CENTRAL, Y CONDICIONA TODO LO DEMÁS:
--
--   EL REFRESH TOKEN ES LA LLAVE DE LA TIENDA DE UN CLIENTE.
--
-- No es una credencial nuestra, es la de él. Con ese token se puede cambiar el
-- precio de todo su catálogo. Por eso vive CIFRADO en una columna que el
-- navegador no puede leer ni siquiera siendo admin: la tabla no tiene GRANT ni
-- política permisiva para `authenticated`, y la pantalla se sirve desde el
-- servidor con service_role y una lista de columnas EXPLÍCITA que no incluye el
-- token. Un `select('*')` sobre amazon_connections desde una ruta que devuelva
-- su resultado al navegador es el fallo grave de este módulo; está dicho
-- también en lib/amazon/data.ts, que es el único sitio que lee esa columna.
--
-- LA SEGUNDA DECISIÓN QUE NO ES OBVIA: EL ESPEJO DEL CATÁLOGO NO ES UNA CACHÉ.
-- amazon_listings guarda lo último que Amazon contestó, con `last_seen_at`. Se
-- necesita para tres cosas que una caché no daría: pintar la tabla sin esperar
-- a la API, saber el VALOR ANTERIOR de lo que se va a cambiar (sin eso no hay
-- deshacer ni auditoría que valga), y guardar el `product_type`, que es
-- OBLIGATORIO en cada PATCH y no se puede inventar: solo se conoce leyendo el
-- listing.
--
-- LA TERCERA: `amazon_submissions` NO ES UN LOG DE DEPURACIÓN. Es la única
-- forma de contestar «¿por qué mi producto está a otro precio?» seis meses
-- después. Por eso guarda el valor anterior además del nuevo, quién lo mandó,
-- qué contestó Amazon (submission_id y request_id incluidos) y de dónde salió
-- el cambio: de una edición a mano o de un fichero procesado. Ese último campo
-- —`source`— es lo que deja que la fase 2 (enchufar el motor de ficheros de
-- stock-sync a esta API) entre sin rehacer la tabla.
--
-- Y UNA CUARTA, DE MODELO: UN CLIENTE PUEDE TENER VARIAS CONEXIONES. Una
-- autorización de Amazon cubre una REGIÓN entera, así que España, Francia,
-- Italia y Alemania caben en la misma; Estados Unidos es otra región y va
-- aparte, con su propio token. De ahí amazon_clients (1) -> amazon_connections
-- (N, una por región) -> marketplace_ids (N dentro de cada una). Región y
-- marketplace son datos de la fila, nunca constantes en el código.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción:
-- reventar aquí deja la base intacta en vez de a medias, con tablas de tokens
-- sueltas que nadie sabría de dónde salieron.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RAISE EXCEPTION 'No existe public.profiles. Esta migración va después de las de usuarios.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella las políticas RLS de abajo dejarían estas tablas abiertas a cualquiera, y aquí hay llaves de tiendas ajenas.';
  END IF;
END $$;

-- =====================================================
-- 1) CLIENTES
-- =====================================================
-- Independiente de stock_clients, y no por comodidad. Son dos conjuntos
-- distintos: en stock_clients está quien nos manda un Excel (hoy, uno), y aquí
-- estará todo el que autorice la aplicación. Atarlos con una FK obligaría a dar
-- de alta en sincronismo de stock a cualquiera que conecte su cuenta, y al
-- revés: un cliente que manda Excel pero no ha autorizado aparecería aquí con
-- un botón muerto. Es la misma decisión que ya se tomó tres veces en este ERP
-- (treasury_clients, marketing_clients, stock_clients son independientes).
--
-- El puente entre los dos mundos, cuando llegue la fase 2, es el SKU:
-- stock_mappings.sku_amazon = amazon_listings.sku. No hace falta una FK para
-- eso, y meterla ahora ataría dos módulos que hoy tienen que poder vivir solos.
CREATE TABLE IF NOT EXISTS public.amazon_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  /** Único para que la semilla de abajo se pueda reejecutar sin duplicar */
  name TEXT NOT NULL UNIQUE,
  /**
   * Identificador estable y legible, misma forma que stock_clients.slug. Es lo
   * que irá en la URL y lo que permite referirse a un cliente sin conocer su
   * UUID. Se restringe la forma para que no acaben conviviendo «Shoplamp» y
   * «shop lamp» como dos clientes distintos.
   */
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  /** Orden de los botones en la pantalla; NULL va al final */
  position INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_amazon_clients_activos
  ON public.amazon_clients(is_active, position);

-- La cuenta de la propia agencia. Mientras la aplicación esté en BORRADOR en el
-- portal de Amazon, la única cuenta que se puede autorizar es la del
-- desarrollador, así que las primeras pruebas van contra esta fila. Se siembra
-- para que el flujo de autorización se pueda probar de punta a punta sin haber
-- escrito todavía la pantalla de alta de clientes.
INSERT INTO public.amazon_clients (name, slug, position, notes)
SELECT
  'Liberty Seller (cuenta propia)',
  'liberty-seller',
  0,
  'Cuenta de vendedor de la agencia. Con la aplicación en borrador es la única que Amazon deja autorizar, así que es contra esta contra la que se prueba.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.amazon_clients WHERE slug = 'liberty-seller'
);

-- =====================================================
-- 2) CONEXIONES (aquí vive el token)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.amazon_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  /** CASCADE: si se borra el cliente, su llave se va con él. Una llave de una
      tienda huérfana es exactamente lo que no puede quedar por ahí */
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /** Cómo se llama esta conexión en pantalla. Se rellena con el nombre de la
      tienda que devuelve getMarketplaceParticipations (`storeName`), pero es
      editable: un cliente con tienda en Europa y otra en EEUU necesita
      distinguirlas y el nombre que pone Amazon puede ser el mismo */
  name TEXT NOT NULL,

  /** El identificador del vendedor que devuelve Amazon en el callback de OAuth
      (`selling_partner_id`). Es lo que va en la ruta de casi todas las
      llamadas, y es el único dato que identifica la tienda si algún día
      desaparece esta fila: por eso se copia también en amazon_submissions */
  selling_partner_id TEXT NOT NULL,

  /** Región de la API, NO país. Una autorización cubre la región entera:
      'eu' vale para España, Francia, Italia y Alemania a la vez.
      Los endpoints y la URL de Seller Central de cada una están en
      lib/types/amazon.ts (AMAZON_REGIONS) y no se escriben aquí: son datos
      de la aplicación, no de la base */
  region TEXT NOT NULL CHECK (region IN ('eu', 'na', 'fe')),

  /** Marketplaces que cubre esta conexión, descubiertos con
      getMarketplaceParticipations al autorizar. Array y no una tabla aparte
      porque no tienen datos propios: son cinco identificadores y siempre se
      leen enteros */
  marketplace_ids TEXT[] NOT NULL DEFAULT '{}',

  /** Con cuál se abre la pantalla. Sin esto, una conexión con cuatro países no
      sabe cuál enseñar y la elección quedaría al azar del orden del array,
      que es justo lo que no puede pasar cuando lo siguiente que se hace es
      escribir un precio */
  default_marketplace_id TEXT,

  /**
   * EL REFRESH TOKEN, CIFRADO. Nunca en claro, ni aquí, ni en un log, ni en un
   * mensaje de error, ni en una respuesta al navegador.
   *
   * Formato: 'v1.<iv>.<tag>.<ciphertext>' en base64url, AES-256-GCM. Lo
   * producen encryptToken()/decryptToken() de lib/amazon/crypto.ts.
   *
   * La clave vive en AMAZON_TOKEN_KEY (variable de entorno, solo servidor) y NO
   * está en la base de datos a propósito: quien se lleve un volcado de Postgres
   * NO se lleva las tiendas de los clientes.
   *
   * TEXT y no BYTEA porque el valor ya va cifrado y en base64: por BYTEA
   * PostgREST devuelve una cadena hexadecimal con prefijo '\x' que habría que
   * volver a parsear en cada lado, y no se gana nada.
   */
  refresh_token_enc TEXT NOT NULL,

  /**
   * Estado de la conexión, tal y como hay que enseñárselo a una persona:
   *   activa    -> se puede leer y escribir
   *   revocada  -> el cliente quitó el acceso desde su Seller Central
   *   caducada  -> pasaron los 365 días y toca volver a autorizar
   *   error     -> Amazon devuelve 403 por otra razón (rol que falta, cuenta
   *                suspendida, región equivocada). status_detail lo explica
   *
   * No es decorativo: un refresco que falla tiene que dejar la conexión en un
   * estado que la pantalla pueda pintar, o el catálogo se queda viejo sin que
   * nadie se entere.
   */
  status TEXT NOT NULL DEFAULT 'activa'
    CHECK (status IN ('activa', 'revocada', 'caducada', 'error')),
  /** Qué le pasa, en español y sin JSON: es lo que va a leer una persona */
  status_detail TEXT,

  /** Cuándo autorizó el cliente y quién de nosotros lanzó el flujo.
      SET NULL: si esa persona se va del ERP, la conexión se queda */
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authorized_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  /** Último refresco CORRECTO del catálogo, y cuántas líneas trajo */
  last_sync_at TIMESTAMPTZ,
  last_sync_items INTEGER,
  /** Último INTENTO, saliera bien o mal. Separado del anterior a propósito:
      si solo hubiera uno, una conexión rota parecería recién sincronizada */
  last_sync_attempt_at TIMESTAMPTZ,
  /** Qué falló en el último intento, en español. NULL = el último fue bien */
  last_sync_error TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /** Un vendedor solo puede tener una conexión viva por región: autorizar otra
      vez sustituye el token, no añade una fila. Sin esto, dos filas del mismo
      vendedor con tokens distintos harían que el refresco escribiera el mismo
      catálogo dos veces y que «revocar» dejara la otra funcionando */
  UNIQUE (selling_partner_id, region),

  /** El marketplace por defecto tiene que estar entre los que cubre */
  CONSTRAINT amazon_connections_default_mkt_ok
    CHECK (default_marketplace_id IS NULL OR default_marketplace_id = ANY (marketplace_ids)),
  /** Si no está activa, hay que decir por qué. «Roto y sin explicación» es el
      estado que obliga a abrir la consola para entender la pantalla */
  CONSTRAINT amazon_connections_detalle_ok
    CHECK (status = 'activa' OR btrim(COALESCE(status_detail, '')) <> '')
);

COMMENT ON COLUMN public.amazon_connections.refresh_token_enc IS
  'Refresh token de LWA cifrado con AES-256-GCM (lib/amazon/crypto.ts). La clave está en AMAZON_TOKEN_KEY, fuera de la base. NUNCA se devuelve al navegador ni se escribe en un log.';

COMMENT ON COLUMN public.amazon_connections.marketplace_ids IS
  'Marketplaces que cubre la autorización, descubiertos con getMarketplaceParticipations. Una autorización europea cubre ES, FR, IT y DE; Estados Unidos necesita otra conexión aparte.';

CREATE INDEX IF NOT EXISTS idx_amazon_connections_cliente
  ON public.amazon_connections(client_id, region);

-- La consulta de cada carga de pantalla y la del cron: «qué conexiones hay que
-- refrescar». Parcial porque las rotas no se tocan hasta que alguien las
-- vuelva a autorizar.
CREATE INDEX IF NOT EXISTS idx_amazon_connections_activas
  ON public.amazon_connections(last_sync_at)
  WHERE status = 'activa' AND is_active;

-- =====================================================
-- 3) ESTADO DEL FLUJO DE AUTORIZACIÓN (CSRF)
-- =====================================================
-- Amazon no devuelve NADA nuestro en el callback: solo `state`,
-- `selling_partner_id` y el código. El `state` es el único hilo que conecta ese
-- código con el cliente del ERP que lo pidió, así que tiene que estar guardado
-- antes de mandar a nadie a Amazon.
--
-- Y es además la protección contra CSRF que exige la documentación: se genera
-- uno por petición, se valida al volver y si no coincide SE RECHAZA. Sin esa
-- comprobación, alguien puede inducir a un admin a completar un flujo que
-- engancha una cuenta de Amazon que no es la del cliente que se creía.
--
-- Vida corta (minutos) y un solo uso: `consumed_at` lo marca. Un state que se
-- pueda reutilizar deja de ser una defensa.
CREATE TABLE IF NOT EXISTS public.amazon_oauth_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  /** El valor que viaja a Amazon. Único: es la clave de búsqueda al volver */
  state TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  region TEXT NOT NULL CHECK (region IN ('eu', 'na', 'fe')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_amazon_oauth_states_caducidad
  ON public.amazon_oauth_states(expires_at);

-- =====================================================
-- 4) ESPEJO DEL CATÁLOGO
-- =====================================================
CREATE TABLE IF NOT EXISTS public.amazon_listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  /** El marketplace del que son ESTOS datos. El mismo SKU tiene precio y stock
      distintos en España y en Francia, así que forma parte de la clave */
  marketplace_id TEXT NOT NULL,
  /** La clave del negocio, igual que en stock_mappings: el SKU identifica el
      listing. El ASIN no vale, dos SKU pueden apuntar al mismo */
  sku TEXT NOT NULL,
  asin TEXT,
  title TEXT,

  /**
   * OBLIGATORIO en cada PATCH que se mande a Amazon, y no se puede deducir:
   * sale de summaries[].productType al leer el catálogo. Si está a NULL, ese
   * listing NO se puede modificar y la pantalla tiene que decirlo en vez de
   * mandar una petición que Amazon rechazará con un 400.
   */
  product_type TEXT,
  /** new_new, used_good... tal cual lo devuelve Amazon */
  condition_type TEXT,
  /** BUYABLE / DISCOVERABLE. Array porque pueden darse los dos a la vez */
  listing_status TEXT[] NOT NULL DEFAULT '{}',

  /** NUMERIC sin escala fija: Amazon devuelve el importe como CADENA
      («14.99») justamente para que nadie pierda precisión por el camino, y
      hay marketplaces sin decimales. NULL = el listing no tiene precio en
      este marketplace, que es distinto de valer 0 */
  price NUMERIC,
  currency TEXT,

  /**
   * Unidades declaradas en fulfillment_availability.
   *
   * OJO, y es la trampa de este módulo: esto SOLO tiene sentido para los
   * listings gestionados por el vendedor (canal 'DEFAULT'). En un listing FBA
   * la cantidad real la lleva Amazon y viene de getInventorySummaries, no de
   * aquí; escribir esta columna en un FBA no cambia nada en la tienda.
   */
  quantity INTEGER,

  /** 'DEFAULT' = lo manda el vendedor (MFN/FBM). 'AMAZON_EU', 'AMAZON_NA'... =
      lo manda Amazon (FBA). Se guarda el código tal cual porque los valores
      posibles dependen del vendedor y de los programas en los que esté */
  fulfillment_channel_code TEXT,
  /**
   * Derivada, y generada por la base a propósito: si fuera una columna normal
   * que escribe la aplicación acabaría discrepando del código de canal, y de
   * esta columna depende que el stock sea editable o de solo lectura. Un
   * desajuste aquí es un cambio de stock que se manda a Amazon y no hace nada.
   */
  is_fba BOOLEAN GENERATED ALWAYS AS (
    fulfillment_channel_code IS NOT NULL AND fulfillment_channel_code <> 'DEFAULT'
  ) STORED,

  /** Stock en la red de Amazon, de getInventorySummaries. Solo se rellena para
      clientes que venden por FBA. NULL = no se ha consultado (no es 0) */
  fba_quantity INTEGER,
  fba_fulfillable_quantity INTEGER,

  /** Cuándo lo leímos nosotros por última vez */
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Cuándo dice Amazon que cambió por última vez (summaries[].lastUpdatedDate).
      Es lo que permite el refresco incremental con lastUpdatedAfter en vez de
      barrer el catálogo entero cada cuarto de hora */
  amazon_last_updated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE (connection_id, marketplace_id, sku),
  CONSTRAINT amazon_listings_precio_ok CHECK (price IS NULL OR price >= 0),
  CONSTRAINT amazon_listings_cantidad_ok CHECK (quantity IS NULL OR quantity >= 0)
);

-- Por si la tabla ya existía de una ejecución anterior sin estas columnas: el
-- CREATE TABLE de arriba lleva IF NOT EXISTS y ahí no entra nada.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS fba_quantity INTEGER;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS fba_fulfillable_quantity INTEGER;

COMMENT ON COLUMN public.amazon_listings.product_type IS
  'Tipo de producto de Amazon (summaries[].productType). Es obligatorio en cada patchListingsItem: sin él no se puede cambiar ni el precio ni el stock de este SKU.';

COMMENT ON COLUMN public.amazon_listings.is_fba IS
  'Derivada del canal de logística. Si es true, el stock lo gestiona Amazon: la celda de cantidad va de SOLO LECTURA y su valor sale de fba_quantity.';

-- La consulta real de la pantalla: «el catálogo de esta conexión en este
-- marketplace, por SKU». El UNIQUE de arriba ya la cubre entera.
--
-- Este otro es para la fase 2 y para investigar una incidencia: «dónde aparece
-- este SKU», que es como se cruzará con stock_mappings.sku_amazon.
CREATE INDEX IF NOT EXISTS idx_amazon_listings_sku
  ON public.amazon_listings(sku);

-- «Qué hace falta refrescar», y también «qué desapareció del catálogo»: las
-- filas cuyo last_seen_at se quedó atrás tras un barrido completo son listings
-- que Amazon ya no devuelve.
CREATE INDEX IF NOT EXISTS idx_amazon_listings_frescura
  ON public.amazon_listings(connection_id, last_seen_at);

-- =====================================================
-- 5) REGISTRO DE CAMBIOS ENVIADOS
-- =====================================================
-- Una fila por CAMBIO, no por envío: cambiar el precio y el stock de un mismo
-- SKU son dos filas. Es lo que permite contestar «¿quién le tocó el precio a
-- esto y cuándo?» sin tener que abrir un JSON.
CREATE TABLE IF NOT EXISTS public.amazon_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  /** SET NULL y no CASCADE, al revés que en las otras tablas, y es deliberado:
      si se borra la conexión el registro TIENE que sobrevivir. Es contabilidad
      de lo que hemos tocado en la tienda de otro. Los dos campos de abajo
      guardan a qué tienda y a qué marketplace fue, así que la fila se sigue
      entendiendo sola sin la conexión */
  connection_id UUID REFERENCES public.amazon_connections(id) ON DELETE SET NULL,
  /** Congelados al enviar: identifican la tienda aunque la conexión ya no esté */
  selling_partner_id TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,

  sku TEXT NOT NULL,
  asin TEXT,

  /** Qué se tocó. 'precio' viaja en el atributo purchasable_offer y 'cantidad'
      en fulfillment_availability. Hoy son los dos únicos: el título y el resto
      se pueden cambiar con los mismos permisos, pero no se hace desde aquí */
  field TEXT NOT NULL CHECK (field IN ('precio', 'cantidad')),

  /**
   * Valor ANTERIOR y valor NUEVO, tal y como se leyeron y se escribieron.
   *
   * El anterior no es adorno: es lo único que permite deshacer, y lo que
   * distingue «se lo subimos nosotros de 12 a 15» de «llegó así». Sale del
   * espejo del catálogo justo antes de enviar; NULL significa que no había
   * valor previo conocido, que es distinto de 0.
   *
   * TEXT y no NUMERIC aunque hoy los dos campos sean números: el día que se
   * registre un cambio de título, la tabla lo admite sin migrar. Nadie suma
   * estas columnas.
   */
  previous_value TEXT,
  new_value TEXT NOT NULL,
  /** Divisa del cambio de precio. Sin ella, «15» no dice nada en una conexión
      que cubre España y Estados Unidos */
  currency TEXT,

  /**
   * DE DÓNDE SALIÓ EL CAMBIO. Decisión de diseño, no un campo informativo:
   *   'manual'  -> alguien lo tecleó en la tabla de la pantalla
   *   'fichero' -> lo produjo un fichero del cliente ya procesado (fase 2:
   *                enchufar el motor de cruce de stock-sync a esta API)
   *
   * Está desde el primer día para que la fase 2 no tenga que tocar esta tabla,
   * y porque el día que un precio salga mal, lo primero que hay que saber es si
   * lo tecleó una persona o lo generó un proceso.
   */
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'fichero')),
  /** Del fichero o proceso que lo originó: nombre del fichero, id de un
      stock_runs... NULL cuando es manual */
  source_ref TEXT,

  /** Agrupa todo lo que salió de un mismo botón «Enviar cambios». Sin esto, 40
      filas con la misma marca de tiempo no se distinguen de 40 envíos sueltos,
      y deshacer «lo de las 11:20» dejaría de tener sentido */
  batch_id UUID NOT NULL,

  /** Quién lo mandó. NULL cuando lo lanzó un proceso automático */
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  /**
   * Estado del envío:
   *   pendiente   -> registrado, todavía no ha salido
   *   aceptado    -> Amazon contestó ACCEPTED. OJO: aceptado para PROCESAR,
   *                  no aplicado. Se aplica más tarde, aguas abajo
   *   confirmado  -> un refresco posterior vio el valor nuevo en Amazon. Es la
   *                  única prueba de que el cambio llegó de verdad
   *   invalido    -> Amazon contestó HTTP 200 con status INVALID. Este es el
   *                  que se le escapa a todo el mundo: un precio mal formado
   *                  NO devuelve un 4xx, devuelve un 200 con issues dentro
   *   error       -> no salió (403, 400, 5xx tras los reintentos, red)
   */
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'aceptado', 'confirmado', 'invalido', 'error')),

  /** El identificador de envío que devuelve Amazon. Cada reintento genera uno
      nuevo, por eso el identificador propio de la operación es el `id` de esta
      fila y no este */
  submission_id TEXT,
  /** x-amzn-RequestId. Es LO ÚNICO que sirve para abrir un caso con soporte de
      Amazon, así que se guarda incluso cuando todo va bien */
  request_id TEXT,
  http_status INTEGER,
  /** Los issues de Amazon tal cual, para no perder nada */
  issues JSONB,
  /** Y lo mismo ya traducido a español, que es lo que se enseña en pantalla */
  error_message TEXT,
  /** Cuántos intentos costó (los 429 y los 5xx se reintentan) */
  attempts INTEGER NOT NULL DEFAULT 0,

  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /** Todo lo que ha salido lleva la hora a la que salió */
  CONSTRAINT amazon_submissions_enviado_ok
    CHECK (status = 'pendiente' OR sent_at IS NOT NULL),
  /** Y todo lo que ha fallado dice por qué. Un fallo mudo obliga a abrir la
      consola del servidor para entender la pantalla */
  CONSTRAINT amazon_submissions_fallo_motivado
    CHECK (status NOT IN ('invalido', 'error') OR btrim(COALESCE(error_message, '')) <> ''),
  /** Un cambio de precio sin divisa no se puede leer seis meses después */
  CONSTRAINT amazon_submissions_divisa_ok
    CHECK (field <> 'precio' OR currency IS NOT NULL),
  /** Y uno que viene de un fichero tiene que decir de cuál */
  CONSTRAINT amazon_submissions_origen_ok
    CHECK (source <> 'fichero' OR btrim(COALESCE(source_ref, '')) <> '')
);

COMMENT ON TABLE public.amazon_submissions IS
  'Registro de todo lo que este ERP ha cambiado en la tienda de un cliente. No es un log de depuración: es la única forma de saber, meses después, si un precio raro salió de aquí. No se borra nunca.';

COMMENT ON COLUMN public.amazon_submissions.source IS
  'manual = lo tecleó una persona en la pantalla. fichero = lo generó el procesado de un fichero del cliente (fase 2). Distinguirlos es lo primero que hace falta cuando un precio sale mal.';

-- «Lo último que se ha enviado en esta conexión», que es la vista de la
-- pantalla y la de cualquier investigación.
CREATE INDEX IF NOT EXISTS idx_amazon_submissions_conexion
  ON public.amazon_submissions(connection_id, created_at DESC);

-- «Qué le hemos hecho a este SKU», que es la pregunta literal del cliente.
CREATE INDEX IF NOT EXISTS idx_amazon_submissions_sku
  ON public.amazon_submissions(selling_partner_id, sku, created_at DESC);

-- Un envío entero, para poder deshacerlo junto.
CREATE INDEX IF NOT EXISTS idx_amazon_submissions_lote
  ON public.amazon_submissions(batch_id);

-- Índice parcial para lo que queda por confirmar: son unas pocas filas dentro
-- de una tabla que crece para siempre, y es la consulta que lanza cada
-- refresco de catálogo para pasar 'aceptado' a 'confirmado'.
CREATE INDEX IF NOT EXISTS idx_amazon_submissions_sin_confirmar
  ON public.amazon_submissions(connection_id, sku)
  WHERE status IN ('pendiente', 'aceptado');

-- =====================================================
-- updated_at
-- =====================================================
-- Función propia del módulo y no la de otro: que esto no dependa de que nadie
-- renombre la de empleados o la de vacaciones.
CREATE OR REPLACE FUNCTION public.update_amazon_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_amazon_clients_updated ON public.amazon_clients;
CREATE TRIGGER trg_amazon_clients_updated
  BEFORE UPDATE ON public.amazon_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

DROP TRIGGER IF EXISTS trg_amazon_connections_updated ON public.amazon_connections;
CREATE TRIGGER trg_amazon_connections_updated
  BEFORE UPDATE ON public.amazon_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

DROP TRIGGER IF EXISTS trg_amazon_listings_updated ON public.amazon_listings;
CREATE TRIGGER trg_amazon_listings_updated
  BEFORE UPDATE ON public.amazon_listings
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

DROP TRIGGER IF EXISTS trg_amazon_submissions_updated ON public.amazon_submissions;
CREATE TRIGGER trg_amazon_submissions_updated
  BEFORE UPDATE ON public.amazon_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

-- =====================================================
-- RLS
-- =====================================================
-- SOLO ADMIN EN LAS CINCO. Esta app cambia precios en tiendas que no son
-- nuestras: el listón es el mismo que el de Control empleados, ni un partner
-- entra. `public.is_erp_admin(uuid)` es la de la migración 111; no se crea otra
-- función de rol porque dos comprobaciones de «quién es admin» acaban
-- discrepando.
--
-- Y en las tres tablas NADIE ESCRIBE DESDE EL NAVEGADOR. Todas las escrituras
-- pasan por app/api/amazon/**, que van con service_role después de haber
-- comprobado el rol contra la sesión. Dos candados en el mismo sentido:
--   a) sin GRANT, `authenticated` ni lo intenta;
--   b) sin política permisiva, si alguien restaurara el GRANT algún día (un
--      `GRANT ALL ON ALL TABLES IN SCHEMA public` de los que se escriben sin
--      pensar), RLS seguiría diciendo que no.
-- TRUNCATE va en la lista de REVOKE porque entra en el GRANT ALL de Supabase y
-- RLS NO SE APLICA A TRUNCATE.

-- ---------- Clientes: se leen, no se escriben ----------
ALTER TABLE public.amazon_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read amazon clients" ON public.amazon_clients;
CREATE POLICY "Admins read amazon clients"
  ON public.amazon_clients FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.amazon_clients FROM authenticated, anon;

-- ---------- Conexiones: NO SE LEEN SIQUIERA ----------
-- Aquí está el token. No hay política de SELECT y no es un olvido: aunque vaya
-- cifrado, un ciphertext en el navegador es material que no tiene por qué
-- salir del servidor, y la pantalla no lo necesita para nada. Lo que la
-- pantalla enseña (nombre, marketplaces, estado, último refresco) se lo sirve
-- el Server Component con service_role y una lista de columnas explícita.
--
-- Consecuencia práctica que hay que tener presente al escribir la pantalla: un
-- `supabase.from('amazon_connections').select(...)` desde el navegador devuelve
-- CERO FILAS, sin error. Es a propósito.
ALTER TABLE public.amazon_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read amazon connections" ON public.amazon_connections;
DROP POLICY IF EXISTS "Admins manage amazon connections" ON public.amazon_connections;

-- REVOKE ALL y no la lista de cuatro verbos que se usa en las demás tablas del
-- ERP: en esta hay llaves de tiendas ajenas, así que se retira TODO, incluidos
-- TRIGGER y REFERENCES, que el GRANT ALL de Supabase también reparte. Un
-- trigger propio sobre esta tabla podría leer la columna del token saltándose
-- que no haya SELECT.
REVOKE ALL ON public.amazon_connections FROM authenticated, anon;

-- ---------- El state de OAuth: tampoco ----------
-- Un state que se pueda leer desde el navegador deja de proteger de nada.
ALTER TABLE public.amazon_oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read amazon oauth states" ON public.amazon_oauth_states;

REVOKE ALL ON public.amazon_oauth_states FROM authenticated, anon;

-- ---------- Catálogo y registro de cambios: se leen ----------
ALTER TABLE public.amazon_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read amazon listings" ON public.amazon_listings;
CREATE POLICY "Admins read amazon listings"
  ON public.amazon_listings FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.amazon_listings FROM authenticated, anon;

ALTER TABLE public.amazon_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read amazon submissions" ON public.amazon_submissions;
CREATE POLICY "Admins read amazon submissions"
  ON public.amazon_submissions FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

-- Ni un admin borra de aquí. Un envío rechazado es el registro de que se
-- intentó; si se pudiera borrar, el histórico no serviría para lo único para lo
-- que existe.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.amazon_submissions FROM authenticated, anon;

-- =====================================================
-- Realtime
-- =====================================================
-- Solo el catálogo y el registro de envíos. amazon_connections se queda FUERA a
-- propósito: una publicación de realtime emite la fila entera, y esa fila lleva
-- el token. Que hoy RLS no deje leerla no es razón para meterla en un canal de
-- difusión.
--
-- Con guardia: añadir una tabla que ya está en la publicación da error, y como
-- el editor SQL corre el script entero en una transacción, ese error de la
-- última línea desharía todos los CREATE TABLE de arriba. La migración
-- parecería aplicada sin haber creado nada.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['amazon_listings', 'amazon_submissions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE
      'No se ha podido añadir a la publicación de realtime (%). El módulo funciona igual: la pantalla se refresca cada 15 minutos por su cuenta.',
      SQLERRM;
END $$;

-- =====================================================
-- Permiso de la app
-- =====================================================
-- SOLO ADMINS, igual que 'empleados'. El id 'amazon-api' tiene que coincidir
-- LETRA POR LETRA en tres sitios: aquí, en lib/config/apps.ts y en el mapa
-- routeToAppId de middleware.ts. Si baila en uno de los tres, el módulo queda
-- invisible sin dar ningún error.
--
-- Guarda doble por si la base todavía no tiene esas tablas: un INSERT contra
-- una tabla inexistente tumbaría la transacción y con ella todo lo de arriba.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_app_permissions'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN

    INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
    SELECT p.id, 'amazon-api', true
    FROM public.profiles p
    WHERE p.role = 'admin'
    ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

  END IF;
END $$;
