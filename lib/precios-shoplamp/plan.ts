import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import {
  actuaElSuelo,
  DESTINOS,
  EXCLUIDOS,
  MERCADO_BASE,
  mismaDivisa,
  paisDe,
  precioDestino,
  subidaPct,
  type ReglaDestino,
} from './reglas'

/**
 * EL PLAN: qué precio tendría cada referencia si se aplicara la regla.
 * ====================================================================
 *
 * Esto NO envía nada. Lee el espejo del catálogo, empareja cada referencia de
 * Francia, Italia y Alemania con su gemela de España, aplica el recargo y
 * devuelve la lista entera —lo que cambia Y lo que no— para que se pueda mirar
 * antes de tocar la tienda de nadie.
 *
 *
 * ============ SE EMPAREJA POR SKU ============
 *
 * El SKU es del vendedor y es el mismo en todos sus marketplaces europeos: es lo
 * que Amazon usa para identificar la oferta y es por donde hay que escribir. El
 * ASIN no sirve de clave: una misma referencia puede tener ASIN distinto por
 * país, y dos SKU distintos pueden compartir ASIN.
 *
 * Lo que no case se APARTA, no se adivina. En este catálogo hay 553 referencias
 * que existen fuera y no en España: sin precio base no hay regla que aplicar.
 *
 *
 * ============ SOLO SHOPLAMP, Y SE CIERRA AQUÍ ============
 *
 * El cliente se resuelve por `slug` dentro de esta función y no llega por
 * parámetro. Es lo que hace que «SOLO para Shoplamp» no dependa de que la
 * pantalla mande el id correcto: aunque alguien llame a la ruta a mano con otro
 * cliente, aquí no hay por dónde colarlo.
 */

/** El slug de Shoplamp en amazon_clients. Es el ancla de todo el módulo */
export const SLUG_SHOPLAMP = 'shoplamp'

export type EstadoFila =
  /** Hay base, hay destino, y el precio que toca es distinto del que tiene */
  | 'cambia'
  /** Ya está en el precio que la regla manda. No se toca ni se gasta cupo */
  | 'ya_correcto'
  /** Existe fuera pero no en España: sin base no hay regla */
  | 'sin_base'
  /** Está en España pero su precio no sirve para calcular (vacío, cero) */
  | 'base_invalida'
  /**
   * ESTÁ EN ESPAÑA Y NO LO TENEMOS EN EL CATÁLOGO DE ESE PAÍS.
   *
   * Es el agujero que esta pantalla tenía y que no se veía. El plan se construía
   * recorriendo las referencias de FUERA y buscándoles su gemela española, así
   * que una referencia española SIN fila en Francia no producía ninguna línea:
   * no salía como pendiente, no salía como error, no salía. Simplemente no
   * existía, y 89 referencias se quedaban fuera del cálculo en silencio.
   *
   * Y OJO CON LO QUE SIGNIFICA, porque son dos cosas distintas y desde aquí no
   * se distinguen:
   *
   *   · o el cliente no vende esa referencia en ese país —legítimo, no hay nada
   *     que hacer—,
   *   · o SÍ la vende y nuestro espejo de ese país está incompleto.
   *
   * El segundo caso es real: el censo del catálogo solo corre sobre los
   * marketplaces marcados en `marketplaces_activos` (Amazon API · Cuentas), y si
   * un país no está marcado, su mitad del espejo se queda congelada el día que
   * se leyó por última vez. Por eso esta fila dice «no lo tenemos» y no «no está
   * publicado»: es lo único que sabemos de verdad.
   */
  | 'sin_listado'

export interface FilaPlan {
  sku: string
  marketplaceId: string
  pais: string
  asin: string | null
  titulo: string | null
  /** El precio de España, la base */
  base: number | null
  /** Lo que tiene ahora en ese país. null = no tiene precio puesto */
  actual: number | null
  /** Lo que tendría al aplicar la regla. null si no se puede calcular */
  destino: number | null
  /** Cuánto sube respecto a España, en % */
  subida: number | null
  recargo: number
  estado: EstadoFila
  /** Hace falta para poder mandar el PATCH */
  productType: string | null
  /**
   * El precio lo ha puesto el SUELO de 15 € y no el recargo: base + recargo no
   * llegaba. Es lo que distingue «de 1 € a 15 €» de «de 1 € a 7 €».
   */
  porSuelo: boolean
}

export interface PlanPrecios {
  /** Null si el cliente no está dado de alta o no tiene conexión */
  connectionId: string | null
  clienteNombre: string
  /** Cuándo se leyó por última vez el catálogo del que sale todo esto */
  catalogoAl: string | null
  filas: FilaPlan[]
  /** Cuántas referencias tiene España con precio: es la base de todo */
  referenciasBase: number
  mercadosExcluidos: typeof EXCLUIDOS
}

export interface FilaListing {
  sku: string
  asin: string | null
  title: string | null
  price: number | string | null
  marketplace_id: string
  product_type: string | null
  last_seen_at: string | null
}

const CAMPOS = 'sku, asin, title, price, marketplace_id, product_type, last_seen_at'

/**
 * El precio tal y como llega de PostgREST.
 *
 * `price` es NUMERIC en la base y PostgREST manda los NUMERIC como CADENA en
 * cuanto se salen de lo que un double representa sin perder nada. `Number('')`
 * es 0, que aquí sería un precio de cero euros: por eso se descarta la cadena
 * vacía antes de convertir.
 */
export function aNumero(v: number | string | null): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

async function listingsDe(connectionId: string, marketplaceId: string): Promise<FilaListing[]> {
  const service = createServiceClient()
  return fetchAll<FilaListing>((a, b) =>
    service
      .from('amazon_listings')
      .select(CAMPOS)
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      // El orden termina en columna única: `.range()` sobre un orden con empates
      // repite filas o se las salta entre tramos, y aquí una fila saltada es una
      // referencia que no se entera de que le cambia el precio.
      .order('sku', { ascending: true })
      .order('id')
      .range(a, b)
  )
}

/**
 * UNA FILA DEL PLAN. Pura: no toca la base de datos ni el reloj.
 *
 * Aquí está toda la lógica que merece prueba, y está fuera de `construirPlan`
 * justo por eso: se comprueba con listings inventados en
 * lib/precios-shoplamp/plan.prueba.ts, sin Supabase y sin red.
 */
export function construirFila(
  regla: ReglaDestino,
  enDestino: FilaListing,
  enEspana: FilaListing | undefined
): FilaPlan {
  const precioBase = enEspana ? aNumero(enEspana.price) : null
  const actual = aNumero(enDestino.price)
  const destino = precioDestino(precioBase, regla.recargoCentimos)

  let estado: EstadoFila
  if (!enEspana) estado = 'sin_base'
  else if (destino === null) estado = 'base_invalida'
  // Se compara en CÉNTIMOS: `35.99 !== 35.989999999999995` daría «cambia» en una
  // referencia que ya está bien, y se gastaría cupo de Amazon para mandar el
  // mismo número que ya tiene.
  else if (actual !== null && Math.round(actual * 100) === Math.round(destino * 100))
    estado = 'ya_correcto'
  else estado = 'cambia'

  return {
    sku: enDestino.sku,
    marketplaceId: regla.marketplaceId,
    pais: regla.pais,
    asin: enDestino.asin,
    // El título del país, y si allí no hay, el de España: es solo para
    // reconocer la referencia de un vistazo, no un dato que se publique.
    titulo: enDestino.title ?? enEspana?.title ?? null,
    base: precioBase,
    actual,
    destino,
    subida: precioBase !== null && destino !== null ? subidaPct(precioBase, destino) : null,
    recargo: regla.recargoCentimos / 100,
    estado,
    productType: enDestino.product_type,
    porSuelo: actuaElSuelo(precioBase, regla.recargoCentimos),
  }
}

export async function construirPlan(): Promise<PlanPrecios> {
  const service = createServiceClient()

  const { data: cliente } = await service
    .from('amazon_clients')
    .select('id, name')
    .eq('slug', SLUG_SHOPLAMP)
    .maybeSingle()

  if (!cliente) {
    return {
      connectionId: null,
      clienteNombre: 'Shoplamp',
      catalogoAl: null,
      filas: [],
      referenciasBase: 0,
      mercadosExcluidos: EXCLUIDOS,
    }
  }

  const { id: clienteId, name } = cliente as { id: string; name: string }

  // La conexión activa. Si hay varias —no debería— se coge la activa; sin
  // conexión no hay catálogo que leer ni tienda a la que escribir.
  const { data: conexiones } = await service
    .from('amazon_connections')
    .select('id, status, is_active')
    .eq('client_id', clienteId)
    .order('created_at', { ascending: true })

  const viva = ((conexiones ?? []) as Array<{ id: string; status: string; is_active: boolean }>).find(
    (c) => c.is_active && c.status === 'activa'
  )

  if (!viva) {
    return {
      connectionId: null,
      clienteNombre: name,
      catalogoAl: null,
      filas: [],
      referenciasBase: 0,
      mercadosExcluidos: EXCLUIDOS,
    }
  }

  // ---------- España y los tres destinos, a la vez ----------
  const [espana, ...porDestino] = await Promise.all([
    listingsDe(viva.id, MERCADO_BASE),
    ...DESTINOS.map((d) => listingsDe(viva.id, d.marketplaceId)),
  ])

  const base = new Map<string, FilaListing>()
  for (const l of espana) base.set(l.sku, l)

  const catalogoAl =
    espana.map((l) => l.last_seen_at).filter((x): x is string => Boolean(x)).sort().pop() ?? null

  const filas: FilaPlan[] = []

  DESTINOS.forEach((regla, i) => {
    // EL CORTAFUEGOS, otra vez y aquí. Un destino cuya divisa no sea la de la
    // base no entra en el plan ni para mirarlo: lo que no está en la lista no se
    // puede enviar por error desde ningún sitio.
    if (!mismaDivisa(regla.marketplaceId)) return

    const vistosAqui = new Set<string>()
    for (const l of porDestino[i]) {
      vistosAqui.add(l.sku)
      filas.push(construirFila(regla, l, base.get(l.sku)))
    }

    // LA OTRA MITAD, la que antes no se contaba: lo que está en España y no
    // tenemos en este país. Ver el comentario de 'sin_listado'.
    for (const [sku, esp] of base) {
      if (vistosAqui.has(sku)) continue
      const precioBase = aNumero(esp.price)
      filas.push({
        sku,
        marketplaceId: regla.marketplaceId,
        pais: regla.pais,
        asin: esp.asin,
        titulo: esp.title,
        base: precioBase,
        actual: null,
        // No se calcula precio: no hay a qué referencia aplicárselo. Poner aquí
        // base+7 sería ofrecer publicar en una ficha que no sabemos que exista.
        destino: null,
        subida: null,
        recargo: regla.recargoCentimos / 100,
        estado: 'sin_listado',
        productType: esp.product_type,
        // No se calcula precio, y por tanto el suelo no ha actuado.
        porSuelo: false,
      })
    }
  })

  return {
    connectionId: viva.id,
    clienteNombre: name,
    catalogoAl,
    filas: filas.sort(
      (a, b) => a.pais.localeCompare(b.pais) || a.sku.localeCompare(b.sku)
    ),
    referenciasBase: espana.filter((l) => aNumero(l.price) !== null).length,
    mercadosExcluidos: EXCLUIDOS,
  }
}

/** Lo que se enseña arriba: cuántas de cada cosa, por país */
export function resumir(filas: FilaPlan[]) {
  const porPais = new Map<
    string,
    {
      pais: string
      marketplaceId: string
      recargo: number
      cambia: number
      yaCorrecto: number
      sinBase: number
      baseInvalida: number
      sinListado: number
    }
  >()
  for (const f of filas) {
    const r =
      porPais.get(f.marketplaceId) ??
      {
        pais: f.pais,
        marketplaceId: f.marketplaceId,
        recargo: f.recargo,
        cambia: 0,
        yaCorrecto: 0,
        sinBase: 0,
        baseInvalida: 0,
        sinListado: 0,
      }
    if (f.estado === 'cambia') r.cambia += 1
    else if (f.estado === 'ya_correcto') r.yaCorrecto += 1
    else if (f.estado === 'sin_base') r.sinBase += 1
    else if (f.estado === 'sin_listado') r.sinListado += 1
    else r.baseInvalida += 1
    porPais.set(f.marketplaceId, r)
  }
  return [...porPais.values()].sort((a, b) => a.pais.localeCompare(b.pais))
}

export { paisDe }
