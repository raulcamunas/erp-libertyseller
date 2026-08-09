/**
 * EL FICHERO DEL CENSO: LEER GET_MERCHANT_LISTINGS_ALL_DATA
 * ========================================================
 * Puro: recibe el texto del informe y devuelve filas. Sin red, sin Supabase.
 * Todo lo de aquí se puede comprobar con una cadena de tres líneas.
 *
 *
 * LAS CUATRO TRAMPAS DE ESTE FICHERO, Y LAS CUATRO MUERDEN EN SILENCIO
 * -------------------------------------------------------------------
 *
 * 1. EL BOM. Amazon documenta que el fichero empieza con tres bytes de marca de
 *    orden (UTF-8 BOM). Si no se quitan, la PRIMERA columna se llama
 *    "﻿item-name" en vez de "item-name" y desaparece del mapa de cabeceras
 *    sin dar ningún error: el informe se lee entero y el título sale vacío en
 *    todas las filas.
 *
 * 2. LA CABECERA VIENE EN EL IDIOMA DEL MARKETPLACE. Y el `reportOptions` que
 *    sirve para pedirla en inglés NO ES FIABLE: la propia documentación avisa de
 *    que los informes no se cachean por idioma, así que dentro de la ventana de
 *    caché puedes pedir en_US y recibir las cabeceras en español. Por eso aquí
 *    hay TRES vías, en este orden: nombres conocidos → alias configurados a mano
 *    → POSICIÓN. La posición es fiable porque Amazon conserva las columnas
 *    obsoletas precisamente «to maintain the original column order».
 *
 * 3. EL SEPARADOR DECIMAL DEPENDE DEL PAÍS. En el informe de España un precio
 *    llega como «14,99» y `Number('14,99')` es NaN. Leerlo mal no da error: da
 *    un catálogo entero sin precio, y un SKU sin precio se cae del criterio de
 *    seguimiento por la regla de «excluir sin precio».
 *
 * 4. EL ESTADO DEL LISTING HABLA OTRO IDIOMA QUE LA API. El informe dice
 *    «Active»; la Listings API dice ['BUYABLE','DISCOVERABLE']. Escribir
 *    «Active» en la columna listing_status haría que estaALaVenta() —que busca
 *    BUYABLE— devolviera false PARA TODO EL CATÁLOGO, y el conjunto activo de
 *    ese cliente se quedaría vacío. Ver estadoDelInforme().
 */

/* ------------------------------------------------------------------ */
/* Las 29 columnas, en su orden exacto                                 */
/* ------------------------------------------------------------------ */

/**
 * El orden documentado por Amazon. NO SE TOCA NI SE REORDENA: es la vía de
 * respaldo cuando la cabecera viene en un idioma que no reconocemos, y depende
 * de que estas posiciones sean las de verdad.
 *
 * Las `zshop-*`, `bid-for-featured-placement`, `item-is-marketplace` y
 * `add-delete` están muertas desde hace años y Amazon las mantiene a propósito
 * para no mover el resto de columnas. Por eso siguen en la lista.
 */
export const COLUMNAS_INFORME_LISTINGS = [
  'item-name',
  'item-description',
  'listing-id',
  'seller-sku',
  'price',
  'quantity',
  'open-date',
  'image-url',
  'item-is-marketplace',
  'product-id-type',
  'zshop-shipping-fee',
  'item-note',
  'item-condition',
  'zshop-category1',
  'zshop-browse-path',
  'zshop-storefront-feature',
  'asin1',
  'asin2',
  'asin3',
  'will-ship-internationally',
  'expedited-shipping',
  'zshop-boldface',
  'product-id',
  'bid-for-featured-placement',
  'add-delete',
  'pending-quantity',
  'fulfillment-channel',
  'merchant-shipping-group',
  'status',
] as const

export type ColumnaInforme = (typeof COLUMNAS_INFORME_LISTINGS)[number]

/** Sin esta columna el fichero no sirve para nada: es la clave del catálogo */
const COLUMNA_IMPRESCINDIBLE: ColumnaInforme = 'seller-sku'

/** Las que el ERP usa de verdad. El resto se leen y se tiran */
const COLUMNAS_USADAS: ColumnaInforme[] = [
  'item-name',
  'seller-sku',
  'price',
  'quantity',
  'pending-quantity',
  'asin1',
  'product-id',
  'product-id-type',
  'fulfillment-channel',
  'status',
]

/**
 * Sinónimos conocidos de las columnas que usamos, por si la cabecera llega
 * traducida.
 *
 * NO PRETENDE SER COMPLETA y no pasa nada: si falla, la lectura cae a la vía de
 * la posición, que es la que de verdad garantiza que esto funcione en cualquier
 * país. Está aquí porque cuando acierta, el evento que se levanta es un 'info'
 * en vez de un aviso, y porque ampliarla es una línea el día que se vea una
 * cabecera nueva de verdad —no inventada— en el informe de un cliente.
 */
const SINONIMOS: Partial<Record<ColumnaInforme, string[]>> = {
  'seller-sku': ['sku-del-vendedor', 'sku', 'sku-vendeur', 'verkaufer-sku', 'sku-venditore'],
  'item-name': ['nombre-del-producto', 'nombre-producto', 'nom-de-l-article', 'artikelname'],
  price: ['precio', 'prix', 'preis', 'prezzo'],
  quantity: ['cantidad', 'quantite', 'menge', 'quantita'],
  'pending-quantity': ['cantidad-pendiente', 'quantite-en-attente'],
  asin1: ['asin', 'asin-1'],
  'product-id': ['id-de-producto', 'id-producto', 'identifiant-produit'],
  'product-id-type': ['tipo-de-id-de-producto', 'tipo-id-producto'],
  'fulfillment-channel': ['canal-de-logistica', 'canal-logistica', 'circuit-de-distribution'],
  status: ['estado', 'statut', 'stato'],
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

/** Cómo se ha resuelto el mapa de columnas. Se cuenta en un evento */
export type ViaCabecera = 'nombres' | 'posicion'

export interface FilaCenso {
  sku: string
  asin: string | null
  titulo: string | null
  /** Ya en número, con el separador decimal del país deshecho */
  precio: number | null
  cantidad: number | null
  /** Unidades comprometidas en pedidos sin enviar */
  pendiente: number | null
  /** El valor CRUDO de Amazon ('DEFAULT', 'AMAZON_NA'...). Nunca se traduce
      aquí: la lista depende del vendedor y de sus programas */
  canal: string | null
  /** El texto crudo del estado, para poder explicarlo */
  estadoCrudo: string | null
  /**
   * El estado traducido al vocabulario de la Listings API, o `undefined` cuando
   * no se reconoce. `undefined` NO es lo mismo que `[]`: uno significa «no
   * escribas esta columna» y el otro «no está a la venta». Ver la trampa 4.
   */
  estado: string[] | undefined
  codigoExterno: string | null
  codigoExternoTipo: string | null
}

export interface LecturaInforme {
  filas: FilaCenso[]
  via: ViaCabecera
  /** Las cabeceras tal cual venían, para poder enseñarlas si algo no cuadra */
  cabeceras: string[]
  /** Columnas que usamos y no se han encontrado */
  ausentes: ColumnaInforme[]
  /** Líneas que se han tirado por no tener SKU o por venir partidas */
  descartadas: number
  /** Valores de `status` que no sabemos traducir, con su recuento */
  estadosDesconocidos: Record<string, number>
}

export interface OpcionesLectura {
  /**
   * Mapa columna canónica -> cabecera real, para arreglar a mano un idioma que
   * no reconocemos SIN TENER QUE DESPLEGAR. Va en `parametros` del trabajo.
   */
  alias?: Record<string, string> | null
}

export class InformeIlegible extends Error {
  readonly cabeceras: string[]
  constructor(mensaje: string, cabeceras: string[]) {
    super(mensaje)
    this.name = 'InformeIlegible'
    this.cabeceras = cabeceras
  }
}

/**
 * Convierte el fichero del informe en filas del catálogo.
 *
 * Devuelve TODO lo que ha pasado —la vía usada, las columnas que faltan, las
 * líneas descartadas y los estados que no entiende— porque quien llama tiene que
 * poder contarlo en un evento. Una lectura que «funciona» tirando el 40 % de las
 * líneas es el fallo silencioso más caro que puede tener el censo.
 */
export function leerInformeListings(
  texto: string,
  opciones: OpcionesLectura = {}
): LecturaInforme {
  // ---------- El BOM (trampa 1) ----------
  // TextDecoder ya lo quita con su configuración por defecto, pero esta función
  // recibe una cadena y no sabe de dónde viene. Quitarlo dos veces no cuesta
  // nada; no quitarlo ninguna cuesta la primera columna.
  const limpio = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto

  const lineas = limpio.split(/\r?\n/)
  let i = 0
  while (i < lineas.length && lineas[i].trim() === '') i += 1
  if (i >= lineas.length) {
    throw new InformeIlegible(
      'El informe de Amazon ha llegado vacío: ni siquiera trae la fila de cabeceras.',
      []
    )
  }

  const cabeceras = lineas[i].split('\t').map((c) => c.trim())
  i += 1

  const { indice, via, ausentes } = resolverColumnas(cabeceras, opciones.alias ?? null)

  const filas: FilaCenso[] = []
  const estadosDesconocidos: Record<string, number> = {}
  let descartadas = 0

  const idx = (columna: ColumnaInforme): number | undefined => indice[columna]

  for (; i < lineas.length; i++) {
    const linea = lineas[i]
    if (linea.trim() === '') continue

    const celdas = linea.split('\t')
    const sku = celda(celdas, idx('seller-sku'))
    if (!sku) {
      // Una línea sin SKU no es una línea del catálogo. Se cuenta en vez de
      // ignorarse: si aparecen muchas, el mapa de columnas está mal.
      descartadas += 1
      continue
    }

    const estadoCrudo = celda(celdas, idx('status'))
    const estado = estadoDelInforme(estadoCrudo)
    if (estadoCrudo !== null && estado === undefined) {
      estadosDesconocidos[estadoCrudo] = (estadosDesconocidos[estadoCrudo] ?? 0) + 1
    }

    filas.push({
      sku,
      asin: celda(celdas, idx('asin1')),
      titulo: celda(celdas, idx('item-name')),
      precio: numeroDelInforme(celda(celdas, idx('price'))),
      cantidad: enteroDelInforme(celda(celdas, idx('quantity'))),
      pendiente: enteroDelInforme(celda(celdas, idx('pending-quantity'))),
      canal: celda(celdas, idx('fulfillment-channel')),
      estadoCrudo,
      estado,
      codigoExterno: celda(celdas, idx('product-id')),
      codigoExternoTipo: tipoDeCodigo(celda(celdas, idx('product-id-type'))),
    })
  }

  return { filas, via, cabeceras, ausentes, descartadas, estadosDesconocidos }
}

/* ------------------------------------------------------------------ */
/* El mapa de columnas                                                 */
/* ------------------------------------------------------------------ */

interface MapaColumnas {
  indice: Partial<Record<ColumnaInforme, number>>
  via: ViaCabecera
  ausentes: ColumnaInforme[]
}

/**
 * Resuelve dónde está cada columna: por nombre si se reconoce, por posición si
 * no.
 *
 * El criterio para dar por buena la vía de los nombres es que aparezca
 * `seller-sku`. Si esa no está, no hay nada que hacer con los nombres y se pasa
 * a la posición; y si la posición tampoco encaja —porque el número de columnas
 * no es el documentado— se revienta con la cabecera entera en el mensaje, que es
 * lo único que permite arreglarlo sin acceso a la cuenta.
 */
function resolverColumnas(
  cabeceras: string[],
  alias: Record<string, string> | null
): MapaColumnas {
  const normalizadas = new Map<string, number>()
  cabeceras.forEach((c, n) => {
    const clave = normalizar(c)
    // La primera gana: si el informe repitiera una cabecera, quedarse con la
    // primera es lo mismo que hace cualquier lector de TSV.
    if (clave !== '' && !normalizadas.has(clave)) normalizadas.set(clave, n)
  })

  const indice: Partial<Record<ColumnaInforme, number>> = {}

  for (const columna of COLUMNAS_USADAS) {
    // 1) Alias puesto a mano en los parámetros del trabajo. Manda sobre todo lo
    //    demás: existe justamente para arreglar lo que este código no adivina.
    const puesto = alias?.[columna]
    if (puesto) {
      const n = normalizadas.get(normalizar(puesto))
      if (n !== undefined) {
        indice[columna] = n
        continue
      }
    }

    // 2) El nombre canónico en inglés.
    const directo = normalizadas.get(normalizar(columna))
    if (directo !== undefined) {
      indice[columna] = directo
      continue
    }

    // 3) Sinónimos conocidos.
    for (const sinonimo of SINONIMOS[columna] ?? []) {
      const n = normalizadas.get(normalizar(sinonimo))
      if (n !== undefined) {
        indice[columna] = n
        break
      }
    }
  }

  if (indice[COLUMNA_IMPRESCINDIBLE] !== undefined) {
    return { indice, via: 'nombres', ausentes: faltantes(indice) }
  }

  // ---------- Vía de respaldo: la posición (trampa 2) ----------
  if (cabeceras.length !== COLUMNAS_INFORME_LISTINGS.length) {
    throw new InformeIlegible(
      `No se entiende la cabecera del informe de Amazon. No aparece la columna «${COLUMNA_IMPRESCINDIBLE}» ` +
        `y tampoco se puede leer por posición, porque el fichero trae ${cabeceras.length} columnas y el ` +
        `informe documentado tiene ${COLUMNAS_INFORME_LISTINGS.length}. Cabeceras recibidas: ` +
        cabeceras.slice(0, 40).join(' | '),
      cabeceras
    )
  }

  const porPosicion: Partial<Record<ColumnaInforme, number>> = {}
  COLUMNAS_INFORME_LISTINGS.forEach((columna, n) => {
    if (COLUMNAS_USADAS.includes(columna)) porPosicion[columna] = n
  })
  return { indice: porPosicion, via: 'posicion', ausentes: [] }
}

function faltantes(indice: Partial<Record<ColumnaInforme, number>>): ColumnaInforme[] {
  return COLUMNAS_USADAS.filter((c) => indice[c] === undefined)
}

/** Minúsculas, sin acentos y con cualquier separador convertido en guion */
function normalizar(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // Los diacríticos sueltos que deja NFD. Es lo que hace que «cantidad» y
    // «Cantidád» sean la misma cabecera.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function celda(celdas: string[], n: number | undefined): string | null {
  if (n === undefined) return null
  const v = celdas[n]
  if (v === undefined) return null
  const limpio = v.trim()
  return limpio === '' ? null : limpio
}

/* ------------------------------------------------------------------ */
/* Números (trampa 3)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Un número del informe, venga con punto o con coma decimal.
 *
 * La regla es la única que funciona sin saber el país: EL ÚLTIMO SEPARADOR QUE
 * APARECE ES EL DECIMAL, y todos los anteriores son de millares. Con «1.234,56»
 * y con «1,234.56» da lo mismo, y con «14,99» —el caso español, que es el que
 * importa hoy— da 14,99 en vez de NaN.
 *
 * Un valor sin separadores («1234») se lee tal cual. Los símbolos de moneda y
 * los espacios se quitan: el informe no debería traerlos, pero costaba una línea.
 */
export function numeroDelInforme(valor: string | null): number | null {
  if (valor === null) return null
  const bruto = valor.replace(/[^\d.,-]/g, '').trim()
  if (bruto === '' || bruto === '-') return null

  const ultimoPunto = bruto.lastIndexOf('.')
  const ultimaComa = bruto.lastIndexOf(',')

  let normalizado: string
  if (ultimoPunto === -1 && ultimaComa === -1) {
    normalizado = bruto
  } else if (ultimaComa > ultimoPunto) {
    normalizado = bruto.replace(/\./g, '').replace(',', '.')
  } else {
    normalizado = bruto.replace(/,/g, '')
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Lo mismo pero entero. Una cantidad con decimales es un dato roto, no un 3,7 */
export function enteroDelInforme(valor: string | null): number | null {
  const n = numeroDelInforme(valor)
  if (n === null) return null
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

/* ------------------------------------------------------------------ */
/* Estado del listing (trampa 4)                                       */
/* ------------------------------------------------------------------ */

/**
 * Traduce el `status` del informe al vocabulario de la Listings API.
 *
 * El informe distingue tres cosas y la API distingue banderas. Lo único que
 * usamos de verdad es si está a la venta (BUYABLE), y eso sí se puede traducir
 * sin inventar nada.
 *
 * DEVUELVE `undefined` PARA LO QUE NO RECONOCE, y esa es la parte importante:
 * quien escribe la fila tiene que dejar la columna COMO ESTABA en vez de poner
 * un array vacío. Un array vacío significa «no está a la venta», y aplicarlo a
 * un catálogo entero porque la cabecera vino en un idioma raro dejaría a ese
 * cliente sin ningún SKU en seguimiento.
 */
export function estadoDelInforme(valor: string | null): string[] | undefined {
  if (valor === null) return undefined
  const v = normalizar(valor)
  if (v === 'active' || v === 'activo' || v === 'actif' || v === 'aktiv' || v === 'attivo') {
    return ['BUYABLE']
  }
  if (
    v === 'inactive' ||
    v === 'inactivo' ||
    v === 'incomplete' ||
    v === 'incompleto' ||
    v === 'inactif' ||
    v === 'incomplet'
  ) {
    return []
  }
  return undefined
}

/* ------------------------------------------------------------------ */
/* Tipo de identificador externo                                       */
/* ------------------------------------------------------------------ */

/**
 * `product-id-type` viene como un número en el informe. Se traduce a algo
 * legible y, si el código no está en la tabla, SE GUARDA CRUDO en vez de
 * perderse: un identificador con tipo «7» es investigable; uno con tipo null, no.
 */
const TIPOS_DE_CODIGO: Record<string, string> = {
  '1': 'ASIN',
  '2': 'ISBN',
  '3': 'UPC',
  '4': 'EAN',
}

export function tipoDeCodigo(valor: string | null): string | null {
  if (valor === null) return null
  return TIPOS_DE_CODIGO[valor] ?? valor
}
