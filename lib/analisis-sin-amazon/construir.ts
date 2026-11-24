/**
 * DE KEEPA AL INFORME DE UNA TIENDA SIN AMAZON (función pura). De tú: son tiendas españolas.
 *
 * Dos casos, y el informe se escribe distinto:
 *   revendida  su marca YA tiene fichas en Amazon y las venden otros (comprobado que no es él: ni su CIF ni su razón social).
 *              El gancho: «tu marca ya se vende en Amazon, pero no la vendes tú»; y si hay fichas sin nadie que las venda, que quien
 *              busca su producto allí no lo puede comprar.
 *   ausente    su marca no está. El gancho: lo que ya se compra en Amazon de lo suyo, a qué precio y contra quién.
 *   multimarca no tiene marca propia: revende marcas de otros (Percy Fotografía: Canon, Fujifilm, Kodak; 24 nov 2026). El gancho: esos mismos
 *              productos ya tienen ficha en Amazon y se venden; puede vender en esas fichas sin crear nada, compitiendo por la venta.
 *              Las marcas no son «rivales»: son lo que vende.
 *
 * Nada inventado: cada frase sale de una cifra de Keepa o de su web. Sin promesas de resultados.
 */
import { cifNormal, empresaNormal, type EstudioSinAmazon } from './estudio'

type K = any

export const SELLER_SIN_AMAZON = 'SINAMAZON'
const AMAZON_IDS = new Set(['A1AT7YVPFBWXBL', 'A1X6FK5RDHNB96', 'A3JWKAKR8XB7XF', 'A11IL2PNWYJU7H', 'A3P5ROKL5A1OLE', 'ATVPDKIKX0DER'])

export type ProductoMini = {
  asin: string
  titulo: string
  marca: string | null
  imagen: string | null
  precio: number | null
  ventasMes: number | null
  resenas: number
  estrellas: number | null
  /** quién gana la venta ahora: nombre de la tienda, «Amazon» o null si nadie la vende */
  vende: string | null
}

export type VendedorDeSuMarca = { nombre: string; empresa: string | null; ciudad: string | null; pais: string | null; marcas: number | null; productos: number | null }

export type MercadoSinAmazon = {
  nombre: string
  categoria: string | null
  origen: 'marca' | 'texto'
  /** «ventas»: la mayoría publica sus ventas al mes; «ranking»: nicho, se ordena por ranking */
  modo: 'ventas' | 'ranking'
  productos: ProductoMini[]
  ventasMes: number
  facturacionMes: number
  precioMediano: number | null
  resenasMediana: number | null
  comisionPct: number | null
  logistica: number | null
  suyo: { titulo: string; precio: number; deAmazon: boolean } | null
  marcas: { marca: string; ventasMes: number; fichas: number }[]
}

export type Clave = { cifra: string; titulo: string; detalle: string }

/** Un producto de su web (de otra marca) frente a su ficha en Amazon */
export type ProductoAjeno = {
  titulo: string
  marca: string
  /** Su precio en la web */
  precio: number | null
  /** La ficha en Amazon (null: no la hemos encontrado) */
  amazon: (ProductoMini & { ofertas: number | null; amazonVende: boolean }) | null
}

export type Reventa = {
  marcas: string[]
  /** true: productos de su catálogo; false: no se pudo leer su web y son modelos típicos de las marcas que vende */
  deSuWeb: boolean
  productos: ProductoAjeno[]
  encontrados: number
  ventasMes: number
  /** Tiendas que lo ofrecen, de mediana, en las fichas encontradas */
  ofertasMediana: number | null
  /** Fichas en las que Amazon no vende (solo tiendas) */
  sinAmazon: number
  /** Fichas en las que su precio es igual o más bajo que el de Amazon */
  suPrecioCompite: number
  conAmbosPrecios: number
}

export type InformeSinAmazon = {
  clase: 'sin_amazon'
  version: 1
  fecha: string
  caso: 'revendida' | 'ausente' | 'multimarca'
  /** Solo en una tienda multimarca */
  reventa?: Reventa
  /** compatibles con el informe de Amazon (ficha de Cold Calling, avisos, baja, correo) */
  tipo: null
  tipoTexto: string
  vendedor: { nombre: string; web: string }
  catalogo: { productos: number }
  marca: {
    nombre: string
    modelos: number
    fichas: ProductoMini[]
    revisadas: number
    sinVendedor: number
    vendedores: VendedorDeSuMarca[]
    ventasMes: number
    /** cómo se ha comprobado que esos vendedores no son el lead */
    comprobadoPor: 'CIF' | 'razón social' | null
  }
  mercados: MercadoSinAmazon[]
  titular: [string, string]
  resumen: string
  claves: Clave[]
  guion: { tipo: string; frases: string[] }
}

const ent = (n: number) => Math.round(n).toLocaleString('es-ES')
const eur = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`
const mediana = (xs: number[]): number | null => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b)
  if (!s.length) return null
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const enumerar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

/** Amazon vende con varias cuentas (Amazon.es, Amazon Media EU…): todas cuentan como Amazon, no como «otra tienda» */
const esAmazon = (id: string, v: K) => AMAZON_IDS.has(id) || /^amazon\b/i.test(String(v?.sellerName ?? '')) || /^amazon\b/i.test(String(v?.businessName ?? ''))

function mini(p: K, vendedores: Record<string, K>): ProductoMini {
  const c: number[] = p?.stats?.current ?? []
  const precio = [c[18], c[1], c[0]].find((v) => typeof v === 'number' && v > 0)
  const img = p?.images?.[0]?.m ?? p?.images?.[0]?.l ?? null
  const bb: string | null = typeof p?.stats?.buyBoxSellerId === 'string' && !p.stats.buyBoxSellerId.startsWith('-') ? p.stats.buyBoxSellerId : null
  return {
    asin: String(p.asin),
    titulo: String(p.title ?? '').slice(0, 160),
    marca: (p.brand && String(p.brand).trim()) || null,
    imagen: img ? `https://m.media-amazon.com/images/I/${img}` : null,
    precio: precio ? precio / 100 : null,
    ventasMes: typeof p.monthlySold === 'number' && p.monthlySold > 0 ? p.monthlySold : null,
    resenas: typeof c[17] === 'number' && c[17] > 0 ? c[17] : 0,
    estrellas: typeof c[16] === 'number' && c[16] > 0 ? c[16] / 10 : null,
    vende: !bb ? null : esAmazon(bb, vendedores[bb]) ? 'Amazon' : (vendedores[bb]?.sellerName ?? 'otra tienda'),
  }
}

/**
 * LOS TEXTOS DEL INFORME (titular, resumen, claves y chuleta) a partir de sus cifras. Aparte de construirSinAmazon para poder rehacerlos con
 * solo los mercados que valen (lib/analisis-sin-amazon/calidad.ts): un informe ya guardado no se vuelve a pedir a Keepa.
 */
export type CifrasDelTexto = {
  caso: InformeSinAmazon['caso']
  marcaNombre: string
  modelos: number
  nombresTerceros: string[]
  sinVendedor: number
  revisadas: number
  productosWeb: number
  mercados: MercadoSinAmazon[]
  reventa?: Reventa
}

/** Los textos de una tienda multimarca: lo que vende en su web ya se vende en Amazon, y puede venderlo en esas mismas fichas */
function textosMultimarca(d: CifrasDelTexto, r: Reventa): Pick<InformeSinAmazon, 'titular' | 'resumen' | 'claves' | 'guion'> {
  const marcas = enumerar(r.marcas.slice(0, 3))
  const ejemplo = [...r.productos].filter((p) => p.amazon).sort((a, b) => (b.amazon?.ventasMes ?? 0) - (a.amazon?.ventasMes ?? 0))[0] ?? null
  const claves: Clave[] = []
  if (r.encontrados)
    claves.push({ cifra: `${r.encontrados} de ${r.productos.length}`, titulo: r.deSuWeb ? 'productos de tu web ya tienen ficha en Amazon' : 'modelos de tus marcas que hemos buscado tienen ficha en Amazon', detalle: 'No hay que crear nada: te pones a vender en la ficha que ya existe.' })
  if (r.ventasMes > 0) claves.push({ cifra: `+${ent(r.ventasMes)}`, titulo: 'unidades al mes', detalle: 'Lo que Amazon publica que se vende de esas fichas.' })
  if (r.ofertasMediana)
    claves.push({ cifra: ent(r.ofertasMediana), titulo: r.ofertasMediana === 1 ? 'tienda vende cada ficha' : 'tiendas venden cada ficha, de mediana', detalle: 'Compiten por la venta con el precio, el stock y el envío.' })
  if (r.conAmbosPrecios && claves.length < 4)
    claves.push({ cifra: `${r.suPrecioCompite} de ${r.conAmbosPrecios}`, titulo: 'con tu precio igual o más bajo', detalle: 'Comparando el precio de tu web con el que gana hoy la venta en Amazon.' })
  else if (r.sinAmazon && claves.length < 4) claves.push({ cifra: ent(r.sinAmazon), titulo: r.sinAmazon === 1 ? 'ficha que Amazon no vende' : 'fichas que Amazon no vende', detalle: 'Ahí solo compiten tiendas como la tuya.' })

  const titular: [string, string] = r.deSuWeb
    ? ['Lo que vendes en tu web ya se vende en Amazon.', 'Y puedes venderlo tú, en las mismas fichas.']
    : ['Las marcas que vendes ya se venden en Amazon.', 'Y puedes venderlas tú, en las mismas fichas.']
  const resumen = `${r.deSuWeb ? (d.productosWeb > 0 ? `Hemos cruzado productos de los ${ent(d.productosWeb)} de tu web` : 'Hemos cruzado productos de tu web') : 'Hemos buscado en Amazon.es modelos de las marcas que vendes'}${marcas ? ` (${marcas})` : ''}${r.deSuWeb ? ' con Amazon.es' : ''}: ${
    r.encontrados ? `${r.encontrados} de ${r.productos.length} ya tienen ficha${r.ventasMes ? ` y venden más de ${ent(r.ventasMes)} unidades al mes` : ''}` : 'las marcas que vendes están en Amazon'
  }. No necesitas marca propia para vender allí: te pones en esas fichas y compites por la venta con tu precio y tu stock.`

  const frases = [
    `He mirado en Amazon ${r.deSuWeb ? 'los productos que vendes en tu web' : 'las marcas que vendes'}${marcas ? `, ${r.deSuWeb ? 'de ' : ''}${marcas}` : ''}: ${r.encontrados ? `${r.encontrados} de ${r.productos.length} ya tienen ficha` : 'esas marcas están todas'}.`,
    ejemplo?.amazon
      ? `Por ejemplo, ${ejemplo.amazon.titulo.split(/ [-–|,] /)[0].slice(0, 60)}: ${ejemplo.amazon.precio ? `se vende a ${eur(ejemplo.amazon.precio)}` : 'se vende'}${ejemplo.amazon.ventasMes ? `, más de ${ent(ejemplo.amazon.ventasMes)} al mes` : ''}${ejemplo.amazon.ofertas ? `, y la ofrecen ${ent(ejemplo.amazon.ofertas)} tiendas` : ''}${ejemplo.precio ? `; tú la tienes a ${eur(ejemplo.precio)}` : ''}.`
      : '',
    'No hace falta crear fichas ni marca: se vende en las que ya existen, compitiendo por la venta. Algunas marcas piden autorización y lo miramos marca a marca.',
    '¿Te paso con nuestro equipo de estrategia para verlo con tu catálogo en 20 minutos?',
  ].filter(Boolean)

  return { titular, resumen, claves: claves.slice(0, 4), guion: { tipo: 'Tienda multimarca: vende marcas de otros', frases } }
}

export function textosDelInforme(d: CifrasDelTexto): Pick<InformeSinAmazon, 'titular' | 'resumen' | 'claves' | 'guion'> {
  const { caso, marcaNombre, modelos, nombresTerceros, sinVendedor, mercados } = d
  if (caso === 'multimarca' && d.reventa) return textosMultimarca(d, d.reventa)
  const ventasMes = mercados.reduce((a, m) => a + m.ventasMes, 0)
  const marcasRivales = [...new Set(mercados.flatMap((m) => m.marcas.map((x) => x.marca)))].slice(0, 4)
  const principal = [...mercados].sort((a, b) => b.ventasMes - a.ventasMes || (a.resenasMediana ?? 1e9) - (b.resenasMediana ?? 1e9))[0] ?? null

  const claves: Clave[] = []
  if (caso === 'revendida') {
    claves.push({
      cifra: ent(modelos),
      titulo: `${modelos === 1 ? 'ficha' : 'fichas'} de ${marcaNombre} en Amazon`,
      detalle: 'Tu marca ya tiene sitio en Amazon.es, aunque tú no vendas allí.',
    })
    if (nombresTerceros.length)
      claves.push({
        cifra: ent(nombresTerceros.length),
        titulo: nombresTerceros.length === 1 ? 'tienda vende tu marca' : 'tiendas venden tu marca',
        detalle: `${enumerar(nombresTerceros.slice(0, 3))}. Ellos ponen el precio y cobran la venta.`,
      })
    if (sinVendedor)
      claves.push({
        cifra: `${sinVendedor} de ${d.revisadas}`,
        titulo: sinVendedor === 1 ? 'ficha tuya sin nadie que la venda' : 'fichas tuyas sin nadie que las venda',
        detalle: 'Quien busca ese producto en Amazon hoy no lo puede comprar.',
      })
  } else {
    claves.push({ cifra: '0', titulo: `fichas de ${marcaNombre} en Amazon`, detalle: 'Quien te busca allí, no te encuentra: acaba comprando otra marca.' })
  }
  if (ventasMes >= 300)
    claves.push({ cifra: `+${ent(ventasMes)}`, titulo: 'unidades al mes', detalle: `Lo que venden solo los primeros puestos de ${principal ? principal.nombre.toLowerCase() : 'tus categorías'}.` })
  else if (principal?.resenasMediana)
    claves.push({
      cifra: ent(principal.resenasMediana),
      titulo: 'reseñas de mediana entre los que más venden',
      detalle: `En ${principal.nombre.toLowerCase()}, a ${principal.precioMediano ? eur(principal.precioMediano) : 'precios'} de mediana.`,
    })
  if (marcasRivales.length && claves.length < 4)
    claves.push({ cifra: ent(marcasRivales.length), titulo: 'marcas se reparten tus ventas', detalle: `${enumerar(marcasRivales)} venden allí lo que tú vendes en tu web.` })

  const titular: [string, string] =
    caso === 'revendida'
      ? ['Tu marca ya se vende en Amazon.', 'Pero no la vendes tú.']
      : ['Tus clientes ya compran esto en Amazon.', 'Se lo están vendiendo otros.']

  const resumen =
    caso === 'revendida'
      ? `Hemos buscado ${marcaNombre} en Amazon.es: tiene ${ent(modelos)} ${modelos === 1 ? 'ficha' : 'fichas'} y${nombresTerceros.length ? ` la venden ${enumerar(nombresTerceros.slice(0, 3))}, no tú` : ' no las vendes tú'}.${sinVendedor ? ` De las que hemos revisado, ${sinVendedor === 1 ? 'una no tiene ahora mismo a nadie vendiéndola' : `${sinVendedor} no tienen ahora mismo a nadie vendiéndolas`}.` : ''} Y al lado, lo que se vende de lo tuyo y contra quién compites.`
      : `${d.productosWeb > 0 ? `Hemos cruzado los ${ent(d.productosWeb)} productos de tu web` : 'Hemos mirado tu web'} con lo que se vende hoy en Amazon.es. Tu marca todavía no está, y ${ventasMes >= 300 ? `los primeros puestos de lo que tú vendes mueven allí más de ${ent(ventasMes)} unidades al mes` : `${enumerar(marcasRivales.slice(0, 3)) || 'otras marcas'} se están quedando con esas ventas`}.`

  const frases: string[] =
    caso === 'revendida'
      ? [
          `He estado mirando ${marcaNombre} en Amazon: tiene ${ent(modelos)} fichas${nombresTerceros.length ? ` y las ${nombresTerceros.length > 1 ? 'están' : 'está'} vendiendo ${enumerar(nombresTerceros.slice(0, 2))}` : ''}. ¿Lo sabías?`,
          sinVendedor ? `De las que he revisado, ${sinVendedor === 1 ? 'una no la vende' : `${sinVendedor} no las vende`} nadie ahora mismo: quien te busca allí no te puede comprar.` : `Ellos ponen el precio y las fotos de tu marca, y se quedan la venta.`,
          principal ? `En ${principal.nombre.toLowerCase()} los que más venden son ${enumerar(principal.marcas.slice(0, 3).map((x) => x.marca))}.` : '',
          'Con el Registro de Marca recuperas el control de tus fichas. ¿Te paso con nuestro equipo de estrategia para que te lo expliquen en 20 minutos?',
        ].filter(Boolean)
      : [
          `He mirado ${marcaNombre} en Amazon y no estás: quien te busca allí acaba comprando otra marca.`,
          principal
            ? `En ${principal.nombre.toLowerCase()} ${principal.modo === 'ventas' ? `los primeros venden más de ${ent(principal.ventasMes)} unidades al mes` : `los que mandan tienen unas ${ent(principal.resenasMediana ?? 0)} reseñas`}, a ${principal.precioMediano ? eur(principal.precioMediano) : 'precios'} de mediana.`
            : '',
          marcasRivales.length ? `Se lo están llevando ${enumerar(marcasRivales.slice(0, 3))}.` : '',
          'No hace falta subir todo: empezaríamos por lo que más se vende. ¿Te paso con nuestro equipo de estrategia para verlo en 20 minutos?',
        ].filter(Boolean)


  return { titular, resumen, claves: claves.slice(0, 4), guion: { tipo: caso === 'revendida' ? 'Su marca la venden otros en Amazon' : 'Su marca no está en Amazon', frases } }
}

export function construirSinAmazon(
  e: EstudioSinAmazon,
  lead: { nombre: string; web: string; productosWeb: number; cif?: string | null; empresa?: string | null },
): InformeSinAmazon {
  const vendedores = e.marca.vendedores ?? {}
  const marcaNombre = e.plan.marcas[0] ?? lead.nombre

  // Su marca: una fila por modelo y vendedor; primero las que hoy se venden
  const fichas = e.marca.productos
    .map((p) => mini(p, vendedores))
    .filter((p, i, xs) => xs.findIndex((q) => q.titulo.slice(0, 45) === p.titulo.slice(0, 45) && q.vende === p.vende) === i)
    .sort((a, b) => Number(!!b.precio && !!b.vende) - Number(!!a.precio && !!a.vende))
  const sinVendedor = fichas.filter((p) => !p.vende || !p.precio).length
  const terceros: VendedorDeSuMarca[] = Object.values<K>(vendedores)
    .filter((v) => !esAmazon(String(v?.sellerId ?? ''), v))
    .map((v) => {
      const dir: string[] = Array.isArray(v?.address) ? v.address : []
      return {
        nombre: String(v?.sellerName ?? 'Otra tienda'),
        empresa: v?.businessName ?? null,
        ciudad: dir.length >= 3 ? dir[dir.length - 4] ?? null : null,
        pais: dir.length ? dir[dir.length - 1] : null,
        marcas: Array.isArray(v?.sellerBrandStatistics) ? v.sellerBrandStatistics.length : null,
        productos: Array.isArray(v?.totalStorefrontAsins) ? v.totalStorefrontAsins[1] ?? null : null,
      }
    })
  const reventa = e.plan.multimarca && e.ajenos?.length ? construirReventa(e.ajenos, e.plan.marcasAjenas ?? [], vendedores, e.plan.ajenosDeSuWeb !== false) : undefined
  const caso: InformeSinAmazon['caso'] = reventa ? 'multimarca' : e.marca.total > 0 && fichas.length > 0 ? 'revendida' : 'ausente'

  const mercados: MercadoSinAmazon[] = e.mercados.map((m) => {
    const ps = m.productos.map((p) => mini(p, vendedores))
    const conVentas = ps.filter((p) => p.ventasMes).length
    const comision = mediana(m.productos.map((p) => Number(p?.referralFeePercentage ?? p?.referralFeePercent ?? 0)))
    const logistica = mediana(m.productos.map((p) => Number(p?.fbaFees?.pickAndPackFee ?? 0) / 100))
    const porMarca = new Map<string, { v: number; n: number }>()
    for (const p of ps) if (p.marca) porMarca.set(p.marca, { v: (porMarca.get(p.marca)?.v ?? 0) + (p.ventasMes ?? 0), n: (porMarca.get(p.marca)?.n ?? 0) + 1 })
    return {
      nombre: m.tipo,
      categoria: m.categoria,
      origen: m.origen,
      modo: conVentas >= 4 ? 'ventas' : 'ranking',
      productos: ps,
      ventasMes: ps.reduce((a, p) => a + (p.ventasMes ?? 0), 0),
      facturacionMes: ps.reduce((a, p) => a + (p.ventasMes ?? 0) * (p.precio ?? 0), 0),
      precioMediano: mediana(ps.map((p) => p.precio ?? 0)),
      resenasMediana: mediana(ps.map((p) => p.resenas)),
      comisionPct: comision,
      logistica,
      suyo: m.precio && m.producto ? { titulo: m.producto, precio: m.precio, deAmazon: m.precioDeAmazon } : null,
      marcas: [...porMarca].map(([marca, x]) => ({ marca, ventasMes: x.v, fichas: x.n })).sort((a, b) => b.ventasMes - a.ventasMes || b.fichas - a.fichas).slice(0, 5),
    }
  })

  const textos = textosDelInforme({
    caso,
    marcaNombre,
    modelos: e.marca.total,
    nombresTerceros: terceros.map((t) => t.nombre),
    sinVendedor,
    revisadas: fichas.length,
    productosWeb: lead.productosWeb,
    mercados,
    reventa,
  })

  return {
    clase: 'sin_amazon',
    version: 1,
    fecha: e.fecha,
    caso,
    tipo: null,
    tipoTexto: caso === 'multimarca' ? 'Sin Amazon · tienda multimarca' : caso === 'revendida' ? 'Sin Amazon · su marca la venden otros' : 'Sin Amazon · su marca no está',
    ...(reventa ? { reventa } : {}),
    vendedor: { nombre: lead.nombre, web: lead.web },
    catalogo: { productos: lead.productosWeb },
    marca: {
      nombre: marcaNombre,
      modelos: e.marca.total,
      fichas: fichas.slice(0, 8),
      revisadas: fichas.length,
      sinVendedor,
      vendedores: terceros,
      ventasMes: fichas.reduce((a, p) => a + (p.ventasMes ?? 0), 0),
      comprobadoPor:
        cifNormal(lead.cif) && Object.values<K>(vendedores).some((v) => cifNormal(v?.vatID))
          ? 'CIF'
          : empresaNormal(lead.empresa) && Object.values<K>(vendedores).some((v) => empresaNormal(v?.businessName))
            ? 'razón social'
            : null,
    },
    mercados,
    ...textos,
  }
}

/** Sus productos frente a sus fichas de Amazon, con las cifras que usa el texto */
export function construirReventa(ajenos: NonNullable<EstudioSinAmazon['ajenos']>, marcasAjenas: string[], vendedores: Record<string, K>, deSuWeb = true): Reventa {
  const productos: ProductoAjeno[] = ajenos.map((a) => {
    if (!a.producto) return { titulo: a.titulo, marca: a.marca, precio: a.precio, amazon: null }
    const c: number[] = a.producto?.stats?.current ?? []
    return {
      titulo: a.titulo,
      marca: a.marca,
      precio: a.precio,
      amazon: { ...mini(a.producto, vendedores), ofertas: typeof c[11] === 'number' && c[11] > 0 ? c[11] : null, amazonVende: typeof c[0] === 'number' && c[0] > 0 },
    }
  })
  const con = productos.filter((p) => p.amazon)
  const ambos = con.filter((p) => p.precio && p.amazon?.precio)
  return {
    marcas: marcasAjenas.length ? marcasAjenas : [...new Set(ajenos.map((a) => a.marca))],
    deSuWeb,
    // Primero las encontradas, de más a menos ventas
    productos: [...productos].sort((a, b) => Number(!!b.amazon) - Number(!!a.amazon) || (b.amazon?.ventasMes ?? 0) - (a.amazon?.ventasMes ?? 0)),
    encontrados: con.length,
    ventasMes: con.reduce((s, p) => s + (p.amazon?.ventasMes ?? 0), 0),
    ofertasMediana: mediana(con.map((p) => p.amazon?.ofertas ?? 0)),
    sinAmazon: con.filter((p) => !p.amazon?.amazonVende).length,
    suPrecioCompite: ambos.filter((p) => (p.precio ?? 0) <= (p.amazon?.precio ?? 0) * 1.01).length,
    conAmbosPrecios: ambos.length,
  }
}

export const esSinAmazon = (inf: unknown): inf is InformeSinAmazon => (inf as { clase?: string } | null)?.clase === 'sin_amazon'
