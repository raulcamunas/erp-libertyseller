import {
  AMAZON_SUBMISSION_STATUS_HINTS,
  canEditPrice,
  canEditQuantity,
  isMfnChannel,
  marketplacesForRegion,
  pendingChangeKey,
  resolveMarketplace,
  type AmazonConnection,
  type AmazonListing,
  type AmazonPendingChange,
  type AmazonSubmission,
  type AmazonSubmissionField,
} from '@/lib/types/amazon'

/**
 * EL MOTOR DE LA PANTALLA DE CATÁLOGO — PURO
 * ==========================================
 * Sin React, sin `fetch`, sin Supabase. Mismo reparto que en Sincronismo de
 * stock, donde lib/stock-sync/engine.ts hace el cruce y lib/stock-sync/api.ts
 * habla con la base: lo que decide algo se puede probar en tres líneas y lo que
 * tiene efectos se queda fuera.
 *
 * AQUÍ VIVEN LAS TRES COSAS QUE NO PUEDEN ESTAR DENTRO DE UN COMPONENTE:
 *
 *   1. LEER UN NÚMERO ESCRITO A MANO (parsePrecio / parseCantidad). Es la
 *      frontera por la que entra el error caro del módulo: un «1499» donde se
 *      quería «14,99» acaba en la tienda de un cliente. Se valida ANTES de que
 *      el valor entre en la lista de pendientes, y lo que no pasa por aquí no
 *      llega a Amazon.
 *
 *   2. QUÉ PASA CUANDO EL REFRESCO PISA UNA EDICIÓN A MEDIAS (mergeRefresh).
 *      Es la decisión E del módulo y está explicada entera ahí abajo.
 *
 *   3. QUÉ SE PINTA EN CADA CELDA (cellState). Una celda puede estar mostrando
 *      el valor de Amazon, una edición sin enviar, o un cambio que ya salió y
 *      todavía no consta aplicado. Son tres cosas distintas y confundirlas es
 *      lo que hace que alguien mande dos veces el mismo cambio.
 */

/* ------------------------------------------------------------------ */
/* Leer números escritos a mano                                        */
/* ------------------------------------------------------------------ */

/**
 * Tope de precio. No es el de Amazon —cada categoría tiene el suyo y solo él
 * los conoce— sino un cortafuegos contra el error de tecleo: nadie de la
 * agencia va a poner a la venta nada por encima de esto, y un dedo de más en el
 * teclado numérico se para aquí en vez de en la tienda del cliente.
 */
export const MAX_PRICE = 999_999.99

/** Lo mismo para las unidades. Un stock de siete cifras es un dedo pegado */
export const MAX_QUANTITY = 999_999

/**
 * A partir de qué salto se avisa en la pantalla de revisión.
 *
 * Tres veces arriba o abajo. No bloquea —hay rebajas de verdad y hay productos
 * que se reponen de golpe— pero sale marcado en la lista de lo que va a salir,
 * que es el último sitio donde se puede parar. El caso que persigue es el
 * clásico: el punto decimal en el sitio equivocado, que da exactamente un
 * factor 10 o 100.
 */
export const BIG_JUMP_RATIO = 3

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

/**
 * Precio tal y como lo teclea una persona en España: «14,99», «14.99», «1 499,90».
 *
 * Se aceptan las dos separaciones decimales a propósito. El teclado numérico de
 * muchos portátiles mete un punto y la costumbre de aquí es la coma: rechazar
 * una de las dos solo consigue que se escriba dos veces.
 */
export function parsePrecio(text: string): ParseResult {
  const limpio = text.trim().replace(/[€$£\s]/g, '')
  if (limpio === '') return { ok: false, error: 'Escribe un precio' }

  /*
   * QUÉ SEPARADOR ES EL DECIMAL. No se asume: se mira.
   *
   * La regla vieja era «si hay una coma, es la coma decimal», y con eso
   * «1,499.90» —el formato que sale de cualquier export de Amazon o de una hoja
   * en inglés, que es justo de donde se copian los precios— se leía como
   * 1,49990 y salía 1,50 € hacia la tienda del cliente. Mil veces más barato,
   * sin ningún error, y el aviso de salto grande de la pantalla de revisión
   * solo lo caza si el precio anterior estaba lejos.
   *
   * La regla buena: EL ÚLTIMO SEPARADOR ES EL DECIMAL y el otro es el de
   * millares. Vale para los dos mundos sin tener que preguntar.
   */
  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')

  let normalizado: string
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    normalizado =
      ultimaComa > ultimoPunto
        ? limpio.replace(/\./g, '').replace(',', '.') // 1.499,90 -> 1499.90
        : limpio.replace(/,/g, '') //                    1,499.90 -> 1499.90
  } else if (ultimaComa >= 0) {
    // Una coma sola seguida de TRES dígitos exactos es de verdad ambigua:
    // «1,499» es 1499 en inglés y 1,499 en español. Como un precio no tiene
    // tres decimales, lo que casi seguro se quería es lo primero — pero
    // «casi seguro» no basta para mandarlo a la tienda de un cliente, así que
    // se pregunta en vez de elegir.
    if (/^\d+,\d{3}$/.test(limpio)) {
      return {
        ok: false,
        error: 'No se sabe si eso son mil y pico o una coma decimal. Escríbelo como 1499,00 o como 1,50',
      }
    }
    normalizado = limpio.replace(',', '.')
  } else {
    normalizado = limpio
  }

  if (!/^\d+(\.\d+)?$/.test(normalizado)) {
    return { ok: false, error: 'Eso no es un precio. Escribe algo como 14,99' }
  }

  const n = Number(normalizado)
  if (!Number.isFinite(n)) return { ok: false, error: 'Eso no es un precio' }
  if (n <= 0) return { ok: false, error: 'El precio tiene que ser mayor que cero' }
  if (n > MAX_PRICE) {
    return { ok: false, error: `Un precio por encima de ${MAX_PRICE} no se envía: repásalo` }
  }

  // Amazon trabaja a dos decimales. Redondear aquí y no al enviar hace que lo
  // que se ve en la pantalla de revisión sea exactamente lo que va a salir.
  return { ok: true, value: Math.round(n * 100) / 100 }
}

/** Unidades: entero, cero incluido. Cero es un valor legítimo —es «agotado» */
export function parseCantidad(text: string): ParseResult {
  const limpio = text.trim().replace(/\s/g, '')
  if (limpio === '') return { ok: false, error: 'Escribe una cantidad' }

  // El punto se quita SOLO si de verdad separa millares, o sea si lo que va
  // detrás son grupos de tres cifras. Antes se borraban todos los puntos a
  // secas y «12.5» se convertía en 125: diez veces más stock del que se quería,
  // sin ningún aviso. Ahora «12.5» no cuela y se dice por qué.
  const sinMillares = /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, '') : limpio

  if (!/^\d+$/.test(sinMillares)) {
    return { ok: false, error: 'El stock son unidades enteras: 0, 12, 340…' }
  }

  const n = Number(sinMillares)
  if (!Number.isFinite(n)) return { ok: false, error: 'Eso no es una cantidad' }
  if (n > MAX_QUANTITY) {
    return { ok: false, error: `Un stock por encima de ${MAX_QUANTITY} no se envía: repásalo` }
  }
  return { ok: true, value: n }
}

export function parseCampo(field: AmazonSubmissionField, text: string): ParseResult {
  return field === 'precio' ? parsePrecio(text) : parseCantidad(text)
}

/**
 * ¿Es un salto lo bastante grande como para avisar?
 *
 * Solo tiene sentido con un valor anterior conocido y distinto de cero: contra
 * un precio que no existía todavía no hay nada con lo que comparar, y dividir
 * por cero daría infinito y marcaría de sospechoso todo lo que sale de un
 * agotado.
 */
export function isBigJump(previous: number | null, next: number): boolean {
  if (previous === null || previous === 0) return false
  const ratio = next / previous
  return ratio >= BIG_JUMP_RATIO || ratio <= 1 / BIG_JUMP_RATIO
}

/* ------------------------------------------------------------------ */
/* Formato                                                             */
/* ------------------------------------------------------------------ */

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  PLN: 'zł',
  SEK: 'kr',
  TRY: '₺',
}

/**
 * Precio para pantalla: «14,99 €», «1.499,90 €».
 *
 * EL SÍMBOLO SE PEGA A MANO en vez de usar Intl con `style: 'currency'`, y no
 * es por gusto: ese modo LANZA una excepción con un código de divisa que no
 * reconoce. La divisa aquí no la elegimos nosotros —viene de lo que devuelva
 * Amazon para ese listing— así que un país nuevo o un dato raro tumbaría la
 * tabla entera en vez de pintar una celda fea. Lo que no está en la tabla de
 * arriba sale con su código de tres letras detrás, que se lee perfectamente.
 *
 * El agrupamiento de millares sí lo hace la configuración regional, y en
 * español NO agrupa los números de cuatro cifras: «1499,90», pero «14.999,90».
 * Es lo correcto en es-ES y conviene saberlo antes de «arreglarlo».
 */
export function formatPrecio(value: number | null, currency: string | null): string {
  if (value === null) return '—'
  const numero = value.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (!currency) return numero
  return `${numero} ${CURRENCY_SYMBOLS[currency] ?? currency}`
}

export function formatCantidad(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('es-ES')
}

/** El valor de un campo, ya formateado, para la lista de revisión y el historial */
export function formatCampo(
  field: AmazonSubmissionField,
  value: number | null,
  currency: string | null
): string {
  return field === 'precio' ? formatPrecio(value, currency) : formatCantidad(value)
}

/**
 * Los valores del historial son TEXT en la base (ver el comentario de
 * previous_value en la migración 118: se guarda como texto para que un futuro
 * cambio de título entre sin migrar la tabla). Aquí se vuelven número solo para
 * pintarlos, y lo que no lo sea se enseña tal cual en vez de como «—».
 */
export function formatValorGuardado(
  field: AmazonSubmissionField,
  raw: string | null,
  currency: string | null
): string {
  if (raw === null || raw.trim() === '') return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return formatCampo(field, n, currency)
}

/* ------------------------------------------------------------------ */
/* Lectura de una línea del catálogo                                   */
/* ------------------------------------------------------------------ */

/**
 * El stock que significa algo en esta línea.
 *
 * En un producto del vendedor es `quantity`, que es la que se escribe. En un
 * FBA esa columna no dice nada —Amazon no la devuelve por ahí— y lo que cuenta
 * son las unidades vendibles que hay en sus almacenes. Confundirlas hace que un
 * FBA con 400 unidades salga listado como agotado.
 */
export function stockEfectivo(listing: AmazonListing): number | null {
  if (listing.is_fba) {
    return listing.fba_fulfillable_quantity ?? listing.fba_quantity
  }
  return listing.quantity
}

/** El valor que Amazon nos dice que tiene hoy este campo */
export function valorActual(
  listing: AmazonListing,
  field: AmazonSubmissionField
): number | null {
  return field === 'precio' ? listing.price : stockEfectivo(listing)
}

export function puedeEditar(listing: AmazonListing, field: AmazonSubmissionField): boolean {
  return field === 'precio' ? canEditPrice(listing) : canEditQuantity(listing)
}

/* ------------------------------------------------------------------ */
/* Sobre qué países se puede trabajar                                  */
/* ------------------------------------------------------------------ */

/**
 * Los marketplaces de una conexión.
 *
 * Normalmente es la lista que devolvió Amazon al autorizar. Pero esa lista
 * PUEDE ESTAR VACÍA: se rellena llamando a getMarketplaceParticipations, que es
 * una operación lenta y que puede fallar, y hasta el siguiente refresco la
 * conexión existe sin saber en qué países vende el cliente.
 *
 * En ese hueco se cae a los marketplaces de su REGIÓN, que es lo que la
 * autorización cubre de verdad: un refresh token europeo vale para España,
 * Francia, Italia y Alemania, participe el vendedor o no. Sin esta caída, una
 * conexión recién autorizada se queda sin ningún país válido, la pantalla no
 * puede pedir su catálogo y lo único que se ve es un cargador girando para
 * siempre.
 *
 * Leer un país en el que el cliente no vende no rompe nada: devuelve cero
 * líneas. Y sin líneas no hay nada que editar, así que tampoco se puede
 * escribir donde no toca.
 */
export function marketplacesCubiertos(
  conn: Pick<AmazonConnection, 'marketplace_ids' | 'region'>
): string[] {
  if (conn.marketplace_ids.length > 0) return conn.marketplace_ids
  return marketplacesForRegion(conn.region).map((m) => m.id)
}

/** Con qué país se abre el catálogo de una conexión */
export function marketplaceDeEntrada(
  conn: Pick<AmazonConnection, 'marketplace_ids' | 'region' | 'default_marketplace_id'>
): string | null {
  return resolveMarketplace(conn) ?? marketplacesCubiertos(conn)[0] ?? null
}

/** Etiquetas de los estados que devuelve Amazon en summaries[].status */
export const LISTING_STATUS_LABELS: Record<string, string> = {
  BUYABLE: 'A la venta',
  DISCOVERABLE: 'Visible',
}

export function listingStatusLabel(raw: string): string {
  return LISTING_STATUS_LABELS[raw] ?? raw
}

/**
 * «Vendedor», «Amazon (FBA)» o «Sin determinar»: es lo que decide si el stock
 * se puede tocar, así que la tercera opción NO se puede disimular como una de
 * las otras dos.
 *
 * Antes un canal desconocido (Amazon no siempre devuelve
 * fulfillmentAvailability) se pintaba «Vendedor», que es exactamente la
 * respuesta que hace que alguien teclee unidades sobre un producto que a lo
 * mejor gestiona Amazon.
 */
export function canalLabel(listing: AmazonListing): string {
  if (isMfnChannel(listing.fulfillment_channel_code)) return 'Vendedor'
  if (listing.fulfillment_channel_code) return 'Amazon (FBA)'
  return 'Sin determinar'
}

/* ------------------------------------------------------------------ */
/* Buscador y filtros                                                  */
/* ------------------------------------------------------------------ */

export type CatalogFilter = 'sin-stock' | 'sin-precio' | 'fba' | 'mfn' | 'editados'

export const CATALOG_FILTER_LABELS: Record<CatalogFilter, string> = {
  'sin-stock': 'Sin stock',
  'sin-precio': 'Sin precio',
  fba: 'Solo FBA',
  mfn: 'Solo del vendedor',
  editados: 'Con cambios sin enviar',
}

export const CATALOG_FILTER_HINTS: Record<CatalogFilter, string> = {
  'sin-stock': 'Cero unidades, o ninguna cantidad publicada',
  'sin-precio': 'El listing existe pero no tiene precio puesto',
  fba: 'Los gestiona Amazon: su stock no se toca desde aquí',
  mfn: 'Los gestiona el cliente: su stock sí se puede cambiar',
  editados: 'Lo que has tocado y todavía no ha salido',
}

export const CATALOG_FILTERS: CatalogFilter[] = [
  'sin-stock',
  'sin-precio',
  'fba',
  'mfn',
  'editados',
]

/**
 * Normaliza para buscar: sin mayúsculas y sin acentos.
 *
 * Sin quitar acentos, buscar «lampara» no encuentra «Lámpara», y en un catálogo
 * de dos mil títulos eso se lee como que el producto no está.
 */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    // El rango de los signos diacríticos que NFD acaba de separar. Escrito con
    // escapes y no con los caracteres a pelo: son combinantes, así que pegados
    // en el código se dibujarían encima del corchete y el rango sería
    // imposible de leer en una revisión.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export interface CatalogQuery {
  search: string
  filters: CatalogFilter[]
}

/**
 * Aplica buscador y filtros.
 *
 * Los filtros se acumulan (Y, no O): «sin stock» + «solo del vendedor» son los
 * agotados que se pueden reponer desde aquí, que es una pregunta real. La única
 * combinación que no devuelve nada nunca es FBA + vendedor, y se deja poner: la
 * lista vacía se explica sola y bloquearla obligaría a explicar por qué.
 */
export function filterListings(
  listings: AmazonListing[],
  query: CatalogQuery,
  pending: Map<string, AmazonPendingChange>
): AmazonListing[] {
  const term = normalizeSearch(query.search)
  const filtros = new Set(query.filters)
  if (term === '' && filtros.size === 0) return listings

  return listings.filter((l) => {
    if (term !== '') {
      const heno = normalizeSearch(`${l.sku} ${l.asin ?? ''} ${l.title ?? ''}`)
      if (!heno.includes(term)) return false
    }

    if (filtros.has('sin-stock')) {
      const stock = stockEfectivo(l)
      if (stock !== null && stock > 0) return false
    }
    if (filtros.has('sin-precio') && l.price !== null) return false
    // Los dos filtros de logística se resuelven contra el CANAL y no contra
    // `is_fba`, para que un listing sin canal conocido no se cuele en «solo del
    // vendedor»: ahí es donde alguien va a buscar qué stock puede tocar, y ese
    // no se puede.
    if (filtros.has('fba') && isMfnChannel(l.fulfillment_channel_code)) return false
    if (filtros.has('mfn') && !isMfnChannel(l.fulfillment_channel_code)) return false
    if (filtros.has('editados') && !tieneEdicion(l, pending)) return false

    return true
  })
}

function tieneEdicion(listing: AmazonListing, pending: Map<string, AmazonPendingChange>): boolean {
  const base = { marketplaceId: listing.marketplace_id, sku: listing.sku }
  return (
    pending.has(pendingChangeKey({ ...base, field: 'precio' })) ||
    pending.has(pendingChangeKey({ ...base, field: 'cantidad' }))
  )
}

/* ------------------------------------------------------------------ */
/* EL REFRESCO CONTRA LAS EDICIONES SIN ENVIAR (decisión E)            */
/* ------------------------------------------------------------------ */

/**
 * Una celda cuyo valor en Amazon HA CAMBIADO por debajo de una edición que
 * todavía no ha salido.
 *
 * `seenValue` es lo que la persona tenía delante cuando decidió el cambio, y
 * `currentValue` lo que hay ahora. Que sean distintos es justo el caso que hay
 * que enseñar: si alguien puso 12,99 mirando un 14,99 y mientras tanto el
 * precio se ha ido a 9,50, ese 12,99 ya no significa lo que significaba.
 */
export interface CatalogConflict {
  key: string
  sku: string
  marketplaceId: string
  field: AmazonSubmissionField
  /** Lo que se veía al editar */
  seenValue: number | null
  /** Lo que hay ahora en Amazon */
  currentValue: number | null
  /** Lo que se quiere escribir */
  newValue: number
}

export interface MergeRefreshResult {
  /** Ediciones que siguen teniendo sentido, con su clave */
  pending: Map<string, AmazonPendingChange>
  /** Ediciones cuya base se ha movido bajo los pies */
  conflicts: CatalogConflict[]
  /** Ediciones cuyo SKU ya no está en el catálogo: no se pueden enviar */
  gone: AmazonPendingChange[]
}

/**
 * CÓMO CONVIVEN UN REFRESCO Y LO QUE HAY A MEDIO ESCRIBIR.
 *
 * EL PROBLEMA. Cada quince minutos entra una foto nueva del catálogo. Si se
 * pinta por encima sin más, se lleva por delante lo que alguien esté editando:
 * veinte precios tecleados a mano desaparecen porque una tarea de fondo eligió
 * ese momento. Y si NO se pinta nunca mientras haya algo pendiente, se acaba
 * enviando un precio calculado sobre datos de hace media hora.
 *
 * LO QUE NO SE HACE, Y POR QUÉ. La salida fácil es preguntar «hay datos nuevos,
 * ¿recargo?» y que la respuesta sea sí o no para toda la pantalla. Es una mala
 * pregunta: en un catálogo de dos mil líneas con tres editadas, «no» deja 1.997
 * líneas viejas por proteger tres, y «sí» tira las tres para actualizar 1.997
 * que no le importaban a nadie. Nadie puede responder eso bien.
 *
 * LO QUE SE HACE. El conflicto no es de la pantalla, es DE CADA CELDA:
 *
 *   - Toda línea SIN edición pendiente se actualiza. Siempre, sin preguntar.
 *     Ahí no hay nada que perder y sí mucho que ganar.
 *
 *   - Toda edición pendiente SE CONSERVA. El refresco jamás borra lo tecleado:
 *     lo que se escribió está por escribirse, no por leerse.
 *
 *   - Y cuando el valor de Amazon se ha movido justo debajo de una edición
 *     pendiente, eso se marca como CONFLICTO. La celda lo enseña, y la lista de
 *     «Enviar cambios» lo saca con su aviso: «cuando lo escribiste ponía X,
 *     ahora pone Y». Nada se decide por la persona; se le pone delante lo único
 *     que no podía saber.
 *
 *   - Si el SKU ha desaparecido del catálogo, la edición no se puede enviar y
 *     se retira, diciéndolo.
 *
 * Así el refresco nunca pisa una edición, la edición nunca congela el catálogo,
 * y lo único que se pregunta es lo que de verdad hay que preguntar.
 *
 * Y QUIÉN DECIDE CUÁNDO SE APLICA ESTO. Dos casos, y son distintos a propósito:
 *
 *   - El refresco AUTOMÁTICO, el de cada quince minutos, no lo ha pedido nadie.
 *     Si hay ediciones sin enviar, no toca la pantalla: avisa de que hay datos
 *     nuevos, dice cuántas líneas se han movido y cuántas de ellas tocan algo
 *     tuyo, y espera. Es la decisión E del módulo, literal.
 *
 *   - El BOTÓN de refrescar sí lo ha pedido alguien. Ahí se aplica en el acto,
 *     conservando las ediciones y marcando los conflictos. Volver a preguntar
 *     a quien acaba de pulsar «refrescar» si quiere refrescar es de las cosas
 *     que enseñan a la gente a pulsar «sí» sin leer.
 *
 * Esta función NO decide qué se pinta: las líneas nuevas mandan siempre. Decide
 * qué pasa con las EDICIONES, que es lo que no se puede recalcular.
 */
export function mergeRefresh(params: {
  fresh: AmazonListing[]
  pending: Iterable<AmazonPendingChange>
}): MergeRefreshResult {
  const porClave = new Map(params.fresh.map((l) => [`${l.marketplace_id}|${l.sku}`, l]))
  const mercadosLeidos = new Set(params.fresh.map((l) => l.marketplace_id))

  const pending = new Map<string, AmazonPendingChange>()
  const conflicts: CatalogConflict[] = []
  const gone: AmazonPendingChange[] = []

  for (const change of params.pending) {
    const listing = porClave.get(`${change.marketplaceId}|${change.sku}`)

    // Ojo: que un SKU no esté en `fresh` solo significa que no está en ESTA
    // foto. Quien llama pasa el catálogo del marketplace que acaba de leer, así
    // que una edición de otro marketplace no aparecería aquí y no debe darse
    // por perdida. Por eso se comprueba el marketplace antes de descartar.
    if (!listing) {
      if (mercadosLeidos.has(change.marketplaceId)) gone.push(change)
      else pending.set(pendingChangeKey(change), change)
      continue
    }

    const clave = pendingChangeKey(change)
    pending.set(clave, change)

    const ahora = valorActual(listing, change.field)
    if (!mismoValor(ahora, change.previousValue, change.field)) {
      conflicts.push({
        key: clave,
        sku: change.sku,
        marketplaceId: change.marketplaceId,
        field: change.field,
        seenValue: change.previousValue,
        currentValue: ahora,
        newValue: change.newValue,
      })
    }
  }

  return { pending, conflicts, gone }
}

/**
 * Qué trae de nuevo un refresco que todavía no se ha aplicado.
 *
 * Existe para que el aviso diga algo. «Hay datos nuevos» no permite decidir
 * nada: si son doce líneas y dos de ellas son justo las que estás editando, eso
 * sí. Y si el barrido no ha movido ni una fila —que es lo normal cuando se
 * refresca dos veces seguidas— no hay nada que avisar y el aviso ni sale.
 */
export interface RefreshPreview {
  /** Líneas cuyo precio o stock ha cambiado */
  changed: number
  /** SKU que antes no estaban */
  added: number
  /** SKU que ya no están */
  removed: number
  /** De las que han cambiado, cuántas tienen una edición sin enviar encima */
  touchesEdited: number
}

export function previewRefresh(params: {
  current: AmazonListing[]
  fresh: AmazonListing[]
  pending: Map<string, AmazonPendingChange>
}): RefreshPreview {
  const antes = new Map(params.current.map((l) => [`${l.marketplace_id}|${l.sku}`, l]))
  const out: RefreshPreview = { changed: 0, added: 0, removed: 0, touchesEdited: 0 }

  const vistos = new Set<string>()
  for (const nuevo of params.fresh) {
    const clave = `${nuevo.marketplace_id}|${nuevo.sku}`
    vistos.add(clave)
    const viejo = antes.get(clave)
    if (!viejo) {
      out.added += 1
      continue
    }
    const precioCambia = !mismoValor(viejo.price, nuevo.price, 'precio')
    const stockCambia = !mismoValor(stockEfectivo(viejo), stockEfectivo(nuevo), 'cantidad')
    if (precioCambia || stockCambia) {
      out.changed += 1
      if (tieneEdicion(nuevo, params.pending)) out.touchesEdited += 1
    }
  }

  for (const clave of antes.keys()) {
    if (!vistos.has(clave)) out.removed += 1
  }

  return out
}

/** ¿Merece la pena avisar de este refresco? */
export function hayNovedades(p: RefreshPreview): boolean {
  return p.changed > 0 || p.added > 0 || p.removed > 0
}

/**
 * Compara dos valores del mismo campo.
 *
 * Con margen en los precios: Amazon devuelve importes como texto y un 14.99
 * puede volver como 14.990. Sin el margen, cada refresco marcaría de conflicto
 * cualquier precio con decimales y el aviso dejaría de significar nada — que es
 * la forma más rápida de que la gente deje de leerlo.
 */
export const PRICE_EPSILON = 0.005

export function mismoValor(
  a: number | null,
  b: number | null,
  field: AmazonSubmissionField
): boolean {
  if (a === null || b === null) return a === b
  if (field === 'precio') return Math.abs(a - b) < PRICE_EPSILON
  return a === b
}

/* ------------------------------------------------------------------ */
/* Qué se pinta en cada celda                                          */
/* ------------------------------------------------------------------ */

/**
 * El último envío de cada celda que TODAVÍA NO CONSTA APLICADO.
 *
 * Lo confirmado se deja fuera a propósito: cuando un cambio pasa a
 * «confirmado» es porque el refresco ha vuelto a leer el listing y el valor
 * nuevo ya está en la columna que la celda pinta. Marcarlo además sería decir
 * dos veces lo mismo, y a los tres días la tabla entera estaría llena de avisos
 * de cambios viejos.
 *
 * `submissions` tiene que venir de la más reciente a la más antigua, que es
 * como sale de loadSubmissions(); se queda la primera de cada celda.
 */
export function lastSubmissionsByCell(
  submissions: AmazonSubmission[]
): Map<string, AmazonSubmission> {
  const out = new Map<string, AmazonSubmission>()
  for (const s of submissions) {
    if (s.status === 'confirmado') continue
    const clave = pendingChangeKey({
      marketplaceId: s.marketplace_id,
      sku: s.sku,
      field: s.field,
    })
    if (!out.has(clave)) out.set(clave, s)
  }
  return out
}

/**
 * Qué le pasó al último envío de esta celda, en una frase.
 *
 * EMPIEZA POR EL VALOR QUE SE MANDÓ, y eso es lo importante. Al terminar un
 * envío la tabla sigue pintando el valor VIEJO —y no puede hacer otra cosa: el
 * espejo no cambia hasta el siguiente barrido—, así que se acaban de mandar
 * veinte precios y la pantalla está idéntica a como estaba. Con un puntito al
 * lado cuyo `title` decía el estado pero no el número, la única forma de saber
 * qué había salido era abrir el historial y buscar el SKU. Con hasta quince
 * minutos hasta el refresco, ese hueco es justo donde alguien vuelve a teclear
 * el mismo cambio porque «no se ha aplicado».
 *
 * El mensaje de Amazon se pega detrás del estado porque es el que dice algo
 * accionable: «Rechazado» a secas manda a alguien a buscar el motivo a otra
 * pantalla, y el motivo está aquí mismo. Los mensajes vienen ya traducidos y
 * sin credenciales dentro desde lib/amazon/errors.ts.
 */
export function submissionStatusHint(s: AmazonSubmission): string {
  const base = AMAZON_SUBMISSION_STATUS_HINTS[s.status] ?? s.status
  const valor = formatValorGuardado(s.field, s.new_value, s.currency)
  // En lo que ha fallado, «se intentó»; en lo que ha salido, «se envió». La
  // diferencia importa: sobre lo primero se sabe que la tienda del cliente
  // sigue como estaba.
  const verbo = s.status === 'invalido' || s.status === 'error' ? 'Se intentó' : 'Se envió'
  const partes = [`${verbo} ${valor}`, base]
  if (s.error_message) partes.push(s.error_message)
  return `${partes.join('. ')}.`
}

export interface CellState {
  /** Lo que hay hoy en Amazon según el último refresco */
  current: number | null
  /** Lo tecleado y sin enviar, si hay algo */
  draft: number | null
  /** El valor que se veía al teclear. Solo importa si difiere de `current` */
  seen: number | null
  /** El valor de Amazon se ha movido por debajo de la edición */
  conflict: boolean
  /** Salió hacia Amazon y todavía no consta aplicado, o lo rechazaron */
  sent: AmazonSubmission | null
  editable: boolean
}

export function cellState(params: {
  listing: AmazonListing
  field: AmazonSubmissionField
  pending: Map<string, AmazonPendingChange>
  sent: Map<string, AmazonSubmission>
}): CellState {
  const { listing, field } = params
  const clave = pendingChangeKey({
    marketplaceId: listing.marketplace_id,
    sku: listing.sku,
    field,
  })
  const draft = params.pending.get(clave) ?? null
  const current = valorActual(listing, field)

  return {
    current,
    draft: draft?.newValue ?? null,
    seen: draft?.previousValue ?? null,
    conflict: draft !== null && !mismoValor(current, draft.previousValue, field),
    // Una edición sin enviar tapa la marca del envío anterior: lo que la
    // persona necesita ver de esa celda es lo que va a salir ahora.
    sent: draft === null ? (params.sent.get(clave) ?? null) : null,
    editable: puedeEditar(listing, field),
  }
}

/* ------------------------------------------------------------------ */
/* Ediciones pendientes                                                */
/* ------------------------------------------------------------------ */

/**
 * Registra una edición, o la retira si el valor tecleado es el que ya había.
 *
 * Lo segundo importa: escribir 14,99 encima de un 14,99 no es un cambio, y
 * dejarlo en la lista significaría mandar a Amazon una escritura que no hace
 * nada, gastando cupo y ensuciando el historial con una línea en la que el
 * valor anterior y el nuevo son iguales. Devuelve un Map NUEVO: el estado de
 * React no se muta en su sitio.
 */
export function setPendingChange(
  pending: Map<string, AmazonPendingChange>,
  listing: AmazonListing,
  field: AmazonSubmissionField,
  newValue: number
): Map<string, AmazonPendingChange> {
  const out = new Map(pending)
  const clave = pendingChangeKey({
    marketplaceId: listing.marketplace_id,
    sku: listing.sku,
    field,
  })
  const actual = valorActual(listing, field)

  if (mismoValor(actual, newValue, field)) {
    out.delete(clave)
    return out
  }

  out.set(clave, {
    listingId: listing.id,
    sku: listing.sku,
    marketplaceId: listing.marketplace_id,
    field,
    previousValue: actual,
    newValue,
    currency: field === 'precio' ? listing.currency : null,
  })
  return out
}

export function clearPendingChange(
  pending: Map<string, AmazonPendingChange>,
  key: string
): Map<string, AmazonPendingChange> {
  const out = new Map(pending)
  out.delete(key)
  return out
}

export function clearPendingChanges(
  pending: Map<string, AmazonPendingChange>,
  keys: Iterable<string>
): Map<string, AmazonPendingChange> {
  const out = new Map(pending)
  for (const k of keys) out.delete(k)
  return out
}

/**
 * Las ediciones ordenadas como se van a enseñar y a enviar: por marketplace y
 * dentro de él por SKU. Un orden estable hace que la lista de revisión no baile
 * entre que se abre y se manda, que es lo que hace dudar de si se ha colado
 * algo.
 */
export function sortPendingChanges(
  pending: Map<string, AmazonPendingChange>
): AmazonPendingChange[] {
  return Array.from(pending.values()).sort(
    (a, b) =>
      a.marketplaceId.localeCompare(b.marketplaceId) ||
      a.sku.localeCompare(b.sku, 'es') ||
      a.field.localeCompare(b.field)
  )
}

/** Cuántas ediciones hay en cada marketplace, para poder decirlo en pantalla */
export function pendingByMarketplace(
  pending: Map<string, AmazonPendingChange>
): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of pending.values()) {
    out.set(c.marketplaceId, (out.get(c.marketplaceId) ?? 0) + 1)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Validar un cambio que llega por la red                              */
/* ------------------------------------------------------------------ */

/**
 * Cambios como mucho por petición.
 *
 * Vive aquí y no en la ruta porque lo tienen que saber los dos: la pantalla
 * para partir el lote en tramos, y la ruta para rechazar lo que venga de más.
 * Con dos constantes, el día que alguien suba una la pantalla mandaría tramos
 * que el servidor rechaza enteros con un error que no le dice nada a nadie.
 *
 * A cinco cambios por segundo, veinticinco son unos cinco segundos: bastante
 * corto para que ningún proxy corte la petición por el camino y bastante largo
 * para que la barra de progreso no avance de una en una.
 */
export const MAX_CHANGES_PER_REQUEST = 25

/** Lo mínimo que hace falta para escribir un cambio en Amazon */
export interface IncomingChange {
  sku: string
  marketplaceId: string
  field: AmazonSubmissionField
  newValue: number
}

export type ChangeValidation =
  | { ok: true; change: IncomingChange }
  | { ok: false; error: string }

/**
 * Comprueba un cambio recibido por la red ANTES de que llegue a la tienda de un
 * cliente.
 *
 * POR QUÉ SE VALIDA DOS VECES. La pantalla ya comprueba cada número al
 * teclearlo, con parsePrecio y parseCantidad. Pero esa comprobación corre en el
 * navegador, y el navegador no es de fiar: quien llame a la ruta directamente
 * se salta la pantalla entera. Los topes son LOS MISMOS de arriba, importados y
 * no copiados, para que no puedan separarse.
 *
 * `marketplacePermitido` lo pone quien llama, porque solo el servidor sabe qué
 * países cubre la autorización de esa conexión. Es la comprobación que impide
 * que un identificador de país cambiado en la petición escriba un precio en una
 * tienda que este cliente no nos ha autorizado.
 */
export function validateIncomingChange(
  raw: unknown,
  marketplacePermitido: (id: string) => boolean
): ChangeValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Un cambio mal formado' }
  }
  const c = raw as Record<string, unknown>

  const sku = typeof c.sku === 'string' ? c.sku.trim() : ''
  if (sku === '') return { ok: false, error: 'Hay un cambio sin SKU' }
  if (sku.length > 400) {
    return { ok: false, error: `El SKU «${sku.slice(0, 40)}…» no es un SKU` }
  }

  const marketplaceId = typeof c.marketplaceId === 'string' ? c.marketplaceId.trim() : ''
  if (marketplaceId === '' || !marketplacePermitido(marketplaceId)) {
    return {
      ok: false,
      error: `El SKU ${sku} apunta a un país que este cliente no nos ha autorizado`,
    }
  }

  const field = c.field
  if (field !== 'precio' && field !== 'cantidad') {
    return { ok: false, error: `No se sabe qué se quiere cambiar del SKU ${sku}` }
  }

  // Se exige un número de verdad: un "12" en texto llegaría hasta Amazon como
  // texto y el rechazo saldría allí, sin poder decir aquí qué estaba mal.
  if (typeof c.newValue !== 'number' || !Number.isFinite(c.newValue)) {
    return { ok: false, error: `El valor del SKU ${sku} no es un número` }
  }
  const newValue = c.newValue

  if (field === 'precio') {
    if (newValue <= 0 || newValue > MAX_PRICE) {
      return { ok: false, error: `El precio del SKU ${sku} está fuera de lo que se puede enviar` }
    }
  } else if (!Number.isInteger(newValue) || newValue < 0 || newValue > MAX_QUANTITY) {
    return {
      ok: false,
      error: `El stock del SKU ${sku} tiene que ser un número entero de unidades`,
    }
  }

  return { ok: true, change: { sku, marketplaceId, field, newValue } }
}

/* ------------------------------------------------------------------ */
/* Frescura del espejo                                                 */
/* ------------------------------------------------------------------ */

/**
 * A partir de cuántos minutos sin refrescar se avisa.
 *
 * El ciclo son quince, así que veinte deja margen para que un barrido tarde
 * algo sin que salte el aviso, y sigue siendo lo bastante pronto como para
 * enterarse de que el cron no está corriendo ANTES de mandar un precio
 * calculado sobre un catálogo de ayer.
 */
export const STALE_MINUTES = 20

export type Frescura = 'fresco' | 'viejo' | 'nunca'

export function frescura(lastSyncAt: string | null, now: Date = new Date()): Frescura {
  if (!lastSyncAt) return 'nunca'
  const minutos = (now.getTime() - new Date(lastSyncAt).getTime()) / 60_000
  return minutos > STALE_MINUTES ? 'viejo' : 'fresco'
}
