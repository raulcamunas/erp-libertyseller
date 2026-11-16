/**
 * AMAZON ADS · EL AGENTE PPC: STOCK POR ASIN, EFN, COBERTURA Y DECISIÓN DE PAUSA. PURO (nada de servidor).
 *
 * - `stockDeAsin`: suma por ASIN TODOS sus SKU del marketplace. FBA → «Disponible (FBA)» (`fba_fulfillable_quantity`,
 *   que desde b168c2a1d ya incluye lo que está en transferencia entre centros); no FBA → `quantity`. No se suma el
 *   entrante (`fba_inbound_quantity`): es mercancía aún no recibida y no se puede vender.
 * - `stockEfectivo`: EFN. Francia, Alemania, Italia, Países Bajos, Bélgica, Suecia y Polonia se sirven desde el almacén
 *   de España: si el país da 0 o nada, cuenta el de España (y lo dice en `fuente`).
 * - `coberturaDias`: días que aguanta el stock al ritmo de los últimos 14 días.
 * - `decisionDeStock`: pausar SOLO con stock 0 en dos lecturas separadas ≥ 6 h, listing fresco (< 6 h) y la campaña
 *   gastando hoy. Si no se cumple todo, solo se recorta la postura (con el porqué para el aviso).
 * - `puedeReactivar`: stock ≥ 5 en lectura fresca y nadie ha tocado a mano el estado desde la pausa.
 * - `topeDePosturaPorStock`: el máximo de postura que permite el stock.
 *
 * Solo importa de './tipos'.
 */

import { AGENTE, type DecisionDeStock, type Postura } from './tipos'

/** Marketplaces servidos desde el almacén de España (EFN) */
export const PAISES_EFN: readonly string[] = ['FR', 'DE', 'IT', 'NL', 'BE', 'SE', 'PL']

/** País del que sale el stock de los EFN */
const PAIS_ORIGEN_EFN = 'ES'

const HORA_MS = 3_600_000

type Stock = { stock: number | null; actualizadoAt: string | null }

// ───────────────────────────── auxiliares ─────────────────────────────

const esNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const msDe = (iso: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** El instante más viejo de dos ISO (el que falte no cuenta) */
const masViejo = (a: string | null, b: string | null): string | null => {
  const ta = msDe(a)
  const tb = msDe(b)
  if (ta === null) return tb === null ? null : b
  if (tb === null) return a
  return ta <= tb ? a : b
}

/** Horas desde un ISO hasta `ahora`; null si no hay fecha */
const horasDesde = (iso: string | null, ahora: number): number | null => {
  const t = msDe(iso)
  return t === null ? null : (ahora - t) / HORA_MS
}

const unDecimal = (h: number): string => (Math.round(h * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 })

// ───────────────────────────── stock por ASIN ─────────────────────────────

/**
 * Σ por ASIN de todos sus SKU. FBA → `fbaDisponible`; no FBA → `quantity` (si no se sabe si es FBA, el primero que
 * tenga número). `stock` null si ninguna fila del ASIN trae número. `actualizadoAt` = el `updatedAt` más viejo de las
 * filas VIVAS del ASIN (la lectura vale lo que su parte más antigua): las que aportan número (si ninguna lo aporta, todas)
 * y no llevan más de `STOCK_SKU_MUERTO_HORAS` de retraso frente a la más reciente. Un SKU borrado o retirado que el sync
 * ya no actualiza dejaría si no el stock «viejo» para siempre (freno por datos viejos y nunca un listing fresco). Su
 * número SÍ se sigue sumando: ante la duda, más stock (no se pausa por un dato dudoso).
 */
export function stockDeAsin(
  filas: ReadonlyArray<{ asin: string | null; isFba: boolean | null; quantity: number | null; fbaDisponible: number | null; updatedAt: string | null }>,
): Map<string, { stock: number | null; actualizadoAt: string | null }> {
  const porAsin = new Map<string, Array<{ n: number | null; iso: string | null; ms: number | null }>>()
  for (const f of filas) {
    const asin = (f.asin ?? '').trim().toUpperCase()
    if (!asin) continue
    const valor = f.isFba === true ? f.fbaDisponible : f.isFba === false ? f.quantity : (f.fbaDisponible ?? f.quantity)
    const n = esNumero(valor) ? Math.max(0, valor) : null
    const lista = porAsin.get(asin) ?? []
    lista.push({ n, iso: f.updatedAt ?? null, ms: msDe(f.updatedAt ?? null) })
    porAsin.set(asin, lista)
  }
  const r = new Map<string, Stock>()
  for (const [asin, lista] of Array.from(porAsin.entries())) {
    const conNumero = lista.filter((x) => x.n !== null)
    const stock = conNumero.length ? conNumero.reduce((s, x) => s + (x.n as number), 0) : null
    const conFecha = (conNumero.length ? conNumero : lista).filter((x) => x.ms !== null)
    let actualizadoAt: string | null = null
    if (conFecha.length) {
      const masReciente = Math.max(...conFecha.map((x) => x.ms as number))
      const vivas = conFecha.filter((x) => masReciente - (x.ms as number) <= AGENTE.STOCK_SKU_MUERTO_HORAS * HORA_MS)
      for (const x of vivas) actualizadoAt = masViejo(actualizadoAt, x.iso)
    }
    r.set(asin, { stock, actualizadoAt })
  }
  return r
}

// ───────────────────────────── EFN ─────────────────────────────

/**
 * El stock que cuenta en `pais`. En un país EFN con 0 o sin dato, el de España (si España tiene número).
 * `fuente` dice de dónde sale la cifra, para el aviso.
 */
export function stockEfectivo(
  local: { stock: number | null; actualizadoAt: string | null } | undefined,
  origen: { stock: number | null; actualizadoAt: string | null } | undefined,
  pais: string,
): { stock: number | null; actualizadoAt: string | null; fuente: string } {
  const p = (pais ?? '').trim().toUpperCase()
  const stockLocal = local?.stock ?? null
  const fechaLocal = local?.actualizadoAt ?? null
  const efn = PAISES_EFN.includes(p)
  if (efn && (stockLocal === null || stockLocal === 0) && origen && esNumero(origen.stock)) {
    const motivo = stockLocal === null ? `sin dato en ${p}` : `${p} a 0`
    return { stock: origen.stock, actualizadoAt: origen.actualizadoAt ?? null, fuente: `inventario de ${PAIS_ORIGEN_EFN} (EFN, ${motivo})` }
  }
  if (stockLocal === null) return { stock: null, actualizadoAt: fechaLocal, fuente: `sin dato de stock en ${p || 'el país'}` }
  return { stock: stockLocal, actualizadoAt: fechaLocal, fuente: `inventario de ${p || 'el país'}` }
}

// ───────────────────────────── cobertura ─────────────────────────────

/** stock ÷ (unidades vendidas en 14 d ÷ 14), a 1 decimal. null si no se sabe el stock o no hay ventas */
export function coberturaDias(stock: number | null, unidades14: number | null): number | null {
  if (!esNumero(stock) || !esNumero(unidades14) || unidades14 <= 0) return null
  const dias = Math.max(0, stock) / (unidades14 / 14)
  return Math.round(dias * 10) / 10
}

// ───────────────────────────── pausar ─────────────────────────────

/**
 * Pausar solo si TODO: stock 0 en ≥ 2 lecturas separadas ≥ 6 h (`ceroDesde` = la primera lectura a 0), listing
 * actualizado hace < 6 h y la campaña sigue gastando hoy. Un ASIN en la campaña → `pausar_campana`; varios →
 * `pausar_anuncio`. Stock 0 sin todo lo anterior → `solo_recortar` con el porqué. Stock > 0 o desconocido → `nada`
 * (el desconocido ya lo limita `topeDePosturaPorStock`).
 */
export function decisionDeStock(e: {
  stock: number | null
  ceroDesde: string | null
  lecturasCero: number
  listingAt: string | null
  ahora: number
  campanaGastaHoy: boolean
  asinsEnCampana: number
}): { decision: DecisionDeStock; porque: string } {
  if (!esNumero(e.stock)) return { decision: 'nada', porque: 'stock desconocido: no se pausa nada (la postura queda como mucho en mantener)' }
  if (e.stock > 0) return { decision: 'nada', porque: `hay stock (${e.stock})` }

  const faltas: string[] = []
  const horasCero = horasDesde(e.ceroDesde, e.ahora)
  if (e.lecturasCero < AGENTE.STOCK_CERO_LECTURAS) {
    faltas.push(`solo ${e.lecturasCero === 1 ? 'una lectura' : `${e.lecturasCero} lecturas`} a 0 (hacen falta ${AGENTE.STOCK_CERO_LECTURAS})`)
  }
  if (horasCero === null) faltas.push('no se sabe desde cuándo está a 0')
  else if (horasCero < AGENTE.STOCK_CERO_HORAS_ENTRE) {
    faltas.push(`a 0 desde hace ${unDecimal(horasCero)} h (hacen falta ${AGENTE.STOCK_CERO_HORAS_ENTRE} h entre lecturas)`)
  }
  const horasListing = horasDesde(e.listingAt, e.ahora)
  if (horasListing === null) faltas.push('no se sabe cuándo se leyó el inventario')
  else if (horasListing >= AGENTE.LISTING_FRESCO_HORAS) {
    faltas.push(`el inventario se leyó hace ${unDecimal(horasListing)} h (debe ser de menos de ${AGENTE.LISTING_FRESCO_HORAS} h)`)
  }
  if (!e.campanaGastaHoy) faltas.push('la campaña no está gastando hoy')

  if (faltas.length) return { decision: 'solo_recortar', porque: `stock 0, pero no se pausa: ${faltas.join('; ')}` }

  const horas = unDecimal(horasCero ?? 0)
  if (e.asinsEnCampana > 1) {
    return { decision: 'pausar_anuncio', porque: `stock 0 en ${e.lecturasCero} lecturas en ${horas} h y la campaña sigue gastando; tiene ${e.asinsEnCampana} productos: se pausa solo el anuncio de este` }
  }
  return { decision: 'pausar_campana', porque: `stock 0 en ${e.lecturasCero} lecturas en ${horas} h y la campaña sigue gastando` }
}

/**
 * PURO. decisionDeStock con los anuncios LEÍDOS de la campaña. Sin ellos (falló la lectura, o la campaña no está en lo leído) no se sabe cuántos productos
 * tiene: el nombre no lo garantiza, y pausar la campaña entera pararía también los productos con stock. Ante la duda no se pausa nada: solo recortar.
 * Solo se pausa la campaña cuando la lista de anuncios leída confirma un único ASIN.
 */
export function decisionDeStockConAnuncios(
  e: Omit<Parameters<typeof decisionDeStock>[0], 'asinsEnCampana'>,
  anuncios: ReadonlyArray<{ asin: string }> | null
): { decision: DecisionDeStock; porque: string } {
  if (!anuncios || anuncios.length === 0) {
    const d = decisionDeStock({ ...e, asinsEnCampana: 1 })
    if (d.decision === 'pausar_campana' || d.decision === 'pausar_anuncio') return { decision: 'solo_recortar', porque: 'stock 0, pero no he podido leer los anuncios de la campaña: no pauso' }
    return d
  }
  const asins = new Set(anuncios.map((a) => String(a.asin ?? '').toUpperCase()).filter(Boolean)).size
  if (asins === 0) {
    const d = decisionDeStock({ ...e, asinsEnCampana: 1 })
    if (d.decision === 'pausar_campana' || d.decision === 'pausar_anuncio') return { decision: 'solo_recortar', porque: 'stock 0, pero los anuncios leídos no dicen qué productos tiene la campaña: no pauso' }
    return d
  }
  return decisionDeStock({ ...e, asinsEnCampana: asins })
}

// ───────────────────────────── reactivar ─────────────────────────────

/** Reactivar si stock ≥ 5 en una lectura fresca (< 6 h) y nadie ha cambiado a mano el estado desde la pausa */
export function puedeReactivar(e: { stock: number | null; listingAt: string | null; ahora: number; cambiosManualesDesdeLaPausa: number }): { reactivar: boolean; porque: string } {
  if (!esNumero(e.stock)) return { reactivar: false, porque: 'stock desconocido' }
  if (e.stock < AGENTE.STOCK_REACTIVAR) return { reactivar: false, porque: `stock ${e.stock}: hacen falta ${AGENTE.STOCK_REACTIVAR} o más` }
  const h = horasDesde(e.listingAt, e.ahora)
  if (h === null) return { reactivar: false, porque: 'no se sabe cuándo se leyó el inventario' }
  if (h >= AGENTE.LISTING_FRESCO_HORAS) return { reactivar: false, porque: `el inventario se leyó hace ${unDecimal(h)} h (debe ser de menos de ${AGENTE.LISTING_FRESCO_HORAS} h)` }
  if (e.cambiosManualesDesdeLaPausa > 0) {
    return { reactivar: false, porque: `alguien cambió a mano el estado desde la pausa (${e.cambiosManualesDesdeLaPausa} ${e.cambiosManualesDesdeLaPausa === 1 ? 'cambio' : 'cambios'}): no se reactiva` }
  }
  return { reactivar: true, porque: `vuelve a haber stock (${e.stock})` }
}

// ───────────────────────────── tope de postura ─────────────────────────────

/**
 * Stock 0 o cobertura < 7 días → como mucho `recortar`; cobertura < 14 días o stock desconocido → como mucho
 * `mantener`; si no, sin tope (`crecer`, porque null). Stock conocido y sin ventas (cobertura null) no limita.
 */
export function topeDePosturaPorStock(stock: number | null, cobertura: number | null): { maximo: Postura; porque: string | null } {
  if (!esNumero(stock)) return { maximo: 'mantener', porque: 'stock desconocido' }
  if (stock <= 0) return { maximo: 'recortar', porque: 'sin stock' }
  if (esNumero(cobertura)) {
    const c = unDecimal(cobertura)
    if (cobertura < AGENTE.COBERTURA_RECORTAR_DIAS) return { maximo: 'recortar', porque: `cobertura de ${c} días (< ${AGENTE.COBERTURA_RECORTAR_DIAS})` }
    if (cobertura < AGENTE.COBERTURA_MANTENER_DIAS) return { maximo: 'mantener', porque: `cobertura de ${c} días (< ${AGENTE.COBERTURA_MANTENER_DIAS})` }
  }
  return { maximo: 'crecer', porque: null }
}

/**
 * Los productos sin stock (los que vigilar pausa y los que solo recorta) que hay que dejar en «recortar» AHORA, sin esperar al cerebro de las 08:00 (§6.5).
 * Solo devuelve los que no están ya en «recortar» (`antes` = la postura guardada, o null si no había): así vigilar no reescribe cada 10 minutos.
 */
export function posturasPorStock(
  asins: ReadonlyArray<{ asin: string; porque: string }>,
  guardadas: ReadonlyMap<string, Postura>,
): Array<{ asin: string; antes: Postura | null; motivo: string }> {
  const vistos = new Set<string>()
  const r: Array<{ asin: string; antes: Postura | null; motivo: string }> = []
  for (const a of asins) {
    const asin = a.asin.toUpperCase()
    if (vistos.has(asin)) continue
    vistos.add(asin)
    const antes = guardadas.get(asin) ?? null
    if (antes === 'recortar') continue
    r.push({ asin, antes, motivo: `Sin stock: recortar (${a.porque})`.slice(0, 300) })
  }
  return r
}

/** Estados de una propuesta de pausa que ya está hecha (o a punto) a efectos de no proponerla otra vez. «ensayada» solo cuenta en ensayo (ver `pausasYaHechas`) */
export const ESTADOS_DE_PAUSA_HECHA: string[] = ['pendiente', 'aprobada', 'aplicando', 'aplicada', 'ensayada']

export type FilaDePausa = { tipo: string; campaign_id: string; objetivo_id: string | null; objetivo_tipo: string | null; estado: string; agente_at?: string | null }

/**
 * Las campañas y anuncios que ya tienen su pausa (por stock) hecha o en marcha. Una «ensayada» cuenta SOLO si el agente sigue en ensayo y es de ESTE ensayo
 * (agente_at ≥ encendido; sin fecha de encendido, de las últimas 24 h): así la misma pausa no se vuelve a ensayar cada 30 minutos. En activo o frenado no cuenta.
 */
export function pausasYaHechas(
  filas: ReadonlyArray<FilaDePausa>,
  estado: string,
  encendidoAt: string | null,
  ahora: number,
): { campanas: Set<string>; anuncios: Set<string> } {
  const desdeEnsayo = msDe(encendidoAt) ?? ahora - 24 * HORA_MS
  const cuenta = (p: FilaDePausa): boolean => {
    if (p.estado !== 'ensayada') return ['pendiente', 'aprobada', 'aplicando', 'aplicada'].includes(p.estado)
    if (estado !== 'ensayo') return false
    const t = msDe(p.agente_at ?? null)
    return t != null && t >= desdeEnsayo
  }
  const campanas = new Set<string>()
  const anuncios = new Set<string>()
  for (const p of filas) {
    if (!cuenta(p)) continue
    if (p.tipo === 'pausar-campana') campanas.add(p.campaign_id)
    else if (p.objetivo_tipo === 'anuncio' && p.objetivo_id) anuncios.add(p.objetivo_id)
  }
  return { campanas, anuncios }
}
