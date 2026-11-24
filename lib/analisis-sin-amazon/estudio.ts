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
  /** Tienda multimarca: vende sobre todo marcas de otros (Canon, Fujifilm…), no una suya (24 nov 2026, Percy Fotografía) */
  multimarca?: boolean
  /** Solo si es multimarca: las marcas que más pesan en su catálogo */
  marcasAjenas?: string[]
  /** Solo si es multimarca: productos concretos de su web, de esas marcas, para buscar su ficha en Amazon */
  productosAjenos?: { titulo: string; marca: string; busqueda: string; precio: number }[]
  /** Si esos productos salen de su catálogo (true) o, sin catálogo legible, son los modelos típicos de esas marcas (false) */
  ajenosDeSuWeb?: boolean
}

/** Un producto de su web (de otra marca) y su ficha en Amazon, si la hay */
export type AjenoCrudo = { titulo: string; marca: string; busqueda: string; precio: number | null; producto: K | null }

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
  /** Solo en una tienda multimarca: sus productos y su ficha en Amazon */
  ajenos?: AjenoCrudo[]
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

/** Productos de su web que se buscan en Amazon si es multimarca (cada uno ~15 tokens: una búsqueda y su ficha) */
const PRODUCTOS_AJENOS = 6

/**
 * ¿La ficha de Amazon es ese producto? La marca en el título o en la marca de la ficha, y las piezas del modelo (las que llevan cifras, «12»,
 * «R50», y las palabras de 4+ letras sin la marca) casi todas en el título: «Instax Mini 12» no es «Instax Mini 11» ni una funda para ella.
 */
export function esLaFicha(busqueda: string, marca: string, p: K): boolean {
  const norm = (t: string) =>
    String(t ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  const titulo = norm(`${p?.brand ?? ''} ${p?.title ?? ''}`)
  const enTitulo = new Set(titulo.split(/[^a-z0-9]+/).filter(Boolean))
  const m = norm(marca).split(/[^a-z0-9]+/).filter(Boolean)
  if (!m.every((w) => enTitulo.has(w))) return false
  if (/\b(funda|estuche|carcasa|protector|bolsa|correa)\b/.test(norm(p?.title ?? '').slice(0, 30)) && !/\b(funda|estuche|carcasa|protector|bolsa|correa)\b/.test(norm(busqueda))) return false
  // Los números del modelo mandan («A6400» = «Alpha 6400», «XF35mm F2» = «XF35mmF2», «f/1.8» = «F1.8»): todos los de la búsqueda, en el título
  // Con sus decimales: «f/2» no es «f/2.8»
  const numeros = (t: string) => new Set((t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.')))
  const enNumeros = numeros(titulo)
  const suyos = [...numeros(norm(busqueda))]
  if (suyos.length && !suyos.every((n) => enNumeros.has(n))) return false
  // Y las palabras (4+ letras, sin la marca ni lo que lleva cifras), la mitad al menos; sin palabras, con los números basta
  const palabrasSuyas = norm(busqueda)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !/\d/.test(w) && !m.includes(w))
  if (!palabrasSuyas.length) return suyos.length > 0
  const pegado = titulo.replace(/[^a-z0-9]/g, '')
  return palabrasSuyas.filter((w) => enTitulo.has(w) || pegado.includes(w)).length / palabrasSuyas.length >= 0.5
}

/** Hasta 2 mercados de 6 productos (13 nov 2026; eran 3 de 8) */
const MERCADOS = 2
const PRODUCTOS_POR_MERCADO = 6

/** Palabras que salen en cualquier rama de Amazon y no dicen qué producto es */
const GENERICAS = /^(infantil|infantiles|ni[nñ]o|ni[nñ]a|ni[nñ]os|ni[nñ]as|bebe|bebes|hombre|hombres|mujer|mujeres|adulto|adultos|unisex|ropa|moda|accesorio|accesorios|otros|varios|productos|hogar|casa|para)$/

/** Hojas cuyo nombre solo no dice qué producto es («Seca» es el pienso seco de perros): se le antepone su categoría padre */
const HOJA_AMBIGUA = /^(seca|h[uú]meda|otros|otras|varios|juegos|accesorios|general|generales)$/i
const hojaDe = (p: K) => {
  const arbol: K[] = Array.isArray(p?.categoryTree) ? p.categoryTree : []
  const hoja = arbol[arbol.length - 1]
  if (!hoja) return null
  const padre = arbol[arbol.length - 2]
  return padre?.name && HOJA_AMBIGUA.test(String(hoja.name ?? '').trim()) ? { ...hoja, name: `${padre.name} · ${hoja.name}` } : hoja
}
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
          required: ['multimarca', 'marcas', 'marcasAjenas', 'productosAjenos', 'busquedas'],
          properties: {
            multimarca: {
              type: 'boolean',
              description: 'true si la tienda vende SOBRE TODO productos de marcas de otros fabricantes (distribuidor o tienda multimarca: una tienda de fotografía que vende Canon y Fujifilm). false si vende sobre todo su propia marca.',
            },
            marcas: { type: 'array', items: { type: 'string' }, description: 'Sus marcas PROPIAS tal como saldrían en Amazon (1-2). No las de terceros que revenda. Vacío si es multimarca y no tiene marca propia.' },
            marcasAjenas: { type: 'array', items: { type: 'string' }, description: 'Solo si es multimarca: las 3-5 marcas de otros que más pesan en su catálogo. Vacío si no.' },
            productosAjenos: {
              type: 'array',
              description:
                'Solo si es multimarca: hasta 6 productos concretos de su catálogo, de esas marcas (mejor de marcas distintas y con precio conocido). Si no hay catálogo legible, pon igualmente para cada marca ajena 1-2 modelos actuales y populares del tipo que vende la tienda (título = la búsqueda, precio 0). Vacío si no es multimarca.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['titulo', 'marca', 'busqueda', 'precio'],
                properties: {
                  titulo: { type: 'string', description: 'El título tal cual en su web' },
                  marca: { type: 'string', description: 'La marca del producto' },
                  busqueda: { type: 'string', description: 'Marca + modelo exacto, como saldría en el título de Amazon (p. ej. «Fujifilm Instax Mini 12»), sin colores ni packs' },
                  precio: { type: 'number', description: 'Su precio en euros; 0 si no se conoce' },
                },
              },
            },
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
          'Analizas una tienda online española que no vende en Amazon. Primero decide si es multimarca: si lo que vende son sobre todo productos de marcas de otros fabricantes (una tienda de fotografía con Canon, Fujifilm o Kodak; una ferretería con Bosch y Makita), es multimarca: su nombre NO es una marca de producto, así que no lo pongas en marcas; di las marcas ajenas que más pesan y elige hasta 6 productos concretos suyos de esas marcas para buscarlos en Amazon. Si vende sobre todo su propia marca, no es multimarca: di cuáles son sus marcas propias (casi siempre el nombre de la tienda). En los dos casos elige los 3 tipos de producto que más pesan en su catálogo y que tienen equivalente claro en amazon.es, con el término que buscaría un comprador. Términos que devuelvan productos equivalentes a los suyos, no accesorios ni recambios. Si hay productos con precio conocido, al menos dos de los tres tipos tienen que ser de esos, con ese producto como representativo y su precio.',
      },
      { role: 'user', content: resumen },
    ],
  })
  const plan = JSON.parse(r.choices?.[0]?.message?.content ?? '{}') as PlanDeEstudio
  const multimarca = plan.multimarca === true
  return {
    marcas: (plan.marcas ?? []).map((m) => String(m).trim()).filter((m) => m.length >= 2).slice(0, 2),
    busquedas: (plan.busquedas ?? []).filter((b) => b?.termino).slice(0, 3),
    multimarca,
    marcasAjenas: multimarca ? (plan.marcasAjenas ?? []).map((m) => String(m).trim()).filter((m) => m.length >= 2).slice(0, 5) : [],
    productosAjenos: multimarca ? (plan.productosAjenos ?? []).filter((p) => p?.busqueda?.trim() && p?.marca?.trim()).slice(0, PRODUCTOS_AJENOS) : [],
    ajenosDeSuWeb: multimarca && cat.productos.length > 0,
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
  const muestra = await productos(asins.slice(0, 10))
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
  // 1 bis) Tienda multimarca: la ficha en Amazon de productos concretos de su web (de Canon, Fujifilm…)
  let ajenos: AjenoCrudo[] | undefined
  if (plan.multimarca && plan.productosAjenos?.length) {
    const candidatos: Array<{ a: (typeof plan.productosAjenos)[number]; asins: string[] }> = []
    for (const a of plan.productosAjenos) {
      let d = await k(finder({ title: a.busqueda, brand: [a.marca.toLowerCase()], current_SALES_gte: 1, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
      // Sin resultados con el modelo entero («Sony Alpha A6400 16-50mm»): con la marca y el número principal («6400»)
      const principal = (a.busqueda.match(/\d{2,}/g) ?? []).sort((x, y) => y.length - x.length)[0]
      if (!(d?.asinList ?? []).length && principal) d = await k(finder({ title: principal, brand: [a.marca.toLowerCase()], current_SALES_gte: 1, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
      candidatos.push({ a, asins: (d?.asinList ?? []).slice(0, 3) })
    }
    const todos = [...new Set(candidatos.flatMap((c) => c.asins))]
    const fichas = new Map((await productos(todos.slice(0, 18))).map((p) => [String(p?.asin), p] as const))
    const usadas = new Set<string>()
    ajenos = candidatos.map(({ a, asins }) => ({
      titulo: a.titulo,
      marca: a.marca,
      busqueda: a.busqueda,
      precio: a.precio > 0 ? a.precio : null,
      // De las que casan, la de título más corto: es el producto solo y no un kit que lo lleva («EOS R50 + RF 50mm» no es el objetivo)
      producto: (() => {
        const p =
          asins
            .map((x) => fichas.get(x))
            .filter((x) => x && !usadas.has(String(x.asin)) && esLaFicha(a.busqueda, a.marca, x))
            .sort((x, y) => String(x?.title ?? '').length - String(y?.title ?? '').length)[0] ?? null
        if (p) usadas.add(String(p.asin))
        return p
      })(),
    }))
  }

  const ids = [
    ...new Set(
      [...marca.productos, ...(ajenos ?? []).map((x) => x.producto).filter(Boolean)].map((p) => p?.stats?.buyBoxSellerId).filter((x) => typeof x === 'string' && !x.startsWith('-')),
    ),
  ] as string[]
  if (ids.length) marca.vendedores = (await k(`seller?domain=9&seller=${ids.slice(0, 10).join(',')}`))?.sellers ?? {}

  // ¿Alguno de esos vendedores es el propio lead?
  const cif = cifNormal(lead.cif)
  const empresa = empresaNormal(lead.empresa)
  let propio: EstudioSinAmazon['propio'] = null
  for (const [id, v] of Object.entries<K>(marca.vendedores)) {
    if (cif && cifNormal(v?.vatID) === cif) propio = { sellerId: id, nombre: v?.sellerName ?? id, por: 'CIF' }
    else if (!propio && empresa && empresaNormal(v?.businessName) === empresa) propio = { sellerId: id, nombre: v?.sellerName ?? id, por: 'razón social' }
  }
  if (propio) return { fecha: hoy(), plan, marca, mercados: [], gastado, propio, ajenos }

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
    // Dos mercados como mucho (13 nov 2026): el tercero casi nunca aportaba y era otro sitio donde equivocarse
    const hojas = [...cuenta].sort((x, y) => y[1].n - x[1].n).filter(([, c], i) => i === 0 || c.n >= 2).slice(0, MERCADOS)
    for (const [catId, c] of hojas) {
      const d = await k(finder({ categories_include: [catId], current_SALES_gte: 1, singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
      const ps = (await productos((d?.asinList ?? []).slice(0, PRODUCTOS_POR_MERCADO + 2))).filter((p) => !esSuya(p)).slice(0, PRODUCTOS_POR_MERCADO)
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
      // Multimarca con sus fichas encontradas: basta un mercado (lo fuerte son sus productos, y así cabe en el saldo de una tienda)
      if (mercados.length >= (ajenos?.some((x) => x.producto) ? 1 : MERCADOS)) break
      let d = await k(finder({ title: b.termino, monthlySold_gte: 50, singleVariation: true, sort: [['monthlySold', 'desc']], perPage: 50, page: 0 }))
      if ((d?.asinList ?? []).length < 5) d = await k(finder({ title: b.termino, current_SALES_gte: 1, singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
      const ps = await productos((d?.asinList ?? []).slice(0, 10))
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
      if (buenos.length < 5) {
        // Pocas en la muestra: lo más vendido de esa categoría, directamente
        let dc = await k(finder({ categories_include: [hoja[0]], monthlySold_gte: 50, singleVariation: true, sort: [['monthlySold', 'desc']], perPage: 50, page: 0 }))
        if ((dc?.asinList ?? []).length < 5) dc = await k(finder({ categories_include: [hoja[0]], current_SALES_gte: 1, singleVariation: true, sort: [['current_SALES', 'asc']], perPage: 50, page: 0 }))
        buenos = await productos((dc?.asinList ?? []).slice(0, PRODUCTOS_POR_MERCADO))
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
        productos: buenos.slice(0, PRODUCTOS_POR_MERCADO),
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

  const validados = await validarMercados(lead, plan, titulosDeSuWeb, mercados)
  return { fecha: hoy(), plan, marca, mercados: validados.filter((m) => m.productos.length >= 3), gastado, propio: null, ajenos }
}

/**
 * SEGUNDA MIRADA DE LA IA (13 nov 2026): las palabras no bastan. En Amazon, «Platos» también son los comederos de perro y «vestido niña»
 * en noviembre son disfraces de Halloween. La IA ve qué vende la tienda y los productos que ha encontrado Keepa, y deja solo los que un
 * comprador de esa tienda compararía con lo suyo. Si falla la IA, se queda todo como estaba (no se pierde el informe por eso).
 */
export async function validarMercados(lead: LeadDeEstudio, plan: PlanDeEstudio, titulos: string[], mercados: MercadoCrudo[]): Promise<MercadoCrudo[]> {
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave || !mercados.length) return mercados
  const listado = mercados
    .map((m, i) => [`MERCADO ${i}: «${m.tipo}» (categoría de Amazon: ${m.categoria ?? '—'})`, ...m.productos.map((p, j) => `  ${j}. ${String(p?.title ?? '').slice(0, 140)}`)].join('\n'))
    .join('\n')
  try {
    const ia = new OpenAI({ apiKey: clave, maxRetries: 1, timeout: 45_000 })
    const r = await ia.chat.completions.create({
      ...parametrosDeIa({ maxSalida: 2000, esfuerzo: 'low' }),
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'validacion',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['mercados'],
            properties: {
              mercados: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['mercado', 'equivalentes'],
                  properties: { mercado: { type: 'integer' }, equivalentes: { type: 'array', items: { type: 'integer' } } },
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
            'Revisas un análisis de mercado. Para cada mercado, devuelve los números de los productos de Amazon que un comprador de esta tienda vería como alternativa a lo que ella vende (mismo tipo de producto y mismo uso; el precio o la calidad pueden ser distintos). Quita SOLO lo que es claramente otra cosa: otro tipo de producto, accesorios o recambios, productos para mascotas si la tienda no es de mascotas, disfraces si no vende disfraces. Ante la duda, déjalo.',
        },
        {
          role: 'user',
          content: [`Tienda: ${lead.nombre} (${lead.web})`, `Vende, entre otras cosas: ${titulos.slice(0, 40).join(' | ') || plan.busquedas.map((b) => b.producto).join(' | ')}`, '', listado].join('\n'),
        },
      ],
    })
    const o = JSON.parse(r.choices?.[0]?.message?.content ?? '{}') as { mercados?: { mercado: number; equivalentes: number[] }[] }
    const porMercado = new Map((o.mercados ?? []).map((x) => [x.mercado, new Set(x.equivalentes)]))
    return mercados.map((m, i) => ({ ...m, productos: m.productos.filter((_, j) => porMercado.get(i)?.has(j) ?? false) }))
  } catch (e) {
    console.warn('[analisis-sin-amazon] la IA no ha podido revisar los mercados', { codigo: (e as { status?: number })?.status ?? null })
    return mercados
  }
}
