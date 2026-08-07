-- =====================================================
-- PERFILES DE LECTURA Y EJECUCIONES AUTOMÁTICAS
-- =====================================================
-- Hoy el stock llega a Amazon así: el cliente manda un Excel, alguien lo sube
-- a «Sincronismo de stock», el motor lo cruza y escupe otro Excel que alguien
-- sube a Seller Central. Funciona, pero hay que estar delante, y el lector del
-- fichero está GRABADO EN EL CÓDIGO para un solo cliente: la hoja se llama
-- 'Browser' y las columnas 'Articulo' y 'St. Real' (lib/stock-sync/engine.ts).
-- El segundo cliente no cabe sin tocar TypeScript y desplegar.
--
-- LA IDEA CENTRAL, Y CONDICIONA TODO LO DEMÁS:
--
--   LO ÚNICO QUE CAMBIA DE UN CLIENTE A OTRO ES EL FICHERO Y CÓMO SE
--   INTERPRETA. EL DESTINO ES SIEMPRE EL MISMO.
--
-- Amazon quiere SKU, precio y cantidad, ni más ni menos. El cruce
-- (crossStock) y el envío (sendChanges) ya existen, están probados y no saben
-- nada de ningún cliente concreto. Así que toda la variabilidad del mundo cabe
-- en UNA pieza: el perfil de lectura. Esta tabla ES esa pieza. Si algún día
-- alguien se ve escribiendo un `IF cliente = 'X'` en el código, es que esta
-- tabla se ha quedado corta y hay que añadirle una columna, no un IF.
--
-- LA SEGUNDA DECISIÓN QUE NO ES OBVIA: LAS COLUMNAS SE BUSCAN POR NOMBRE Y
-- NUNCA POR POSICIÓN, y por eso cada campo guarda una LISTA de nombres
-- aceptados (TEXT[]) en vez de uno solo. No es un capricho de flexibilidad: el
-- día que el cliente añade una columna a su exportación, ir por posición
-- escribe el stock de un artículo en el precio de otro SIN DAR NINGÚN ERROR.
-- Ir por nombre falla ruidosamente, que es lo que se quiere.
--
-- LA TERCERA: EL ORIGEN DEL FICHERO ES ENCHUFABLE. Hoy solo hay 'manual'
-- (subida a mano) y 'drive' (carpeta compartida de Google Drive), pero el
-- CHECK ya admite 'sftp' y 'correo' porque todavía no se sabe qué podrá dar
-- cada cliente, y descubrirlo no puede obligar a una migración. La
-- configuración propia de cada conector va en origen_config (JSONB) porque
-- cada uno tiene una forma distinta: un id de carpeta no se parece a un
-- usuario de SFTP. Todo lo demás son columnas de verdad, con su tipo.
--
-- LA CUARTA, Y ES LA QUE EVITA EL DESASTRE: EL ENVÍO AUTOMÁTICO NACE APAGADO
-- (envio_automatico = false) y los frenos viven en la ficha del cliente. Un
-- fichero mal exportado un martes por la noche no puede vaciar el inventario
-- de un cliente en Amazon quince minutos después sin que nadie lo vea. Uno con
-- 400 referencias y otro con 40.000 no toleran los mismos umbrales, así que
-- los umbrales son POR CLIENTE, no constantes del código.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción:
-- reventar aquí deja la base intacta en vez de a medias, con perfiles a los
-- que les falta la mitad de las columnas y que alguien daría por buenos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stock_clients'
  ) THEN
    RAISE EXCEPTION
      'No existe public.stock_clients. Lanza antes 106_stock_sync.sql: el perfil de lectura cuelga del cliente de sincronismo, no al revés.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_connections'
  ) THEN
    RAISE EXCEPTION
      'No existe public.amazon_connections. Lanza antes 118_amazon_api.sql: sin conexión no hay a dónde mandar lo que se lea.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella las políticas RLS de abajo dejarían estas tablas abiertas a cualquiera, y desde aquí se cambia el precio de tiendas ajenas.';
  END IF;
END $$;

-- =====================================================
-- 1) PERFILES DE LECTURA
-- =====================================================
-- Una fila = un fichero que un cliente nos entrega y cómo se interpreta.
--
-- Son VARIOS por cliente a propósito y no uno: Shoplamp entrega dos ficheros
-- distintos con formatos distintos (el volcado de stock y el de códigos de
-- barras), y el segundo es tan «suyo» como el primero. De ahí `tipo`.
CREATE TABLE IF NOT EXISTS public.stock_read_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.stock_clients(id) ON DELETE CASCADE,

  /** Nombre para una persona: «Volcado de stock de Shoplamp» */
  name TEXT NOT NULL,
  /** Identificador estable y legible, misma forma que stock_clients.slug */
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),

  /**
   * Qué es este fichero:
   *   stock -> el volcado principal: referencia, unidades y (si lo trae) precio
   *   ean   -> el índice de códigos de barras del ERP, que alimenta la vía
   *            'ean_erp' del cruce. Sin él se pierde esa vía entera.
   */
  tipo TEXT NOT NULL DEFAULT 'stock' CHECK (tipo IN ('stock', 'ean')),

  -- ---------- De dónde sale el fichero ----------
  /**
   * El conector. 'manual' y 'drive' son los que existen; 'sftp' y 'correo'
   * están en el CHECK para que el día que un cliente solo sepa dar eso no haga
   * falta una migración para apuntarlo. El código tiene un registro de
   * conectores con interfaz común: añadir uno es añadir un fichero, no tocar
   * esta tabla.
   */
  origen TEXT NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual', 'drive', 'sftp', 'correo')),
  /**
   * Configuración propia del conector, y el ÚNICO JSONB de la tabla.
   * Es JSONB porque cada conector tiene una forma distinta y desconocida:
   *   drive  -> { "folder_id": "...", "patron": "ARTICULOS_STOCK*.xlsx", "unidad_compartida": true }
   *   sftp   -> { "host": "...", "ruta": "/out", "usuario": "..." }
   * NUNCA guarda contraseñas ni tokens: si un conector los necesita irán
   * cifrados en su propia columna, con el patrón de lib/amazon/crypto.ts.
   */
  origen_config JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ---------- Formato ----------
  /** 'auto' deja que lo decida la librería por el contenido; los demás lo fuerzan */
  formato TEXT NOT NULL DEFAULT 'auto'
    CHECK (formato IN ('auto', 'xlsx', 'xls', 'csv')),
  /** Solo para CSV: ';' en las exportaciones españolas, ',' en las inglesas */
  csv_separador TEXT,
  /** Solo para CSV: 'utf-8', 'latin1'… Vacío = utf-8 */
  csv_codificacion TEXT,

  -- ---------- Dónde están los datos dentro del fichero ----------
  /** Hoja por NOMBRE. Es lo preferido: sobrevive a que el cliente reordene el libro */
  hoja TEXT,
  /**
   * Hoja por POSICIÓN, empezando en 1, y solo como último recurso: un libro
   * cuya primera hoja cambia de sitio lee otra cosa sin avisar. Si hay nombre,
   * manda el nombre.
   */
  hoja_indice INTEGER CHECK (hoja_indice IS NULL OR hoja_indice >= 1),
  /**
   * Fila de la cabecera, empezando en 1. NULL = búscala sola en las primeras
   * 20 filas, que es lo que hace hoy el motor y funciona con los Excel de
   * trabajo, que suelen llevar un título delante.
   */
  fila_cabecera INTEGER CHECK (fila_cabecera IS NULL OR fila_cabecera >= 1),
  /** Primera fila de datos, empezando en 1. NULL = la siguiente a la cabecera */
  fila_datos INTEGER CHECK (fila_datos IS NULL OR fila_datos >= 1),

  -- ---------- Las columnas, POR NOMBRE ----------
  -- Cada una es una LISTA de nombres aceptados y se compara sin tildes, sin
  -- mayúsculas y sin puntuación (normalizeHeader), así que «Artículo»,
  -- «ARTICULO» y «Cód.Artículo» ya casan solas. La lista sirve para los
  -- nombres REALMENTE distintos: «St. Real» y «Stock disponible».
  --
  -- El orden importa: se prueban de la primera a la última, primero por
  -- coincidencia exacta y luego por «empieza por». Poner un nombre corto y
  -- genérico el primero («EAN») hace que se coma una columna más específica
  -- («EAN_AMAZON»).
  /** OBLIGATORIA siempre: el código del artículo en el ERP del cliente */
  col_referencia TEXT[] NOT NULL DEFAULT '{}',
  /** OBLIGATORIA en los perfiles de tipo 'stock' */
  col_stock TEXT[] NOT NULL DEFAULT '{}',
  /** Precio de venta ya listo para publicar. Vacío = este cliente no manda precio */
  col_precio TEXT[] NOT NULL DEFAULT '{}',
  /** Precio de respaldo: se usa SOLO si la de arriba viene vacía en esa fila */
  col_precio_respaldo TEXT[] NOT NULL DEFAULT '{}',
  /** Coste; solo hace falta con precio_modo = 'margen' */
  col_coste TEXT[] NOT NULL DEFAULT '{}',
  /** OBLIGATORIA en los perfiles de tipo 'ean' */
  col_ean TEXT[] NOT NULL DEFAULT '{}',
  /** Descripción, solo para reconocer la fila al auditar. Nunca obligatoria */
  col_descripcion TEXT[] NOT NULL DEFAULT '{}',
  /** Familia o categoría del artículo; hace falta para excluir familias enteras */
  col_familia TEXT[] NOT NULL DEFAULT '{}',
  /** Solo en los ficheros de EAN que mezclan tipos de código: ver ean_solo_tipo */
  col_tipo TEXT[] NOT NULL DEFAULT '{}',

  /**
   * En un fichero de EAN que mezcla EAN-13 con códigos internos del ERP, el
   * valor de la columna «Tipo» que marca los EAN-13 de verdad (en Shoplamp,
   * 1). NULL = quédate con todo lo que parezca un código de barras.
   *
   * Colar códigos internos aquí no es cosmético: dos artículos distintos pueden
   * casar por un código interno parecido y el stock acaba en el listing
   * equivocado.
   */
  ean_solo_tipo INTEGER,

  -- ---------- Reglas de negocio ----------
  -- Esto es lo que de verdad distingue a un cliente de otro. Todas se aplican
  -- DESPUÉS de leer y ANTES de cruzar, y todas viven en funciones puras
  -- (lib/stock-sync/reglas.ts) para poder comprobarlas sin base de datos.
  /**
   * Unidades que NO se venden en Amazon: las últimas N se guardan para la
   * tienda física, para los pedidos que ya están comprometidos o simplemente
   * como colchón contra el desfase entre el ERP y la realidad del almacén.
   * Se restan antes que nada.
   */
  reserva_unidades INTEGER NOT NULL DEFAULT 0 CHECK (reserva_unidades >= 0),
  /**
   * Por debajo de N unidades (ya descontada la reserva), se publica 0.
   * Es distinto de la reserva: la reserva es «guarda 2 siempre», el umbral es
   * «si quedan menos de 3 no merece la pena arriesgarse a una rotura».
   */
  stock_minimo INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),

  /**
   * De dónde sale el precio:
   *   ninguno -> este cliente no manda precio, solo stock (el caso de hoy)
   *   columna -> de col_precio, con col_precio_respaldo si viene vacía
   *   margen  -> de col_coste aplicando margen_porcentaje (y el IVA si procede)
   */
  precio_modo TEXT NOT NULL DEFAULT 'ninguno'
    CHECK (precio_modo IN ('ninguno', 'columna', 'margen')),
  /** Margen sobre el coste, en tanto por ciento: 35 => coste * 1,35 */
  margen_porcentaje NUMERIC(6, 2),
  /**
   * IVA a añadir al calcular por margen, en tanto por ciento. NULL = el coste
   * ya lo lleva. Amazon publica el precio CON impuestos (value_with_tax): si el
   * cliente da coste sin IVA y aquí no se dice, se publica un 21% barato.
   */
  iva_porcentaje NUMERIC(5, 2),
  /** Suelo y techo de cordura. Un precio fuera de rango descarta la LÍNEA, no la corrige */
  precio_minimo NUMERIC(12, 2) CHECK (precio_minimo IS NULL OR precio_minimo >= 0),
  precio_maximo NUMERIC(12, 2) CHECK (precio_maximo IS NULL OR precio_maximo >= 0),
  /** Divisa de los precios de este fichero. Amazon la exige en cada cambio de precio */
  moneda TEXT NOT NULL DEFAULT 'EUR',

  /** Familias enteras que no se tocan (obra, material de taller, muestras…) */
  familias_excluidas TEXT[] NOT NULL DEFAULT '{}',
  /** Referencias sueltas que no se tocan, en la forma exacta del ERP */
  referencias_excluidas TEXT[] NOT NULL DEFAULT '{}',

  /** Qué se manda. Los dos a la vez, uno, o ninguno (perfil de solo lectura) */
  enviar_stock BOOLEAN NOT NULL DEFAULT true,
  enviar_precio BOOLEAN NOT NULL DEFAULT false,

  -- ---------- A dónde va ----------
  /**
   * El puente que faltaba entre los dos mundos. La migración 118 lo dejó sin
   * FK a propósito («el puente es el SKU»), y para el proceso manual basta.
   * Para el automático no: hay que saber A QUÉ CUENTA se manda lo que se lee, y
   * eso no se puede deducir del SKU.
   *
   * SET NULL y no CASCADE: si el cliente revoca la autorización de Amazon, el
   * perfil de lectura sigue siendo válido y sigue sirviendo para el simulacro.
   * Borrarlo obligaría a reescribir la configuración entera al volver a
   * autorizar.
   */
  connection_id UUID REFERENCES public.amazon_connections(id) ON DELETE SET NULL,
  /**
   * Marketplace concreto al que se aplica. NULL = el marketplace por defecto de
   * la conexión. Un cliente europeo vende el mismo SKU en ES/FR/IT/DE con
   * precio distinto, así que esto NO es un detalle: la clave del espejo del
   * catálogo es (connection_id, marketplace_id, sku).
   */
  marketplace_id TEXT,

  -- ---------- Frenos, POR CLIENTE ----------
  -- NULL = ese freno no se evalúa. Que el valor por defecto sea prudente y no
  -- NULL es deliberado: un perfil recién creado tiene que estar frenado, no
  -- suelto. El día que alguien cree un perfil y encienda el envío sin mirar
  -- esta sección, los frenos ya están puestos.
  /** Porcentaje máximo del catálogo que puede irse a 0 de una vez */
  freno_pct_a_cero NUMERIC(5, 2) DEFAULT 20
    CHECK (freno_pct_a_cero IS NULL OR (freno_pct_a_cero >= 0 AND freno_pct_a_cero <= 100)),
  /** Variación máxima de precio de UNA línea, en tanto por ciento sobre lo publicado */
  freno_variacion_precio_pct NUMERIC(6, 2) DEFAULT 30
    CHECK (freno_variacion_precio_pct IS NULL OR freno_variacion_precio_pct >= 0),
  /**
   * Caída máxima de líneas del fichero respecto a lo habitual, en tanto por
   * ciento. Un fichero que trae 8.000 líneas menos es un volcado a medias, no
   * un almacén vacío, y es EXACTAMENTE el caso que vacía el inventario de un
   * cliente sin que nadie haya hecho nada mal a la vista.
   */
  freno_caida_lineas_pct NUMERIC(5, 2) DEFAULT 15
    CHECK (freno_caida_lineas_pct IS NULL OR (freno_caida_lineas_pct >= 0 AND freno_caida_lineas_pct <= 100)),
  /** Número máximo de SKU que pueden cambiar de golpe */
  freno_max_cambios INTEGER CHECK (freno_max_cambios IS NULL OR freno_max_cambios >= 0),
  /**
   * Cuántas líneas trae este fichero un día normal. Es la referencia contra la
   * que se mide freno_caida_lineas_pct. La escribe el proceso tras una
   * ejecución que se dio por buena; NULL = todavía no hay con qué comparar y
   * ese freno no puede saltar.
   */
  lineas_referencia INTEGER CHECK (lineas_referencia IS NULL OR lineas_referencia >= 0),

  -- ---------- Interruptor general ----------
  /**
   * NACE APAGADO Y HAY QUE ENCENDERLO A CONCIENCIA. Con esto en false el ciclo
   * entero corre igual y deja el simulacro: qué se mandaría, cuántos SKU
   * cambian, cuántos se irían a cero. Eso solo ya vale para dar de alta a un
   * cliente en media hora en vez de en un susto.
   *
   * Motivo concreto para que arranque en false: la escritura de PRECIO contra
   * Amazon todavía no se ha validado contra una cuenta real (el PATCH usa
   * 'merge' en vez del 'replace' del ejemplo oficial, a propósito, para no
   * borrar precio B2B ni rebajas programadas). Hasta que eso se compruebe con
   * una cuenta de verdad, nadie debería encender esto para precio.
   */
  envio_automatico BOOLEAN NOT NULL DEFAULT false,

  /** Cada cuántos minutos se mira el origen. 15 es la cadencia del cron que ya existe */
  cadencia_minutos INTEGER NOT NULL DEFAULT 15 CHECK (cadencia_minutos >= 5),

  /** Último intento y último acierto separados: si solo hubiera uno, un perfil
      roto parecería recién ejecutado */
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  /**
   * Huella del último fichero procesado (md5Checksum de Drive, o la fecha de
   * modificación si el conector no da checksum). Es lo que evita reprocesar el
   * mismo fichero cada 15 minutos y llenar el historial de ruido.
   */
  last_file_fingerprint TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE (client_id, slug),

  /**
   * Un perfil sin las columnas que su tipo necesita no puede leer nada, y el
   * fallo aparecería a las tres de la mañana en el cron y no aquí. Se prohíbe
   * guardarlo.
   */
  CONSTRAINT stock_read_profiles_columnas_ok
    CHECK (
      array_length(col_referencia, 1) IS NOT NULL
      AND (tipo <> 'stock' OR array_length(col_stock, 1) IS NOT NULL)
      AND (tipo <> 'ean' OR array_length(col_ean, 1) IS NOT NULL)
    ),
  /** Con precio por margen hace falta el margen; si no, el precio saldría a coste */
  CONSTRAINT stock_read_profiles_margen_ok
    CHECK (precio_modo <> 'margen' OR margen_porcentaje IS NOT NULL),
  /** Y con precio por columna hace falta saber cuál */
  CONSTRAINT stock_read_profiles_precio_columna_ok
    CHECK (precio_modo <> 'columna' OR array_length(col_precio, 1) IS NOT NULL),
  /** Por margen hace falta el coste, que es de donde sale */
  CONSTRAINT stock_read_profiles_coste_ok
    CHECK (precio_modo <> 'margen' OR array_length(col_coste, 1) IS NOT NULL),
  /** Mandar precio sin saber de dónde sacarlo es el fallo que publica 0,00 € */
  CONSTRAINT stock_read_profiles_precio_ok
    CHECK (enviar_precio = false OR precio_modo <> 'ninguno'),
  /** Suelo por encima del techo deja el catálogo entero descartado sin explicación */
  CONSTRAINT stock_read_profiles_rango_precio_ok
    CHECK (precio_minimo IS NULL OR precio_maximo IS NULL OR precio_minimo <= precio_maximo),
  /** Enviar algo a Amazon exige saber a qué cuenta */
  CONSTRAINT stock_read_profiles_destino_ok
    CHECK (envio_automatico = false OR connection_id IS NOT NULL)
);

COMMENT ON TABLE public.stock_read_profiles IS
  'Cómo se lee e interpreta el fichero de UN cliente. Es la única pieza del proceso que cambia de un cliente a otro: el cruce y el envío son comunes y no saben de clientes.';

COMMENT ON COLUMN public.stock_read_profiles.col_referencia IS
  'Nombres aceptados para la columna del código de artículo, en orden de preferencia. Se comparan sin tildes, sin mayúsculas y sin puntuación. NUNCA se lee por posición: una columna nueva del cliente desplazaría los datos sin dar error.';

COMMENT ON COLUMN public.stock_read_profiles.origen_config IS
  'Configuración del conector de origen. Formas conocidas: drive -> {folder_id, patron, unidad_compartida}; sftp -> {host, ruta, usuario}. Nunca contraseñas ni tokens.';

COMMENT ON COLUMN public.stock_read_profiles.envio_automatico IS
  'Falso de fábrica y a conciencia. En false todo el ciclo corre igual pero se queda en simulacro. La escritura de precio contra Amazon aún no está validada contra una cuenta real.';

COMMENT ON COLUMN public.stock_read_profiles.lineas_referencia IS
  'Líneas que trae este fichero un día normal. Referencia del freno de caída de líneas. NULL = aún no hay con qué comparar y ese freno no salta.';

CREATE INDEX IF NOT EXISTS idx_stock_read_profiles_cliente
  ON public.stock_read_profiles(client_id, tipo, position);

-- La consulta del cron: «qué perfiles hay que mirar ahora». Parcial porque los
-- apagados no se tocan y son la mayoría mientras se dan de alta clientes.
CREATE INDEX IF NOT EXISTS idx_stock_read_profiles_pendientes
  ON public.stock_read_profiles(last_run_at)
  WHERE is_active AND origen <> 'manual';

CREATE INDEX IF NOT EXISTS idx_stock_read_profiles_conexion
  ON public.stock_read_profiles(connection_id)
  WHERE connection_id IS NOT NULL;

-- =====================================================
-- 2) EJECUCIONES
-- =====================================================
-- Una fila por vez que se lee un fichero, se decida lo que se decida. Incluidas
-- las que no mandaron nada: «no se mandó porque saltó un freno» es justo la
-- información que hace falta, y si solo se guardaran los envíos, un cliente
-- frenado durante tres días parecería un cliente sin novedades.
--
-- No lleva updated_at a propósito, igual que stock_runs: una ejecución es un
-- hecho pasado. Si algo sale mal se lanza otra, no se edita la anterior.
CREATE TABLE IF NOT EXISTS public.stock_profile_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.stock_read_profiles(id) ON DELETE CASCADE,
  /** Repetido desde el perfil a propósito: «todo lo que ha pasado con este
      cliente» es la consulta de todos los días y no debería necesitar un JOIN */
  client_id UUID NOT NULL REFERENCES public.stock_clients(id) ON DELETE CASCADE,
  /** Quién lo lanzó. NULL = lo lanzó el proceso automático, que no es nadie */
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- ---------- Qué fichero ----------
  /** De dónde vino ESTA vez; puede no ser el origen del perfil (una subida a mano de emergencia) */
  origen TEXT NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual', 'drive', 'sftp', 'correo')),
  fichero_nombre TEXT,
  /** Id del fichero en el sistema de origen (el fileId de Drive), para poder volver a él */
  fichero_id_externo TEXT,
  /** md5Checksum o fecha de modificación: con qué se decidió que el fichero era nuevo */
  fichero_huella TEXT,
  fichero_bytes INTEGER,
  fichero_modificado_at TIMESTAMPTZ,

  -- ---------- Qué se decidió ----------
  /**
   *   sin_cambios -> el fichero era el mismo de la vez anterior, o nada cambiaba
   *   simulacro   -> se procesó entero y NO se mandó porque el envío está apagado
   *   frenado     -> se procesó entero y NO se mandó porque saltó un freno
   *   enviado     -> se mandó a Amazon (mirar batch_id y amazon_submissions)
   *   error       -> no se pudo procesar; el porqué está en error_message
   */
  estado TEXT NOT NULL
    CHECK (estado IN ('sin_cambios', 'simulacro', 'frenado', 'enviado', 'error')),

  -- ---------- Métricas ----------
  -- Sin DEFAULT 0: NULL es «no se calculó» y 0 es «cero de verdad». La
  -- diferencia importa: 0 líneas leídas es un fichero vacío (grave), y NULL es
  -- que ni se llegó a abrir.
  /** Líneas con código de artículo que traía el fichero */
  lineas_leidas INTEGER,
  /** Las que sobrevivieron a las reglas (exclusiones, umbral, precio ilegible) */
  lineas_utiles INTEGER,
  /** Las que las reglas descartaron, con el desglose en reglas_detalle */
  lineas_excluidas INTEGER,
  /** SKU de Amazon que casaron en el cruce, y los que no */
  sku_casados INTEGER,
  sku_sin_casar INTEGER,
  /** Suma de unidades que se publicarían: un volcado a medias se ve aquí */
  unidades_total INTEGER,
  /** Cuántos SKU cambiarían de verdad respecto a lo que Amazon tiene AHORA */
  cambios_stock INTEGER,
  cambios_precio INTEGER,
  /** De esos cambios, los que dejarían el listing en 0. Es el número que asusta */
  sku_a_cero INTEGER,
  sku_suben INTEGER,
  sku_bajan INTEGER,

  /** Desglose de qué descartó cada regla, para poder explicarlo sin reprocesar */
  reglas_detalle JSONB,

  -- ---------- Frenos ----------
  /** Código del PRIMER freno que saltó. NULL = no saltó ninguno */
  freno TEXT CHECK (freno IS NULL OR freno IN (
    'pct_a_cero', 'variacion_precio', 'caida_lineas', 'max_cambios'
  )),
  /**
   * La frase en español, entera y con sus números, tal cual se le enseña a una
   * persona: «se irían a cero 3.412 de 3.900 referencias (87%), y el límite de
   * este cliente es el 20%». Se guarda ya redactada y no como plantilla para
   * que dentro de seis meses diga lo mismo aunque el texto del código cambie.
   */
  freno_detalle TEXT,
  /** TODOS los frenos evaluados con umbral y valor medido, saltaran o no */
  frenos JSONB,

  -- ---------- Rastro del envío ----------
  /** Enlaza con amazon_submissions.batch_id: de aquí se llega a cada cambio */
  batch_id UUID,
  duracion_ms INTEGER,
  error_message TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /** Un error sin explicación es el estado que obliga a abrir la consola */
  CONSTRAINT stock_profile_runs_error_ok
    CHECK (estado <> 'error' OR btrim(COALESCE(error_message, '')) <> ''),
  /** Frenado sin decir cuál ni por qué no vale para nada */
  CONSTRAINT stock_profile_runs_freno_ok
    CHECK (estado <> 'frenado' OR (freno IS NOT NULL AND btrim(COALESCE(freno_detalle, '')) <> '')),
  /** Enviado sin lote no se puede auditar contra amazon_submissions */
  CONSTRAINT stock_profile_runs_enviado_ok
    CHECK (estado <> 'enviado' OR batch_id IS NOT NULL)
);

COMMENT ON TABLE public.stock_profile_runs IS
  'Una fila por lectura de fichero, se mande o no. Incluye las frenadas: «no se mandó y por qué» es el dato que hace falta cuando un cliente pregunta por qué su stock no se ha movido.';

COMMENT ON COLUMN public.stock_profile_runs.freno_detalle IS
  'La frase completa que se enseña a una persona, con sus números. Se guarda redactada, no como plantilla, para que siga diciendo lo mismo cuando el texto del código cambie.';

CREATE INDEX IF NOT EXISTS idx_stock_profile_runs_perfil
  ON public.stock_profile_runs(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_profile_runs_cliente
  ON public.stock_profile_runs(client_id, created_at DESC);

-- La consulta de «qué hay que mirar hoy»: las que no salieron bien. Parcial
-- porque el 99% de las filas serán 'enviado' o 'simulacro'.
CREATE INDEX IF NOT EXISTS idx_stock_profile_runs_incidencias
  ON public.stock_profile_runs(created_at DESC)
  WHERE estado IN ('frenado', 'error');

-- =====================================================
-- updated_at
-- =====================================================
-- Función propia del módulo y no la de otro: que esto no dependa de que nadie
-- renombre la de stock-sync ni la de Amazon.
CREATE OR REPLACE FUNCTION public.update_stock_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_read_profiles_updated ON public.stock_read_profiles;
CREATE TRIGGER trg_stock_read_profiles_updated
  BEFORE UPDATE ON public.stock_read_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_stock_profiles_updated_at();

-- =====================================================
-- RLS
-- =====================================================
-- SOLO ADMIN en las dos, el mismo listón que el módulo de Amazon: desde aquí se
-- decide qué precio y qué stock acaban publicados en la tienda de un cliente.
-- Se usa public.is_erp_admin(uuid) de la 111 y no se crea otra función de rol,
-- porque dos comprobaciones de «quién es admin» acaban discrepando.
--
-- Y NADIE ESCRIBE DESDE EL NAVEGADOR. Todas las escrituras pasan por rutas de
-- servidor que van con service_role después de comprobar el rol contra la
-- sesión. Dos candados en el mismo sentido:
--   a) sin GRANT, `authenticated` ni lo intenta;
--   b) sin política permisiva, si alguien restaurara el GRANT algún día (un
--      `GRANT ALL ON ALL TABLES IN SCHEMA public` de los que se escriben sin
--      pensar), RLS seguiría diciendo que no.
-- TRUNCATE va en la lista de REVOKE porque entra en el GRANT ALL de Supabase y
-- RLS NO SE APLICA A TRUNCATE.
ALTER TABLE public.stock_read_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read stock read profiles" ON public.stock_read_profiles;
CREATE POLICY "Admins read stock read profiles"
  ON public.stock_read_profiles FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_read_profiles FROM authenticated, anon;

ALTER TABLE public.stock_profile_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read stock profile runs" ON public.stock_profile_runs;
CREATE POLICY "Admins read stock profile runs"
  ON public.stock_profile_runs FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

-- Ni un admin borra de aquí. Una ejecución frenada es el registro de que el
-- sistema paró a tiempo; si se pudiera borrar, el historial no serviría para lo
-- único para lo que existe.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_profile_runs FROM authenticated, anon;

-- =====================================================
-- Aviso cuando salta un freno
-- =====================================================
-- Un freno que salta y nadie ve es un cliente con el stock congelado durante
-- tres días. La campana del ERP es lo que ya existe, así que se usa esa.
--
-- Va por trigger y no desde TypeScript porque el ERP entero crea las
-- notificaciones así (040 y 051), y porque el aviso tiene que salir aunque la
-- fila se escriba desde un proceso automático sin sesión.
--
-- PRIMERO hay que ampliar el CHECK del tipo: sin esto el INSERT de la
-- notificación falla y, al ser un trigger AFTER INSERT, se lleva por delante la
-- escritura de la ejecución. Se perdería justo la fila que explica el freno.
--
-- Con guarda porque public.notifications la crea la 040 y esta migración no
-- depende de ella para nada más: si no estuviera, el módulo tiene que seguir
-- instalándose y limitarse a no avisar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) THEN
    ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN ('comment', 'mention', 'task_assigned', 'task_updated', 'web_lead', 'freno_stock'));
  ELSE
    RAISE NOTICE 'No existe public.notifications; el freno quedará registrado en stock_profile_runs pero no avisará por la campana.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_stock_freno_notification()
RETURNS TRIGGER AS $$
DECLARE
  admin_user RECORD;
  nombre_cliente TEXT;
BEGIN
  IF NEW.estado <> 'frenado' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO nombre_cliente FROM public.stock_clients WHERE id = NEW.client_id;

  FOR admin_user IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, type, title, message, read, created_at)
    VALUES (
      admin_user.id,
      'freno_stock',
      'Envío detenido: ' || COALESCE(nombre_cliente, 'cliente sin nombre'),
      COALESCE(NEW.freno_detalle, 'Ha saltado un freno y no se ha mandado nada a Amazon.'),
      false,
      NOW()
    );
  END LOOP;

  RETURN NEW;
EXCEPTION
  -- Que no se pueda avisar NO puede costar la fila de la ejecución: sin ella se
  -- pierde el único sitio donde consta que el sistema paró y por qué.
  WHEN OTHERS THEN
    RAISE NOTICE 'No se ha podido crear el aviso del freno (%). La ejecución sí queda registrada.', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_stock_profile_runs_freno ON public.stock_profile_runs;
CREATE TRIGGER trg_stock_profile_runs_freno
  AFTER INSERT ON public.stock_profile_runs
  FOR EACH ROW EXECUTE FUNCTION public.create_stock_freno_notification();

-- =====================================================
-- Realtime
-- =====================================================
-- Con guardia: añadir una tabla que ya está en la publicación da error, y como
-- el editor SQL corre el script entero en una transacción, ese error de la
-- última línea desharía todos los CREATE TABLE de arriba. La migración
-- parecería aplicada sin haber creado nada.
--
-- Se añade también `notifications`, que NO estaba en ninguna migración pese a
-- que components/layout/NotificationsBell.tsx se suscribe a ella: hasta hoy esa
-- suscripción solo funcionaba si alguien la activó a mano en el panel de
-- Supabase. Un freno tiene que verse sin recargar la página.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_read_profiles', 'stock_profile_runs', 'notifications'] LOOP
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
      'No se ha podido añadir a la publicación de realtime (%). El módulo funciona igual: la pantalla se refresca por su cuenta.',
      SQLERRM;
END $$;

-- =====================================================
-- Permiso de la app
-- =====================================================
-- NO hay bloque de user_app_permissions y no es un olvido: estas dos tablas no
-- estrenan pantalla. Se sirven dentro de 'amazon-api', que ya es solo de
-- admins y ya tiene su permiso dado en la 118. Insertar aquí un app_id nuevo
-- que no exista en lib/config/apps.ts ni en el routeToAppId de middleware.ts
-- dejaría una entrada muerta en la tabla de permisos.
--
-- El día que esto tenga pantalla propia, el id tiene que coincidir LETRA POR
-- LETRA en tres sitios: la migración que lo añada, lib/config/apps.ts y
-- middleware.ts.

-- =====================================================
-- Semilla: el perfil de Shoplamp, que es lo que hoy está grabado en el código
-- =====================================================
-- Reproduce EXACTAMENTE lo que hacen hoy parseStockWorkbook() y
-- parseEanWorkbook() en lib/stock-sync/engine.ts, incluidos los alias y el
-- «solo Tipo 1». Es la prueba de que el perfil de lectura da para expresar el
-- cliente que ya funciona: si algún dato de aquí no cupiera en estas columnas,
-- la tabla estaría mal diseñada.
--
-- origen 'manual' y envio_automatico false: esto NO cambia nada de lo que hace
-- hoy el módulo «Sincronismo de stock», que sigue subiendo el fichero a mano.
DO $$
DECLARE
  v_client UUID;
BEGIN
  SELECT id INTO v_client FROM public.stock_clients WHERE slug = 'shoplamp';
  IF v_client IS NULL THEN
    RAISE NOTICE 'No hay cliente «shoplamp»; no se siembra el perfil de lectura.';
    RETURN;
  END IF;

  INSERT INTO public.stock_read_profiles (
    client_id, name, slug, tipo, origen, formato,
    hoja, col_referencia, col_stock, col_descripcion,
    reserva_unidades, stock_minimo, precio_modo,
    enviar_stock, enviar_precio, envio_automatico, position, notes
  ) VALUES (
    v_client,
    'Shoplamp — volcado de stock',
    'shoplamp-stock',
    'stock',
    'manual',
    'auto',
    'Browser',
    ARRAY['Articulo', 'Cod.Articulo', 'Codigo articulo'],
    ARRAY['St. Real', 'St.Real', 'Stock real', 'Stock'],
    ARRAY['Descrip.Propia', 'Descripcion', 'Descripcion propia'],
    0, 0, 'ninguno',
    true, false, false, 1,
    'Lo que hoy está grabado en parseStockWorkbook(). No cambia nada del proceso manual.'
  )
  ON CONFLICT (client_id, slug) DO NOTHING;

  INSERT INTO public.stock_read_profiles (
    client_id, name, slug, tipo, origen, formato,
    hoja, col_referencia, col_ean, col_tipo, ean_solo_tipo,
    enviar_stock, enviar_precio, envio_automatico, position, notes
  ) VALUES (
    v_client,
    'Shoplamp — códigos de barras',
    'shoplamp-ean',
    'ean',
    'manual',
    'auto',
    'Browser',
    ARRAY['Cod.Articulo', 'Codigo articulo', 'Articulo'],
    ARRAY['Codigo de Barras', 'Codigo barras', 'EAN'],
    ARRAY['Tipo'],
    1,
    false, false, false, 2,
    'Lo que hoy está grabado en parseEanWorkbook(). Solo Tipo 1 = EAN-13; los demás son códigos internos del ERP.'
  )
  ON CONFLICT (client_id, slug) DO NOTHING;
END $$;
