/**
 * EL ESTUDIO DE UNA TIENDA QUE (EN TEORÍA) NO VENDE EN AMAZON: catálogo de su web → la IA decide marca y qué buscar → Keepa.
 *
 *   1. SU MARCA EN AMAZON  Product Finder por marca, un modelo por ficha. De las 10 primeras: precio, quién gana la venta y si tiene
 *                          a alguien vendiéndola. De esos vendedores, su razón social, CIF y dirección (Keepa los da).
 *      ¿ES ÉL?            Si el CIF de un vendedor es el del lead, o la razón social coincide, el lead YA VENDE en Amazon: no se hace
 *                          este informe, se devuelve `propio` y la recogida lo pasa a la cola del informe de Amazon.
 *   2. LO QUE SE VENDE     Si su marca ya tiene fichas, las categorías salen de ellas (es donde Amazon pone sus productos) y se mira lo
 *                          más vendido de cada una sin su marca. Si no, se busca por texto lo que diría un comprador y se queda lo de la
 *                          categoría que más se repite (la búsqueda por texto mete accesorios: fundas entre las jaulas, etc.).
 *
 * Coste medido en el prototipo del 13 nov 2026: entre 230 y 300 tokens; con 10 productos por mercado, ~210.
 */
import OpenAI from 'openai'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { finder, pedir } from '@/lib/analisis-amazon/keepa'
import type { Catalogo } from './catalogo'

type K = any

export type PlanDeEstudio = {
  marcas: string[]
  busquedas: { tipo: string; termino: string; producto: string; precio: number }[]
}

export type LeadDeEstudio = { nombre: string; web: string; cif: string | null; empresa: string | null }

export type MercadoCrudo = {
  origen: 'marca' | 'texto'
  tipo: string
  termino: string
  categoria: string | null
  producto: string | null
  precio: number | null
  precioDeAmazon: boolean
  productos: K[]
}

export type EstudioSinAmazon = {
  fecha: string
  plan: PlanDeEstudio
  marca: { total: number; productos: K[]; vendedores: Record<string, K> }
  mercados: MercadoCrudo[]
  gastado: number
  /** El vendedor de Amazon que ES el lead (mismo CIF o razón social): entonces no hay informe de este tipo */
  propio: { sellerId: string; nombre: string; por: 'CIF' | 'razón social' } | null
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

export const cifNormal = (c: unknown): string | null => {
  let x = String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (x.length === 11 && x.startsWith('ES')) x = x.slice(2)
  return /^[A-Z]\d{7}[A-Z0-9]$|^\d{8}[A-Z]$/.test(x) ? x : null
}
const SUFIJOS = /\b(s\s?l\s?u|s\s?l\s?l|s\s?a\s?u|s\s?l|s\s?a|s\s?c\s?p|c\s?b|s\s?r\s?l|sociedad limitada|sociedad anonima|slne|unipersonal)\b/g
export const empresaNormal = (e: unknown): string | null => {
  const x = String(e ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(SUFIJOS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return x.length >= 5 ? x : null
}

/** Palabras con contenido (4+ letras, sin tildes) para saber si una ficha de Amazon con su marca es de verdad de su catálogo */
const VACIAS = new Set(['para', 'with', 'from', 'that', 'this', 'como', 'unidades', 'pack', 'set', 'color', 'talla', 'size', 'nuevo', 'new', 'original', 'oficial', 'official', 'hombre', 'mujer', 'women', 'unisex', 'black', 'white', 'negro', 'blanco', 'grande', 'pequeño', 'pequeno'])
export const palabras = (t: string) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !VACIAS.has(w))

/** Palabras que salen en cualquier rama de Amazon y no dicen qué producto es */
const GENERICAS = /^(infantil|infantiles|ni[nñ]o|ni[nñ]a|ni[nñ]os|ni[nñ]as|bebe|bebes|hombre|hombres|mujer|mujeres|adulto|adultos|unisex|ropa|moda|accesorio|accesorios|otros|varios|productos|hogar|casa|para)$/

const hojaDe = (p: K) => (Array.isArray(p?.categoryTree) && p.categoryTree.length ? p.categoryTree[p.categoryTree.length - 1] : null)
const raizDe = (p: K) => (Array.isArray(p?.categoryTree) && p.categoryTree.length ? p.categoryTree[0]?.catId ?? null : null)
const rango = (p: K) => Number(p?.stats?.current?.[3] ?? 0)
const precioDe = (p: K): number | null => {
  const c = p?.stats?.current ?? []
  const v = [c[18], c[1], c[0]].find((x: unknown) => typeof x === 'number' && x > 0)
  return v ? v / 100 : null
}

export async function planDeEstudio(lead: LeadDeEstudio, cat: Catalogo): Promise<PlanDeEstudio> {
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave) throw new Error('falta OPENAI_API_KEY')
  const resumen = [
    `Tienda: ${lead.nombre} (${cat.origen})`,
    cat.titulo ? `Título de la web: ${cat.titulo}` : '',
    cat.descripcion ? `Cómo se describe: ${cat.descripcion}` : '',
    `Texto de la portada (recortado): ${cat.portada.slice(0, 1500)}`,
    cat.productos.length ? `Productos (${cat.productos.length}; título | precio € o «?»):` : 'No se ha podido leer el catálogo: guíate por la portada.',
    ...cat.productos.slice(0, 120).map((p) => `- ${p.titulo}${p.enlace && p.enlace.length > p.titulo.length + 18 ? ` (${p.enlace.replace(/^\/products\//, '').replace(/-/g, ' ').slice(0, 80)})` : ''} | ${p.precio ?? '?'}`),
  ]
    .filter(Boolean)
    .join('\n')

  const ia = new OpenAI({ apiKey: clave, maxRetries: 1, timeout: 60_000 })
  const r = await ia.chat.completions.create({
    ...parametrosDeIa({ maxSalida: 3000, esfuerzo: 'low' }),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'plan',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['marcas', 'busquedas'],
          properties: {
            marcas: { type: 'array', items: { type: 'string' }, description: 'Sus marcas PROPIAS tal como saldrían en Amazon (1-2). No las de terceros que revenda.' },
            busquedas: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['tipo', 'termino', 'producto', 'precio'],
                properties: {
                  tipo: { type: 'string', description: 'Nombre corto en español del tipo de producto, para el informe' },
                  termino: { type: 'string', description: 'Lo que buscaría un comprador en amazon.es: 2-3 palabras en español, genérico, sin marca' },
                  producto: { type: 'string', description: 'Su producto más representativo de ese tipo (título tal cual)' },
                  precio: { type: 'number', description: 'Su precio en euros; 0 si no se conoce' },
                },
              },
            },
          },
        },
      },
    },
    messages: [
      {
        role: 'system',
        content:
          'Analizas una tienda online española que no vende en Amazon. Di cuáles son sus marcas propias (casi siempre el nombre de la tienda) y elige los 3 tipos de producto que más pesan en su catálogo y que tienen equivalente claro en amazon.es, con el término que buscaría un comprador. Términos que devuelvan productos equivalentes a los suyos, no accesorios ni recambios. Si hay productos con precio conocido, al menos dos de los tres tipos tienen que ser de esos, con ese producto como representativo y su precio.',
      },
      { role: 'user', content: resumen },
    ],
  })
  const plan = JSON.parse(r.choices?.[0]?.message?.content ?? '{}') as PlanDeEstudio
  return {
    marcas: (plan.marcas ?? []).map((m) => String(m).trim()).filter((m) => m.length >= 2).slice(0, 2),
    busquedas: (plan.busquedas ?? []).filter((b) => b?.termino).slice(0, 3),
  }
}

export async function estudiarTienda(clave: string, lead: LeadDeEstudio, plan: PlanDeEstudio, titulosDeSuWeb: string[] = []): Promise<EstudioSinAmazon> {
  let gastado = 0
  const k = async (ruta: string) => {
    const d = await pedir(clave, ruta)
    gastado += Number(d?.tokensConsumed ?? 0)
    return d
  }
  const productos = async (asins: string[]): Promise<K[]> =>
    asins.length ? ((await k(`product?domain=9&asin=${asins.join(',')}&stats=90&buybox=1&rating=1&history=0`))?.products ?? []) : []

  // 1) Su marca en Amazon
  const marca: EstudioSinAmazon['marca'] = { total: 0, productos: [], vendedores: {} }
  const asins: string[] = []
  for (const m of plan.marcas) {
    const d = await k(finder({ brand: [m.toLowerCase()], singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
    marca.total += Number(d?.totalResults ?? (d?.asinList ?? []).length)
    for (const a of d?.asinList ?? []) if (!asins.includes(a)) asins.push(a)
  }
  const muestra = await productos(asins.slice(0, 8))
  // La misma marca puede ser de otra empresa (Blizzard: videojuegos… y alicates de uñas). Solo cuentan las fichas que comparten
  // palabras con su web; si la muestra sale mezclada, el total se ajusta en la misma proporción.
  const deLaMarca = new Set(plan.marcas.flatMap((m) => palabras(m)))
  const vocabulario = new Set(
    [...titulosDeSuWeb, ...plan.busquedas.flatMap((b) => [b.tipo, b.termino, b.producto])].flatMap((t) => palabras(t)).filter((w) => !deLaMarca.has(w)),
  )
  const porPalabras = vocabulario.size ? muestra.filter((p) => palabras(p?.title ?? '').some((w) => !deLaMarca.has(w) && vocabulario.has(w))) : muestra
  // Una palabra suelta puede coincidir por casualidad («profesional»): además, la misma rama de Amazon que la mayoría de las buenas
  const ramas = new Map<number, number>()
  for (const p of porPalabras) if (raizDe(p)) ramas.set(raizDe(p), (ramas.get(raizDe(p)) ?? 0) + 1)
  const rama = [...ramas].sort((x, y) => y[1] - x[1])[0]?.[0]
  const relevantes = rama && porPalabras.length >= 3 ? porPalabras.filter((p) => raizDe(p) === rama) : porPalabras
  if (muestra.length && relevantes.length < muestra.length) {
    const proporcion = relevantes.length / muestra.length
    marca.total = proporcion < 0.3 ? relevantes.length : Math.round(marca.total * proporcion)
  }
  marca.productos = relevantes
  const ids = [...new Set(marca.productos.map((p) => p?.stats?.buyBoxSellerId).filter((x) => typeof x === 'string' && !x.startsWith('-')))] as string[]
  if (ids.length) marca.vendedores = (await k(`seller?domain=9&seller=${ids.slice(0, 10).join(',')}`))?.sellers ?? {}

  // ¿Alguno de esos vendedores es el propio lead?
  const cif = cifNormal(lead.cif)
  const empresa = empresaNormal(lead.empresa)
  let propio: EstudioSinAmazon['propio'] = null
  for (const [id, v] of Object.entries<K>(marca.vendedores)) {
    if (cif && cifNormal(v?.vatID) === cif) propio = { sellerId: id, nombre: v?.sellerName ?? id, por: 'CIF' }
    else if (!propio && empresa && empresaNormal(v?.businessName) === empresa) propio = { sellerId: id, nombre: v?.sellerName ?? id, por: 'razón social' }
  }
  if (propio) return { fecha: hoy(), plan, marca, mercados: [], gastado, propio }

  // 2) Lo que se vende en Amazon de lo suyo
  const marcas = new Set(plan.marcas.map((m) => m.toLowerCase().replace(/[^a-z0-9]/g, '')))
  const esSuya = (p: K) => marcas.has(String(p?.brand ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''))
  const mercados: MercadoCrudo[] = []
  const suyos = marca.productos.filter((p) => hojaDe(p))

  if (suyos.length >= 3) {
    const cuenta = new Map<number, { n: number; nombre: string; suyos: K[] }>()
    for (const p of suyos) {
      const h = hojaDe(p)
      const c = cuenta.get(h.catId) ?? { n: 0, nombre: h.name, suyos: [] as K[] }
      c.n++
      c.suyos.push(p)
      cuenta.set(h.catId, c)
    }
    // Solo las categorías con al menos 2 fichas suyas (la primera siempre): una herramienta suelta no es su mercado
    const hojas = [...cuenta].sort((x, y) => y[1].n - x[1].n).filter(([, c], i) => i === 0 || c.n >= 2).slice(0, 3)
    for (const [catId, c] of hojas) {
      const d = await k(finder({ categories_include: [catId], current_SALES_gte: 1, singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
      const ps = (await productos((d?.asinList ?? []).slice(0, 6))).filter((p) => !esSuya(p)).slice(0, 5)
      const suyo = c.suyos.filter((p) => rango(p) > 0).sort((a, b) => rango(a) - rango(b))[0] ?? c.suyos[0]
      mercados.push({
        origen: 'marca',
        tipo: c.nombre,
        termino: c.nombre,
        categoria: c.nombre,
        producto: String(suyo?.title ?? '').slice(0, 90) || null,
        precio: precioDe(suyo),
        precioDeAmazon: true,
        productos: ps,
      })
    }
  } else {
    for (const b of plan.busquedas) {
      let d = await k(finder({ title: b.termino, monthlySold_gte: 50, singleVariation: true, sort: [['monthlySold', 'desc']], perPage: 50, page: 0 }))
      if ((d?.asinList ?? []).length < 5) d = await k(finder({ title: b.termino, current_SALES_gte: 1, singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
      const ps = await productos((d?.asinList ?? []).slice(0, 8))
      // La categoría tiene que ser la de su producto: con «vestido niña» en noviembre lo que más sale son disfraces de Halloween.
      // Se elige la hoja más repetida CUYA RUTA nombra el tipo (vestidos, cascos…, comparando las 5 primeras letras); si ninguna, fuera.
      // Solo el nombre de la hoja y el de su padre (la ruta entera lleva «Infantil», «Mujer»… y casa con cualquier cosa), sin genéricas
      const raices = new Set(palabras(`${b.tipo} ${b.termino}`).filter((w) => !GENERICAS.test(w)).map((w) => w.slice(0, 5)))
      const encaja = (p: K) => {
        const arbol: K[] = p?.categoryTree ?? []
        return palabras(arbol.slice(-2).map((n) => n?.name ?? '').join(' '))
          .filter((w) => !GENERICAS.test(w))
          .some((w) => raices.has(w.slice(0, 5)))
      }
      const cuenta = new Map<number, { n: number; nombre: string }>()
      for (const p of ps) {
        const h = hojaDe(p)
        if (h && encaja(p)) cuenta.set(h.catId, { n: (cuenta.get(h.catId)?.n ?? 0) + 1, nombre: h.name })
      }
      const hoja = [...cuenta].sort((x, y) => y[1].n - x[1].n)[0]
      if (!hoja) continue
      if (mercados.some((m) => m.categoria === hoja[1].nombre)) continue
      let buenos = ps.filter((p) => hojaDe(p)?.catId === hoja[0])
      if (buenos.length < 4) {
        // Pocas en la muestra: lo más vendido de esa categoría, directamente
        let dc = await k(finder({ categories_include: [hoja[0]], monthlySold_gte: 50, singleVariation: true, sort: [['monthlySold', 'desc']], perPage: 50, page: 0 }))
        if ((dc?.asinList ?? []).length < 5) dc = await k(finder({ categories_include: [hoja[0]], current_SALES_gte: 1, singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
        buenos = await productos((dc?.asinList ?? []).slice(0, 5))
      }
      if (buenos.length < 3) continue
      mercados.push({
        origen: 'texto',
        tipo: b.tipo,
        termino: b.termino,
        categoria: hoja[1].nombre,
        producto: b.producto || null,
        precio: b.precio > 0 ? b.precio : null,
        precioDeAmazon: false,
        productos: buenos.slice(0, 5),
      })
    }
  }

  // Fuera lo que cae en otro árbol de categorías (Amazon mete un Blu-ray de Titanic en «Barcos»)
  for (const m of mercados) {
    const raices = new Map<number, number>()
    for (const p of m.productos) if (raizDe(p)) raices.set(raizDe(p), (raices.get(raizDe(p)) ?? 0) + 1)
    const buena = [...raices].sort((x, y) => y[1] - x[1])[0]?.[0]
    if (buena) m.productos = m.productos.filter((p) => raizDe(p) === buena)
  }

  return { fecha: hoy(), plan, marca, mercados: mercados.filter((m) => m.productos.length >= 3), gastado, propio: null }
}
