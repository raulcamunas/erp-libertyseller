-- ============================================================================
-- 204 · EL CRM ADMITE UN SEGUNDO TIPO DE LEAD: TIENDAS QUE AÚN NO ESTÁN EN AMAZON
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- NO borra, NO renombra y NO reescribe ninguna fila: los 3.978 leads de Amazon
-- que ya hay siguen exactamente igual después de pegar esto.
--
-- Abre la línea de captación nueva: tiendas online (PrestaShop, Shopify) que NO
-- venden todavía en Amazon, sacadas de Store Leads y cruzadas con el BORME.
-- El Excel de origen es «Tiendas por sectores - reparto comerciales.xlsx»
-- (23.320 tiendas con contacto). En esta tanda entran 3.000: los lotes de José,
-- Daniela y María Fernanda, 1.000 cada uno. Los tres traen la misma mezcla de
-- sectores a propósito —Belleza 270, Hogar 230, Mascotas 190…— para que sus
-- números sean comparables entre sí desde el primer día.
--
--
-- ============ POR QUÉ 18 COLUMNAS NUEVAS Y NO RECICLAR LAS QUE HAY ==========
--
-- La tabla ya tiene columnas que SUENAN igual que las del Excel nuevo. Ninguna
-- de las cuatro que se parecen se reutiliza, y conviene que el motivo quede por
-- escrito porque el día que alguien quiera «ahorrarse una columna» va a volver
-- a mirar aquí:
--
--   mercantile_registry  NO es el CIF. Uno es tomo/folio/hoja del registro y el
--     otro un identificador fiscal de 9 caracteres. La ficha rotula ese campo
--     «Reg. mercantil»: si se mezclan, nadie puede saber qué hay dentro de una
--     fila cualquiera, no se puede validar el formato y se pierde el cruce con
--     el BORME local (20,7 M de cargos) y con facturación.
--
--   seller_url  NO es la web de la tienda. ColdLeadDetail y ColdLeadsTable lo
--     pintan con el rótulo FIJO «Ver en Amazon». Meter ahí greenstuffworld.com
--     da un enlace que miente Y borra la única señal que hoy tiene el CRM de
--     «este lead ya está en Amazon». Ensucia en las dos direcciones.
--
--   directors  NO es Decisor + Cargo. `directors` guarda un texto agregado con
--     varios cargos de un vendedor de Amazon. Aquí llega UNA persona —el
--     administrador activo del BORME— y su cargo aparte. Concatenar no rompe
--     las filas viejas, pero destruye el dato nuevo: pierdes la separación y,
--     sobre todo, pierdes el NULL. Y ese NULL es el que hace que la ficha diga
--     «pregunta por el responsable» en 607 de cada 1.000 leads.
--
--   revenue_monthly  NO son las ventas estimadas, y esta es la peligrosa de
--     verdad. formatRevenue() en lib/types/cold-leads.ts es
--     `${Math.round(n).toLocaleString('es-ES')} €`: concatena euros sin
--     preguntar. Las ventas estimadas son DÓLARES de un modelo de tráfico de
--     Store Leads, y la Leyenda del Excel dice literalmente que sirven para
--     ORDENAR y que no se dicen en la llamada. Reutilizar la columna le pondría
--     al comercial «793.590 €/mes» delante mientras habla por teléfono, como
--     si fuera facturación observada. Va a ventas_estimadas_usd, y en la ficha
--     con la advertencia pegada al número.
--
-- Y dos columnas del Excel NO se importan:
--   «Precio medio $» está vacía en las 1.000 medidas. Una columna que nace NULL
--     al 100 % solo es un hueco que alguien rellenará a mano con otra cosa.
--   «Provincia» dice «Europe» en las 1.000: es el campo `region` de Store
--     Leads, no una provincia. Si entrara en `province` aparecería «Europe»
--     como una provincia más en la columna Provincia de la tabla y en el
--     buscador del board, ensuciando el dato de los leads que ya hay. La
--     geografía real está en Ciudad, y por eso hay columna `ciudad`.
--
--
-- ============ POR QUÉ HACE FALTA `tipo_lead` Y NO BASTA `source_list` =======
--
-- `source_list` es TEXT sin CHECK y el board agrupa por igualdad exacta
-- (`const key = l.source_list || 'Sin lista'`). «Jose V2» en vez de «José V2»
-- crea una lista nueva en silencio. Si la ficha decidiera qué bloques pinta a
-- partir de ese texto, un acento de más haría que a una tienda online se le
-- pintaran «Perfil seller → Ver en Amazon» y «Vende desde —», y —lo grave— se
-- le escondiera el bloque de «¿Vende ya en Amazon?», que es el que decide si se
-- la llama y con qué discurso. El fallo no daría error: solo pintaría mal.
--
-- Además las dos columnas responden a preguntas distintas y hacen falta las
-- dos: `tipo_lead` es QUÉ CLASE de lead es, `source_list` es DE QUÉ LOTE salió
-- —y dentro de la lista nueva siguen habiendo cuatro lotes—. Si compartieran
-- columna se perdería uno de los dos.
--
-- Con NOT NULL DEFAULT 'seller_amazon' los leads que ya están quedan correctos
-- sin tocar una sola fila, y añadir un tercer tipo mañana es ampliar un CHECK y
-- no un grep por cadenas de texto.
--
--
-- ============ «YA VENDE EN AMAZON» NO SE AÑADE AL ENUM DE `status` ==========
--
-- En esta línea, «la hemos mirado y ya vende en Amazon» va a ser el descarte
-- más frecuente y el más valioso (es información de mercado: la tienda migró).
-- Se resuelve con vende_en_amazon = 'vende' + status = 'no_interesa', y NO
-- añadiendo un octavo estado al CHECK de `status`.
--
-- Motivo: `status` es el embudo compartido con los 3.978 leads de Amazon, y un
-- chip «Ya vende en Amazon» en la ficha de un vendedor de Amazon no significa
-- nada. Con las dos columnas la cifra sigue siendo medible de un SELECT:
--
--     SELECT count(*) FROM public.cold_leads
--      WHERE tipo_lead = 'tienda_online' AND vende_en_amazon = 'vende';
--
-- Si más adelante se prefiere el estado propio, se amplía el CHECK y se
-- reclasifican con ese mismo WHERE. Al revés —importar 23.320 filas y luego
-- decidir— es lo que no se puede hacer.
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 1) QUÉ CLASE DE LEAD ES                                             */
/* ------------------------------------------------------------------ */

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS tipo_lead TEXT NOT NULL DEFAULT 'seller_amazon'
    CHECK (tipo_lead IN ('seller_amazon', 'tienda_online'));

COMMENT ON COLUMN public.cold_leads.tipo_lead IS
  'Qué clase de lead es, y de ello depende qué bloques pinta la ficha. seller_amazon: ya vende en Amazon (lo único que hubo hasta la 203). tienda_online: tienda que todavía NO vende en Amazon, del Excel «Tiendas por sectores». NO usar source_list para esto: es texto libre y un acento de más escondería el bloque de ¿Vende ya en Amazon?.';


/* ------------------------------------------------------------------ */
/* 2) LO PRIMERO QUE SE MIRA: ¿VENDE YA EN AMAZON?                     */
/* ------------------------------------------------------------------ */
--
-- Columna «¿Vende ya en Amazon?» del Excel. La Leyenda: se comprueba antes de
-- marcar, cuesta 30 segundos, y CAMBIA EL DISCURSO ENTERO de la llamada.
--
-- Tres valores nombrados y no un BOOLEAN NULL. Un BOOLEAN también daría tres
-- estados, pero obliga a escribir `IS NOT FALSE` por toda la pantalla y a que
-- cada lector adivine qué significa el NULL; así el filtro del board es un `=`
-- y el SQL se lee solo.
--
-- Y el sello de cuándo se comprobó va aparte a propósito: es lo que hace que
-- «lo hemos mirado y no vende» sea distinguible de «nadie lo ha mirado». A los
-- cuatro meses un 'no_vende' de abril ya no vale, y sin sello se leería como
-- fresco y se llamaría con el discurso equivocado.

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS vende_en_amazon TEXT NOT NULL DEFAULT 'sin_comprobar'
    CHECK (vende_en_amazon IN ('sin_comprobar', 'no_vende', 'vende')),
  ADD COLUMN IF NOT EXISTS vende_en_amazon_comprobado_en TIMESTAMPTZ;

COMMENT ON COLUMN public.cold_leads.vende_en_amazon IS
  'Columna «¿Vende ya en Amazon?» del Excel. sin_comprobar: nadie lo ha mirado. no_vende: comprobado y no está. vende: ya está en Amazon (descarte: se cierra con status=no_interesa y se cuenta por esta columna). Decide el discurso entero de la llamada, así que en la ficha va arriba del todo.';

COMMENT ON COLUMN public.cold_leads.vende_en_amazon_comprobado_en IS
  'Cuándo se comprobó lo de arriba. Sin este sello un «no vende» de hace cuatro meses se lee como fresco y se llama con el discurso equivocado; la comprobación cuesta 30 segundos y se repite.';


/* ------------------------------------------------------------------ */
/* 3) LA PERSONA A LA QUE HAY QUE PREGUNTAR                            */
/* ------------------------------------------------------------------ */

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS decisor TEXT,
  ADD COLUMN IF NOT EXISTS cargo_decisor TEXT;

COMMENT ON COLUMN public.cold_leads.decisor IS
  'Columna «Decisor» del Excel: administrador activo según el BORME. Aparte de `directors` (que es texto agregado de varios cargos de un seller de Amazon) porque aquí importa el NULL: vacío en 607 de cada 1.000, y es lo que dispara el «pregunta por el responsable» de la ficha en vez de un guion.';

COMMENT ON COLUMN public.cold_leads.cargo_decisor IS
  'Columna «Cargo» del Excel: el cargo del decisor en el BORME (Administrador único, solidario, Presidente...). TEXT y NO un CHECK con los 10 valores medidos: el BORME publica más cargos de los que salieron en la muestra, y un CHECK reventaría la importación entera de 23.320 filas por un «Consejero delegado» que no estaba en las 1.000.';


/* ------------------------------------------------------------------ */
/* 4) DÓNDE ESTÁ Y CÓMO DE GRANDE ES                                   */
/* ------------------------------------------------------------------ */

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS ciudad TEXT,
  ADD COLUMN IF NOT EXISTS nivel SMALLINT CHECK (nivel IS NULL OR nivel BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS ventas_estimadas_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS n_productos INTEGER,
  ADD COLUMN IF NOT EXISTS anos_tienda NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS plataforma TEXT;

COMMENT ON COLUMN public.cold_leads.ciudad IS
  'Columna «Ciudad» del Excel: aquí está la geografía REAL de estas tiendas (vacía en 353 de 1.000). NO va a `province`, que guarda provincias españolas de verdad de los leads de Amazon y se usa en el buscador del board. La columna «Provincia» del Excel dice «Europe» en las 1.000 y por eso no se importa.';

COMMENT ON COLUMN public.cold_leads.nivel IS
  'Columna «Nivel» del Excel, solo el número: 1 potencial alto, 2 muy buenos números, 3 leads correctos. Se guarda el número y no la etiqueta «1 - Potencial alto» porque con la etiqueta entera no se puede ordenar ni comparar; el rótulo lo pinta el código, como ya se hace con COLD_STATUS_LABELS. Es el criterio de prioridad de la lista.';

COMMENT ON COLUMN public.cold_leads.ventas_estimadas_usd IS
  'Columna «Ventas est. $/mes» del Excel: DÓLARES estimados por el modelo de tráfico de Store Leads. NO es revenue_monthly y no debe volver a serlo: formatRevenue() concatena « €» sin condición, y la Leyenda prohíbe expresamente decir estas cifras en la llamada. Sirve para ORDENAR. En la ficha va con la advertencia pegada al número.';

COMMENT ON COLUMN public.cold_leads.n_productos IS
  'Columna «Nº productos» del Excel: tamaño del catálogo de la tienda. Sirve para cualificar (3.171 referencias no es lo mismo que 12). Sin CHECK: puede venir 0.';

COMMENT ON COLUMN public.cold_leads.anos_tienda IS
  'Columna «Años» del Excel: antigüedad de la TIENDA, con decimal (9.7), de ahí el NUMERIC. NO va a `amazon_start`, que la ficha rotula «Vende desde»: diría «Vende desde 9.7», ilegible y además falso, porque el sentido de esta lista es justo que NO vende en Amazon.';

COMMENT ON COLUMN public.cold_leads.plataforma IS
  'Columna «Plataforma» del Excel (PrestaShop, Shopify...). TEXT y no enum: en la muestra solo salen dos, pero Store Leads distingue docenas y la cola de 15.586 traerá más. Sirve para el discurso de integración de catálogo.';


/* ------------------------------------------------------------------ */
/* 5) CANALES ALTERNATIVOS Y ENLACES                                   */
/* ------------------------------------------------------------------ */

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS web TEXT,
  ADD COLUMN IF NOT EXISTS instagram TEXT,
  ADD COLUMN IF NOT EXISTS telefonos_extra TEXT,
  ADD COLUMN IF NOT EXISTS emails_extra TEXT;

COMMENT ON COLUMN public.cold_leads.web IS
  'Columna «Web» del Excel: la tienda online. NO va a `seller_url`, que ambos componentes pintan con el rótulo fijo «Ver en Amazon»; meterla ahí da un enlace que miente y borra la única señal de «ya está en Amazon» que tiene la tabla. Es además la clave de deduplicación de esta lista (ver el índice único del punto 8).';

COMMENT ON COLUMN public.cold_leads.instagram IS
  'Columna «Instagram» del Excel (vacía en 142 de 1.000). Canal alternativo de contacto, así que en la ficha va en el bloque de contacto y no en el de datos de la tienda.';

COMMENT ON COLUMN public.cold_leads.telefonos_extra IS
  'Columna «Teléfonos extra» del Excel. Aparte y NO apilados en `phone`: telHref() coge el primer número de la cadena, así que concatenar aquí dejaría el resto invisible para el enlace tel: aunque se vieran en pantalla.';

COMMENT ON COLUMN public.cold_leads.emails_extra IS
  'Columna «Emails extra» del Excel. Aparte por lo mismo que los teléfonos: el mailto: de la ficha usa el primero de `email`.';


/* ------------------------------------------------------------------ */
/* 6) QUIÉN ES LA EMPRESA (y si se le puede llamar en frío)             */
/* ------------------------------------------------------------------ */

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS cif TEXT,
  ADD COLUMN IF NOT EXISTS tipo_empresa TEXT
    CHECK (tipo_empresa IS NULL OR tipo_empresa IN ('sociedad', 'autonomo')),
  ADD COLUMN IF NOT EXISTS n_administradores SMALLINT;

COMMENT ON COLUMN public.cold_leads.cif IS
  'Columna «CIF» del Excel: identificador fiscal. NO es `mercantile_registry` (tomo/folio/hoja), que la ficha rotula «Reg. mercantil»; mezclarlos deja sin saber qué contiene una fila, sin poder validar formato y sin cruce con el BORME local ni con facturación. TEXT y no VARCHAR(9): hay CIF de sociedades extranjeras y 142 de 1.000 vienen vacíos.';

COMMENT ON COLUMN public.cold_leads.tipo_empresa IS
  'Columna «Tipo» del Excel. CRITERIO DE NEGOCIO DURO de la Leyenda: si es autonomo NO SE LLAMA EN FRÍO, va por email. Un BOOLEAN no serviría: 752 de 1.000 vienen vacíos y «no sabemos si es autónomo» no es «es sociedad», así que el NULL expresa el desconocido y el CHECK lo permite.';

COMMENT ON COLUMN public.cold_leads.n_administradores IS
  'Columna «Nº admin. activos» del Excel. Viene 0 —no NULL— cuando el BORME no da ninguno, así que 0 y NULL significan cosas distintas y hay que respetarlo: es el respaldo de POR QUÉ `decisor` está vacío.';


/* ------------------------------------------------------------------ */
/* 7) CÓMO SE NORMALIZA UNA WEB                                        */
/* ------------------------------------------------------------------ */
--
-- IMMUTABLE porque tiene que poder indexarse. Y tiene que hacer EXACTAMENTE lo
-- mismo que normalizarWeb() en scripts/generar-csv-tiendas-no-amazon.ts: si las
-- dos normalizaciones se separan, el script dice que no hay duplicados y el
-- índice los rechaza a mitad de subida, dejando el lote a medias.

CREATE OR REPLACE FUNCTION public.normalizar_web(url TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(url)), '^https?://', ''),
        '^www\.', ''
      ),
      '/+$', ''
    ),
    ''
  );
$$;

COMMENT ON FUNCTION public.normalizar_web(TEXT) IS
  'Deja una web comparable: minúsculas, sin protocolo, sin www. y sin barra final. Existe solo para el índice único de deduplicación de las tiendas online. Tiene que coincidir con normalizarWeb() del script que genera el CSV.';


/* ------------------------------------------------------------------ */
/* 8) LA DEDUPLICACIÓN, QUE ANTES NO EXISTÍA                           */
/* ------------------------------------------------------------------ */
--
-- La 091 resolvía la reimportación con TRUNCATE TABLE cold_leads CASCADE. HOY
-- ESO YA NO ES UNA OPCIÓN: se llevaría por delante los 3.978 leads de Amazon y,
-- con el CASCADE, todas las notas de llamadas reales registradas desde agosto.
--
-- Y `cold_leads` no tiene ni un UNIQUE, así que si una subida se queda a medias
-- y se repite —que es literalmente lo que pasó la primera vez, José con 334 de
-- 1.178— quedan duplicados y no hay forma de limpiarlos sin mirar fila por
-- fila. Este índice hace que la segunda subida FALLE en vez de duplicar.
--
-- Parcial a tipo_lead='tienda_online' para no imponer nada a los leads de
-- Amazon, que no tienen `web` y nunca la han necesitado.

CREATE UNIQUE INDEX IF NOT EXISTS ux_cold_leads_tienda_web
  ON public.cold_leads (public.normalizar_web(web))
  WHERE tipo_lead = 'tienda_online' AND web IS NOT NULL;

-- Así se va a consultar la pantalla en cuanto haya dos tipos conviviendo.
CREATE INDEX IF NOT EXISTS idx_cold_leads_tipo_status
  ON public.cold_leads (tipo_lead, status);

-- El orden de trabajo de la lista nueva: primero el nivel, y dentro del nivel
-- las que más venden (estimado). Sin este índice, ordenar 23.320 filas por dos
-- columnas es un sort en memoria cada vez que alguien abre la pantalla.
CREATE INDEX IF NOT EXISTS idx_cold_leads_tienda_prioridad
  ON public.cold_leads (nivel, ventas_estimadas_usd DESC)
  WHERE tipo_lead = 'tienda_online';


/* ------------------------------------------------------------------ */
/* 9) CÓMO SE DESHACE UNA IMPORTACIÓN, AHORA QUE NO HAY TRUNCATE       */
/* ------------------------------------------------------------------ */
--
-- Queda escrito aquí y COMENTADO a propósito: es lo que alguien va a buscar con
-- prisa cuando una subida salga mal, y es justo el momento en que se copia el
-- TRUNCATE viejo sin leer. Descomentar solo el lote que haya que rehacer.
--
--   DELETE FROM public.cold_leads
--    WHERE tipo_lead = 'tienda_online'
--      AND source_list = 'No Amazon V1';
--
-- El DELETE arrastra en cascada las notas DE ESOS leads (cold_lead_notes.lead_id
-- es ON DELETE CASCADE) y no toca nada más. Antes de lanzarlo, mirar si algún
-- comercial ya había apuntado algo:
--
--   SELECT count(*) FROM public.cold_lead_notes n
--     JOIN public.cold_leads l ON l.id = n.lead_id
--    WHERE l.tipo_lead = 'tienda_online';


/* ------------------------------------------------------------------ */
/* 10) QUÉ HA PASADO DE VERDAD                                         */
/* ------------------------------------------------------------------ */
--
-- Un ALTER ... IF NOT EXISTS que no hace nada tampoco se queja, así que se
-- comprueba que las 18 columnas están de verdad antes de dar esto por bueno.

DO $$
DECLARE
  faltan            TEXT := '';
  col               TEXT;
  nuevas            TEXT[] := ARRAY[
    'tipo_lead', 'vende_en_amazon', 'vende_en_amazon_comprobado_en',
    'decisor', 'cargo_decisor', 'ciudad', 'nivel', 'ventas_estimadas_usd',
    'n_productos', 'anos_tienda', 'plataforma', 'web', 'instagram',
    'telefonos_extra', 'emails_extra', 'cif', 'tipo_empresa', 'n_administradores'
  ];
  sellers           INTEGER;
  tiendas           INTEGER;
  sin_tipo          INTEGER;
BEGIN
  FOREACH col IN ARRAY nuevas LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cold_leads'
         AND column_name = col
    ) THEN
      faltan := faltan || col || ' ';
    END IF;
  END LOOP;

  IF faltan <> '' THEN
    RAISE EXCEPTION '204 · faltan columnas por crear: %. Nada se ha quedado a medias, pero revisa el error de arriba.', faltan;
  END IF;

  SELECT count(*) FILTER (WHERE tipo_lead = 'seller_amazon'),
         count(*) FILTER (WHERE tipo_lead = 'tienda_online'),
         count(*) FILTER (WHERE tipo_lead IS NULL)
    INTO sellers, tiendas, sin_tipo
    FROM public.cold_leads;

  RAISE NOTICE '204 · 18 columnas nuevas listas. Ni una fila tocada.';
  RAISE NOTICE '204 · leads por tipo: % vendedores de Amazon, % tiendas online, % sin tipo.',
    sellers, tiendas, sin_tipo;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'ux_cold_leads_tienda_web'
  ) THEN
    RAISE WARNING '204 · el índice único de deduplicación NO está. Sin él, repetir una subida a medias duplica leads en silencio.';
  ELSE
    RAISE NOTICE '204 · deduplicación por web activa: repetir una subida fallará en vez de duplicar.';
  END IF;

  RAISE NOTICE '204 · siguiente paso: subir supabase/seed/cold_leads_no_amazon.csv por el Table Editor y luego pegar la 088 para traducir import_email a assigned_to. La 089 NO tiene equivalente aquí (las seis columnas de trabajo vienen vacías) y la 091 NO se puede usar (ver el punto 9).';
END $$;
