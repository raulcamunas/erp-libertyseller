/**
 * LO QUE SE LE PIDE A KEEPA PARA EL ANÁLISIS DE UN VENDEDOR (solo lectura en Keepa).
 *
 * Es el mismo recorrido que hacía la recogida del portátil (~/Dev/keepa-estudios/recoger.py), pasado al servidor:
 *   1. el vendedor en España con su escaparate                           ~10 tokens
 *   2. el mismo vendedor en FR, IT, DE y UK                              ~1 token por país
 *   3. sus productos por ventas (Product Finder, una variación por ficha) ~11 tokens
 *   4. los 20 mejores con stock, Buy Box y reseñas (sin históricos)       ~4 tokens cada uno
 *   5. la competencia: los que más venden en la categoría hoja de su producto estrella, sin los suyos (~11 + 3 por rival)
 * En total, entre 90 y 140 tokens por tienda.
 *
 * Keepa da los tokens a ritmo fijo (21 por minuto con el plan de ahora) y se acumulan una hora. Si falta saldo contesta 429: eso aquí
 * es `SinTokens` y la tienda se reintenta en la pasada siguiente, sin marcarla como fallida.
 */

const BASE = 'https://api.keepa.com/'
const TOP = 20
const PAISES = { fr: 4, it: 8, de: 3, uk: 2 } as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type K = any

export class SinTokens extends Error {
  constructor() {
    super('Keepa no tiene tokens ahora mismo')
  }
}

export type Saldo = { tokens: number; ritmo: number }

export type EstudioKeepa = {
  vendedorEs: K
  paises: Record<string, K | null>
  productos: { products: K[]; fecha: string }
  competencia: K
  gastado: number
  /** Keepa no conoce al vendedor o no tiene productos activos: no hay informe que hacer */
  sinDatos: boolean
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

async function pedir(clave: string, ruta: string): Promise<K> {
  const url = BASE + ruta + (ruta.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(clave)
  let ultimo = ''
  for (let intento = 0; intento < 3; intento++) {
    let r: Response
    try {
      r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(120_000) })
    } catch (e) {
      ultimo = (e as Error).name === 'TimeoutError' ? 'Keepa no ha contestado en 2 minutos' : 'sin conexión con Keepa'
      await new Promise((res) => setTimeout(res, 5_000))
      continue
    }
    if (r.status === 429) throw new SinTokens()
    if (r.ok) return r.json()
    // Nunca el cuerpo ni la URL en el error: la URL lleva la clave
    ultimo = `Keepa ha contestado HTTP ${r.status} en /${ruta.split('?')[0]}`
    if (r.status >= 400 && r.status < 500) break
    await new Promise((res) => setTimeout(res, 5_000))
  }
  throw new Error(ultimo)
}

/** Cuántos tokens quedan (esta pregunta no gasta) */
export async function saldoKeepa(clave: string): Promise<Saldo> {
  const d = await pedir(clave, 'token')
  return { tokens: Number(d.tokensLeft ?? 0), ritmo: Number(d.refillRate ?? 0) }
}

const finder = (seleccion: object) => 'query?domain=9&selection=' + encodeURIComponent(JSON.stringify(seleccion))

export async function estudiarVendedor(clave: string, sellerId: string): Promise<EstudioKeepa> {
  let gastado = 0
  const fecha = hoy()
  const anotar = (d: K) => {
    gastado += Number(d?.tokensConsumed ?? 0)
    return d
  }

  const vendedorEs = anotar(await pedir(clave, `seller?domain=9&seller=${sellerId}&storefront=1`))
  const s = vendedorEs?.sellers?.[sellerId]
  const vacio = { products: [] as K[], fecha }
  if (!s) return { vendedorEs, paises: {}, productos: vacio, competencia: { ...vacio, nota: 'Keepa no conoce a este vendedor' }, gastado, sinDatos: true }

  const paises: Record<string, K | null> = {}
  for (const [p, dom] of Object.entries(PAISES)) {
    const d = anotar(await pedir(clave, `seller?domain=${dom}&seller=${sellerId}`))
    paises[p] = d?.sellers?.[sellerId] ?? null
  }

  let top: string[] = []
  try {
    const d = anotar(
      await pedir(clave, finder({ sellerIds: [sellerId], current_SALES_gte: 1, singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 })),
    )
    top = d?.asinList ?? []
  } catch (e) {
    if (e instanceof SinTokens) throw e
  }
  // El buscador no los tiene todos: se completa con el escaparate
  if (top.length < TOP) top = [...top, ...((s.asinList ?? []) as string[]).filter((a) => !top.includes(a))]
  top = top.slice(0, TOP)

  const productos: K[] = []
  for (let i = 0; i < top.length; i += 10) {
    const d = anotar(await pedir(clave, `product?domain=9&asin=${top.slice(i, i + 10).join(',')}&stats=90&buybox=1&rating=1&history=0`))
    productos.push(...(d?.products ?? []))
  }
  if (!productos.length) return { vendedorEs, paises, productos: vacio, competencia: { ...vacio }, gastado, sinDatos: true }

  // La competencia: los que más venden en la categoría hoja de su producto estrella (el de mejor ranking), sin los suyos
  const rango = (p: K) => Number(p?.stats?.current?.[3] ?? 0)
  const conRango = productos.filter((p) => rango(p) > 0)
  const estrella = conRango.length ? conRango.reduce((a, b) => (rango(b) < rango(a) ? b : a)) : null
  const competencia: K = { categoria: null, catId: null, estrella: null, products: [], fecha }
  const hoja = estrella?.categoryTree?.length ? estrella.categoryTree[estrella.categoryTree.length - 1] : null
  if (hoja) {
    Object.assign(competencia, { categoria: hoja.name ?? null, catId: hoja.catId ?? null, estrella: estrella.asin })
    const marcasPropias = new Set(((s.sellerBrandStatistics ?? []) as K[]).map((m) => String(m.brand ?? '').toLowerCase()))
    const propios = new Set((s.asinList ?? []) as string[])
    let candidatos: string[] = []
    try {
      const d = anotar(
        await pedir(clave, finder({ categories_include: [hoja.catId], current_SALES_gte: 1, singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 })),
      )
      candidatos = ((d?.asinList ?? []) as string[]).filter((a) => !propios.has(a)).slice(0, 6)
    } catch (e) {
      if (e instanceof SinTokens) throw e
    }
    if (candidatos.length) {
      const d = anotar(await pedir(clave, `product?domain=9&asin=${candidatos.join(',')}&stats=90&buybox=1&rating=1&history=0`))
      competencia.products = ((d?.products ?? []) as K[]).filter((p) => !marcasPropias.has(String(p.brand ?? '').toLowerCase())).slice(0, 5)
    }
  }

  return { vendedorEs, paises, productos: { products: productos, fecha }, competencia, gastado, sinDatos: false }
}
