/**
 * LÍMITES Y CALIDAD DEL INFORME DE UNA TIENDA SIN AMAZON (función pura, sin red).
 *
 * El 14 nov 2026 Raúl vio un informe con «Barritas de Ternera, 0,90 €» que, tras la logística de Amazon, «dejaba» −2,94 € por venta. Al revisar los 58
 * informes ya hechos salieron más cosas del mismo origen: la cuenta del margen mezclaba el precio de SU producto con la comisión y la logística de
 * OTROS (los de la categoría), y a veces su producto y el mercado no se parecen (un kit de batería de 7.240 € contra una mediana de 300 €, un vestido de
 * comunión de 480 € contra 33 €), o Amazon clasifica el mercado como accesorios (los «Monitores» eran soportes de monitor).
 *
 * Todo se calcula al leer el informe, no al guardarlo: así vale para los ya hechos sin volver a pedir nada a Keepa, y los límites se pueden mover aquí.
 *
 *   cuentaDeMercado   lo que le llega por venta, o por qué no se calcula (precio bajo, margen nulo, sin tarifas)
 *   evaluarMercado    ok · ajustado (se enseña, pero sin comparar su precio) · dudoso (no se enseña al lead)
 *   depurar           el informe sin los mercados dudosos, con sus textos rehechos, y su calidad: bueno · revisar · flojo
 */
import { textosDelInforme, type InformeSinAmazon, type MercadoSinAmazon } from './construir'

export const LIMITES = {
  /** Por debajo de este precio de venta (con IVA) la tarifa fija de logística de Amazon pesa más que el producto: no se calcula lo que queda */
  precioMinimoCuenta: 10,
  /** Si lo que queda por venta (antes de coste, publicidad…) es menos de este tanto del precio, la cuenta no dice nada útil */
  margenMinimo: 0.3,
  /** Su precio y la mediana de Amazon se comparan solo si van de 1/3 a 3 veces uno del otro; fuera de ahí son productos de otra gama */
  veces: 3,
  /** Una marca con tantas fichas es una marca grande, o comparte nombre con otra: lo confirma una persona */
  fichasDeMarcaGrande: 100,
  /** Un mercado con menos productos que estos no se enseña */
  productosMinimos: 3,
} as const

/** IVA general en España: el precio de venta de Amazon lo lleva dentro (en alimentación y libros es menor) */
export const IVA_GENERAL = 0.21
/** La «tasa Google» que Amazon repercute en España sobre su comisión: un 3 % de la comisión */
export const TASA_DIGITAL = 0.03

export type Cuenta = {
  /** el precio con el que se hace la cuenta: el suyo si se puede comparar con el mercado; si no, la mediana de Amazon */
  base: number
  usaSuyo: boolean
  /** null si falta su precio o la mediana */
  comparable: boolean | null
  /** su precio frente a la mediana, en %, solo si es comparable */
  pct: number | null
  iva: number
  comision: number
  tasaDigital: number
  logistica: number
  llega: number | null
  /** por qué no hay cuenta: sin tarifas de Keepa, precio bajo, o margen nulo */
  sinCuenta: null | 'sin-tarifas' | 'precio-bajo' | 'margen-bajo'
}

export function cuentaDeMercado(m: MercadoSinAmazon): Cuenta {
  const suyo = m.suyo?.precio ?? 0
  const med = m.precioMediano ?? 0
  const ratio = suyo > 0 && med > 0 ? suyo / med : null
  const comparable = ratio === null ? null : ratio >= 1 / LIMITES.veces && ratio <= LIMITES.veces
  const usaSuyo = suyo > 0 && comparable !== false
  const base = usaSuyo ? suyo : med
  const pct = usaSuyo && comparable && med ? Math.round(((suyo - med) / med) * 100) : null
  const vacia = { base, usaSuyo, comparable, pct, iva: 0, comision: 0, tasaDigital: 0, logistica: m.logistica ?? 0, llega: null }
  if (!base || !m.comisionPct || !m.logistica) return { ...vacia, sinCuenta: 'sin-tarifas' }

  // El precio de Amazon lleva el IVA dentro y la comisión se calcula sobre ese precio con IVA; el IVA es de Hacienda, no del vendedor. Las tarifas de Amazon
  // llevan IVA, pero una empresa lo recupera: no es un coste
  const iva = base - base / (1 + IVA_GENERAL)
  const comision = (base * m.comisionPct) / 100
  const tasaDigital = comision * TASA_DIGITAL
  const llega = base - iva - comision - tasaDigital - m.logistica
  const cuenta = { ...vacia, iva, comision, tasaDigital, llega }
  if (base < LIMITES.precioMinimoCuenta) return { ...cuenta, sinCuenta: 'precio-bajo' }
  if (llega <= 0 || llega / base < LIMITES.margenMinimo) return { ...cuenta, sinCuenta: 'margen-bajo' }
  return { ...cuenta, sinCuenta: null }
}

const sinTildes = (t: string) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
/** Las 5 primeras letras de cada palabra con contenido (4+ letras, sin cifras): «Arneses» y «arnés» comparten «arnes» */
const raices = (t: string) =>
  new Set(
    sinTildes(t)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !/\d/.test(w) && !/^(para|tipo|interior|exterior|otros|otras|varios|infantil|infantiles|hombre|mujer)$/.test(w))
      .map((w) => w.slice(0, 5)),
  )
/** Amazon clasifica como accesorio, recambio o complemento (no como el producto en sí) */
const ACCESORIO = /^(soportes?|fundas?|kits?|recambios?|repuestos?|accesorios?|cables?|cargadores?|carcasas?|grifos?|embellecedor\w*)$/
const AMBIGUA = /^(seca|humeda|otros|otras|varios|juegos|accesorios|general|generales)$/

export type Veredicto = {
  estado: 'ok' | 'ajustado' | 'dudoso'
  /** Para la persona que va a mandar el informe */
  avisos: string[]
  /** Algo que solo una persona puede decidir (¿la categoría de Amazon es lo que vende?): el informe queda en «revisar» aunque el mercado se enseñe */
  revisar: boolean
  /** Solo si es dudoso: por qué no se enseña al lead */
  motivo: string | null
}

const eur = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

export function evaluarMercado(m: MercadoSinAmazon): Veredicto {
  const avisos: string[] = []
  const cat = m.categoria ?? ''
  const cabeza = sinTildes(cat).split(/[^a-z]+/).find(Boolean) ?? ''

  let revisar = false
  if (m.productos.length < LIMITES.productosMinimos) return { estado: 'dudoso', avisos, revisar, motivo: `solo ${m.productos.length} productos` }

  // Amazon pone ese mercado en accesorios/recambios y lo suyo no lo es («Monitores» → «Soportes para monitor»)
  if (ACCESORIO.test(cabeza) && !raices(m.nombre).has(cabeza.slice(0, 5)))
    return { estado: 'dudoso', avisos, revisar, motivo: `Amazon lo clasifica como «${cat}», que no es lo que vende (${m.nombre})` }

  // La categoría que ha salido no se parece a lo que se buscaba. Las palabras no bastan para ocultarlo («Cristalería» → «Copas de vino» es correcto,
  // «Quemagrasas» → «Ácidos grasos esenciales» no): se enseña y lo mira una persona. Solo en los que se buscan por texto: los de marca salen de sus fichas
  if (m.origen === 'texto' && cat) {
    const a = raices(m.nombre)
    const b = raices(cat)
    if (a.size && b.size && ![...a].some((r) => b.has(r))) {
      avisos.push(`La categoría de Amazon («${cat}») no se parece a «${m.nombre}»: comprueba que es lo que vende`)
      revisar = true
    }
  }

  if (AMBIGUA.test(sinTildes(m.nombre).trim())) avisos.push(`El nombre «${m.nombre}» no dice qué producto es`)

  const c = cuentaDeMercado(m)
  const suyo = m.suyo?.precio ?? 0
  if (c.comparable === false && m.precioMediano) {
    avisos.push(`Su precio (${eur(suyo)}) y la mediana de Amazon (${eur(m.precioMediano)}) son de otra gama: no se comparan`)
    return { estado: 'ajustado', avisos, revisar, motivo: null }
  }
  return { estado: 'ok', avisos, revisar, motivo: null }
}

export type Calidad = {
  nivel: 'bueno' | 'revisar' | 'flojo'
  /** Lo que tiene que saber quien va a mandarlo */
  motivos: string[]
  /** Los mercados que no se enseñan al lead, y por qué */
  ocultos: { nombre: string; motivo: string }[]
  mercadosBuenos: number
}

/**
 * El informe sin los mercados dudosos (y con sus titulares, claves y chuleta rehechos si ha quitado alguno) y su calidad:
 *   flojo    no queda ningún mercado y su marca no está en Amazon: no hay nada que enseñar, no se manda
 *   revisar  se ha ocultado algo, hay un mercado con la categoría dudosa, no queda mercado o la marca es enorme: que lo mire una persona antes de mandarlo
 *   bueno    se puede mandar
 */
export function depurar(inf: InformeSinAmazon): InformeSinAmazon & { calidad: Calidad } {
  const vs = inf.mercados.map((m) => ({ m, v: evaluarMercado(m) }))
  const utiles = vs.filter((x) => x.v.estado !== 'dudoso').map((x) => x.m)
  const ocultos = vs.filter((x) => x.v.estado === 'dudoso').map((x) => ({ nombre: x.m.nombre, motivo: x.v.motivo ?? '' }))

  const motivos: string[] = [
    ...ocultos.map((o) => `No se enseña «${o.nombre}»: ${o.motivo}`),
    ...vs.filter((x) => x.v.estado !== 'dudoso').flatMap((x) => x.v.avisos.map((a) => `«${x.m.nombre}»: ${a}`)),
  ]
  const grande = inf.marca.modelos > LIMITES.fichasDeMarcaGrande
  if (grande) motivos.push(`Su marca tiene ${inf.marca.modelos.toLocaleString('es-ES')} fichas en Amazon: es una marca grande o comparte nombre con otra. Confirma que es la suya`)
  if (!utiles.length) motivos.push(inf.caso === 'revendida' ? 'No hay ningún mercado fiable: solo se enseñan las fichas de su marca' : 'No hay ningún mercado fiable que enseñar')

  const aMirar = vs.some((x) => x.v.estado !== 'dudoso' && x.v.revisar)
  const nivel: Calidad['nivel'] = !utiles.length && inf.caso === 'ausente' ? 'flojo' : ocultos.length || aMirar || grande || !utiles.length ? 'revisar' : 'bueno'

  const calidad: Calidad = { nivel, motivos, ocultos, mercadosBuenos: utiles.length }
  const textos = textosDelInforme({
    caso: inf.caso,
    marcaNombre: inf.marca.nombre,
    modelos: inf.marca.modelos,
    nombresTerceros: inf.marca.vendedores.map((v) => v.nombre),
    sinVendedor: inf.marca.sinVendedor,
    revisadas: inf.marca.revisadas,
    productosWeb: inf.catalogo.productos,
    mercados: utiles,
  })
  // Sin nada oculto se respetan los textos guardados, salvo la chuleta del comercial: se rehace siempre para que los informes ya hechos
  // lleven también las frases de hoy (el comercial pasa al lead a nuestro equipo de estrategia, no se lo explica él)
  if (utiles.length === inf.mercados.length) return { ...inf, guion: textos.guion, calidad }
  return { ...inf, mercados: utiles, ...textos, calidad }
}
