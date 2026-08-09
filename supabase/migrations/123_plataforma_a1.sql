-- =====================================================
-- 123 · PLATAFORMA, MÓDULO A1 — LA CAPA BASE DE DATOS
-- =====================================================
-- Esto es el motor común del que van a colgar A2 (Buy Box), A3 (auditoría de
-- repricing), A4 (FBM→FBA), A5 (costes) y A6 (la aplicación). La especificación
-- dice de A1: «Esto es lo primero y todo lo demás depende de ello. Construye
-- esto bien.»
--
--
-- LAS DOS DECISIONES QUE ALGUIEN VA A DESHACER SIN QUERER DENTRO DE SEIS MESES.
-- Están escritas aquí arriba a propósito, porque las dos parecen un rodeo raro
-- cuando se lee el esquema sin contexto.
--
--
-- ============ 1) LAS SERIES TEMPORALES SON DE SOLO INSERCIÓN ============
--
-- Un snapshot NO se corrige: se añade otro. La razón no es purismo, es que
-- ESTE HISTÓRICO NO SE PUEDE RECUPERAR HACIA ATRÁS. Amazon no tiene un endpoint
-- que diga «a qué precio estaba la Buy Box de este ASIN el 3 de marzo»: eso solo
-- lo sabe quien lo miró ese día y lo apuntó. Todo el valor de A2 y A3 —el % de
-- tiempo con Buy Box, el margen regalado, hasta dónde bajó cada competidor— es
-- una lectura de estas tablas. Un UPDATE que «arregla» una fila destruye el
-- único ejemplar que existe de ese instante.
--
-- Por eso no basta con no escribir UPDATEs: hay un TRIGGER que los prohíbe
-- (sección 4.5). Es a prueba de service_role, que es quien escribe aquí y quien
-- se salta RLS y los GRANT. Si de verdad hay que purgar histórico antiguo, se
-- quita el trigger A PROPÓSITO y se vuelve a poner: que cueste dos líneas es el
-- punto.
--
-- Consecuencia que sí es rara y hay que saberla: las cuatro tablas de serie
-- NO LLEVAN CLAVE AJENA a amazon_listings ni a amazon_connections, y no es un
-- olvido. Las dos filas padre se borran de verdad en la operativa normal:
--   · purgeMissingListings() (lib/amazon/data.ts) borra los listings que Amazon
--     deja de devolver en un barrido completo;
--   · disconnectConnection() borra la fila de la conexión al desconectar.
-- Una FK con CASCADE se llevaría el histórico por delante justo cuando más
-- falta hace (un SKU que desaparece del catálogo es lo que más interesa
-- explicar), y una FK con SET NULL sería un UPDATE sobre la serie, que es
-- exactamente lo que el trigger prohíbe. Así que se guarda el `listing_id` como
-- referencia blanda para poder unir cuando existe, y ADEMÁS se congela en cada
-- fila la identidad que sobrevive a todo: selling_partner_id + marketplace_id +
-- sku. Es el mismo razonamiento que ya aplicó amazon_submissions en la 118.
--
--
-- ============ 2) SE EXTIENDE amazon_listings, NO SE CREA «skus» ============
--
-- La especificación dibuja una tabla `skus (id, cliente_id, marketplace, sku,
-- asin, canal, marca, categoria, peso, dims, es_marca_propia, activo_tracking)`.
-- Eso YA EXISTE y se llama amazon_listings: tiene el SKU, el ASIN, el
-- marketplace, el canal de logística (mejor que la spec, porque `is_fba` la
-- calcula la base y no puede discrepar), el precio, la cantidad, el estado del
-- listing y el `product_type` —que es obligatorio en cada PATCH y no se puede
-- deducir—. Lo que le falta son atributos de catálogo: marca, categoría,
-- dimensiones, peso y las dos marcas de seguimiento.
--
-- Crear una tabla paralela sería la forma más rápida de que dos pantallas digan
-- cifras distintas del mismo SKU. Habría dos filas por producto, dos procesos
-- escribiéndolas, dos momentos de última lectura y ninguna regla que diga cuál
-- manda; y el día que discrepen —y discrepan— nadie sabrá cuál mirar. Aquí hay
-- UNA fila por (conexión, marketplace, sku) y punto.
--
-- Lo que NO se añade, también a propósito: `cliente_id`. Hoy se llega al cliente
-- por connection_id -> amazon_connections.client_id. Duplicarlo abre la puerta a
-- que una fila diga un cliente y su conexión diga otro, y una fila de un cliente
-- archivada bajo otro es justo lo que el compromiso de cumplimiento firmado ante
-- Amazon prohíbe (§2.1 de la especificación: los datos de un vendedor se usan
-- EXCLUSIVAMENTE para ese vendedor). Si un JOIN duele, la respuesta es un
-- índice, no una columna.
--
--
-- LO QUE ESTA MIGRACIÓN NO HACE: no toca amazon_clients ni amazon_connections
-- (ya son un superconjunto de `clientes` y `cuentas` de la spec), no crea un
-- app_id nuevo (A1 vive dentro de 'amazon-api', que ya es solo de admins) y no
-- escribe nada en Amazon (A1 SOLO LEE).
--
-- Se lanza en el editor SQL de Supabase, después de la 118 y la 119.
-- IDEMPOTENTE: se puede volver a pegar sin romper nada.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción: reventar
-- aquí deja la base intacta en vez de a medias, con media docena de tablas de
-- series sin sus triggers de solo-inserción.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_listings'
  ) THEN
    RAISE EXCEPTION
      'No existe public.amazon_listings. Lanza antes 118_amazon_api.sql: esta migración EXTIENDE el espejo del catálogo, no lo crea.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_connections'
  ) THEN
    RAISE EXCEPTION 'No existe public.amazon_connections. Lanza antes 118_amazon_api.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_clients'
  ) THEN
    RAISE EXCEPTION 'No existe public.amazon_clients. Lanza antes 118_amazon_api.sql.';
  END IF;

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
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella las políticas RLS de abajo dejarían estas tablas abiertas a cualquiera, y aquí hay el catálogo y los costes de compra de tiendas ajenas.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_amazon_updated_at'
  ) THEN
    RAISE EXCEPTION
      'Falta public.update_amazon_updated_at(), que la crea 118_amazon_api.sql. Es la que mantiene updated_at en las tablas de este módulo.';
  END IF;
END $$;

-- =====================================================
-- 1) EL ESPEJO DEL CATÁLOGO, EXTENDIDO
-- =====================================================
-- Todo lo de aquí sale de Catalog Items 2022-04-01 (searchCatalogItems con
-- includedData=summaries,dimensions) salvo `es_marca_propia`, que Amazon no
-- sabe y pone una persona, y las tres columnas de seguimiento del final.
--
-- REGLA QUE ATRAVIESA TODA ESTA SECCIÓN: NINGÚN NÚMERO SIN SU UNIDAD. Amazon
-- devuelve libras en Norteamérica y kilos en Europa —y en el ejemplo oficial de
-- su propia documentación el mismo paquete viene medido en pulgadas y pesado en
-- kilogramos, dentro del mismo objeto—. Un peso sin unidad es un peso inventado
-- en cuanto entre el segundo marketplace, y de ese número sale la tarifa de FBA
-- con la que A4 recomienda mover inventario a un almacén de Amazon.

ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS marca TEXT;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS categoria_id TEXT;

-- BASE_PRODUCT / VARIATION_PARENT / PRODUCT_BUNDLE / OTHER (summaries[].itemClassification).
-- No es decorativo: un VARIATION_PARENT no se compra ni se vende, es el nodo que
-- agrupa las tallas. Meterlo en un análisis de margen o en el criterio de «SKU
-- activo» ensucia las cifras sin que se note, porque parece un producto más.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS clasificacion_item TEXT;

-- ---------- Dimensiones y peso DEL PRODUCTO ----------
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS peso NUMERIC;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS peso_unidad TEXT;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS largo NUMERIC;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS ancho NUMERIC;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS alto NUMERIC;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS dims_unidad TEXT;

-- ---------- Dimensiones y peso DEL EMBALAJE ----------
-- Van separadas y no es redundancia: Catalog Items devuelve dos juegos,
-- `item` y `package`, y LA TARIFA DE FBA SE CALCULA SOBRE EL EMBALAJE. Guardar
-- solo uno obliga a elegir mal en algún sitio; con los dos, A4 usa el que toca
-- y la ficha de producto enseña el que entiende una persona.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS peso_paquete NUMERIC;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS peso_paquete_unidad TEXT;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS largo_paquete NUMERIC;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS ancho_paquete NUMERIC;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS alto_paquete NUMERIC;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS dims_paquete_unidad TEXT;

-- DE DÓNDE salen las medidas. La regla 4 del §3.5 de la spec exige marcar los
-- SKU sin dimensiones certificadas porque su estimación de tarifa no es fiable,
-- y sin esta columna «medido por nosotros a ojo» y «lo dice Amazon» son
-- indistinguibles. NULL = no tenemos medidas, que NO es cero.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS dims_origen TEXT;

-- product-id + product-id-type del informe de listings (EAN, UPC, GTIN...). Es
-- el puente natural con el mapeo referencia-de-proveedor -> SKU del módulo A5 y
-- con stock_mappings, y viene gratis en el mismo fichero del censo.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS codigo_externo TEXT;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS codigo_externo_tipo TEXT;

-- Amazon NO sabe si la marca es del cliente o si la revende. Y la diferencia
-- decide qué métricas sirven (§3.4 de la spec: marca propia y distribución
-- necesitan análisis distintos), así que es un dato nuestro, no suyo.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS es_marca_propia BOOLEAN NOT NULL DEFAULT false;


-- ==================================================================
-- EL MODELO DE NEGOCIO DEL CLIENTE, Y POR QUÉ DECIDE QUÉ SE MIDE
-- ==================================================================
--
-- No es una etiqueta para la ficha: es lo que evita medir 44.000 productos
-- ajenos cada noche.
--
-- EN MARCA PROPIA el ASIN es del cliente, así que el BSR es SU termómetro: si
-- sube o baja, es cosa suya y hay que verlo. Son catálogos cortos —Bodegas
-- Valhalla, Creative Toys, Yo By Yolanda, Jamones Tapas Party— de decenas o
-- cientos de referencias.
--
-- EN ARBITRAJE (reventa) el cliente es uno de quince vendedores sobre el ASIN de
-- otro. El BSR de ese ASIN mide cómo se vende EL PRODUCTO, no cómo lo hace él:
-- puede mejorar mientras el cliente pierde todas sus ventas por no tener la Buy
-- Box, y al revés. Ahí lo que decide es Buy Box y precio, no ranking. Y son los
-- catálogos enormes: ShoesF ~13.700 SKU, Keslem hasta 30.000. Pedirles BSR a
-- diario son unas seis horas de ventana nocturna gastadas en medir el producto
-- de otro.
--
-- MIX es el caso que impide que esto sea solo un campo del cliente: hay que
-- resolverlo SKU a SKU con `amazon_listings.es_marca_propia`. Por eso el modelo
-- del cliente fija la POLÍTICA y la columna del SKU la afina.
--
-- Y no se apaga del todo en arbitraje, se pasa a BAJO DEMANDA. Sin el rol de
-- Análisis de marcas no hay datos de velocidad de ventas, así que el BSR es la
-- única señal de rotación que queda para decidir si un FBM merece pasar a FBA
-- (módulo A4). Apagarlo entero dejaría ese análisis sin ninguna entrada. Lo que
-- se quita es el barrido diario del catálogo completo, no la medición puntual
-- de los SKU que se están evaluando.
ALTER TABLE public.amazon_clients
  ADD COLUMN IF NOT EXISTS modelo_negocio TEXT NOT NULL DEFAULT 'mix';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'amazon_clients_modelo_negocio_ok'
  ) THEN
    ALTER TABLE public.amazon_clients
      ADD CONSTRAINT amazon_clients_modelo_negocio_ok
      CHECK (modelo_negocio IN ('marca_propia', 'arbitraje', 'mix'));
  END IF;
END $$;

COMMENT ON COLUMN public.amazon_clients.modelo_negocio IS
  'marca_propia | arbitraje | mix. Decide la política de BSR por defecto y qué '
  'análisis tienen sentido. En mix se resuelve por SKU con es_marca_propia.';

-- La política, aparte del modelo, porque un cliente puede ser la excepción.
--   auto          -> se deduce del modelo_negocio (lo normal)
--   diario        -> se mide siempre, cueste lo que cueste
--   bajo_demanda  -> solo los SKU que alguien esté evaluando
--   nunca         -> ni eso
ALTER TABLE public.amazon_clients
  ADD COLUMN IF NOT EXISTS bsr_politica TEXT NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'amazon_clients_bsr_politica_ok'
  ) THEN
    ALTER TABLE public.amazon_clients
      ADD CONSTRAINT amazon_clients_bsr_politica_ok
      CHECK (bsr_politica IN ('auto', 'diario', 'bajo_demanda', 'nunca'));
  END IF;
END $$;

-- Cuándo se leyó el CATÁLOGO ENRIQUECIDO de este SKU. Separado de last_seen_at,
-- que lo mueve el barrido de cada quince minutos: este solo lo mueve
-- searchCatalogItems, que es caro (20 ASIN por llamada, 2 llamadas por segundo)
-- y va en el barrido semanal. Sin separarlos no hay forma de saber a quién le
-- toca enriquecer sin releerlo todo.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS catalogo_visto_at TIMESTAMPTZ;

-- ---------- SEGUIMIENTO: DOS COLUMNAS, NO UNA ----------
-- La spec pide `activo_tracking`. Aquí son dos y esa es la parte importante.
--
--   activo_calculado -> lo que decidió la regla del cliente en el último
--                       recálculo. Lo escribe el sistema, se pisa entero cada
--                       vez y no hay que tenerle cariño.
--   activo_manual    -> lo que dijo una persona. Gana SIEMPRE, en los dos
--                       sentidos. NULL = nadie se ha pronunciado.
--
-- El «SKU activo efectivo» es COALESCE(activo_manual, activo_calculado). Con una
-- sola columna, el recálculo nocturno se lleva por delante lo que un gestor
-- marcó a mano ayer y nadie entiende por qué ha dejado de seguirse un producto.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS activo_calculado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS activo_manual BOOLEAN;
-- Por qué está o no está en seguimiento, EN ESPAÑOL y ya redactado. Es lo que
-- contesta «¿por qué este producto no se refresca a diario?» sin reproducir la
-- regla a mano.
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS activo_motivo TEXT;
ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS activo_evaluado_at TIMESTAMPTZ;

-- ---------- CHECKs, con guardia (ADD CONSTRAINT no admite IF NOT EXISTS) ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_listings_dims_origen_ok') THEN
    ALTER TABLE public.amazon_listings
      ADD CONSTRAINT amazon_listings_dims_origen_ok
      CHECK (dims_origen IS NULL OR dims_origen IN ('amazon', 'manual', 'estimado'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_listings_clasificacion_ok') THEN
    ALTER TABLE public.amazon_listings
      ADD CONSTRAINT amazon_listings_clasificacion_ok
      CHECK (clasificacion_item IS NULL OR clasificacion_item IN (
        'BASE_PRODUCT', 'VARIATION_PARENT', 'PRODUCT_BUNDLE', 'OTHER'
      ));
  END IF;

  -- Un número sin unidad no es un peso. Se exige la pareja completa o ninguna
  -- de las dos, en los cuatro juegos.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_listings_peso_unidad_ok') THEN
    ALTER TABLE public.amazon_listings
      ADD CONSTRAINT amazon_listings_peso_unidad_ok
      CHECK ((peso IS NULL) = (peso_unidad IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_listings_peso_paquete_unidad_ok') THEN
    ALTER TABLE public.amazon_listings
      ADD CONSTRAINT amazon_listings_peso_paquete_unidad_ok
      CHECK ((peso_paquete IS NULL) = (peso_paquete_unidad IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_listings_dims_unidad_ok') THEN
    ALTER TABLE public.amazon_listings
      ADD CONSTRAINT amazon_listings_dims_unidad_ok
      CHECK (dims_unidad IS NOT NULL OR (largo IS NULL AND ancho IS NULL AND alto IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_listings_dims_paquete_unidad_ok') THEN
    ALTER TABLE public.amazon_listings
      ADD CONSTRAINT amazon_listings_dims_paquete_unidad_ok
      CHECK (dims_paquete_unidad IS NOT NULL OR (largo_paquete IS NULL AND ancho_paquete IS NULL AND alto_paquete IS NULL));
  END IF;

  -- Una decisión manual sin motivo es la que dentro de tres meses nadie sabe si
  -- se puede revertir.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_listings_activo_manual_ok') THEN
    ALTER TABLE public.amazon_listings
      ADD CONSTRAINT amazon_listings_activo_manual_ok
      CHECK (activo_manual IS NULL OR btrim(COALESCE(activo_motivo, '')) <> '');
  END IF;
END $$;

COMMENT ON COLUMN public.amazon_listings.activo_manual IS
  'Lo que dijo una persona sobre si este SKU se sigue a diario. GANA SIEMPRE sobre activo_calculado, en los dos sentidos. NULL = nadie se ha pronunciado. El valor efectivo es COALESCE(activo_manual, activo_calculado).';

COMMENT ON COLUMN public.amazon_listings.activo_calculado IS
  'Lo que decidió la regla de amazon_tracking_rules en el último recálculo. Lo pisa entero el trabajo «recalcular_activos»: no se edita a mano, para eso está activo_manual.';

COMMENT ON COLUMN public.amazon_listings.activo_motivo IS
  'Por qué este SKU está o no en seguimiento, en español y ya redactado. Cuando activo_manual está puesto, el motivo es EL DE LA PERSONA y el recálculo no lo toca: pisarlo dejaría la decisión manual sin explicación.';

COMMENT ON COLUMN public.amazon_listings.dims_origen IS
  'De dónde salen las medidas: amazon (Catalog Items), manual (las midió alguien) o estimado. La regla 4 del §3.5 de la spec exige marcar los SKU sin dimensiones certificadas porque su tarifa de FBA no es fiable. NULL = no tenemos medidas, que no es cero.';

COMMENT ON COLUMN public.amazon_listings.peso_paquete IS
  'Peso del EMBALAJE (dimensions[].package.weight). Es el que usa Amazon para calcular la tarifa de FBA; el del producto (peso) sirve para la ficha, no para la tarifa.';

COMMENT ON COLUMN public.amazon_listings.es_marca_propia IS
  'Dato NUESTRO, no de Amazon: si la marca es del cliente o la revende. Decide qué métricas tienen sentido (§3.4 de la spec) y entra en el criterio de SKU activo.';

COMMENT ON COLUMN public.amazon_listings.catalogo_visto_at IS
  'Última lectura del catálogo ENRIQUECIDO (searchCatalogItems). Separado de last_seen_at, que lo mueve el barrido de cada 15 minutos: sin la distinción no se puede saber a quién le toca enriquecer sin releerlo todo.';

-- ---------- Índices ----------
-- La consulta del barrido diario: «qué SKU están en seguimiento de esta
-- conexión». Parcial sobre la expresión efectiva, que es la única que importa.
CREATE INDEX IF NOT EXISTS idx_amazon_listings_activos
  ON public.amazon_listings(connection_id, marketplace_id, sku)
  WHERE COALESCE(activo_manual, activo_calculado);

-- La del barrido semanal de enriquecimiento: «a quién le toca». NULLS FIRST
-- porque los que nunca se han leído van primero.
CREATE INDEX IF NOT EXISTS idx_amazon_listings_enriquecer
  ON public.amazon_listings(connection_id, catalogo_visto_at NULLS FIRST);

-- El cruce con el mapeo de proveedor de A5, que es por código de barras.
CREATE INDEX IF NOT EXISTS idx_amazon_listings_codigo_externo
  ON public.amazon_listings(codigo_externo)
  WHERE codigo_externo IS NOT NULL;

-- =====================================================
-- 2) EL CRITERIO DE «SKU ACTIVO», CONFIGURABLE
-- =====================================================
-- La spec es explícita: «El criterio de "SKU activo" es UNA TABLA CONFIGURABLE,
-- NO UNA REGLA EN EL CÓDIGO. Va a cambiar por cliente y con el tiempo.»
--
-- POR QUÉ COLUMNAS Y NO UN JSON CON REGLAS. Un motor de reglas genérico se
-- escribe en una tarde y se depura durante un año: no se puede consultar desde
-- SQL, no se puede validar con un CHECK, no se puede pintar en una pantalla sin
-- escribir un editor, y nadie sabe qué combinaciones son legales. Estas son las
-- seis preguntas que de verdad distinguen a los clientes de la cartera —canal,
-- marca propia, rotación, listado vivo, exclusiones y tope—, y añadir una
-- séptima es una columna y una línea en lib/plataforma/activos.ts.
--
-- POR QUÉ UNA SOLA REGLA VIVA POR CLIENTE. Con varias haría falta un orden de
-- prioridad y una forma de resolver empates, y el día que dos reglas digan cosas
-- distintas del mismo SKU nadie sabrá cuál ganó. Las anteriores se quedan con
-- is_active = false: son el registro de con qué criterio se midió el histórico.
CREATE TABLE IF NOT EXISTS public.amazon_tracking_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  /** Cómo se llama en pantalla: «FBA + lo que rote», «solo marca propia»... */
  name TEXT NOT NULL,

  /**
   * A qué marketplaces aplica. Vacío = a todos los de ese cliente.
   *
   * Existe porque un cliente puede estar empezando en Estados Unidos con
   * cuarenta referencias y tener trece mil en España: el criterio que sirve
   * para uno arruina el otro.
   */
  marketplace_ids TEXT[] NOT NULL DEFAULT '{}',

  -- ---------- Qué ENTRA ----------
  /** Todo lo que gestiona Amazon. Es el caso de siempre: si está en un almacén
      de Amazon, cuesta dinero cada día y hay que mirarlo */
  incluir_fba BOOLEAN NOT NULL DEFAULT true,
  /**
   * Todo lo gestionado por el vendedor.
   *
   * NACE APAGADO Y NO ES UN DESCUIDO: ShoesF son ~13.700 SKU mayoritariamente
   * FBM. Encenderlo ahí mete el catálogo entero en el refresco diario, que es
   * justo lo que la spec prohíbe («No traigas 13.700 SKUs a diario»). Para FBM
   * la puerta de entrada es la rotación, no el canal.
   */
  incluir_fbm BOOLEAN NOT NULL DEFAULT false,
  /** La marca del cliente: si es suya, se mira aunque venda poco */
  incluir_marca_propia BOOLEAN NOT NULL DEFAULT true,

  /**
   * Rotación mínima para entrar por ventas: `min_unidades` en los últimos
   * `ventana_dias`. NULL = esta vía está apagada.
   *
   * Hasta la Fase B las unidades salen de amazon_ventas_externas (CSV); después,
   * del informe de ventas y tráfico. Quien consulta no se entera: ver
   * lib/plataforma/ventas.ts.
   */
  min_unidades INTEGER,
  ventana_dias INTEGER NOT NULL DEFAULT 30,

  -- ---------- Qué se cae ----------
  /** Un listing que no está a la venta no tiene Buy Box que perder */
  solo_listados_activos BOOLEAN NOT NULL DEFAULT true,
  /** Sin precio no hay margen que calcular ni Buy Box que diagnosticar */
  excluir_sin_precio BOOLEAN NOT NULL DEFAULT true,
  /** Un VARIATION_PARENT no se compra ni se vende: es el nodo de las tallas */
  excluir_variacion_padre BOOLEAN NOT NULL DEFAULT true,
  marcas_excluidas TEXT[] NOT NULL DEFAULT '{}',
  skus_excluidos TEXT[] NOT NULL DEFAULT '{}',
  /** Siempre dentro, pase lo que pase. Los candidatos que el equipo quiere
      vigilar aunque hoy no cumplan ningún criterio */
  skus_incluidos TEXT[] NOT NULL DEFAULT '{}',

  /**
   * EL FRENO. Tope duro de SKU que pueden quedar en seguimiento diario.
   *
   * No es una preferencia, es la protección del cupo de Amazon: el subconjunto
   * diario tiene que caber en una ventana nocturna, y una regla mal puesta —un
   * `incluir_fbm` encendido sin querer— convierte trece mil referencias en el
   * conjunto «activo» sin dar ningún error. Cuando el tope se alcanza, se
   * ordena por `orden_tope`, se corta, y se levanta un evento RUIDOSO: quedarse
   * callado convertiría el freno en una pérdida silenciosa de cobertura.
   */
  tope_skus INTEGER NOT NULL DEFAULT 2000,
  /** Con qué criterio se recorta al llegar al tope. Desempate final por SKU
      para que dos recálculos seguidos den exactamente la misma lista */
  orden_tope TEXT NOT NULL DEFAULT 'ventas'
    CHECK (orden_tope IN ('ventas', 'bsr', 'precio', 'sku')),

  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /**
   * Una regla que no incluye nada no selecciona nada, y no selecciona nada EN
   * SILENCIO: el refresco diario deja de traer datos y todo el mundo cree que
   * está funcionando. Se exige al menos una vía de entrada.
   */
  CONSTRAINT amazon_tracking_rules_algo_entra CHECK (
    incluir_fba
    OR incluir_fbm
    OR incluir_marca_propia
    OR min_unidades IS NOT NULL
    OR COALESCE(array_length(skus_incluidos, 1), 0) > 0
  ),
  CONSTRAINT amazon_tracking_rules_ventana_ok
    CHECK (ventana_dias >= 1 AND ventana_dias <= 365),
  CONSTRAINT amazon_tracking_rules_min_unidades_ok
    CHECK (min_unidades IS NULL OR min_unidades >= 0),
  CONSTRAINT amazon_tracking_rules_tope_ok
    CHECK (tope_skus > 0)
);

COMMENT ON TABLE public.amazon_tracking_rules IS
  'El criterio de «SKU activo» por cliente, configurable sin tocar código (§3.2 de la spec). Una sola regla viva por cliente; las anteriores se quedan con is_active=false porque son el registro de con qué criterio se midió el histórico.';

COMMENT ON COLUMN public.amazon_tracking_rules.tope_skus IS
  'Tope duro de SKU en seguimiento diario. Es el freno que impide que una regla mal puesta meta 13.700 referencias en la ventana nocturna. Al alcanzarlo se recorta por orden_tope y se levanta un evento de severidad «aviso».';

-- UNA regla viva por cliente. El índice parcial es lo que lo garantiza: sin él,
-- dos reglas activas obligarían a inventar un desempate en el código.
CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_tracking_rules_viva
  ON public.amazon_tracking_rules(client_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_amazon_tracking_rules_cliente
  ON public.amazon_tracking_rules(client_id, created_at DESC);

-- ---------- Semilla: una regla conservadora para cada cliente ----------
-- Un cliente sin regla no tendría criterio y el recálculo se saltaría su cuenta
-- sin decir nada. Los valores de fábrica son deliberadamente estrechos —FBA y
-- marca propia, tope de 2.000— porque el error caro es el contrario: un
-- conjunto activo demasiado grande revienta la ventana nocturna del cliente que
-- lo tiene y de todos los demás.
INSERT INTO public.amazon_tracking_rules (client_id, name, notes)
SELECT
  c.id,
  'Criterio de fábrica',
  'Creada por la migración 123 para que ningún cliente se quede sin criterio. Ajústala con el catálogo delante: FBA y marca propia entran, FBM solo si rota, tope de 2.000 SKU.'
FROM public.amazon_clients c
WHERE NOT EXISTS (
  SELECT 1 FROM public.amazon_tracking_rules r WHERE r.client_id = c.id
);

-- =====================================================
-- 3) COSTES DE PRODUCTO, CON VIGENCIA TEMPORAL
-- =====================================================
-- Sin esto A3 y A4 no funcionan: el coste no está en Amazon, lo tiene el
-- cliente (§3.6 de la spec).
--
-- POR QUÉ CUELGA DEL CLIENTE Y NO DE LA CONEXIÓN: el coste es lo que el cliente
-- le paga a su proveedor. No cambia porque el producto se venda en Francia o en
-- Estados Unidos, y una conexión es por REGIÓN, así que colgarlo de ahí
-- obligaría a meter la misma cifra dos veces para un cliente con Europa y
-- Norteamérica, con la garantía de que un día discrepan.
--
-- POR QUÉ `valido_desde` Y NO UN CAMPO `coste` EN EL LISTING: porque los costes
-- cambian y el histórico tiene que seguir siendo correcto. El margen de marzo se
-- calcula con el coste de marzo, no con el de hoy. Con una sola cifra
-- sobreescribible, todo el histórico de margen se reescribe cada vez que el
-- proveedor sube los precios, y nadie se entera.
--
-- ESTA TABLA SÍ SE PUEDE EDITAR (a diferencia de las series del punto 4): es
-- entrada manual, y en la entrada manual hay erratas. Lo que no se hace es
-- SOBRESCRIBIR un tramo de vigencia para «actualizar el precio»: eso es una fila
-- nueva con otro valido_desde.
CREATE TABLE IF NOT EXISTS public.amazon_costes_producto (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  /** El SKU del cliente, tal cual está en amazon_listings.sku */
  sku TEXT NOT NULL,

  /** Coste de compra por unidad, SIN impuestos */
  coste NUMERIC NOT NULL,
  /** Obligatoria. Un coste sin divisa no se puede comparar con un precio de
      Amazon en cuanto el cliente compre en dólares y venda en euros */
  moneda TEXT NOT NULL,

  /**
   * Desde cuándo rige. El coste vigente en una fecha es el de la fila con el
   * `valido_desde` MÁS ALTO que no supere esa fecha; no hay `valido_hasta`
   * porque sería un dato derivado que hay que mantener a mano y que se queda
   * desincronizado el primer día. Ver costeVigente() en lib/plataforma/costes.ts.
   */
  valido_desde DATE NOT NULL,

  /** De dónde salió: lo tecleó alguien, vino en un CSV, lo mandó el ERP */
  origen TEXT NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual', 'fichero', 'erp')),
  /** Nombre del fichero o referencia del import. Obligatorio si no es manual:
      un coste raro sin saber de qué fichero salió no se puede investigar */
  fuente_ref TEXT,

  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /** Un solo coste por SKU y fecha de entrada en vigor. Reimportar el mismo
      fichero corrige la cifra en vez de duplicar el tramo */
  UNIQUE (client_id, sku, valido_desde),
  CONSTRAINT amazon_costes_producto_coste_ok CHECK (coste >= 0),
  CONSTRAINT amazon_costes_producto_origen_ok
    CHECK (origen = 'manual' OR btrim(COALESCE(fuente_ref, '')) <> '')
);

COMMENT ON TABLE public.amazon_costes_producto IS
  'Coste de compra por SKU CON VIGENCIA. El coste vigente en una fecha es el de la fila con el valido_desde más alto que no la supere. Sin valido_hasta a propósito: sería un derivado que se desincroniza el primer día.';

-- La consulta real: «el coste de este SKU en esta fecha». El orden descendente
-- por valido_desde es lo que deja resolverla con un LIMIT 1.
CREATE INDEX IF NOT EXISTS idx_amazon_costes_sku
  ON public.amazon_costes_producto(client_id, sku, valido_desde DESC);

-- «Qué cobertura de costes tiene este cliente», que es la vista que dice de qué
-- análisis te puedes fiar (§3.6 de la spec).
CREATE INDEX IF NOT EXISTS idx_amazon_costes_cliente
  ON public.amazon_costes_producto(client_id, valido_desde DESC);

-- =====================================================
-- 4) LAS SERIES TEMPORALES (SOLO INSERCIÓN)
-- =====================================================
-- Cuatro tablas con la misma forma en la cabecera, y esa forma es deliberada:
--
--   listing_id            referencia BLANDA, sin FK. Sirve para unir mientras
--                         el listing exista; puede quedarse apuntando a nada.
--   connection_id         lo mismo, para la vista «todo lo de este cliente hoy».
--   selling_partner_id    \
--   marketplace_id         >  LA IDENTIDAD QUE SOBREVIVE A TODO.
--   sku                   /
--   fecha                 el INSTANTE de la observación, no el día. Dos lecturas
--                         del mismo día son dos filas legítimas y la serie las
--                         quiere las dos: el % de tiempo con Buy Box se calcula
--                         con la frecuencia real de muestreo.
--
-- Ver el porqué de todo esto en la cabecera del fichero.
--
-- El índice de trabajo es el de la identidad congelada y no el de listing_id,
-- por dos razones: es el único que sigue sirviendo cuando el listing se borra, y
-- quien consulta la ficha de un SKU tiene ya esos tres datos delante, así que no
-- necesita el UUID. Un índice menos en una tabla de millones de filas es tiempo
-- de inserción del barrido nocturno.

-- ---------- 4.1) PRECIO Y BUY BOX ----------
-- La ingesta es de A2, pero el esquema entra AHORA. Cambiarlo después obliga a
-- migrar filas ya guardadas, y estas son precisamente las que no se pueden
-- volver a generar.
CREATE TABLE IF NOT EXISTS public.amazon_snapshots_precio (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID,
  connection_id UUID,
  selling_partner_id TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /** Nuestro precio en ese instante */
  precio_propio NUMERIC,
  /** Obligatoria: «14,99» no dice nada en un cliente que vende en ES y en US */
  moneda TEXT NOT NULL,

  /** NULL = no se pudo saber. Distinto de false, que es «la hemos perdido» */
  tiene_buybox BOOLEAN,
  precio_buybox NUMERIC,
  /** Con qué canal gana el que la tiene: FBA / FBM / AMAZON. Es lo que separa
      «problema de precio» de «problema logístico» en el motor de A2 */
  canal_ganador TEXT,
  n_competidores INTEGER,
  /** Amazon retail vendiendo en el ASIN: descarte automático en A4 */
  amazon_en_asin BOOLEAN,
  /** Lo más bajo que se ha visto ofertar. Es lo que sustituye a Keepa para
      nuestro uso: hasta dónde ha llegado a bajar la competencia */
  precio_competidor_min NUMERIC,

  /**
   * FOEP: el precio al que NUESTRA oferta pasaría a ser la destacada. Es el dato
   * central de toda la plataforma.
   *
   * Va con su propio estado y no solo con NULL, porque la regla 5 del §3.5 de la
   * spec lo exige: «marcar SKUs sin FOEP disponible como caso aparte, NUNCA como
   * cero». Un NULL que signifique a la vez «no lo pedimos» y «Amazon no lo da»
   * hace que A4 no pueda distinguir un SKU pendiente de analizar de uno
   * imposible de analizar.
   */
  foep NUMERIC,
  foep_estado TEXT NOT NULL DEFAULT 'no_consultado'
    CHECK (foep_estado IN ('disponible', 'no_disponible', 'no_consultado')),

  /** De qué llamada salió esta fila, para poder auditar una cifra rara */
  origen TEXT NOT NULL DEFAULT 'pricing'
    CHECK (origen IN ('listings', 'pricing', 'foep', 'informe', 'manual')),
  /** x-amzn-RequestId. Es lo ÚNICO que acepta el soporte de Amazon al abrir un
      caso, así que se guarda también cuando todo va bien */
  request_id TEXT,
  job_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_snapshots_precio_foep_ok
    CHECK ((foep IS NOT NULL) = (foep_estado = 'disponible')),
  CONSTRAINT amazon_snapshots_precio_importes_ok
    CHECK (COALESCE(precio_propio, 0) >= 0 AND COALESCE(precio_buybox, 0) >= 0
           AND COALESCE(foep, 0) >= 0 AND COALESCE(precio_competidor_min, 0) >= 0)
);

COMMENT ON TABLE public.amazon_snapshots_precio IS
  'Serie de solo inserción: precio propio, Buy Box, competencia y FOEP en un instante. NO SE ACTUALIZA NUNCA (hay un trigger que lo impide). Amazon no tiene forma de decirnos a qué precio estaba la Buy Box la semana pasada: esta tabla es el único ejemplar de ese dato.';

COMMENT ON COLUMN public.amazon_snapshots_precio.foep_estado IS
  'disponible / no_disponible / no_consultado. La regla 5 del §3.5 de la spec exige que un SKU sin FOEP sea un caso aparte y nunca un cero: un NULL a secas confundiría «no lo pedimos» con «Amazon no lo da».';

CREATE INDEX IF NOT EXISTS idx_amazon_snap_precio_sku
  ON public.amazon_snapshots_precio(selling_partner_id, marketplace_id, sku, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_snap_precio_conexion
  ON public.amazon_snapshots_precio(connection_id, fecha DESC);

-- ---------- 4.2) BSR ----------
-- Varias filas por SKU y fecha A PROPÓSITO: Catalog Items devuelve DOS
-- jerarquías y las dos importan.
--
--   'grupo'     -> displayGroupRanks: el número grande de la categoría raíz
--                  («#72.855 en Electrónica»). Es «el BSR» del que habla el
--                  equipo y el que sirve para comparar rotación.
--   'categoria' -> classificationRanks: la subcategoría («#113 en Televisores
--                  QLED»), que es la que sale en la ficha del producto.
--
-- Mezclarlos en una sola columna sin distintivo hace la serie ININTERPRETABLE:
-- un 113 y un 72.855 en la misma columna no se pueden ni graficar juntos.
CREATE TABLE IF NOT EXISTS public.amazon_snapshots_bsr (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID,
  connection_id UUID,
  selling_partner_id TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  tipo TEXT NOT NULL CHECK (tipo IN ('grupo', 'categoria')),
  /** El nombre legible que devuelve Amazon (`title`) */
  categoria TEXT NOT NULL,
  /** classificationId o websiteDisplayGroup, para poder seguir la misma
      categoría cuando Amazon le cambie el nombre */
  categoria_id TEXT,
  rank INTEGER NOT NULL,

  request_id TEXT,
  job_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_snapshots_bsr_rank_ok CHECK (rank > 0)
);

COMMENT ON COLUMN public.amazon_snapshots_bsr.tipo IS
  'grupo = displayGroupRanks (el BSR grande de la categoría raíz). categoria = classificationRanks (la subcategoría de la ficha). Sin distinguirlos, un rank de 113 y uno de 72.855 conviven en la misma columna y la serie no significa nada.';

CREATE INDEX IF NOT EXISTS idx_amazon_snap_bsr_sku
  ON public.amazon_snapshots_bsr(selling_partner_id, marketplace_id, sku, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_snap_bsr_conexion
  ON public.amazon_snapshots_bsr(connection_id, fecha DESC);

-- ---------- 4.3) INVENTARIO ----------
-- LA TRAMPA DE ESTA TABLA, y es la que más caro sale de todo A1:
--
-- FBA Inventory NO DEVUELVE LOS SKU GESTIONADOS POR EL VENDEDOR. No da error, no
-- deja hueco, no avisa: simplemente no vienen. Si el código interpreta «no vino
-- en la respuesta» como «stock 0», el artículo FBM del piloto sale sin stock,
-- dispara una alerta de reposición falsa y A2 lo diagnostica como «Sin stock ->
-- Reponer». En ShoesF, que es mayoría FBM, eso convertiría el 90 % del catálogo
-- en «sin stock».
--
-- Por eso `estado_dato` tiene TRES valores y no dos, y por eso hay un CHECK que
-- obliga a que las cantidades estén a NULL cuando no son conocidas: un NULL que
-- significa a la vez «este SKU no es de FBA» y «no pudimos leerlo» hace
-- inservible el módulo de alertas de reposición de la Fase B.
CREATE TABLE IF NOT EXISTS public.amazon_snapshots_inventario (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID,
  connection_id UUID,
  selling_partner_id TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /** El canal tal y como lo devuelve Amazon ('DEFAULT', 'AMAZON_NA'...). Crudo
      a propósito: la lista de valores depende del vendedor y de los programas en
      los que esté, y grabarla en el código es lo que revienta con el primer
      cliente europeo */
  canal TEXT,

  /**
   *   conocido    -> las cantidades de abajo son de verdad
   *   no_aplica   -> este SKU no está en la red de Amazon (es FBM). No es cero
   *   desconocido -> se intentó leer y no se pudo. TAMPOCO es cero
   */
  estado_dato TEXT NOT NULL DEFAULT 'conocido'
    CHECK (estado_dato IN ('conocido', 'no_aplica', 'desconocido')),

  disponible INTEGER,
  reservado INTEGER,
  inbound_working INTEGER,
  inbound_enviado INTEGER,
  inbound_recibiendo INTEGER,
  /** Inventario que el cliente cree que tiene y no puede vender. Detectarlo es
      dinero directo: caducados, dañados, defectuosos */
  invendible INTEGER,
  /** Extraviado o dañado en almacén, en investigación */
  investigando INTEGER,
  total INTEGER,
  /** Stock propio declarado en el listing (solo tiene sentido en FBM) */
  stock_propio INTEGER,

  origen TEXT NOT NULL DEFAULT 'informe'
    CHECK (origen IN ('informe', 'fba_inventory', 'listings', 'manual')),
  request_id TEXT,
  job_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /**
   * Si el dato no es conocido, NO hay cantidades. Es el CHECK que impide que un
   * cero se cuele donde había un «no lo sabemos».
   */
  CONSTRAINT amazon_snapshots_inventario_tri_estado CHECK (
    estado_dato = 'conocido'
    OR (disponible IS NULL AND reservado IS NULL AND inbound_working IS NULL
        AND inbound_enviado IS NULL AND inbound_recibiendo IS NULL
        AND invendible IS NULL AND investigando IS NULL AND total IS NULL)
  ),
  CONSTRAINT amazon_snapshots_inventario_no_negativo CHECK (
    COALESCE(disponible, 0) >= 0 AND COALESCE(reservado, 0) >= 0
    AND COALESCE(total, 0) >= 0 AND COALESCE(stock_propio, 0) >= 0
  )
);

COMMENT ON COLUMN public.amazon_snapshots_inventario.estado_dato IS
  'conocido / no_aplica / desconocido. FBA Inventory omite en silencio los SKU gestionados por el vendedor: sin estos tres estados, «no vino en la respuesta» se confunde con «stock 0» y todo el catálogo FBM de ShoesF aparecería sin existencias.';

CREATE INDEX IF NOT EXISTS idx_amazon_snap_inv_sku
  ON public.amazon_snapshots_inventario(selling_partner_id, marketplace_id, sku, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_snap_inv_conexion
  ON public.amazon_snapshots_inventario(connection_id, fecha DESC);

-- ---------- 4.4) TARIFAS ESTIMADAS ----------
-- `origen` no es informativo: la spec avisa de que hay discrepancias reportadas
-- entre getMyFeesEstimate y lo que Amazon acaba cobrando, y pide que la
-- comparación sea una función del sistema y no algo manual. Con el origen en la
-- fila, contrastar la estimación contra el Fee Preview y (en la Fase B) contra
-- la liquidación real es una consulta, no un proyecto.
CREATE TABLE IF NOT EXISTS public.amazon_fees_estimados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID,
  connection_id UUID,
  selling_partner_id TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /** A qué precio se pidió la estimación. Sin él las tarifas no significan
      nada: son un porcentaje de algo */
  precio_referencia NUMERIC NOT NULL,
  moneda TEXT NOT NULL,

  referral_fee NUMERIC,
  fba_fee NUMERIC,
  otras_fees NUMERIC,
  total_fees NUMERIC,

  origen TEXT NOT NULL DEFAULT 'estimado_api'
    CHECK (origen IN ('estimado_api', 'fee_preview', 'liquidacion')),
  request_id TEXT,
  job_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_fees_estimados_precio_ok CHECK (precio_referencia >= 0),
  CONSTRAINT amazon_fees_estimados_importes_ok CHECK (
    COALESCE(referral_fee, 0) >= 0 AND COALESCE(fba_fee, 0) >= 0
    AND COALESCE(otras_fees, 0) >= 0 AND COALESCE(total_fees, 0) >= 0
  )
);

COMMENT ON COLUMN public.amazon_fees_estimados.origen IS
  'estimado_api = getMyFeesEstimates. fee_preview = el informe de Seller Central. liquidacion = lo que Amazon cobró de verdad (Fase B). Tenerlos en la misma tabla convierte el contraste que pide el §3.5 de la spec en una consulta.';

CREATE INDEX IF NOT EXISTS idx_amazon_fees_sku
  ON public.amazon_fees_estimados(selling_partner_id, marketplace_id, sku, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_fees_conexion
  ON public.amazon_fees_estimados(connection_id, fecha DESC);

-- ---------- 4.5) EL CANDADO DE SOLO INSERCIÓN ----------
-- Los REVOKE de la sección 8 protegen del navegador. Esto protege de NOSOTROS:
-- las series las escribe service_role, que se salta RLS y los GRANT, así que la
-- única barrera que le queda delante a un UPDATE escrito con buena intención es
-- un trigger.
--
-- A nivel de SENTENCIA y no de fila: es más barato y basta, porque lo que se
-- prohíbe es la operación entera.
CREATE OR REPLACE FUNCTION public.amazon_serie_solo_insercion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% es una serie temporal de SOLO INSERCIÓN: un snapshot es lo que se observó en un instante y no se corrige, se añade otro. Amazon no puede volver a darnos el dato de ayer. Si de verdad hay que purgar histórico, quita este trigger a propósito y vuelve a ponerlo.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- TRUNCATE va aparte porque no se puede combinar con eventos de fila, y va
-- porque entra en el GRANT ALL de Supabase y NI RLS NI LOS CHECK SE APLICAN A
-- TRUNCATE: sin este trigger, la instrucción más destructiva de las tres es la
-- única sin candado.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_snapshots_precio',
    'amazon_snapshots_bsr',
    'amazon_snapshots_inventario',
    'amazon_fees_estimados'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_solo_insercion ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_solo_insercion BEFORE UPDATE OR DELETE ON public.%I '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION public.amazon_serie_solo_insercion()', t, t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_sin_truncate ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_sin_truncate BEFORE TRUNCATE ON public.%I '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION public.amazon_serie_solo_insercion()', t, t);
  END LOOP;
END $$;

-- =====================================================
-- 5) VENTAS EXTERNAS (CSV HASTA LA FASE B)
-- =====================================================
-- ESTA TABLA NO ES UNA SERIE DE SNAPSHOTS Y LA DIFERENCIA IMPORTA.
--
-- Un snapshot es «lo que observamos en el instante T» y por eso no se corrige.
-- Una fila de aquí es «lo que pasó el día D», y eso SÍ se puede restar mejor
-- después: hoy lo dice un CSV de Sellerboard, mañana lo dirá
-- GET_SALES_AND_TRAFFIC_REPORT con el rol de Análisis de marcas. Así que aquí no
-- hay trigger de solo inserción; hay una clave única que incluye el ORIGEN.
--
-- CÓMO SE CAMBIA LA FUENTE SIN TOCAR A QUIEN LA CONSUME, que es lo que pide la
-- spec (§B1: «Sustituye el CSV externo del módulo A4. Diseña A4 con esa interfaz
-- desde el principio para que el cambio sea transparente»):
--
--   · el origen forma parte de la clave, así que el CSV y la API pueden convivir
--     el mismo día sin pisarse;
--   · quien consulta NO lee esta tabla directamente: llama a ventasEnVentana()
--     de lib/plataforma/ventas.ts, que ordena los orígenes por fiabilidad y se
--     queda con el mejor que haya para cada día;
--   · el día que llegue el rol, se rellena con origen 'sp_api' y la función
--     empieza a preferirlo. Ni A4 ni el criterio de SKU activo se enteran.
CREATE TABLE IF NOT EXISTS public.amazon_ventas_externas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  asin TEXT,
  /** DATE y no TIMESTAMPTZ: esto es un día de negocio, no un instante */
  fecha DATE NOT NULL,

  unidades INTEGER,
  sesiones INTEGER,
  page_views INTEGER,
  /** Ratio 0..1, no porcentaje. Un mismo campo que a veces es 12 y a veces 0,12
      es el error de conversión que nadie ve hasta que un margen sale absurdo */
  conversion NUMERIC,
  ingresos NUMERIC,
  moneda TEXT,

  /**
   * De dónde salió el dato. El orden de fiabilidad lo fija
   * lib/plataforma/ventas.ts, no esta tabla.
   */
  origen TEXT NOT NULL
    CHECK (origen IN ('csv_sellerboard', 'csv_business_reports', 'csv_manual', 'sp_api')),
  fuente_ref TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /** Reimportar el mismo fichero corrige, no duplica. Y el origen va dentro
      para que la fuente nueva no borre la vieja al llegar */
  UNIQUE (client_id, marketplace_id, sku, fecha, origen),
  CONSTRAINT amazon_ventas_externas_conversion_ok
    CHECK (conversion IS NULL OR (conversion >= 0 AND conversion <= 1)),
  CONSTRAINT amazon_ventas_externas_no_negativo CHECK (
    COALESCE(unidades, 0) >= 0 AND COALESCE(sesiones, 0) >= 0
    AND COALESCE(page_views, 0) >= 0 AND COALESCE(ingresos, 0) >= 0
  ),
  CONSTRAINT amazon_ventas_externas_moneda_ok
    CHECK (ingresos IS NULL OR moneda IS NOT NULL)
);

COMMENT ON TABLE public.amazon_ventas_externas IS
  'Velocidad de ventas y tráfico por SKU y día. Hoy entra por CSV; en la Fase B, del informe de ventas y tráfico. NO es una serie de snapshots: un día de negocio se puede restar con una fuente mejor, y por eso el origen forma parte de la clave única.';

CREATE INDEX IF NOT EXISTS idx_amazon_ventas_sku
  ON public.amazon_ventas_externas(client_id, marketplace_id, sku, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_ventas_cliente
  ON public.amazon_ventas_externas(client_id, fecha DESC);

-- =====================================================
-- 6) TRABAJOS
-- =====================================================
-- La regla de la spec: «Todo job masivo: por lotes, progreso persistido,
-- reanudable si se cae». Un barrido de 13.700 SKU que muere al 80 % y hay que
-- empezar de cero no sirve.
--
-- UN TRABAJO LARGO NO ES UNA EJECUCIÓN LARGA: ES MUCHAS EJECUCIONES CORTAS CON
-- EL PROGRESO EN LA BASE. Es el patrón que este ERP ya tiene resuelto en el
-- ciclo de stock y aquí se copia, con la pieza que allí no hacía falta: EL
-- CURSOR. Cada pasada del cron coge el trabajo más antiguo que esté libre,
-- procesa lotes hasta agotar su presupuesto de tiempo, GUARDA POR DÓNDE IBA y se
-- va. La pasada siguiente lo recoge donde estaba.
--
-- Lo que NO se hace, y conviene que quede escrito: lanzar el trabajo en segundo
-- plano dentro del handler de Next con un setTimeout. En un contenedor que se
-- reinicia con cada despliegue eso muere sin dejar rastro, y un trabajo que
-- desaparece sin decir nada es exactamente el fallo silencioso que la spec
-- prohíbe.
CREATE TABLE IF NOT EXISTS public.amazon_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  /**
   * Los tipos van todos declarados desde ahora, incluidos los de A2, A4 y A5,
   * para que esos módulos no necesiten una migración solo para añadirse. Un tipo
   * sin tarea registrada en lib/plataforma/motor.ts NO se procesa en silencio:
   * levanta un evento de severidad 'error'.
   */
  tipo TEXT NOT NULL CHECK (tipo IN (
    'censo_catalogo',       -- GET_MERCHANT_LISTINGS_ALL_DATA: el censo completo de SKU
    'enriquecer_catalogo',  -- searchCatalogItems: marca, categoría, dimensiones, peso
    'snapshot_bsr',         -- searchCatalogItems con salesRanks
    'inventario_fba',       -- GET_FBA_MYI_ALL_INVENTORY_DATA
    'snapshot_precios',     -- A2: Buy Box + FOEP
    'tarifas',              -- getMyFeesEstimates
    'recalcular_activos',   -- aplica amazon_tracking_rules sobre el catálogo
    'importar_costes',      -- A5
    'importar_ventas'       -- CSV de velocidad de ventas
  )),

  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  /** CASCADE: un trabajo de una conexión que ya no existe no tiene nada que
      hacer. A diferencia de las series, esto no es histórico de negocio */
  connection_id UUID REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT,

  /**
   *   pendiente -> creado, nunca ha empezado
   *   en_curso  -> empezó y no ha terminado. Que lo esté trabajando alguien
   *                AHORA lo dice running_since, no esto
   *   pausado   -> lo paró una persona
   *   terminado -> llegó al final
   *   error     -> se rindió. error_message explica por qué
   *   cancelado -> alguien lo canceló
   */
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'en_curso', 'pausado', 'terminado', 'error', 'cancelado')),

  /** Menor va antes. Un refresco a demanda que pide una persona no espera
      detrás del barrido semanal de trece mil referencias */
  prioridad INTEGER NOT NULL DEFAULT 100,

  /**
   * SUBCONJUNTO DE PRUEBA. La spec: «Todo debe poder ejecutarse sobre un
   * subconjunto de SKUs para pruebas, no solo sobre el catálogo entero.»
   * NULL = todo el ámbito del trabajo.
   */
  skus_filtro TEXT[],
  /** Lo que cada tipo de trabajo necesite y no quepa en columnas. NUNCA
      credenciales: esto se lee y se enseña en pantalla */
  parametros JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ---------- EL CURSOR ----------
  -- Es lo que hace que un trabajo del 80 % no empiece de cero.
  /** Última clave procesada, en orden ascendente. Para casi todo es el SKU */
  cursor_clave TEXT,
  /** Página, cuando el recorrido es por páginas */
  cursor_pagina INTEGER,
  /**
   * Cursor opaco del propio Amazon (nextToken, reportDocumentId...).
   *
   * OJO: el `nextToken` de getInventorySummaries CADUCA A LOS 30 SEGUNDOS y la
   * URL de descarga de un informe a los CINCO MINUTOS. Ninguno de los dos
   * sobrevive a una pausa entre pasadas: para esas operaciones el cursor tiene
   * que ser la clave, no el token. Lo que sí sobrevive y se guarda aquí es el
   * reportId / reportDocumentId, con el que se vuelve a pedir una URL nueva.
   */
  cursor_externo TEXT,

  total_estimado INTEGER,
  procesados INTEGER NOT NULL DEFAULT 0,
  omitidos INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  /**
   * Lotes fallidos SEGUIDOS, y va aparte de `errores` a propósito.
   *
   * `errores` es la cuenta total: cuántos elementos no se han podido procesar
   * en todo el trabajo. Es una estadística y se enseña en pantalla.
   *
   * Esto otro es lo que decide cuándo rendirse, y tiene que ser SEGUIDOS. Con
   * la cuenta total, un barrido de 13.700 SKU que falla un lote de cada dos
   * —un 429 suelto de Amazon, que es de lo más normal— llega a diez errores
   * habiendo procesado la mitad del catálogo y se abandona un trabajo que iba
   * avanzando perfectamente. Se pone a cero en cuanto un lote sale bien.
   */
  lotes_fallidos_seguidos INTEGER NOT NULL DEFAULT 0,
  lotes INTEGER NOT NULL DEFAULT 0,
  /** Cuántas veces lo ha retomado el cron. Un trabajo con 200 pasadas y 12
      procesados está atascado aunque no dé ningún error */
  pasadas INTEGER NOT NULL DEFAULT 0,

  -- ---------- EL CERROJO (patrón de la 121) ----------
  -- Una bandera en Node solo protege de sí misma. El ERP corre en un contenedor
  -- hoy y puede correr en dos mañana, y el cron entra por HTTP: el cerrojo tiene
  -- que estar donde los dos miran, y eso es la base de datos.
  running_since TIMESTAMPTZ,
  /** Testigo de quién lo tiene, para que SOLO SU DUEÑO lo suelte: si una pasada
      se cuelga y otra le roba el cerrojo caducado, la colgada no puede soltar al
      terminar tarde un cerrojo que ya no es suyo */
  running_token UUID,

  -- ---------- CANCELACIÓN ----------
  -- Se PIDE, no se impone. Poner el estado a 'cancelado' por debajo de una
  -- pasada que está trabajando deja al trabajador escribiendo sobre un trabajo
  -- que ya nadie mira; con la petición, el trabajador la ve al guardar el
  -- progreso del lote y para él mismo, ordenadamente, sin dejar el lote a medias.
  cancel_solicitado BOOLEAN NOT NULL DEFAULT false,
  cancel_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancel_motivo TEXT,

  /** Cuándo se guardó progreso por última vez. Es lo que distingue «va lento»
      de «lleva dos horas parado» */
  progreso_at TIMESTAMPTZ,
  iniciado_at TIMESTAMPTZ,
  terminado_at TIMESTAMPTZ,
  /** En español, que es lo que va a leer una persona */
  error_message TEXT,
  error_detalle JSONB,
  /** x-amzn-RequestId de la llamada que falló */
  request_id TEXT,
  /** Una frase con cómo acabó: «13.712 SKU leídos, 4 sin ASIN» */
  resumen TEXT,

  /** Quién lo lanzó. NULL = lo creó el planificador, que no es nadie */
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /** Un error sin explicación obliga a abrir la consola para entender la pantalla */
  CONSTRAINT amazon_jobs_error_ok
    CHECK (estado <> 'error' OR btrim(COALESCE(error_message, '')) <> ''),
  /** Todo lo que ha acabado dice cuándo */
  CONSTRAINT amazon_jobs_fin_ok
    CHECK (estado NOT IN ('terminado', 'error', 'cancelado') OR terminado_at IS NOT NULL),
  /** Y todo lo que ha empezado, también */
  CONSTRAINT amazon_jobs_inicio_ok
    CHECK (estado = 'pendiente' OR iniciado_at IS NOT NULL),
  /** Un filtro vacío no es «sin filtro»: es un filtro que no selecciona nada, y
      el trabajo terminaría en verde sin haber hecho nada */
  CONSTRAINT amazon_jobs_filtro_ok
    CHECK (skus_filtro IS NULL OR COALESCE(array_length(skus_filtro, 1), 0) > 0),
  /** Cancelar sin decir por qué deja un trabajo muerto que nadie sabe si
      relanzar */
  CONSTRAINT amazon_jobs_cancel_ok
    CHECK (cancel_solicitado = false OR btrim(COALESCE(cancel_motivo, '')) <> ''),
  /** Los trabajos que hablan con Amazon necesitan saber CON QUÉ TIENDA y EN QUÉ
      PAÍS. Los que solo tocan la base nuestra, no */
  CONSTRAINT amazon_jobs_destino_ok CHECK (
    tipo IN ('recalcular_activos', 'importar_costes', 'importar_ventas')
    OR (connection_id IS NOT NULL AND marketplace_id IS NOT NULL)
  ),
  CONSTRAINT amazon_jobs_contadores_ok CHECK (
    procesados >= 0 AND omitidos >= 0 AND errores >= 0 AND lotes >= 0 AND pasadas >= 0
    AND lotes_fallidos_seguidos >= 0
  )
);

COMMENT ON TABLE public.amazon_jobs IS
  'Trabajos por lotes con progreso guardado y reanudable. Un trabajo largo no es una ejecución larga: es muchas ejecuciones cortas con el cursor en la base. Si el contenedor muere al 80 % de 13.700 SKU, la pasada siguiente sigue donde estaba.';

COMMENT ON COLUMN public.amazon_jobs.cursor_externo IS
  'Cursor opaco de Amazon. El nextToken de getInventorySummaries caduca en 30 segundos y la URL de descarga de un informe en 5 minutos: ninguno sobrevive a una pausa entre pasadas. Aquí solo va lo que sí sobrevive (reportId, reportDocumentId).';

COMMENT ON COLUMN public.amazon_jobs.cancel_solicitado IS
  'La cancelación se PIDE. El trabajador la ve al guardar el progreso de cada lote y para él mismo. Cambiar el estado por debajo de una pasada en marcha dejaría al trabajador escribiendo sobre un trabajo que ya nadie mira.';

-- ---------- DOS TRABAJOS DEL MISMO TIPO Y CLIENTE NO SE PISAN ----------
-- Lo garantiza la BASE y no el código, porque el código son dos contenedores y
-- una condición de carrera. Índice único parcial: solo puede haber UN trabajo
-- vivo por (tipo, destino).
--
-- La excepción de `skus_filtro IS NULL` es deliberada: los trabajos sobre un
-- subconjunto son los de prueba y los que pide una persona a demanda, y
-- bloquearlos mientras corre el barrido semanal haría imposible probar nada
-- durante horas. Dos trabajos de subconjunto pueden solaparse: cada uno lleva su
-- propio cursor y las series son de solo inserción, así que lo peor que pasa es
-- que un SKU tenga dos observaciones del mismo minuto, que es un dato correcto.
CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_jobs_uno_vivo
  ON public.amazon_jobs (
    tipo,
    COALESCE(connection_id::text, client_id::text),
    COALESCE(marketplace_id, '')
  )
  WHERE estado IN ('pendiente', 'en_curso', 'pausado') AND skus_filtro IS NULL;

-- La consulta del cron: «qué toca ahora». Ordenada como se elige: por prioridad
-- y después por antigüedad, para que ninguno se quede atrás indefinidamente.
CREATE INDEX IF NOT EXISTS idx_amazon_jobs_cola
  ON public.amazon_jobs(prioridad, created_at)
  WHERE estado IN ('pendiente', 'en_curso');

CREATE INDEX IF NOT EXISTS idx_amazon_jobs_cliente
  ON public.amazon_jobs(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_jobs_conexion
  ON public.amazon_jobs(connection_id, created_at DESC)
  WHERE connection_id IS NOT NULL;

-- =====================================================
-- 7) EVENTOS
-- =====================================================
-- «Un error silencioso cuesta ventas reales de clientes que nos pagan» (§3.7 de
-- la spec). Esta es la tabla donde eso deja de ser una frase.
--
-- No es un log de depuración: es la cola de incidencias del §3.7, con severidad,
-- responsable y motivo de cierre. Y el principio de diseño que la acompaña
-- también está en la spec: «Si la cola tiene 200 entradas diarias, nadie la
-- revisa». Por eso el aviso de la campana lo filtra el trigger de la sección 9,
-- no el que inserta.
CREATE TABLE IF NOT EXISTS public.amazon_eventos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  /** Código estable, en minúsculas y con guiones bajos. Se agrupa por él, así
      que tiene que decir QUÉ pasó y no el detalle: 'sku_no_encontrado',
      'cupo_agotado', 'token_caducado', 'tope_activos_alcanzado' */
  tipo TEXT NOT NULL,
  /**
   *   info    -> ha pasado algo que conviene poder consultar
   *   aviso   -> algo no está como debería pero el sistema sigue
   *   error   -> algo no se ha hecho. Suena la campana
   *   critico -> algo no se ha hecho y afecta a la tienda de un cliente
   */
  severidad TEXT NOT NULL DEFAULT 'aviso'
    CHECK (severidad IN ('info', 'aviso', 'error', 'critico')),

  client_id UUID REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES public.amazon_connections(id) ON DELETE SET NULL,
  marketplace_id TEXT,
  sku TEXT,
  asin TEXT,
  /** SET NULL y no CASCADE: el evento que explica por qué un trabajo falló tiene
      que sobrevivir al borrado del trabajo */
  job_id UUID REFERENCES public.amazon_jobs(id) ON DELETE SET NULL,

  /** En español, ya redactado y con sus números. Se guarda la frase entera y no
      una plantilla, para que dentro de seis meses diga lo mismo aunque el texto
      del código haya cambiado */
  mensaje TEXT NOT NULL,
  detalle JSONB,
  /** x-amzn-RequestId, lo único que acepta el soporte de Amazon */
  request_id TEXT,

  /**
   * LA HUELLA, y es lo que hace que la campana siga sirviendo dentro de un mes.
   *
   * Identifica la SITUACIÓN, no el suceso: por ejemplo 'conexión X · marketplace
   * Y · 403'. Dos eventos con la misma huella son el mismo problema contado dos
   * veces, y el trigger de la sección 9 solo avisa del primero mientras siga sin
   * resolverse. Sin esto, un trabajo que falla cada cinco minutos durante una
   * noche deja 96 avisos idénticos, y 96 avisos idénticos son cero avisos.
   */
  huella TEXT,

  /** Quién lo provocó. NULL = un proceso automático, que no es nadie. Cuando lo
      lanzó una persona no se avisa por la campana: está mirando la pantalla */
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  resuelto BOOLEAN NOT NULL DEFAULT false,
  resuelto_at TIMESTAMPTZ,
  resuelto_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  /** Qué se hizo con él. 'ignorado' es una respuesta legítima y hay que poder
      distinguirla de 'arreglado', o el histórico de incidencias miente */
  resolucion TEXT CHECK (resolucion IS NULL OR resolucion IN ('arreglado', 'ignorado', 'caducado')),
  /** Por qué. Cerrar sin motivo convierte la cola en un botón de «vale» */
  resuelto_motivo TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_eventos_mensaje_ok CHECK (btrim(mensaje) <> ''),
  CONSTRAINT amazon_eventos_resuelto_ok CHECK (
    resuelto = false
    OR (resuelto_at IS NOT NULL AND resolucion IS NOT NULL
        AND btrim(COALESCE(resuelto_motivo, '')) <> '')
  )
);

COMMENT ON TABLE public.amazon_eventos IS
  'La cola de incidencias de la plataforma. No es un log de depuración: cada fila tiene severidad, mensaje redactado en español, y al cerrarla hay que decir quién y por qué. Es donde «fallos ruidosos, nunca silenciosos» deja de ser una frase.';

COMMENT ON COLUMN public.amazon_eventos.huella IS
  'Identifica la SITUACIÓN, no el suceso. Dos eventos con la misma huella son el mismo problema repetido: la campana solo avisa del primero mientras siga sin resolver. Sin esto, un fallo cada cinco minutos deja 96 avisos idénticos en una noche y la campana se deja de mirar.';

-- «Qué hay abierto», que es la consulta de la cola. Parcial porque lo normal es
-- que la inmensa mayoría estén resueltos.
CREATE INDEX IF NOT EXISTS idx_amazon_eventos_abiertos
  ON public.amazon_eventos(severidad, created_at DESC)
  WHERE NOT resuelto;

CREATE INDEX IF NOT EXISTS idx_amazon_eventos_cliente
  ON public.amazon_eventos(client_id, created_at DESC);

-- «Qué le pasa a este SKU», que es la pregunta literal del cliente.
CREATE INDEX IF NOT EXISTS idx_amazon_eventos_sku
  ON public.amazon_eventos(connection_id, sku, created_at DESC)
  WHERE sku IS NOT NULL;

-- La que usa el trigger de la campana para decidir si esto ya se avisó.
CREATE INDEX IF NOT EXISTS idx_amazon_eventos_huella
  ON public.amazon_eventos(tipo, huella, created_at DESC)
  WHERE NOT resuelto;

CREATE INDEX IF NOT EXISTS idx_amazon_eventos_job
  ON public.amazon_eventos(job_id, created_at DESC)
  WHERE job_id IS NOT NULL;

-- =====================================================
-- 8) updated_at
-- =====================================================
-- Se reutiliza public.update_amazon_updated_at() de la 118: es la función de
-- este módulo. Las tablas de serie NO llevan updated_at y no es un olvido: una
-- fila que nunca se actualiza no tiene fecha de actualización que contar, y
-- tenerla invitaría a escribirla.
DROP TRIGGER IF EXISTS trg_amazon_tracking_rules_updated ON public.amazon_tracking_rules;
CREATE TRIGGER trg_amazon_tracking_rules_updated
  BEFORE UPDATE ON public.amazon_tracking_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

DROP TRIGGER IF EXISTS trg_amazon_costes_producto_updated ON public.amazon_costes_producto;
CREATE TRIGGER trg_amazon_costes_producto_updated
  BEFORE UPDATE ON public.amazon_costes_producto
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

DROP TRIGGER IF EXISTS trg_amazon_ventas_externas_updated ON public.amazon_ventas_externas;
CREATE TRIGGER trg_amazon_ventas_externas_updated
  BEFORE UPDATE ON public.amazon_ventas_externas
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

DROP TRIGGER IF EXISTS trg_amazon_jobs_updated ON public.amazon_jobs;
CREATE TRIGGER trg_amazon_jobs_updated
  BEFORE UPDATE ON public.amazon_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

-- =====================================================
-- 9) LA CAMPANA
-- =====================================================
-- Mismas cuatro reglas que ya funcionan en el ciclo de stock (121 y 122), porque
-- las cuatro salieron de casos medidos:
--
--   1. SE AMPLÍA EL CHECK ANTES DE INSERTAR NADA. Sin ampliarlo, el INSERT del
--      aviso falla y, al ser un trigger AFTER INSERT, se lleva por delante la
--      escritura del evento. Se perdería justo la fila que explica el fallo.
--   2. NO SE AVISA SI LO LANZÓ UNA PERSONA: está mirando el resultado.
--   3. SE AVISA CUANDO LA SITUACIÓN CAMBIA, no en cada repetición. Esa es la
--      función de `huella`.
--   4. EXCEPTION WHEN OTHERS QUE SOLO HACE RAISE NOTICE: que no se pueda avisar
--      no puede costar la fila del evento.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) THEN
    ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN (
        'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
        'freno_stock', 'fallo_stock',
        'fallo_amazon', 'job_amazon'
      ));
  ELSE
    RAISE NOTICE 'No existe public.notifications; los eventos quedarán registrados pero no sonará la campana.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_amazon_evento_notification()
RETURNS TRIGGER AS $$
DECLARE
  admin_user RECORD;
  nombre_cliente TEXT;
  tipo_aviso TEXT;
  titulo TEXT;
  cuerpo TEXT;
BEGIN
  -- Solo lo que hay que atender. Un 'info' o un 'aviso' viven en la cola de
  -- eventos, que es donde se miran; sacarlos por la campana la convierte en
  -- ruido y entonces tampoco se ven los errores.
  IF NEW.severidad NOT IN ('error', 'critico') THEN
    RETURN NEW;
  END IF;

  -- Lo ha provocado una persona desde la pantalla: ya está viendo el resultado.
  IF NEW.created_by IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ¿Ya está avisado esto? Mismo tipo y misma huella, sin resolver y reciente.
  -- Mientras la situación se mantenga igual, silencio; en cuanto se resuelva y
  -- vuelva a pasar, o cambie la huella, vuelve a sonar.
  IF NEW.huella IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.amazon_eventos e
    WHERE e.id <> NEW.id
      AND e.tipo = NEW.tipo
      AND e.huella = NEW.huella
      AND e.resuelto = false
      AND e.created_at > NOW() - INTERVAL '6 hours'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO nombre_cliente FROM public.amazon_clients WHERE id = NEW.client_id;

  IF NEW.job_id IS NOT NULL THEN
    tipo_aviso := 'job_amazon';
  ELSE
    tipo_aviso := 'fallo_amazon';
  END IF;

  titulo := CASE
    WHEN NEW.severidad = 'critico'
      THEN 'Incidencia grave: ' || COALESCE(nombre_cliente, 'cliente sin identificar')
    ELSE 'Fallo en ' || COALESCE(nombre_cliente, 'un cliente sin identificar')
  END;

  -- Recortado: el cuerpo de la campana son dos líneas. El texto entero está en
  -- la fila del evento, que es donde se va a mirar de verdad.
  cuerpo := LEFT(NEW.mensaje, 300);

  FOR admin_user IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, type, title, message, read, created_at)
    VALUES (admin_user.id, tipo_aviso, titulo, cuerpo, false, NOW());
  END LOOP;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'No se ha podido crear el aviso del evento (%). El evento sí queda registrado.', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_amazon_eventos_aviso ON public.amazon_eventos;
CREATE TRIGGER trg_amazon_eventos_aviso
  AFTER INSERT ON public.amazon_eventos
  FOR EACH ROW EXECUTE FUNCTION public.create_amazon_evento_notification();

-- =====================================================
-- 10) RLS
-- =====================================================
-- SOLO ADMIN, el mismo listón que el resto del módulo: aquí están el catálogo,
-- los costes de compra y las ventas de tiendas que no son nuestras.
--
-- Y NADIE ESCRIBE DESDE EL NAVEGADOR. Todas las escrituras pasan por rutas de
-- servidor con service_role después de comprobar el rol contra la sesión. Dos
-- candados en el mismo sentido:
--   a) sin GRANT, `authenticated` ni lo intenta;
--   b) sin política permisiva, si alguien restaurara el GRANT algún día, RLS
--      seguiría diciendo que no.
-- TRUNCATE va en la lista de REVOKE porque entra en el GRANT ALL de Supabase y
-- RLS NO SE APLICA A TRUNCATE.
DO $$
DECLARE
  t TEXT;
  politica TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_tracking_rules',
    'amazon_costes_producto',
    'amazon_snapshots_precio',
    'amazon_snapshots_bsr',
    'amazon_snapshots_inventario',
    'amazon_fees_estimados',
    'amazon_ventas_externas',
    'amazon_jobs',
    'amazon_eventos'
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

-- =====================================================
-- 11) Realtime
-- =====================================================
-- Solo los trabajos y los eventos: son lo que una persona mira mientras pasa, y
-- son pocas filas. Las series se quedan FUERA a propósito — un barrido nocturno
-- mete decenas de miles de filas y difundirlas una a una no le sirve a nadie y
-- se come la conexión del navegador que tenga la pantalla abierta.
--
-- Con guardia: añadir una tabla que ya está en la publicación da error, y como
-- el editor SQL corre el script entero en una transacción, ese error de la
-- última línea desharía todos los CREATE TABLE de arriba. La migración parecería
-- aplicada sin haber creado nada.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['amazon_jobs', 'amazon_eventos'] LOOP
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
-- NO hay bloque de user_app_permissions, y no es un olvido: A1 no estrena
-- pantalla. Vive dentro de 'amazon-api', que ya es solo de admins y ya tiene su
-- permiso dado en la 118. Insertar aquí un app_id nuevo que no exista en
-- lib/config/apps.ts ni en el routeToAppId de middleware.ts dejaría una entrada
-- muerta en la tabla de permisos.
--
-- El día que esto tenga pantalla propia, el id tiene que coincidir LETRA POR
-- LETRA en tres sitios: la migración que lo añada, lib/config/apps.ts y
-- middleware.ts.
