-- =====================================================
-- 126 · MÓDULO A2 — EL MONITOR DE BUY BOX
-- =====================================================
-- La 123 montó el esquema de A1 y dejó `amazon_snapshots_precio` creada y vacía:
-- es la serie que llena ESTE módulo. Aquí se le añaden las columnas que A1 no
-- podía prever, se crean tres tablas nuevas y cuatro funciones de solo lectura.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta. Y con guardias en todo
-- lo frágil, porque el editor SQL de Supabase corre el fichero entero en UNA
-- transacción: un error en la última línea desharía todo lo de arriba y la
-- migración parecería aplicada sin haber creado nada.
--
--
-- =====================================================================
--  ██  LO PRIMERO: QUÉ ES EL FOEP, PORQUE DE ESTO CUELGA TODO  ██
-- =====================================================================
--
-- Definición literal de Amazon: «A computed listing price AT OR BELOW WHICH a
-- seller can expect to become the featured offer».
--
-- O sea: EL PRECIO DE LISTING MÁXIMO al que Amazon prevé que NUESTRA oferta esté
-- destacada. ES UN TECHO, NO UN OBJETIVO. Y significa dos cosas distintas:
--
--   · si NO tenemos la oferta destacada -> es OFENSIVO: el techo AL QUE BAJAR.
--   · si SÍ la tenemos                  -> es DEFENSIVO: hasta dónde se puede
--                                          SUBIR sin perderla, y normalmente
--                                          está POR ENCIMA del precio actual.
--
-- NO HAY NINGÚN CAMPO DE AMAZON QUE DISTINGA LOS DOS CASOS. Hay que comparar
-- obligatoriamente el identificador de vendedor de la oferta destacada actual
-- contra el nuestro. Por eso esta tabla guarda `buybox_estado` con cuatro
-- valores y no un booleano, y por eso hay un CHECK que impide que ese estado y
-- el booleano heredado se contradigan.
--
-- La regla ingenua «precio_actual > FOEP -> bajar» RECORTA PRECIO EN LOS SKU QUE
-- YA VAN BIEN. Es el fallo más caro que puede tener este proyecto y no da ningún
-- error: la pantalla se ve verde mientras se regala margen. El motor está en
-- lib/plataforma/buybox/diagnostico.ts y lleva esto escrito arriba del todo.
--
--
-- =====================================================================
--  LAS CUATRO COSAS QUE ESTE ESQUEMA IMPIDE QUE SE ESCRIBAN
-- =====================================================================
--
-- 1. UN CERO DONDE NO HAY DATO. El CHECK de FOEP de la 123 ya obligaba a que el
--    importe y el estado cuadren. Aquí se añade lo mismo para «¿está Amazon en
--    el ASIN?» y para «¿quién tiene la oferta destacada?».
--
-- 2. UN «NO» DONDE LA RESPUESTA HONESTA ES «NO SE PUEDE SABER». `amazon_estado`
--    es TERNARIO. No existe ningún campo en la Selling Partner API que
--    identifique la oferta de Amazon Retail: `IsFulfilledByAmazon` significa FBA,
--    no Amazon, y un tercero con FBA devuelve exactamente lo mismo. La lista de
--    identificadores de Amazon Retail no está publicada. El CHECK
--    `amazon_ternario_ok` hace IMPOSIBLE guardar `indeterminado` como `false`.
--
-- 3. UN SFP CONTADO COMO FBM. `canal_ganador` y `canal_propio` son ternarios
--    (FBA / SFP / FBM) más «desconocido». Un cliente de la cartera tiene Seller
--    Fulfilled Prime en parte del catálogo, y con el binario FBA/FBM el
--    diagnóstico de «por qué pierdo la Buy Box» sale al revés.
--
-- 4. UN PRECIO CON ENVÍO COMPARADO CONTRA UNO SIN ENVÍO. El FOEP es precio de
--    listing, SIN envío; la competencia en la misma respuesta trae las dos
--    cosas. Por eso cada importe lleva en su nombre cuál es: `precio_*` es de
--    listing y `*_landed` es puesto en casa. No hay ninguna columna llamada
--    «precio» a secas y no se suman por comodidad.

-- ---------- Guardia previa ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_snapshots_precio'
  ) THEN
    RAISE EXCEPTION
      'No existe amazon_snapshots_precio. Lanza antes 123_plataforma_a1.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella las políticas RLS de abajo dejarían estas tablas abiertas a cualquiera, y aquí hay los precios y la competencia de tiendas ajenas.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_amazon_updated_at'
  ) THEN
    RAISE EXCEPTION
      'Falta public.update_amazon_updated_at(), que la crea 118_amazon_api.sql.';
  END IF;
END $$;

-- =====================================================
-- 1) LO QUE LE FALTABA A LA SERIE DE PRECIOS
-- =====================================================
-- Todo ADD COLUMN IF NOT EXISTS y todo con default o anulable: la tabla es de
-- SOLO INSERCIÓN y tiene un trigger que revienta ante UPDATE, así que no se
-- puede rellenar hacia atrás. Las filas viejas —si las hubiera— se quedan con el
-- default, que en los tres estados nuevos es el honesto: «desconocido».

ALTER TABLE public.amazon_snapshots_precio
  -- ---------- Quién tiene la oferta destacada ----------
  ADD COLUMN IF NOT EXISTS buybox_estado TEXT NOT NULL DEFAULT 'desconocido',
  -- ---------- Canal, ternario ----------
  ADD COLUMN IF NOT EXISTS canal_propio TEXT,
  -- ---------- Amazon Retail, ternario ----------
  ADD COLUMN IF NOT EXISTS amazon_estado TEXT NOT NULL DEFAULT 'indeterminado',
  -- ---------- Envíos, SIEMPRE aparte del precio de listing ----------
  ADD COLUMN IF NOT EXISTS precio_propio_envio NUMERIC,
  ADD COLUMN IF NOT EXISTS precio_buybox_envio NUMERIC,
  ADD COLUMN IF NOT EXISTS precio_competidor_min_landed NUMERIC,
  -- ---------- Competencia ----------
  ADD COLUMN IF NOT EXISTS n_ofertas INTEGER,
  ADD COLUMN IF NOT EXISTS n_competidores_prime INTEGER,
  ADD COLUMN IF NOT EXISTS hay_oferta_propia BOOLEAN,
  -- ---------- FOEP ----------
  ADD COLUMN IF NOT EXISTS foep_resultado TEXT,
  ADD COLUMN IF NOT EXISTS foep_moneda TEXT,
  -- ---------- Qué se estaba vigilando ----------
  ADD COLUMN IF NOT EXISTS condicion TEXT,
  ADD COLUMN IF NOT EXISTS segmento TEXT,
  -- ---------- El histórico de competencia ----------
  ADD COLUMN IF NOT EXISTS ofertas JSONB;

COMMENT ON COLUMN public.amazon_snapshots_precio.buybox_estado IS
  'nuestra / de_otro / nadie / desconocido. CUATRO valores y no un booleano porque son cuatro situaciones con cuatro acciones distintas: "nadie la tiene" no es "la tiene otro", y "no se pudo leer" no es "la hemos perdido" — contarlo como perdida dispara una alerta falsa y mueve el porcentaje del cliente. De este campo cuelga la interpretación del FOEP: con "nuestra" el FOEP es un techo defensivo (hasta dónde SUBIR) y con "de_otro" es un techo ofensivo (hasta dónde BAJAR).';

COMMENT ON COLUMN public.amazon_snapshots_precio.canal_ganador IS
  'FBA / SFP / FBM / desconocido. TERNARIO más el desconocido: Seller Fulfilled Prime NO es FBM. Un cliente de la cartera tiene SFP en parte del catálogo y con el binario FBA/FBM su diagnóstico de Buy Box sale al revés.';

COMMENT ON COLUMN public.amazon_snapshots_precio.amazon_estado IS
  'si / no / indeterminado. NO SE PUEDE SABER CON FIABILIDAD si Amazon Retail vende en un ASIN: IsFulfilledByAmazon significa FBA (un tercero con FBA da lo mismo) y la lista de identificadores de Amazon no está publicada. Solo hay dos afirmaciones honestas: "si" cuando un identificador configurado a mano aparece entre los vendedores, y "no" cuando no hay ninguna oferta ajena. Todo lo demás es "indeterminado" y se enseña así. La especificación (§3.5 regla 3) lo pide como booleano y NO se puede: un SKU descartado por error es una venta perdida y uno recomendado por error es inventario muerto en un almacén de Amazon.';

COMMENT ON COLUMN public.amazon_snapshots_precio.precio_competidor_min IS
  'El precio de LISTING más bajo de la competencia, SIN envío. Es el único comparable con el FOEP, que también es precio de listing sin envío.';

COMMENT ON COLUMN public.amazon_snapshots_precio.precio_competidor_min_landed IS
  'El más bajo PUESTO EN CASA (listing + envío). NO es comparable con el FOEP: compararlos es una comparación inválida y con un catálogo mayoritariamente FBM —donde el envío no es cero— estropea el diagnóstico entero. Existe para enseñarlo, no para decidir.';

COMMENT ON COLUMN public.amazon_snapshots_precio.foep_resultado IS
  'El resultStatus CRUDO de Amazon (VALID_FOEP, NO_COMPETING_OFFER/NO_COMPETING_OFFERS, OFFER_NOT_ELIGIBLE...). SE GUARDA SIN TRADUCIR porque el enum NO es cerrado: Amazon puede añadir valores sin avisar y una traducción sin rama por defecto convertiría un valor nuevo en NULL y de ahí, con un COALESCE, en un cero.';

COMMENT ON COLUMN public.amazon_snapshots_precio.condicion IS
  'La condición vigilada en esta lectura ("New"). Va en la fila y no en la configuración porque el histórico tiene que seguir siendo interpretable el día que se cambie: una serie donde la mitad de las lecturas son de "New" y la otra mitad de "Used" sin distintivo no significa nada.';

COMMENT ON COLUMN public.amazon_snapshots_precio.segmento IS
  'El segmento de comprador vigilado ("Consumer"). B2B es una SEGUNDA PASADA, no un interruptor: su oferta destacada es otra y con otros precios.';

COMMENT ON COLUMN public.amazon_snapshots_precio.ofertas IS
  E'Las ofertas del ASIN en ese instante, recortadas: [{v: vendedor, p: precio de listing, e: envío, c: canal, g: ¿es la destacada?, n: ¿es la nuestra?}].\n\nES LO QUE SUSTITUYE A KEEPA PARA NUESTROS SKU: "hasta dónde ha bajado cada competidor" no se puede reconstruir de ninguna otra forma, porque Amazon no da histórico.\n\nVA COMO JSONB Y NO COMO TABLA A PROPÓSITO. Una tabla de ofertas repetiría vendedor, marketplace, SKU y fecha en cada fila: 13.700 SKU × 5 competidores × 365 noches son 25 millones de filas con la identidad repetida. Aquí son 13.700 filas por noche con un JSONB dentro.\n\nY AUN ASÍ CUESTA ESPACIO, así que es CONFIGURABLE por cliente (amazon_buybox_config.ofertas_guardadas). Con 10 ofertas por fila son ~900 bytes: 13.700 SKU × 90 días ≈ 1,1 GB para el cliente grande. Con 0 no se guarda ninguna y se pierde el histórico de competencia, no el de Buy Box.';

COMMENT ON COLUMN public.amazon_snapshots_precio.fecha IS
  'NUESTRO instante de lectura. AMAZON NO DA NINGUNO: ni el FOEP ni las ofertas vienen selladas con la hora en que se calcularon, y tampoco está documentada la frecuencia de recálculo. Sin esta columna no se puede saber si un veredicto se tomó con datos de hace una hora o de hace seis días.';

-- ---------- Los CHECK que hacen imposible perder un «no se sabe» ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_snap_precio_buybox_estado_ok') THEN
    ALTER TABLE public.amazon_snapshots_precio
      ADD CONSTRAINT amazon_snap_precio_buybox_estado_ok
      CHECK (buybox_estado IN ('nuestra', 'de_otro', 'nadie', 'desconocido'));
  END IF;

  -- El booleano heredado de la 123 y el estado nuevo NO PUEDEN CONTRADECIRSE.
  -- Sin esto conviven dos verdades sobre lo mismo y basta con que una consulta
  -- vieja mire la equivocada para que el porcentaje de Buy Box de un cliente sea
  -- otro según la pantalla.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_snap_precio_buybox_coherente') THEN
    ALTER TABLE public.amazon_snapshots_precio
      ADD CONSTRAINT amazon_snap_precio_buybox_coherente
      CHECK (
        (buybox_estado = 'nuestra'     AND tiene_buybox IS TRUE) OR
        (buybox_estado = 'de_otro'     AND tiene_buybox IS FALSE) OR
        (buybox_estado = 'nadie'       AND tiene_buybox IS FALSE) OR
        (buybox_estado = 'desconocido' AND tiene_buybox IS NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_snap_precio_amazon_ternario_ok') THEN
    ALTER TABLE public.amazon_snapshots_precio
      ADD CONSTRAINT amazon_snap_precio_amazon_ternario_ok
      CHECK (
        (amazon_estado = 'si'            AND amazon_en_asin IS TRUE) OR
        (amazon_estado = 'no'            AND amazon_en_asin IS FALSE) OR
        (amazon_estado = 'indeterminado' AND amazon_en_asin IS NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_snap_precio_canales_ok') THEN
    ALTER TABLE public.amazon_snapshots_precio
      ADD CONSTRAINT amazon_snap_precio_canales_ok
      CHECK (
        (canal_ganador IS NULL OR canal_ganador IN ('FBA', 'SFP', 'FBM', 'desconocido')) AND
        (canal_propio  IS NULL OR canal_propio  IN ('FBA', 'SFP', 'FBM', 'desconocido'))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_snap_precio_importes2_ok') THEN
    ALTER TABLE public.amazon_snapshots_precio
      ADD CONSTRAINT amazon_snap_precio_importes2_ok
      CHECK (
        COALESCE(precio_propio_envio, 0) >= 0 AND
        COALESCE(precio_buybox_envio, 0) >= 0 AND
        COALESCE(precio_competidor_min_landed, 0) >= 0 AND
        COALESCE(n_ofertas, 0) >= 0 AND
        COALESCE(n_competidores_prime, 0) >= 0
      );
  END IF;
END $$;

-- El índice de trabajo de A2: «la última lectura de este SKU de esta cuenta».
-- El de la 123 va por (selling_partner_id, marketplace_id, sku) y sirve para el
-- histórico; este va por conexión, que es como llegan las consultas de pantalla.
CREATE INDEX IF NOT EXISTS idx_amazon_snap_precio_conexion_sku
  ON public.amazon_snapshots_precio(connection_id, marketplace_id, sku, fecha DESC);

-- Para «dame el último FOEP de este SKU», que puede ser de otra noche por la
-- rotación. Parcial: la inmensa mayoría de las filas no traen FOEP.
CREATE INDEX IF NOT EXISTS idx_amazon_snap_precio_foep
  ON public.amazon_snapshots_precio(connection_id, marketplace_id, sku, fecha DESC)
  WHERE foep_estado <> 'no_consultado';

-- =====================================================
-- 2) LA CONFIGURACIÓN POR CLIENTE
-- =====================================================
-- ============ POR QUÉ CASI TODO ESTÁ A NULL ============
--
-- La especificación es literal: «Pregúntame antes de asumir reglas de negocio.
-- Los umbrales, los costes, las reglas de margen y las excepciones por cliente
-- las pongo yo».
--
-- Así que aquí NO hay ni un umbral inventado. Los campos de negocio nacen a NULL
-- y NULL significa NO ACTUAR: el motor informa y no recomienda. Los únicos
-- valores por defecto que llevan número son los TÉCNICOS (condición «New»,
-- segmento «Consumer», dos lecturas seguidas para no alertar por ruido de
-- subasta) o los que da la propia documentación de Amazon.
--
-- Un umbral inventado es indistinguible de uno decidido, y este motor propone
-- precios de dieciséis tiendas ajenas.
CREATE TABLE IF NOT EXISTS public.amazon_buybox_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /* ---------- Qué se vigila. Técnico, no de negocio ---------- */
  condicion TEXT NOT NULL DEFAULT 'New',
  segmento TEXT NOT NULL DEFAULT 'Consumer',

  /* ---------- El FOEP: cada cuánto, porque es lo que cuesta ---------- */
  /** Cada cuántas noches le toca el FOEP a cada SKU. 7 sale del cálculo de la
      ventana nocturna, no de una regla de negocio: a 30 s por llamada de 40 SKU,
      13.700 referencias son 2 h 53 min, y repartirlas en siete noches son 25
      minutos por noche */
  foep_rotacion_dias INTEGER NOT NULL DEFAULT 7,
  /** Tope de SKU con FOEP por noche. NULL = sin tope */
  foep_max_por_noche INTEGER,
  /** ¿Se le pide FOEP el mismo día a un SKU que acaba de perder la oferta
      destacada, sin esperar su turno de rotación? Es la recomendación de la
      propia documentación de Amazon: reaccionar a lo que cambia en vez de
      sondear el catálogo entero */
  foep_cola_activa BOOLEAN NOT NULL DEFAULT true,

  /* ---------- El histórico de competencia ---------- */
  /** Cuántas ofertas se guardan por lectura. 0 = ninguna. Ver el comentario de
      amazon_snapshots_precio.ofertas: esto es lo que sustituye a Keepa y lo que
      más ocupa */
  ofertas_guardadas INTEGER NOT NULL DEFAULT 10,

  /* ---------- REGLAS DE NEGOCIO: TODAS A NULL ---------- */
  /** % de margen mínimo vendiendo al FOEP. NULL = el motor no recomienda */
  margen_minimo_pct NUMERIC,
  /** Cuánto por debajo del FOEP se propone el precio. NULL = el FOEP exacto, que
      es el borde del umbral */
  delta_foep NUMERIC,
  delta_foep_tipo TEXT NOT NULL DEFAULT 'absoluto'
    CHECK (delta_foep_tipo IN ('absoluto', 'porcentaje')),
  /** Suelo y techo por cliente. NULL = sin freno configurado */
  precio_suelo NUMERIC,
  precio_techo NUMERIC,
  /** SKU excluidos de cualquier propuesta de precio: MAP, acuerdos con la marca */
  skus_excluidos TEXT[] NOT NULL DEFAULT '{}',

  /* ---------- Escritura ---------- */
  /** SIEMPRE false por defecto. A2 observa y diagnostica: no escribe ni un
      precio en Amazon. La ejecución existe en A6 pero con confirmación explícita
      y registro de auditoría */
  escritura_autorizada BOOLEAN NOT NULL DEFAULT false,

  /* ---------- Alertas ---------- */
  /** Lecturas SEGUIDAS sin oferta destacada antes de avisar. 2 es técnico: con 1
      se alerta por el ruido de la subasta de la Buy Box, que rota entre ofertas
      empatadas varias veces al día */
  lecturas_para_alertar INTEGER NOT NULL DEFAULT 2,

  /* ---------- Amazon Retail ---------- */
  /** Identificadores de vendedor que SABEMOS que son Amazon Retail, por
      marketplace: {"A1B2C3": "ATVPDKIKX0DER"}. Amazon NO publica esta lista, así
      que se rellena a mano y mientras esté vacía el veredicto es «indeterminado» */
  sellers_amazon JSONB NOT NULL DEFAULT '{}'::jsonb,

  notas TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_buybox_config_rotacion_ok CHECK (foep_rotacion_dias BETWEEN 1 AND 90),
  CONSTRAINT amazon_buybox_config_ofertas_ok CHECK (ofertas_guardadas BETWEEN 0 AND 50),
  CONSTRAINT amazon_buybox_config_lecturas_ok CHECK (lecturas_para_alertar BETWEEN 1 AND 20),
  CONSTRAINT amazon_buybox_config_margen_ok
    CHECK (margen_minimo_pct IS NULL OR (margen_minimo_pct >= 0 AND margen_minimo_pct <= 100)),
  CONSTRAINT amazon_buybox_config_precios_ok
    CHECK (COALESCE(precio_suelo, 0) >= 0 AND COALESCE(precio_techo, 0) >= 0
           AND (precio_suelo IS NULL OR precio_techo IS NULL OR precio_techo >= precio_suelo))
);

COMMENT ON TABLE public.amazon_buybox_config IS
  'Los umbrales del monitor de Buy Box, por cliente. Todo lo de negocio nace a NULL y NULL significa NO ACTUAR: sin margen mínimo el motor informa pero no recomienda, y sin suelo no se propone bajar sin decir que no hay freno. Lo único con número por defecto es lo técnico.';

-- Una viva por cliente. Las viejas se quedan con is_active=false porque son el
-- registro de con qué criterio se midió el histórico.
CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_buybox_config_viva
  ON public.amazon_buybox_config(client_id) WHERE is_active;

DROP TRIGGER IF EXISTS trg_amazon_buybox_config_updated ON public.amazon_buybox_config;
CREATE TRIGGER trg_amazon_buybox_config_updated
  BEFORE UPDATE ON public.amazon_buybox_config
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

-- =====================================================
-- 3) EL DIAGNÓSTICO
-- =====================================================
-- SERIE DE SOLO INSERCIÓN, igual que las cuatro de la 123 y por la misma razón:
-- un veredicto es lo que se decidió con los datos que había en ese instante. Si
-- mañana cambia, se añade otro. Corregir el de ayer borra la única prueba de por
-- qué alguien bajó un precio.
--
-- Y por eso `datos` guarda la FOTO ENTERA de los números, aunque se repitan con
-- el snapshot: el snapshot y el diagnóstico pueden ser de instantes distintos
-- —con la rotación semanal, el FOEP puede tener seis días— y reconstruirlo
-- después obligaría a adivinar cuál era la fila vigente.
CREATE TABLE IF NOT EXISTS public.amazon_buybox_diagnostico (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  /* Referencias BLANDAS, sin clave ajena, como las series de la 123: la fila
     padre se borra de verdad y el histórico tiene que sobrevivir a eso. Lo que
     identifica la serie para siempre son los tres campos congelados */
  listing_id UUID,
  connection_id UUID,
  selling_partner_id TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  veredicto TEXT NOT NULL,
  /** EL PORQUÉ EN TEXTO, con sus números dentro. La especificación insiste: «el
      equipo tiene que entender la decisión, no solo obedecerla». Una etiqueta
      sin frase se obedece; una frase con números se discute, y discutirla es lo
      que hace que se detecte cuando el motor se equivoca */
  motivo TEXT NOT NULL,
  accion TEXT NOT NULL,
  /** Menor va antes en el listado accionable */
  prioridad INTEGER NOT NULL DEFAULT 50,

  /* ---------- Los cuatro números que se consultan, en columnas ----------
     Están DUPLICADOS dentro de `datos` a propósito y no es redundancia mal
     entendida: `datos` es la foto para auditar y se lee de una en una; estas
     columnas se agrupan, se ordenan y se exportan sobre miles de filas. Sacarlas
     de un JSONB en cada consulta obliga a un cast por fila, y un cast por fila es
     lo que convierte una tabla ordenable en una que hay que traerse entera. */
  buybox_estado TEXT NOT NULL DEFAULT 'desconocido',
  amazon_estado TEXT NOT NULL DEFAULT 'indeterminado',
  precio_propio NUMERIC,
  moneda TEXT,
  foep NUMERIC,
  foep_estado TEXT NOT NULL DEFAULT 'no_consultado',

  /** La foto de los números con los que se decidió. Sin esto no se puede
      auditar un veredicto de marzo en junio */
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,

  /** SIEMPRE SIMULACRO. A2 no escribe precios en Amazon: no está autorizado y
      son dieciséis cuentas ajenas */
  precio_propuesto NUMERIC,
  precio_propuesto_motivo TEXT,

  /** De qué lectura salió, y qué antigüedad tenía el FOEP que se usó */
  snapshot_id UUID,
  foep_fecha TIMESTAMPTZ,

  job_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_buybox_diag_veredicto_ok CHECK (veredicto IN (
    'sin_datos', 'sin_oferta_propia',
    'con_buybox_margen_arriba', 'con_buybox_al_limite', 'con_buybox_incoherente', 'con_buybox_sin_foep',
    'no_competible', 'sin_stock', 'nadie_la_tiene', 'sin_foep', 'deberiamos_tenerla',
    'recuperable_bajando', 'bajable_sin_criterio', 'problema_logistico', 'no_recuperable'
  )),
  /** Un veredicto sin frase no entra. Es la mitad del valor del módulo */
  CONSTRAINT amazon_buybox_diag_motivo_ok CHECK (length(btrim(motivo)) > 10),
  CONSTRAINT amazon_buybox_diag_precio_ok CHECK (COALESCE(precio_propuesto, 0) >= 0),
  CONSTRAINT amazon_buybox_diag_buybox_ok
    CHECK (buybox_estado IN ('nuestra', 'de_otro', 'nadie', 'desconocido')),
  CONSTRAINT amazon_buybox_diag_amazon_ok
    CHECK (amazon_estado IN ('si', 'no', 'indeterminado')),
  /** El mismo candado que en la serie: importe y estado del FOEP tienen que
      cuadrar. Un cero aquí se leería como «Amazon dice que lo regales» */
  CONSTRAINT amazon_buybox_diag_foep_ok
    CHECK ((foep IS NOT NULL) = (foep_estado = 'disponible')
           AND foep_estado IN ('disponible', 'no_disponible', 'no_consultado'))
);

COMMENT ON TABLE public.amazon_buybox_diagnostico IS
  'Por qué cada SKU tiene o no tiene la oferta destacada, con el porqué en español y los números con los que se decidió. SOLO INSERCIÓN. La tabla de veredictos NO es la del §3.3 de la especificación: aquella mezclaba los dos sentidos del FOEP en la fila «FOEP >= precio actual -> ya deberíamos tenerla», que es correcta solo si NO tenemos la oferta destacada. Ver lib/plataforma/buybox/diagnostico.ts.';

COMMENT ON COLUMN public.amazon_buybox_diagnostico.precio_propuesto IS
  'SIMULACRO. Nunca se ha enviado a Amazon y este módulo no tiene forma de enviarlo. La ejecución de cambios de precio vive en A6, con confirmación explícita, registro de quién y cuándo, y confirmación reforzada por encima de N SKU.';

COMMENT ON COLUMN public.amazon_buybox_diagnostico.foep_fecha IS
  'Cuándo se leyó el FOEP que se usó para este veredicto. Con rotación semanal puede tener seis días, y un veredicto tomado con un techo de hace seis días vale menos que uno de hace una hora. Quien lo lea tiene que poder saberlo.';

CREATE INDEX IF NOT EXISTS idx_amazon_buybox_diag_sku
  ON public.amazon_buybox_diagnostico(connection_id, marketplace_id, sku, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_buybox_diag_unidad
  ON public.amazon_buybox_diagnostico(connection_id, marketplace_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_buybox_diag_veredicto
  ON public.amazon_buybox_diagnostico(connection_id, marketplace_id, veredicto, fecha DESC);

-- =====================================================
-- 4) LA COLA DE FOEP BAJO DEMANDA
-- =====================================================
-- ============ POR QUÉ HACE FALTA ============
--
-- El FOEP va a UNA PETICIÓN CADA TREINTA SEGUNDOS. Pedirlo todas las noches para
-- las 13.700 referencias del cliente grande son 2 h 53 min POR MARKETPLACE. En
-- España más Alemania, Francia e Italia, once horas y media: no cabe en ninguna
-- ventana nocturna.
--
-- La arquitectura que sí cabe es la que recomienda la propia documentación de
-- Amazon («rely on push notifications instead of polling mechanisms»):
--
--   · las OFERTAS se barren enteras cada noche (23 min por marketplace);
--   · el FOEP va por ROTACIÓN —a cada SKU le toca cada N noches— MÁS esta cola,
--     que adelanta el turno de los SKU que acaban de perder la oferta destacada.
--
-- Sin la cola, un SKU que pierde la Buy Box un lunes puede tardar seis días en
-- tener un techo con el que decidir. Con ella, lo tiene la misma noche.
--
-- ESTA TABLA NO ES UNA SERIE y por eso no lleva el candado de solo inserción: es
-- una cola de trabajo, se marca como servida y se vuelve a pedir. Lo que pasó
-- queda en la serie de precios, no aquí.
CREATE TABLE IF NOT EXISTS public.amazon_buybox_cola_foep (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  /** Por qué está en la cola: 'perdida' (acaba de perder la destacada),
      'peticion' (lo ha pedido una persona), 'analisis' (lo pide A4) */
  motivo TEXT NOT NULL DEFAULT 'perdida',
  pedido_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  servido_at TIMESTAMPTZ,
  intentos INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_buybox_cola_motivo_ok CHECK (motivo IN ('perdida', 'peticion', 'analisis')),
  CONSTRAINT amazon_buybox_cola_unica UNIQUE (connection_id, marketplace_id, sku)
);

COMMENT ON TABLE public.amazon_buybox_cola_foep IS
  'Los SKU a los que hay que pedir el FOEP sin esperar su turno de rotación. El FOEP va a una petición cada treinta segundos: pedirlo cada noche para el catálogo entero de un cliente grande son casi tres horas por marketplace y no cabe en la ventana. Esta cola es lo que hace que un SKU que pierde la oferta destacada tenga su techo esa misma noche en vez de dentro de seis días.';

CREATE INDEX IF NOT EXISTS idx_amazon_buybox_cola_pendiente
  ON public.amazon_buybox_cola_foep(connection_id, marketplace_id, pedido_at)
  WHERE servido_at IS NULL;

DROP TRIGGER IF EXISTS trg_amazon_buybox_cola_updated ON public.amazon_buybox_cola_foep;
CREATE TRIGGER trg_amazon_buybox_cola_updated
  BEFORE UPDATE ON public.amazon_buybox_cola_foep
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

-- =====================================================
-- 5) EL CANDADO DE SOLO INSERCIÓN DEL DIAGNÓSTICO
-- =====================================================
-- Se reutiliza la función de la 123. Protege de NOSOTROS: service_role se salta
-- RLS y los GRANT, así que lo único que le queda delante a un UPDATE escrito con
-- buena intención es este trigger.
DROP TRIGGER IF EXISTS trg_amazon_buybox_diagnostico_solo_insercion ON public.amazon_buybox_diagnostico;
CREATE TRIGGER trg_amazon_buybox_diagnostico_solo_insercion
  BEFORE UPDATE OR DELETE ON public.amazon_buybox_diagnostico
  FOR EACH STATEMENT EXECUTE FUNCTION public.amazon_serie_solo_insercion();

DROP TRIGGER IF EXISTS trg_amazon_buybox_diagnostico_sin_truncate ON public.amazon_buybox_diagnostico;
CREATE TRIGGER trg_amazon_buybox_diagnostico_sin_truncate
  BEFORE TRUNCATE ON public.amazon_buybox_diagnostico
  FOR EACH STATEMENT EXECUTE FUNCTION public.amazon_serie_solo_insercion();

-- =====================================================
-- 6) LAS FUNCIONES DE LECTURA
-- =====================================================
-- Por lo mismo que las tres de la 125: son AGREGACIONES sobre tablas que crecen
-- para siempre y no se pueden hacer desde PostgREST sin traerse las filas. «De
-- los SKU de este cliente, ¿cuántos tienen la oferta destacada?» sobre 13.700
-- referencias × 90 noches son más de un millón de filas para contar trece mil
-- valores.
--
-- SECURITY INVOKER (el valor por omisión, escrito explícito) y con el EXECUTE
-- retirado a anon y authenticated: solo las llama el servidor con service_role.
--
-- CUMPLIMIENTO: las cuatro aceptan un cliente y NINGUNA agrega, compara ni
-- ordena nada entre clientes.

-- ---------- 6.1) El resumen por unidad de trabajo ----------
DROP FUNCTION IF EXISTS public.plataforma_buybox_resumen(UUID, INTEGER);
CREATE FUNCTION public.plataforma_buybox_resumen(
  p_client_id UUID,
  p_dias_vigencia INTEGER DEFAULT 7
)
RETURNS TABLE (
  connection_id UUID,
  connection_name TEXT,
  selling_partner_id TEXT,
  marketplace_id TEXT,
  skus_en_seguimiento BIGINT,
  diagnosticados BIGINT,
  con_buybox BIGINT,
  sin_buybox BIGINT,
  sin_juicio BIGINT,
  con_foep BIGINT,
  amazon_indeterminado BIGINT,
  con_propuesta BIGINT,
  ultima_lectura TIMESTAMPTZ,
  causas JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH unidades AS (
    SELECT c.id AS connection_id, c.name, c.selling_partner_id, m.marketplace_id
    FROM public.amazon_connections c
    CROSS JOIN LATERAL unnest(COALESCE(c.marketplace_ids, ARRAY[]::TEXT[])) AS m(marketplace_id)
    WHERE c.client_id = p_client_id
      AND c.is_active
      AND c.status = 'activa'
  ),
  -- El diagnóstico VIGENTE de cada SKU: el más reciente dentro de la ventana.
  -- Uno de hace tres semanas no es un diagnóstico, es un recuerdo, y contarlo
  -- como vigente hace que el porcentaje de Buy Box de un cliente no se mueva
  -- nunca aunque los barridos hayan dejado de correr.
  vigentes AS (
    SELECT DISTINCT ON (d.connection_id, d.marketplace_id, d.sku)
      d.connection_id, d.marketplace_id, d.sku, d.veredicto, d.fecha,
      d.precio_propuesto, d.foep_estado, d.amazon_estado
    FROM public.amazon_buybox_diagnostico d
    JOIN unidades u
      ON u.connection_id = d.connection_id AND u.marketplace_id = d.marketplace_id
    WHERE d.fecha >= NOW() - make_interval(days => GREATEST(p_dias_vigencia, 1))
    ORDER BY d.connection_id, d.marketplace_id, d.sku, d.fecha DESC
  ),
  seguimiento AS (
    SELECT l.connection_id, l.marketplace_id, COUNT(*) AS n
    FROM public.amazon_listings l
    JOIN unidades u
      ON u.connection_id = l.connection_id AND u.marketplace_id = l.marketplace_id
    WHERE COALESCE(l.activo_manual, l.activo_calculado)
    GROUP BY 1, 2
  ),
  agregado AS (
    SELECT
      v.connection_id, v.marketplace_id,
      COUNT(*) AS diagnosticados,
      COUNT(*) FILTER (WHERE v.veredicto IN (
        'con_buybox_margen_arriba', 'con_buybox_al_limite',
        'con_buybox_incoherente', 'con_buybox_sin_foep')) AS con_buybox,
      COUNT(*) FILTER (WHERE v.veredicto NOT IN (
        'con_buybox_margen_arriba', 'con_buybox_al_limite',
        'con_buybox_incoherente', 'con_buybox_sin_foep', 'sin_datos')) AS sin_buybox,
      COUNT(*) FILTER (WHERE v.veredicto = 'sin_datos') AS sin_juicio,
      COUNT(*) FILTER (WHERE v.foep_estado = 'disponible') AS con_foep,
      COUNT(*) FILTER (WHERE v.amazon_estado = 'indeterminado') AS amazon_indeterminado,
      COUNT(*) FILTER (WHERE v.precio_propuesto IS NOT NULL) AS con_propuesta,
      MAX(v.fecha) AS ultima_lectura
    FROM vigentes v
    GROUP BY 1, 2
  ),
  desglose AS (
    SELECT z.connection_id, z.marketplace_id, jsonb_object_agg(z.veredicto, z.n) AS causas
    FROM (
      SELECT v.connection_id, v.marketplace_id, v.veredicto, COUNT(*) AS n
      FROM vigentes v
      GROUP BY 1, 2, 3
    ) z
    GROUP BY 1, 2
  )
  SELECT
    u.connection_id,
    u.name AS connection_name,
    u.selling_partner_id,
    u.marketplace_id,
    COALESCE(s.n, 0) AS skus_en_seguimiento,
    COALESCE(a.diagnosticados, 0) AS diagnosticados,
    COALESCE(a.con_buybox, 0) AS con_buybox,
    COALESCE(a.sin_buybox, 0) AS sin_buybox,
    COALESCE(a.sin_juicio, 0) AS sin_juicio,
    COALESCE(a.con_foep, 0) AS con_foep,
    COALESCE(a.amazon_indeterminado, 0) AS amazon_indeterminado,
    COALESCE(a.con_propuesta, 0) AS con_propuesta,
    a.ultima_lectura,
    COALESCE(d.causas, '{}'::jsonb) AS causas
  FROM unidades u
  LEFT JOIN seguimiento s
    ON s.connection_id = u.connection_id AND s.marketplace_id = u.marketplace_id
  LEFT JOIN agregado a
    ON a.connection_id = u.connection_id AND a.marketplace_id = u.marketplace_id
  LEFT JOIN desglose d
    ON d.connection_id = u.connection_id AND d.marketplace_id = u.marketplace_id
  -- Orden ESTABLE y sin cifras dentro: alfabético por cuenta y país. Un orden
  -- calculado con las métricas sería un ranking, y aquí no hay rankings.
  ORDER BY u.name, u.marketplace_id;
$$;

COMMENT ON FUNCTION public.plataforma_buybox_resumen(UUID, INTEGER) IS
  'El porcentaje de SKU con oferta destacada y el desglose por causa, por cuenta y país. Solo del cliente que se pasa: ni medias del conjunto, ni comparativas, ni ningún orden calculado con las cifras.';

-- ---------- 6.2) El listado accionable ----------
DROP FUNCTION IF EXISTS public.plataforma_buybox_listado(UUID, UUID, TEXT, TEXT[], TEXT, INTEGER, INTEGER, INTEGER);
CREATE FUNCTION public.plataforma_buybox_listado(
  p_client_id UUID,
  p_connection_id UUID DEFAULT NULL,
  p_marketplace_id TEXT DEFAULT NULL,
  p_veredictos TEXT[] DEFAULT NULL,
  p_busqueda TEXT DEFAULT NULL,
  p_dias_vigencia INTEGER DEFAULT 7,
  p_desde INTEGER DEFAULT 0,
  p_limite INTEGER DEFAULT 200
)
RETURNS TABLE (
  connection_id UUID,
  connection_name TEXT,
  marketplace_id TEXT,
  sku TEXT,
  asin TEXT,
  titulo TEXT,
  marca TEXT,
  es_fba BOOLEAN,
  en_seguimiento BOOLEAN,
  veredicto TEXT,
  motivo TEXT,
  accion TEXT,
  prioridad INTEGER,
  buybox_estado TEXT,
  amazon_estado TEXT,
  precio_propio NUMERIC,
  moneda TEXT,
  foep NUMERIC,
  foep_estado TEXT,
  precio_propuesto NUMERIC,
  precio_propuesto_motivo TEXT,
  datos JSONB,
  fecha TIMESTAMPTZ,
  foep_fecha TIMESTAMPTZ,
  total BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH unidades AS (
    SELECT c.id AS connection_id, c.name, m.marketplace_id
    FROM public.amazon_connections c
    CROSS JOIN LATERAL unnest(COALESCE(c.marketplace_ids, ARRAY[]::TEXT[])) AS m(marketplace_id)
    WHERE c.client_id = p_client_id
      AND (p_connection_id IS NULL OR c.id = p_connection_id)
      AND (p_marketplace_id IS NULL OR m.marketplace_id = p_marketplace_id)
  ),
  vigentes AS (
    SELECT DISTINCT ON (d.connection_id, d.marketplace_id, d.sku) d.*
    FROM public.amazon_buybox_diagnostico d
    JOIN unidades u
      ON u.connection_id = d.connection_id AND u.marketplace_id = d.marketplace_id
    WHERE d.fecha >= NOW() - make_interval(days => GREATEST(p_dias_vigencia, 1))
    ORDER BY d.connection_id, d.marketplace_id, d.sku, d.fecha DESC
  ),
  filtradas AS (
    SELECT v.*, u.name AS connection_name, l.title, l.marca AS l_marca,
           l.is_fba, COALESCE(l.activo_manual, l.activo_calculado) AS seguimiento
    FROM vigentes v
    JOIN unidades u
      ON u.connection_id = v.connection_id AND u.marketplace_id = v.marketplace_id
    LEFT JOIN public.amazon_listings l
      ON l.connection_id = v.connection_id
     AND l.marketplace_id = v.marketplace_id
     AND l.sku = v.sku
    WHERE (p_veredictos IS NULL OR cardinality(p_veredictos) = 0 OR v.veredicto = ANY(p_veredictos))
      AND (
        p_busqueda IS NULL OR btrim(p_busqueda) = '' OR
        v.sku ILIKE '%' || btrim(p_busqueda) || '%' OR
        COALESCE(v.asin, '') ILIKE '%' || btrim(p_busqueda) || '%' OR
        COALESCE(l.title, '') ILIKE '%' || btrim(p_busqueda) || '%'
      )
  )
  SELECT
    f.connection_id, f.connection_name, f.marketplace_id, f.sku, f.asin,
    f.title AS titulo, f.l_marca AS marca, f.is_fba AS es_fba,
    COALESCE(f.seguimiento, false) AS en_seguimiento,
    f.veredicto, f.motivo, f.accion, f.prioridad,
    f.buybox_estado, f.amazon_estado, f.precio_propio, f.moneda, f.foep, f.foep_estado,
    f.precio_propuesto, f.precio_propuesto_motivo, f.datos, f.fecha, f.foep_fecha,
    COUNT(*) OVER () AS total
  FROM filtradas f
  -- «Lo que más importa» = primero la prioridad del veredicto y, dentro de un
  -- mismo veredicto, el SKU más caro: mueve más dinero por unidad. El desempate
  -- por SKU es lo que hace el orden ESTABLE entre páginas — sin él, dos filas
  -- empatadas cambian de sitio entre la página 1 y la 2 y una se pierde.
  ORDER BY f.prioridad ASC,
           COALESCE(f.precio_propio, 0) DESC,
           f.sku ASC
  OFFSET GREATEST(p_desde, 0)
  LIMIT LEAST(GREATEST(p_limite, 1), 2000);
$$;

-- ---------- 6.3) El histórico de un SKU ----------
-- Es lo que la especificación quiere que sustituya a Keepa: «% del tiempo con
-- Buy Box por SKU, evolución de competidores».
DROP FUNCTION IF EXISTS public.plataforma_buybox_historico_sku(UUID, TEXT, TEXT, INTEGER);
CREATE FUNCTION public.plataforma_buybox_historico_sku(
  p_connection_id UUID,
  p_marketplace_id TEXT,
  p_sku TEXT,
  p_dias INTEGER DEFAULT 90
)
RETURNS TABLE (
  lecturas BIGINT,
  lecturas_con_juicio BIGINT,
  con_buybox BIGINT,
  sin_buybox BIGINT,
  nadie BIGINT,
  primera TIMESTAMPTZ,
  ultima TIMESTAMPTZ,
  competidores_min INTEGER,
  competidores_max INTEGER,
  competidores_ultimo INTEGER,
  precio_competidor_min_visto NUMERIC,
  foep_min NUMERIC,
  foep_max NUMERIC,
  serie JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filas AS (
    SELECT s.fecha, s.buybox_estado, s.precio_propio, s.precio_buybox,
           s.n_competidores, s.precio_competidor_min, s.foep, s.foep_estado, s.moneda
    FROM public.amazon_snapshots_precio s
    WHERE s.connection_id = p_connection_id
      AND s.marketplace_id = p_marketplace_id
      AND s.sku = p_sku
      AND s.fecha >= NOW() - make_interval(days => GREATEST(p_dias, 1))
    ORDER BY s.fecha
  )
  SELECT
    COUNT(*) AS lecturas,
    -- EL DENOMINADOR DEL PORCENTAJE EXCLUYE LAS LECTURAS SIN DATO. Contarlas
    -- como «perdida» hace que un fallo de red baje el porcentaje de Buy Box del
    -- cliente, que es exactamente el número que se le enseña en la reunión.
    COUNT(*) FILTER (WHERE buybox_estado <> 'desconocido') AS lecturas_con_juicio,
    COUNT(*) FILTER (WHERE buybox_estado = 'nuestra') AS con_buybox,
    COUNT(*) FILTER (WHERE buybox_estado = 'de_otro') AS sin_buybox,
    COUNT(*) FILTER (WHERE buybox_estado = 'nadie') AS nadie,
    MIN(fecha) AS primera,
    MAX(fecha) AS ultima,
    MIN(n_competidores) AS competidores_min,
    MAX(n_competidores) AS competidores_max,
    (SELECT f.n_competidores FROM filas f ORDER BY f.fecha DESC LIMIT 1) AS competidores_ultimo,
    MIN(precio_competidor_min) AS precio_competidor_min_visto,
    MIN(foep) FILTER (WHERE foep_estado = 'disponible') AS foep_min,
    MAX(foep) FILTER (WHERE foep_estado = 'disponible') AS foep_max,
    COALESCE(jsonb_agg(jsonb_build_object(
      'f', fecha, 'b', buybox_estado, 'p', precio_propio, 'bb', precio_buybox,
      'c', n_competidores, 'cm', precio_competidor_min, 'foep', foep
    ) ORDER BY fecha), '[]'::jsonb) AS serie
  FROM filas;
$$;

-- ---------- 6.4) Hasta dónde ha bajado cada competidor ----------
-- La tercera pieza del §3.3: «hasta dónde ha bajado cada competidor». Amazon NO
-- da histórico, así que esto solo se puede contestar con lo que hayamos guardado
-- nosotros — y es literalmente lo que sustituye a Keepa para nuestros SKU.
DROP FUNCTION IF EXISTS public.plataforma_buybox_competidores_sku(UUID, TEXT, TEXT, INTEGER);
CREATE FUNCTION public.plataforma_buybox_competidores_sku(
  p_connection_id UUID,
  p_marketplace_id TEXT,
  p_sku TEXT,
  p_dias INTEGER DEFAULT 90
)
RETURNS TABLE (
  vendedor TEXT,
  es_nuestro BOOLEAN,
  veces_visto BIGINT,
  veces_destacada BIGINT,
  primera TIMESTAMPTZ,
  ultima TIMESTAMPTZ,
  precio_min NUMERIC,
  precio_max NUMERIC,
  precio_ultimo NUMERIC,
  canal_ultimo TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH desplegadas AS (
    SELECT s.fecha,
           o->>'v' AS vendedor,
           COALESCE((o->>'n')::BOOLEAN, false) AS es_nuestro,
           COALESCE((o->>'g')::BOOLEAN, false) AS destacada,
           NULLIF(o->>'p', '')::NUMERIC AS precio,
           o->>'c' AS canal
    FROM public.amazon_snapshots_precio s
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.ofertas, '[]'::jsonb)) AS o
    WHERE s.connection_id = p_connection_id
      AND s.marketplace_id = p_marketplace_id
      AND s.sku = p_sku
      AND s.fecha >= NOW() - make_interval(days => GREATEST(p_dias, 1))
      AND o->>'v' IS NOT NULL
  )
  SELECT
    d.vendedor,
    bool_or(d.es_nuestro) AS es_nuestro,
    COUNT(*) AS veces_visto,
    COUNT(*) FILTER (WHERE d.destacada) AS veces_destacada,
    MIN(d.fecha) AS primera,
    MAX(d.fecha) AS ultima,
    MIN(d.precio) AS precio_min,
    MAX(d.precio) AS precio_max,
    (SELECT x.precio FROM desplegadas x WHERE x.vendedor = d.vendedor ORDER BY x.fecha DESC LIMIT 1) AS precio_ultimo,
    (SELECT x.canal FROM desplegadas x WHERE x.vendedor = d.vendedor ORDER BY x.fecha DESC LIMIT 1) AS canal_ultimo
  FROM desplegadas d
  GROUP BY d.vendedor
  ORDER BY COUNT(*) FILTER (WHERE d.destacada) DESC, COUNT(*) DESC, d.vendedor;
$$;

-- =====================================================
-- 7) RLS Y PERMISOS
-- =====================================================
-- Mismo criterio que la 123: SELECT solo para admin vía is_erp_admin, y NADIE
-- escribe desde el navegador. TRUNCATE va en el REVOKE porque entra en el GRANT
-- ALL de Supabase y RLS NO SE APLICA A TRUNCATE.
DO $$
DECLARE
  t TEXT;
  politica TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_buybox_config',
    'amazon_buybox_diagnostico',
    'amazon_buybox_cola_foep'
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

-- Las funciones: solo el servidor. Una SECURITY DEFINER aquí convertiría a
-- cualquiera con sesión en alguien que puede leer los precios y la competencia
-- de las dieciséis tiendas.
REVOKE ALL ON FUNCTION public.plataforma_buybox_resumen(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plataforma_buybox_listado(UUID, UUID, TEXT, TEXT[], TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plataforma_buybox_historico_sku(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plataforma_buybox_competidores_sku(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

-- =====================================================
-- 8) LA SEMILLA DE CONFIGURACIÓN
-- =====================================================
-- Una fila por cliente, con TODO lo de negocio a NULL. No es un descuido: es el
-- estado «falta por decidir», y la pantalla lo enseña como tal. Un cliente sin
-- fila funcionaría igual (el código usa los mismos valores por defecto), pero
-- entonces no habría dónde escribir la primera decisión.
INSERT INTO public.amazon_buybox_config (client_id, notas)
SELECT c.id,
       'Creada por la migración 126. Los umbrales de negocio están sin decidir a propósito: mientras estén vacíos, el monitor informa pero no recomienda.'
FROM public.amazon_clients c
WHERE NOT EXISTS (
  SELECT 1 FROM public.amazon_buybox_config b WHERE b.client_id = c.id AND b.is_active
);

-- =====================================================
-- 9) COMPROBACIÓN
-- =====================================================
DO $$
DECLARE faltan TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='amazon_snapshots_precio'
                   AND column_name='buybox_estado') THEN
    faltan := faltan || 'amazon_snapshots_precio.buybox_estado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='amazon_buybox_diagnostico') THEN
    faltan := faltan || 'amazon_buybox_diagnostico';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='plataforma_buybox_resumen') THEN
    faltan := faltan || 'plataforma_buybox_resumen()';
  END IF;

  IF cardinality(faltan) > 0 THEN
    RAISE EXCEPTION 'La migración 126 no ha dejado todo en su sitio. Falta: %', array_to_string(faltan, ', ');
  END IF;

  RAISE NOTICE '126 · Monitor de Buy Box (A2) listo.';
END $$;
