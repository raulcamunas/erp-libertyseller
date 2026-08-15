/**
 * MARKETING V2 · EL BANCO DE PRUEBAS DE LA API DE ADS
 * ==================================================
 *
 * Llamadas preparadas para ver QUÉ DEVUELVE AMAZON antes de decidir qué guardar
 * y cómo. No hay tablas detrás ni nada persistido: se pide, se enseña el JSON
 * crudo y ahí acaba.
 *
 * Y es a propósito. Diseñar el esquema antes de ver el dato es cómo se acaba con
 * una tabla de treinta columnas de las que se usan cuatro, y con tres campos que
 * hacían falta guardados dentro de un JSONB porque «ya se verá».
 *
 *
 * ============ LO QUE HAY QUE SABER DE LA v3 ANTES DE TOCAR NADA ============
 *
 * 1. NO USA `application/json`. Cada recurso tiene su propio tipo de contenido
 *    —`application/vnd.spCampaign.v3+json`, `vnd.spKeyword.v3+json`— y va TANTO
 *    en `Accept` COMO en `Content-Type`. Con el genérico, Amazon contesta 415 y
 *    no dice cuál esperaba.
 *
 * 2. LAS LISTAS SON POST, no GET. `/sp/campaigns/list` con un cuerpo que lleva
 *    los filtros. Un GET a esa ruta da 405.
 *
 * 3. LOS INFORMES SON ASÍNCRONOS y de tres pasos: se pide, se espera a que
 *    Amazon lo genere —de segundos a minutos— y se descarga de una URL firmada.
 *    Aquí solo está el primer paso; el resto se monta cuando se sepa qué
 *    columnas hacen falta.
 *
 * 4. TODO LLEVA `Amazon-Advertising-API-Scope` con el profileId, menos
 *    `/v2/profiles`. Sin él, 401.
 */

export interface LlamadaPreparada {
  id: string
  nombre: string
  /** Qué se ve con esto, en una línea */
  para: string
  metodo: 'GET' | 'POST' | 'PUT'
  ruta: string
  /** El tipo de contenido de la v3. Vacío = el genérico */
  tipo?: string
  cuerpo?: unknown
  /** true si ESCRIBE en la cuenta del cliente. Ver la nota de abajo */
  escribe?: boolean
}

/** El tope de cada lista. 100 es de sobra para ver la forma del dato */
const MAX = 100

/**
 * LAS LLAMADAS DE LECTURA.
 *
 * Ordenadas como se recorre una cuenta de arriba abajo: campaña, grupo, y dentro
 * del grupo las keywords, la segmentación por producto y los anuncios.
 */
export const LECTURAS: LlamadaPreparada[] = [
  {
    id: 'campanas',
    nombre: 'Campañas',
    para: 'Nombre, estado, presupuesto diario, tipo de puja y fechas',
    metodo: 'POST',
    ruta: '/sp/campaigns/list',
    tipo: 'application/vnd.spCampaign.v3+json',
    cuerpo: { maxResults: MAX },
  },
  {
    id: 'grupos',
    nombre: 'Grupos de anuncios',
    para: 'Los grupos de cada campaña, con su puja por defecto',
    metodo: 'POST',
    ruta: '/sp/adGroups/list',
    tipo: 'application/vnd.spAdGroup.v3+json',
    cuerpo: { maxResults: MAX },
  },
  {
    id: 'keywords',
    nombre: 'Keywords y sus pujas',
    para: 'Cada palabra clave, su concordancia y lo que se puja por ella',
    metodo: 'POST',
    ruta: '/sp/keywords/list',
    tipo: 'application/vnd.spKeyword.v3+json',
    cuerpo: { maxResults: MAX },
  },
  {
    id: 'targets',
    nombre: 'Segmentación',
    para: 'Targeting por producto, categoría y automático, con su puja',
    metodo: 'POST',
    ruta: '/sp/targets/list',
    tipo: 'application/vnd.spTargetingClause.v3+json',
    cuerpo: { maxResults: MAX },
  },
  {
    id: 'negativas',
    nombre: 'Keywords negativas',
    para: 'Lo que se está excluyendo, que es la mitad de una cuenta bien llevada',
    metodo: 'POST',
    ruta: '/sp/negativeKeywords/list',
    tipo: 'application/vnd.spNegativeKeyword.v3+json',
    cuerpo: { maxResults: MAX },
  },
  {
    id: 'anuncios',
    nombre: 'Anuncios de producto',
    para: 'Qué ASIN o SKU se anuncia en cada grupo',
    metodo: 'POST',
    ruta: '/sp/productAds/list',
    tipo: 'application/vnd.spProductAd.v3+json',
    cuerpo: { maxResults: MAX },
  },
  {
    id: 'portfolios',
    nombre: 'Portafolios',
    para: 'Cómo agrupa el cliente sus campañas',
    metodo: 'GET',
    ruta: '/portfolios',
  },
  {
    id: 'perfiles',
    nombre: 'Perfiles (sin scope)',
    para: 'Las cuentas de anunciante. Es la única llamada que NO lleva profileId',
    metodo: 'GET',
    ruta: '/v2/profiles',
  },
]

/**
 * LOS INFORMES, que son otra cosa.
 *
 * Asíncronos: esto solo PIDE el informe y devuelve un identificador. Amazon
 * tarda de segundos a varios minutos en generarlo, y después hay que preguntar
 * por él y descargarlo de una URL firmada (que además viene comprimida).
 *
 * Se deja el primer paso montado porque es donde están los datos que de verdad
 * importan —términos de búsqueda, gasto y ventas por keyword— y porque ver la
 * respuesta de la petición es lo que dice si los permisos llegan. Los otros dos
 * pasos se montan cuando se decida qué columnas se guardan.
 */
export function informeTerminosDeBusqueda(desde: string, hasta: string): LlamadaPreparada {
  return {
    id: 'informe-terminos',
    nombre: 'Informe de términos de búsqueda',
    para: 'Por qué buscó la gente que acabó comprando: gasto, clics y ventas',
    metodo: 'POST',
    ruta: '/reporting/reports',
    tipo: 'application/vnd.createasyncreportrequest.v3+json',
    cuerpo: {
      name: `terminos ${desde} a ${hasta}`,
      startDate: desde,
      endDate: hasta,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['searchTerm'],
        columns: [
          'searchTerm',
          'keyword',
          'matchType',
          'campaignName',
          'adGroupName',
          'impressions',
          'clicks',
          'cost',
          'clickThroughRate',
          'costPerClick',
          'purchases7d',
          'sales7d',
        ],
        reportTypeId: 'spSearchTerm',
        timeUnit: 'SUMMARY',
        format: 'GZIP_JSON',
      },
    },
  }
}

/**
 * SUBIR O BAJAR UNA PUJA.
 *
 * ESTO ESCRIBE EN LA CUENTA DE UN CLIENTE Y GASTA SU DINERO. No es una llamada
 * más de la lista: una puja mal puesta se nota en la factura del día siguiente y
 * no hay deshacer que valga — lo gastado, gastado.
 *
 * Por eso vive aparte de LECTURAS, lleva `escribe: true` y la pantalla lo pinta
 * en rojo y pide confirmación. En este banco de pruebas está para comprobar que
 * los permisos alcanzan, no para trabajar: cuando llegue el momento de mover
 * pujas de verdad, eso irá con su propio registro de quién cambió qué, sus
 * topes por día y su simulacro delante, igual que el repricing de Buy Box.
 */
export function cambiarPujaKeyword(keywordId: string, puja: number): LlamadaPreparada {
  return {
    id: 'puja-keyword',
    nombre: `Cambiar la puja de ${keywordId} a ${puja} €`,
    para: 'ESCRIBE en la cuenta del cliente',
    metodo: 'PUT',
    ruta: '/sp/keywords',
    tipo: 'application/vnd.spKeyword.v3+json',
    cuerpo: { keywords: [{ keywordId, bid: puja }] },
    escribe: true,
  }
}
