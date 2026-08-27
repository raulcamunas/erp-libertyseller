/**
 * LAS PLANTILLAS DE INFORME DE AMAZON ADS
 * =======================================
 * PURO: una tabla de definiciones. Sin red, sin base de datos. Lo importa el
 * servidor para pedir los informes y la pantalla para pintar la lista.
 *
 * Son las mismas que Amazon ofrece en «Todas las plantillas» de su consola, con
 * una diferencia que hay que decir antes que nada.
 *
 *
 * ============ SIETE DE LAS DIECISÉIS SON DE AMAZON DSP ============
 *
 * Y DSP no es «otra pestaña de Ads»: es otro producto, con su propia API, su
 * propio contrato y sus propias cuentas de anunciante. Las diez cuentas
 * conectadas de este ERP son todas de tipo `seller` — publicidad patrocinada—,
 * así que Geografía, Tecnología, Audio y vídeo, Inventario, Eventos en directo,
 * Alcance y frecuencia y Ruta de conversión NO se pueden pedir. No es que estén
 * sin hacer: es que no hay por dónde pedirlas.
 *
 * (De «Ruta de conversión» lo dice la propia consola de Amazon en la captura:
 * «Actualmente no admitimos esta plantilla de informe».)
 *
 * Salen igualmente en la lista, apagadas y con el motivo. Esconderlas haría que
 * la pregunta «¿y la de geografía?» volviera cada dos meses.
 *
 *
 * ============ LAS COLUMNAS LAS VALIDA AMAZON, NO ESTE FICHERO ============
 *
 * La v3 rechaza con un 400 cualquier columna que no exista para ese tipo de
 * informe, y dice cuál. Eso es bueno y conviene apoyarse en ello: aquí hay una
 * propuesta razonable de columnas por plantilla, y si alguna no le gusta,
 * Amazon lo dirá con nombre y apellidos.
 *
 * Por eso cada plantilla se pide POR SEPARADO y su fallo se guarda en su propia
 * fila: que «Términos de búsqueda» tenga una columna mal no puede dejar sin
 * informe a las otras ocho. Es la diferencia entre ajustar una línea y no tener
 * nada.
 */

export type ProductoAds =
  | 'SPONSORED_PRODUCTS'
  | 'SPONSORED_BRANDS'
  | 'SPONSORED_DISPLAY'
  | 'SPONSORED_TELEVISION'

/**
 * MÉTRICAS · SE PIDE TODO LO QUE PODRÍA EXISTIR, Y AMAZON PODA.
 *
 * Esta lista es deliberadamente ambiciosa, y eso solo se puede hacer desde que
 * `pedirPodando()` quita las columnas que Amazon rechaza y vuelve a pedir. La v3
 * no tiene forma de preguntar qué admite cada informe —y su documentación es una
 * SPA que no se deja leer—, pero cuando rechaza algo contesta con la lista
 * completa de lo que sí acepta. O sea que la API se documenta sola, pero solo si
 * le pides de más.
 *
 * Antes esto obligaba a ser conservador: una columna de más y perdías la pestaña
 * entera. Ahora una columna de más es una columna menos y una nota en la portada.
 *
 * LAS DOS DE «SAME SKU» SON LAS QUE MÁS FALTAN y por eso están: separan lo que
 * se vendió DEL PRODUCTO ANUNCIADO de lo que se vendió de otros. Sin esa
 * separación, un ACOS bueno puede venir de que el anuncio empuja a un producto
 * distinto — y eso cambia la decisión.
 */
const METRICAS = [
  'impressions',
  'clicks',
  'cost',
  'purchases7d',
  'purchasesSameSku7d',
  'sales7d',
  'attributedSalesSameSku7d',
  'salesOtherSku7d',
  'unitsSoldClicks7d',
  'unitsSoldSameSku7d',
  'clickThroughRate',
  'costPerClick',
  'roasClicks7d',
  'acosClicks7d',
] as const

/** Los identificadores. Sin ellos no se puede cruzar nada entre pestañas */
const IDS_CAMPANA = ['campaignId', 'campaignName', 'campaignStatus'] as const
const IDS_GRUPO = ['adGroupId', 'adGroupName'] as const

export interface Variante {
  /** El tipo de informe de la v3, tal cual lo espera Amazon */
  reportTypeId: string
  adProduct: ProductoAds
  groupBy: string[]
  columns: string[]
  /** Cómo se llama su pestaña en el Excel. Máximo 31 caracteres: es de Excel */
  hoja: string
}

export interface Plantilla {
  id: string
  nombre: string
  descripcion: string
  /**
   * Las variantes que hay que pedir para armar esta plantilla.
   *
   * Son varias porque una misma plantilla —«Campaña»— existe en Sponsored
   * Products, Brands y Display, y cada una es una PETICIÓN DISTINTA con su
   * propio tipo de informe. Amazon las junta en su consola; aquí se piden por
   * separado y se juntan al final, que es la única forma de que un producto que
   * el cliente no usa no tumbe la plantilla entera.
   */
  variantes: Variante[]
  /** Cuando no se puede pedir con lo que hay conectado, POR QUÉ */
  imposible?: string
}

/** El motivo se repite en siete plantillas y decirlo una vez evita que se desincronicen */
const SOLO_DSP =
  'Solo existe en Amazon DSP, que es otro producto con su propia API y sus propias cuentas de ' +
  'anunciante. Las cuentas conectadas aquí son de publicidad patrocinada.'

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'campana',
    nombre: 'Campaña',
    descripcion: 'Métricas de rendimiento por campaña.',
    variantes: [
      {
        reportTypeId: 'spCampaigns',
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['campaign'],
        columns: [
          ...IDS_CAMPANA,
          'campaignBudgetAmount',
          'campaignBudgetType',
          'campaignBudgetCurrencyCode',
          'campaignRuleBasedBudgetAmount',
          'campaignApplicableBudgetRuleName',
          'topOfSearchImpressionShare',
          ...METRICAS,
        ],
        hoja: 'Campaña SP',
      },
      {
        reportTypeId: 'sbCampaigns',
        adProduct: 'SPONSORED_BRANDS',
        groupBy: ['campaign'],
        columns: [...IDS_CAMPANA, 'campaignBudgetAmount', 'campaignBudgetType', ...METRICAS],
        hoja: 'Campaña SB',
      },
      {
        reportTypeId: 'sdCampaigns',
        adProduct: 'SPONSORED_DISPLAY',
        groupBy: ['campaign'],
        columns: [...IDS_CAMPANA, 'campaignBudgetAmount', 'campaignBudgetType', ...METRICAS],
        hoja: 'Campaña SD',
      },
    ],
  },
  {
    id: 'producto_anunciado',
    nombre: 'Producto anunciado',
    descripcion: 'Rendimiento de los productos que se anuncian, en todas las campañas.',
    variantes: [
      {
        reportTypeId: 'spAdvertisedProduct',
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['advertiser'],
        columns: [
          ...IDS_CAMPANA,
          ...IDS_GRUPO,
          'adId',
          'advertisedAsin',
          'advertisedSku',
          'spend',
          ...METRICAS,
        ],
        hoja: 'Producto anunciado SP',
      },
      {
        reportTypeId: 'sdAdvertisedProduct',
        adProduct: 'SPONSORED_DISPLAY',
        groupBy: ['advertiser'],
        columns: [...IDS_CAMPANA, ...IDS_GRUPO, 'promotedAsin', 'promotedSku', ...METRICAS],
        hoja: 'Producto anunciado SD',
      },
    ],
  },
  {
    id: 'producto_convertido',
    nombre: 'Producto convertido',
    descripcion: 'Lo que se acabó comprando, que no siempre es lo que se anunciaba.',
    variantes: [
      {
        reportTypeId: 'spPurchasedProduct',
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['asin'],
        columns: [
          ...IDS_CAMPANA,
          ...IDS_GRUPO,
          'advertisedAsin',
          'purchasedAsin',
          'sales7d',
          'salesOtherSku7d',
          'attributedSalesSameSku7d',
          'unitsSoldClicks7d',
          'unitsSoldSameSku7d',
        ],
        hoja: 'Producto convertido SP',
      },
    ],
  },
  {
    id: 'segmentacion',
    nombre: 'Segmentación',
    descripcion: 'Por palabra clave, producto y categoría.',
    variantes: [
      {
        reportTypeId: 'spTargeting',
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['targeting'],
        columns: [
          ...IDS_CAMPANA,
          ...IDS_GRUPO,
          'keywordId',
          'keyword',
          'keywordType',
          'matchType',
          'targeting',
          // LA PUJA Y EL ESTADO son lo que convierte esta pestaña en accionable:
          // sin ellas se ve qué rinde mal, pero no desde qué puja ni si ya está
          // pausada. Con ellas se puede decir «baja de 0,80 a 0,55».
          'keywordBid',
          'adKeywordStatus',
          'topOfSearchImpressionShare',
          ...METRICAS,
        ],
        hoja: 'Segmentación SP',
      },
    ],
  },
  {
    id: 'termino_busqueda',
    nombre: 'Término de búsqueda',
    descripcion: 'Lo que escribió el comprador cuando hizo clic. Es de donde salen las negativas.',
    variantes: [
      {
        reportTypeId: 'spSearchTerm',
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['searchTerm'],
        columns: [
          ...IDS_CAMPANA,
          ...IDS_GRUPO,
          'searchTerm',
          'keywordId',
          'keyword',
          'keywordType',
          'matchType',
          'keywordBid',
          'adKeywordStatus',
          ...METRICAS,
        ],
        hoja: 'Término búsqueda SP',
      },
    ],
  },
  {
    id: 'emplazamiento',
    nombre: 'Emplazamiento',
    descripcion: 'Arriba de la búsqueda frente al resto de sitios donde sale el anuncio.',
    variantes: [
      {
        reportTypeId: 'spCampaigns',
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['campaignPlacement'],
        columns: [
          ...IDS_CAMPANA,
          'placementClassification',
          'campaignBudgetAmount',
          'topOfSearchImpressionShare',
          ...METRICAS,
        ],
        hoja: 'Emplazamiento SP',
      },
    ],
  },
  {
    id: 'cuota_impresiones_top',
    nombre: 'Cuota de impresiones arriba de la búsqueda',
    descripcion: 'Qué parte de las impresiones de arriba del todo se está llevando el cliente.',
    variantes: [
      {
        reportTypeId: 'spTargeting',
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['targeting'],
        columns: [
          ...IDS_CAMPANA,
          ...IDS_GRUPO,
          'keywordId',
          'keyword',
          'matchType',
          'keywordBid',
          'topOfSearchImpressionShare',
          ...METRICAS,
        ],
        hoja: 'Cuota top SP',
      },
    ],
  },
  {
    id: 'cuota_impresiones_termino',
    nombre: 'Cuota de impresiones por término',
    descripcion: 'Cuota de impresiones de los términos de búsqueda. Solo Sponsored Brands.',
    variantes: [
      {
        /**
         * SPONSORED BRANDS Y NO PRODUCTS, y no es un capricho.
         *
         * `searchTermImpressionShare` y `searchTermImpressionRank` NO existen en
         * `spSearchTerm`: Amazon las rechaza con un 400 y su lista de columnas
         * admitidas no las incluye. Comprobado contra la cuenta real, no
         * deducido de la documentación.
         *
         * Donde sí viven es en el informe de términos de Sponsored Brands. Si la
         * cuenta no tiene campañas de Brands, esta pestaña sale vacía — que es la
         * respuesta correcta y se ve en la portada, no un error.
         */
        reportTypeId: 'sbSearchTerm',
        adProduct: 'SPONSORED_BRANDS',
        groupBy: ['searchTerm'],
        columns: [
          ...IDS_CAMPANA,
          'searchTerm',
          'keywordText',
          'matchType',
          'searchTermImpressionShare',
          'searchTermImpressionRank',
          ...METRICAS,
        ],
        hoja: 'Cuota término SB',
      },
    ],
  },
  {
    id: 'audiencia',
    nombre: 'Audiencia',
    descripcion: 'Segmentación de Sponsored Display: audiencias y productos.',
    variantes: [
      {
        reportTypeId: 'sdTargeting',
        adProduct: 'SPONSORED_DISPLAY',
        groupBy: ['targeting'],
        // SIN `targeting`: Amazon la rechaza en este informe («invalid values:
        // (targeting)»), aunque sea justo el nombre del agrupamiento. Es de las
        // cosas de esta API que no se pueden deducir — el agrupamiento y la
        // columna no se llaman igual.
        columns: [
          ...IDS_CAMPANA,
          ...IDS_GRUPO,
          'targetingText',
          'targetingExpression',
          'targetingType',
          ...METRICAS,
        ],
        hoja: 'Audiencia SD',
      },
    ],
  },

  /* ---------- Las que necesitan Amazon DSP ---------- */
  { id: 'geografia', nombre: 'Geografía', descripcion: 'Por dónde está el comprador.', variantes: [], imposible: SOLO_DSP },
  { id: 'tecnologia', nombre: 'Tecnología', descripcion: 'Dispositivo y sistema operativo del comprador.', variantes: [], imposible: SOLO_DSP },
  { id: 'audio_video', nombre: 'Audio y vídeo', descripcion: 'Anuncios de audio y de vídeo.', variantes: [], imposible: SOLO_DSP },
  { id: 'inventario', nombre: 'Inventario', descripcion: 'Ofertas y fuentes de suministro.', variantes: [], imposible: SOLO_DSP },
  { id: 'eventos', nombre: 'Eventos en directo', descripcion: 'Anuncios emitidos durante un evento en directo.', variantes: [], imposible: SOLO_DSP },
  { id: 'alcance', nombre: 'Alcance y frecuencia', descripcion: 'Personas distintas alcanzadas y cuántas veces.', variantes: [], imposible: SOLO_DSP },
  {
    id: 'ruta_conversion',
    nombre: 'Ruta de conversión',
    descripcion: 'Combinaciones de formatos que llevan a la conversión.',
    variantes: [],
    imposible:
      'La propia consola de Amazon dice que no admite esta plantilla de informe. No es cosa del ERP.',
  },
]

export const PLANTILLAS_POR_ID = new Map(PLANTILLAS.map((p) => [p.id, p]))

/** Las que se pueden pedir de verdad con publicidad patrocinada */
export const PLANTILLAS_DISPONIBLES = PLANTILLAS.filter((p) => !p.imposible)

/**
 * Cuántas peticiones cuesta una selección.
 *
 * Sirve para decir en pantalla lo que va a tardar ANTES de pulsar: cada
 * variante es un informe que Amazon prepara aparte, y son de diez segundos a
 * varios minutos cada uno.
 */
export function cuantasPeticiones(ids: string[]): number {
  let n = 0
  for (const id of ids) n += PLANTILLAS_POR_ID.get(id)?.variantes.length ?? 0
  return n
}
