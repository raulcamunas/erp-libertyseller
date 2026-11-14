/**
 * AMAZON ADS · LAS REGLAS DE LOS TÉRMINOS DE BÚSQUEDA, COMO FUNCIONES PURAS.
 *
 * De los términos de búsqueda de una ventana (informe `spSearchTerm`, 30 días que acaban 3 antes de hoy) y de los objetivos de cada producto salen PROPUESTAS, cada una con su motivo en una línea.
 * Aquí NO se habla con Amazon ni con la base: entran datos y salen propuestas.
 *
 *
 * ============ LAS REGLAS ============
 *
 *   COSECHAR     ≥ N pedidos (3, estimación) con ACoS ≤ objetivo —o los pedidos de la ficha (SOP §7.1: 2) con ≥ 1 ÷ CVR clics— pasa a EXACTA (la ESTABILIDAD del producto si existe, si no la
 *                DOMINIO). Se propone A LA VEZ la negativa exacta en la campaña de origen, para que no compitan dos campañas propias. Un ASIN se cosecha a ATAQUE ASIN como segmentación por producto.
 *   NEGATIVIZAR  0 pedidos y (clics ≥ 3 ÷ CVR de referencia, o gasto ≥ 1,5 × CPA objetivo). Sustituye al «X clics» fijo, que en categorías de conversión baja excluía términos buenos.
 *   IRRELEVANTE  0 pedidos y el término no comparte ninguna palabra con el producto: se propone desde el primer clic, MARCADO PARA REVISAR. Decidir que es otra cosa es criterio humano (SOP).
 *
 * No se negativiza: el término que es la propia keyword (la dejaría muda: eso es puja o pausa) ni lo que tiene pedidos (eso es bajar la puja).
 * Los umbrales que no son del SOP están en umbrales.ts y se cambian por cuenta.
 */

import type { Rol } from './estructura'
import { clicsPorPedido, UMBRALES_DE_PARTIDA, type UmbralesEstimados } from './umbrales'

export interface TerminoDeBusqueda {
  termino: string
  campaignId: string
  campaignName: string
  adGroupName?: string
  clics: number
  gasto: number
  compras: number
  ventas: number
  /**
   * true si el término ES la propia keyword (o el propio ASIN) que lo trajo. Entonces no se negativiza: una negativa exacta de «jamon serrano» en la campaña de la keyword «jamon serrano» la deja
   * muda. Lo que gasta sin vender ahí se arregla en la segmentación (bajar la puja o pausarla), que es otra regla.
   */
  esSuSegmentacion?: boolean
  /** La keyword (o segmentación) que trajo el término: cuenta como «palabras del producto» para la regla de irrelevantes */
  keyword?: string | null
}

export interface UmbralesDeFicha {
  comprasParaExacta: number
  clicsMinimosNegativizar: number
  muestraMinimaClics: number
}

export interface ObjetivosParaReglas {
  /** ACoS objetivo del producto, en % */
  acosObjetivoPct: number
  /** Gasto sin venta a partir del cual se negativiza. Si se da `cpaObjetivo`, se recalcula con el múltiplo de los umbrales estimados */
  gastoMaximoSinVenta: number
  /** Lo que cuesta un pedido en el objetivo (precio × ACoS objetivo) */
  cpaObjetivo?: number
}

/** Lo que las reglas de términos necesitan además de la ficha (todo opcional: sin ello se comportan como antes, con los valores de partida) */
export interface ContextoDeReglas {
  /** CVR de referencia (pedidos ÷ clics) de cada campaña */
  cvrDe?: (campaignId: string) => number
  /** Las palabras que describen el producto (resumen, título…), para detectar términos que no tienen nada que ver */
  palabrasDelProducto?: readonly string[]
  /** Los umbrales estimados de la cuenta */
  estimados?: UmbralesEstimados
}

/** «pausar» necesita la migración 305 para poder guardarse (sin ella, el motor la calcula pero no la guarda y lo dice) */
export type TipoDePropuesta = 'negativizar' | 'promover' | 'puja' | 'presupuesto' | 'pausar'

export interface Propuesta {
  tipo: TipoDePropuesta
  termino: string
  /** La campaña donde se ha visto el término */
  campaignId: string
  campaignName: string
  desdeRol: Rol | null
  /** A qué campaña sube (solo en «promover») */
  haciaRol: Rol | null
  /** Para «promover»: también hay que negativizarlo en la campaña de origen */
  negativizarEnOrigen: boolean
  /** Una línea: qué dato justifica el cambio */
  motivo: string
  clics: number
  gasto: number
  compras: number
  acosPct: number | null
  /** El término es un ASIN (alguien llegó desde una ficha de producto, no escribiendo): se negativiza y se cosecha como segmentación por PRODUCTO, no como palabra clave */
  esAsin: boolean
  /** Negativa por IRRELEVANCIA (no comparte nada con el producto): la persona decide; el piloto automático no la aplica nunca */
  revisar?: boolean
}

/** ¿Es un ASIN? Amazon los devuelve en minúsculas en el informe de términos («b08knpppgd») */
export const esAsin = (termino: string): boolean => /^b0[a-z0-9]{8}$/i.test(termino.trim())

/** Para comparar textos de búsqueda: minúsculas, sin tildes y con los espacios normalizados («Jamón  serrano» = «jamon serrano») */
export const normalizarTexto = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * ¿El término de búsqueda es la propia segmentación que lo trajo? Con la keyword se compara el texto; con una segmentación por producto (`asin="B0…"` o `asin-expanded="B0…"`), el ASIN.
 * Las cláusulas de la automática («close-match»…) nunca coinciden con un término.
 */
export function esLaPropiaSegmentacion(termino: string, keyword: string | null | undefined): boolean {
  if (!keyword) return false
  const asin = /asin(?:-expanded)?="?(b0[a-z0-9]{8})"?/i.exec(keyword)?.[1]
  if (asin) return asin.toLowerCase() === termino.trim().toLowerCase()
  return normalizarTexto(keyword) === normalizarTexto(termino)
}

/**
 * LAS NOMENCLATURAS QUE CONVIVEN. La del ERP (la que crea «Crear campañas») es la de la izquierda. Pero en las cuentas hay otras: «Manual Exacta» a secas (Creative Toys), la del SOP de bulk
 * («AMPLIA», «EXACTA DOMINIO», «EXACTA ESTABILIDAD») y la de la skill de arranque («AUTO», «FRASE H10», «EXACTA», «ASIN H10», «EXACTA ASIN»). Antes el motor solo entendía la primera y las demás
 * campañas quedaban fuera sin decirlo. Cada variante se lleva a su papel en el embudo:
 */
const ALIAS_DE_ROL: Record<string, Rol> = {
  'AUTO RADAR': 'AUTO RADAR',
  AUTO: 'AUTO RADAR',
  'MANUAL AMPLIA': 'MANUAL AMPLIA',
  AMPLIA: 'MANUAL AMPLIA',
  'FRASE H10': 'MANUAL AMPLIA',
  FRASE: 'MANUAL AMPLIA',
  'MANUAL FRASE': 'MANUAL AMPLIA',
  'MANUAL EXACTA DOMINIO': 'MANUAL EXACTA / DOMINIO',
  'EXACTA DOMINIO': 'MANUAL EXACTA / DOMINIO',
  'MANUAL EXACTA ESTABILIDAD': 'MANUAL EXACTA / ESTABILIDAD',
  'EXACTA ESTABILIDAD': 'MANUAL EXACTA / ESTABILIDAD',
  // «Exacta» sin apellido = la de lo probado y cosechado: hace de ESTABILIDAD
  'MANUAL EXACTA': 'MANUAL EXACTA / ESTABILIDAD',
  EXACTA: 'MANUAL EXACTA / ESTABILIDAD',
  'ATAQUE ASIN': 'ATAQUE ASIN',
  'ASIN H10': 'ATAQUE ASIN',
  'EXACTA ASIN': 'ATAQUE ASIN',
}

/** La clave con la que se busca un alias: mayúsculas, sin tildes, sin barras ni espacios dobles («Manual Exacta / Dominio» → «MANUAL EXACTA DOMINIO») */
const claveDeRol = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * De «ASIN | SKU | RESUMEN | ESTRATEGIA» a sus partes, con la estrategia llevada a su papel en el embudo (cualquiera de las nomenclaturas de arriba). `nomenclatura` dice si era la del ERP o una
 * variante. null si el nombre no sigue ninguna (campañas viejas o de otro sistema: el motor no las toca).
 */
export function partesDeNombre(nombre: string): { asin: string; sku: string; resumen: string; rol: Rol; nomenclatura: 'erp' | 'variante' } | null {
  const trozos = nombre.split('|').map((t) => t.trim())
  if (trozos.length < 4) return null
  const original = trozos[trozos.length - 1]
  const rol = ALIAS_DE_ROL[claveDeRol(original)]
  if (!rol) return null
  return { asin: trozos[0].toUpperCase(), sku: trozos[1], resumen: trozos.slice(2, -1).join(' | '), rol, nomenclatura: original.replace(/\s+/g, ' ').toUpperCase() === rol ? 'erp' : 'variante' }
}

/** Palabras que no dicen nada del producto (para la regla de irrelevantes) */
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'para', 'con', 'sin', 'por', 'una', 'uno', 'unos', 'unas', 'y', 'o', 'en', 'al', 'a', 'the', 'for', 'and', 'with', 'pack', 'set'])

/** Las palabras con contenido de un texto (normalizadas, de 3 letras o más) */
export function palabrasDe(texto: string): string[] {
  return normalizarTexto(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 3 && !VACIAS.has(w) && !/^\d+$/.test(w))
}

/**
 * ¿El término comparte ALGUNA palabra con el producto? Se compara por la raíz (las 4 primeras letras: «jamones» = «jamon», «jamonero» también), que es tosca a propósito: más vale dejar pasar un
 * irrelevante (ya caerá por la regla de clics) que marcar como «otra cosa» una búsqueda buena. Sin palabras del producto, se da por relacionado.
 */
export function compartePalabra(termino: string, palabrasDelProducto: readonly string[]): boolean {
  if (palabrasDelProducto.length === 0) return true
  const raiz = (w: string) => w.slice(0, 4)
  const delProducto = new Set(palabrasDelProducto.map(raiz))
  const delTermino = palabrasDe(termino)
  if (delTermino.length === 0) return true
  return delTermino.some((w) => delProducto.has(raiz(w)))
}

/** El escalón al que sube un término desde cada campaña. ESTABILIDAD y ATAQUE ASIN no promueven: no son un escalón del embudo */
const SIGUIENTE: Partial<Record<Rol, Rol>> = {
  // Lo que ya vende con muestra suficiente va directo a EXACTA (investigación nov 2026, regla 7; quien llama la resuelve a ESTABILIDAD o, si no existe, a DOMINIO)
  'AUTO RADAR': 'MANUAL EXACTA / ESTABILIDAD',
  'MANUAL AMPLIA': 'MANUAL EXACTA / ESTABILIDAD',
}

/**
 * Y el de un ASIN: una ficha rival que vende con ACoS en objetivo se ataca DIRECTAMENTE, como segmentación por producto en ATAQUE ASIN (SOP: «cosecha hacia EXACTA ASIN… y negativiza en origen»).
 * Subirlo a AMPLIA como palabra clave «b08knpppgd» —lo que pasaba antes— creaba una keyword que nadie escribe. Desde ATAQUE ASIN no sube a ningún sitio: ya está en su campaña.
 */
const SIGUIENTE_ASIN: Partial<Record<Rol, Rol>> = {
  'AUTO RADAR': 'ATAQUE ASIN',
  'MANUAL AMPLIA': 'ATAQUE ASIN',
}

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const coma = (n: number, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: d })
/** Dinero siempre con dos decimales («10,00», no «10») */
const euros = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Las propuestas para un conjunto de términos. Se juzga cada término en cada campaña por separado, y un mismo término no produce dos propuestas en la misma campaña (si cumple dos reglas, manda
 * la de cosechar, que es la que tiene pedidos).
 */
export function proponerCambios(terminos: readonly TerminoDeBusqueda[], umbrales: UmbralesDeFicha, objetivos: ObjetivosParaReglas, ctx: ContextoDeReglas = {}): Propuesta[] {
  const propuestas: Propuesta[] = []
  const vistos = new Set<string>()
  const u = ctx.estimados ?? UMBRALES_DE_PARTIDA
  const gastoTope = objetivos.cpaObjetivo != null && objetivos.cpaObjetivo > 0 ? redondear(objetivos.cpaObjetivo * u.negativizarGastoXCpa) : objetivos.gastoMaximoSinVenta

  for (const t of terminos) {
    const partes = partesDeNombre(t.campaignName)
    if (!partes) continue // fuera de la nomenclatura: no se toca
    const clave = `${t.campaignId}|${t.termino.trim().toLowerCase()}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    if (t.clics <= 0) continue

    const cvr = ctx.cvrDe?.(t.campaignId) ?? u.cvrPorDefectoPct / 100
    const unPedido = clicsPorPedido(cvr)
    const acos = t.ventas > 0 ? redondear((t.gasto / t.ventas) * 100, 1) : null
    const asin = esAsin(t.termino)
    const base = { termino: t.termino.trim(), campaignId: t.campaignId, campaignName: t.campaignName, desdeRol: partes.rol, clics: t.clics, gasto: redondear(t.gasto), compras: t.compras, acosPct: acos, esAsin: asin }

    // ---- cosechar ----
    const siguiente = (asin ? SIGUIENTE_ASIN : SIGUIENTE)[partes.rol]
    const muestraParaCosechar = t.compras >= u.pedidosParaCosechar || (t.compras >= umbrales.comprasParaExacta && t.clics >= unPedido)
    if (siguiente && muestraParaCosechar && acos !== null && acos <= objetivos.acosObjetivoPct) {
      propuestas.push({
        ...base,
        tipo: 'promover',
        haciaRol: siguiente,
        negativizarEnOrigen: true,
        motivo: `${t.compras} pedidos con ACoS ${coma(acos)} % (objetivo ${coma(objetivos.acosObjetivoPct)} %) en ${t.clics} clics: pasa de ${partes.rol} a ${asin ? 'ATAQUE ASIN' : 'EXACTA'} y se excluye del origen`,
      })
      continue
    }

    // El término que es la propia keyword no se negativiza (la dejaría muda), ni lo que vende: eso lo resuelven las reglas de puja y pausa de la segmentación
    if (t.esSuSegmentacion || t.compras > 0 || t.ventas > 0) continue

    // ---- negativizar un término relevante que no convierte ----
    const clicsTope = Math.ceil(u.negativizarClicsPorCvr * (1 / cvr) - 1e-9)
    const porClics = t.clics >= clicsTope
    const porGasto = gastoTope > 0 && t.gasto >= gastoTope
    if (porClics || porGasto) {
      propuestas.push({
        ...base,
        tipo: 'negativizar',
        haciaRol: null,
        negativizarEnOrigen: false,
        motivo: `${asin ? 'Ficha de producto ' + t.termino.trim().toUpperCase() + ': ' : ''}${euros(t.gasto)} gastados en ${t.clics} clics sin ningún pedido (${porClics ? `con un CVR del ${coma(cvr * 100)} %, ${clicsTope} clics sin pedido ya no son mala suerte` : `pasa ${coma(u.negativizarGastoXCpa)}× el CPA objetivo, ${euros(gastoTope)}`})`,
      })
      continue
    }

    // ---- irrelevante: no comparte nada con el producto (para revisar) ----
    if (!asin && ctx.palabrasDelProducto && ctx.palabrasDelProducto.length > 0 && t.clics >= u.irrelevanteClics) {
      const delProducto = [...ctx.palabrasDelProducto, ...palabrasDe(t.keyword && !/^(close|loose)-match|substitutes|complements|asin/i.test(t.keyword) ? t.keyword : '')]
      if (!compartePalabra(t.termino, delProducto)) {
        propuestas.push({
          ...base,
          tipo: 'negativizar',
          haciaRol: null,
          negativizarEnOrigen: false,
          revisar: true,
          motivo: `REVISAR: «${t.termino.trim()}» no comparte ninguna palabra con el producto y lleva ${t.clics} ${t.clics === 1 ? 'clic' : 'clics'} (${euros(t.gasto)}) sin pedido. Si es otra cosa (otro formato, otra categoría, una marca ajena), exclúyelo ya; si es una búsqueda buena, descártalo`,
        })
      }
    }
  }

  // Primero lo que mejora (cosechar), luego lo que ahorra, y dentro de cada tipo lo que más gasto mueve
  return propuestas.sort((a, b) => (a.tipo === b.tipo ? b.gasto - a.gasto : a.tipo === 'promover' ? -1 : 1))
}
