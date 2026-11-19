/**
 * TRÁFICO Y CONVERSIÓN DEL CLIENTE — PURO (sin base ni red). Lo usan el servidor y la página.
 *
 * Las mismas cuentas que el Excel «Tráfico y conversión por juego»:
 *   · Conversión = unidades encargadas ÷ sesiones.
 *   · Buy Box medio = ponderado por visitas (visitas con Buy Box ÷ visitas).
 *   · Sesiones al día = sesiones ÷ días del periodo; «×» = cuántas veces se multiplican frente al periodo con el que se compara.
 *   · Los juegos suman las ediciones en otros idiomas y las variantes de color (cada ASIN dice a qué juego pertenece).
 *   · Las semanas van de lunes a domingo y se numeran como en Amazon (ISO: la W47 de 2026 es del 16 al 22 de noviembre).
 */

export interface Cifras {
  sesiones: number
  navegador: number
  app: number
  visitas: number
  visitasBB: number
  unidades: number
  pedidos: number
  ventas: number
}

/** Una fila de la base ya sumada: por día (`clave` = AAAA-MM-DD), por mes (AAAA-MM) o en total */
export interface FilaAgregada extends Cifras {
  clave: string
  asin: string
}

export interface DatoDeAsin {
  juego: string
  producto: string | null
}

export const CERO: Cifras = { sesiones: 0, navegador: 0, app: 0, visitas: 0, visitasBB: 0, unidades: 0, pedidos: 0, ventas: 0 }

export function sumar(a: Cifras, b: Cifras): Cifras {
  return {
    sesiones: a.sesiones + b.sesiones,
    navegador: a.navegador + b.navegador,
    app: a.app + b.app,
    visitas: a.visitas + b.visitas,
    visitasBB: a.visitasBB + b.visitasBB,
    unidades: a.unidades + b.unidades,
    pedidos: a.pedidos + b.pedidos,
    ventas: a.ventas + b.ventas,
  }
}

export const sumarTodas = (filas: readonly Cifras[]): Cifras => filas.reduce(sumar, CERO)

/** null cuando no hay con qué dividir (sin sesiones no hay conversión: «—», no 0 %) */
export const conversion = (c: Cifras): number | null => (c.sesiones > 0 ? c.unidades / c.sesiones : null)
export const buyBox = (c: Cifras): number | null => (c.visitas > 0 ? c.visitasBB / c.visitas : null)
export const precioMedio = (c: Cifras): number | null => (c.unidades > 0 ? c.ventas / c.unidades : null)

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

const DIA_MS = 86_400_000
export const sumarDias = (dia: string, n: number): string => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)
export const diasEntre = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS) + 1
export const esDia = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`))

/** Los días de un periodo, en orden */
export function diasDe(desde: string, hasta: string): string[] {
  const n = diasEntre(desde, hasta)
  return n > 0 ? Array.from({ length: n }, (_, i) => sumarDias(desde, i)) : []
}

/** La semana ISO de un día: su número, su año y su lunes y domingo */
export function semanaIso(dia: string): { anio: number; semana: number; lunes: string; domingo: string } {
  const d = new Date(`${dia}T00:00:00Z`)
  const diaSemana = (d.getUTCDay() + 6) % 7 // lunes = 0
  const lunes = sumarDias(dia, -diaSemana)
  const jueves = new Date(`${sumarDias(lunes, 3)}T00:00:00Z`)
  const anio = jueves.getUTCFullYear()
  const primeroDeEnero = Date.UTC(anio, 0, 1)
  const semana = Math.floor((jueves.getTime() - primeroDeEnero) / DIA_MS / 7) + 1
  return { anio, semana, lunes, domingo: sumarDias(lunes, 6) }
}

export interface PeriodoElegible {
  id: string
  texto: string
  desde: string
  hasta: string
}

/** Las semanas (de la más reciente a la más antigua) que tienen algún día entre `primerDia` y `ultimoDia` */
export function semanasDisponibles(primerDia: string, ultimoDia: string): PeriodoElegible[] {
  const salida: PeriodoElegible[] = []
  let s = semanaIso(ultimoDia)
  while (s.domingo >= primerDia && salida.length < 120) {
    salida.push({ id: `W${s.anio}-${s.semana}`, texto: `W${s.semana} · ${fechaCorta(s.lunes)}–${fechaCorta(s.domingo)}${s.anio !== Number(ultimoDia.slice(0, 4)) ? ` ${s.anio}` : ''}`, desde: s.lunes, hasta: s.domingo })
    s = semanaIso(sumarDias(s.lunes, -1))
  }
  return salida
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const nombreDeMes = (mes: string): string => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`
export const fechaCorta = (dia: string): string => `${Number(dia.slice(8, 10))} ${MESES[Number(dia.slice(5, 7)) - 1]}`
export const finDeMes = (mes: string): string => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10)

/** Los meses entre dos días (AAAA-MM), del más antiguo al más reciente */
export function mesesEntre(desde: string, hasta: string): string[] {
  const salida: string[] = []
  let a = Number(desde.slice(0, 4))
  let m = Number(desde.slice(5, 7))
  const fin = hasta.slice(0, 7)
  while (salida.length < 240) {
    const mes = `${a}-${String(m).padStart(2, '0')}`
    salida.push(mes)
    if (mes >= fin) break
    m += 1
    if (m > 12) {
      m = 1
      a += 1
    }
  }
  return salida
}

/** Con qué se compara un periodo */
export type Comparacion = 'anterior' | 'mes-anterior' | 'anio-anterior'

export function periodoDeComparacion(desde: string, hasta: string, como: Comparacion): { desde: string; hasta: string } {
  const n = diasEntre(desde, hasta)
  if (como === 'anio-anterior') {
    const atras = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28')
    return { desde: atras(desde), hasta: atras(hasta) }
  }
  if (como === 'mes-anterior') {
    const mes = desde.slice(0, 7)
    const anterior = mesesEntre(sumarDias(`${mes}-01`, -1), sumarDias(`${mes}-01`, -1))[0]
    return { desde: `${anterior}-01`, hasta: finDeMes(anterior) }
  }
  return { desde: sumarDias(desde, -n), hasta: sumarDias(desde, -1) }
}

/* ------------------------------------------------------------------ */
/* Juegos                                                              */
/* ------------------------------------------------------------------ */

export const juegoDe = (asin: string, juegos: Readonly<Record<string, DatoDeAsin>>): string => juegos[asin]?.juego ?? asin

export interface FilaDeJuego {
  juego: string
  asins: Array<{ asin: string; producto: string | null; cifras: Cifras }>
  cifras: Cifras
  /** Agrupa más de un ASIN (ediciones o colores): se marca con «*» como en el Excel */
  varios: boolean
}

/** Las filas (de un mismo periodo: totales por ASIN) sumadas por juego, ordenadas por sesiones */
export function porJuego(filas: readonly FilaAgregada[], juegos: Readonly<Record<string, DatoDeAsin>>): FilaDeJuego[] {
  const por = new Map<string, FilaDeJuego>()
  const porAsin = new Map<string, Cifras>()
  for (const f of filas) porAsin.set(f.asin, sumar(porAsin.get(f.asin) ?? CERO, f))
  for (const [asin, cifras] of porAsin) {
    const juego = juegoDe(asin, juegos)
    const g = por.get(juego) ?? { juego, asins: [], cifras: CERO, varios: false }
    g.asins.push({ asin, producto: juegos[asin]?.producto ?? null, cifras })
    g.cifras = sumar(g.cifras, cifras)
    por.set(juego, g)
  }
  // Un juego con varios ASIN en la tabla de ASIN (aunque este periodo solo tenga datos de uno) sigue siendo «varios»
  const asinsPorJuego = new Map<string, number>()
  for (const [asin, d] of Object.entries(juegos)) if (asin) asinsPorJuego.set(d.juego, (asinsPorJuego.get(d.juego) ?? 0) + 1)
  const salida = [...por.values()]
  for (const g of salida) {
    g.varios = g.asins.length > 1 || (asinsPorJuego.get(g.juego) ?? 0) > 1
    g.asins.sort((a, b) => b.cifras.sesiones - a.cifras.sesiones || b.cifras.unidades - a.cifras.unidades)
  }
  return salida.sort((a, b) => b.cifras.sesiones - a.cifras.sesiones || b.cifras.unidades - a.cifras.unidades || a.juego.localeCompare(b.juego, 'es'))
}

/** Una tabla juego × clave (día o mes): las cifras de cada juego en cada columna, más la fila del total de la tienda */
export function matriz(filas: readonly FilaAgregada[], juegos: Readonly<Record<string, DatoDeAsin>>): { total: Map<string, Cifras>; porJuego: Map<string, Map<string, Cifras>> } {
  const total = new Map<string, Cifras>()
  const porJuegoMap = new Map<string, Map<string, Cifras>>()
  for (const f of filas) {
    total.set(f.clave, sumar(total.get(f.clave) ?? CERO, f))
    const j = juegoDe(f.asin, juegos)
    const m = porJuegoMap.get(j) ?? new Map<string, Cifras>()
    m.set(f.clave, sumar(m.get(f.clave) ?? CERO, f))
    porJuegoMap.set(j, m)
  }
  return { total, porJuego: porJuegoMap }
}

/** «×6,5» cuando se multiplica; «−40 %» o «+58 %» cuando no llega a duplicar. null sin base */
export function veces(actual: number | null, antes: number | null): string | null {
  if (actual == null || antes == null || antes <= 0) return null
  const r = actual / antes
  if (r >= 2) return `×${r.toLocaleString('es-ES', { maximumFractionDigits: r >= 10 ? 0 : 1 })}`
  const p = (r - 1) * 100
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toLocaleString('es-ES', { maximumFractionDigits: 0 })} %`
}

/** De un ASIN «B0…» o una cadena cualquiera, solo lo que parece un ASIN */
export const esAsin = (x: unknown): x is string => typeof x === 'string' && /^[A-Z0-9]{10}$/.test(x)

/** Lo que trae el informe de Ventas y tráfico (por ASIN hijo) de UN día, convertido a filas. Puro, para probarlo sin red */
export function filasDelInforme(json: unknown): Array<Cifras & { asin: string; parent: string | null; moneda: string | null }> {
  const filas = ((json as { salesAndTrafficByAsin?: unknown[] } | null)?.salesAndTrafficByAsin ?? []) as Array<Record<string, unknown>>
  const n = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  const por = new Map<string, Cifras & { asin: string; parent: string | null; moneda: string | null }>()
  for (const f of filas) {
    const asin = String(f.childAsin ?? f.parentAsin ?? '').toUpperCase()
    if (!esAsin(asin)) continue
    const s = (f.salesByAsin ?? {}) as Record<string, unknown>
    const t = (f.trafficByAsin ?? {}) as Record<string, unknown>
    const importe = (s.orderedProductSales ?? {}) as { amount?: unknown; currencyCode?: unknown }
    const visitas = n(t.pageViews)
    const x = por.get(asin) ?? { asin, parent: typeof f.parentAsin === 'string' ? f.parentAsin.toUpperCase() : null, moneda: null, ...CERO }
    x.sesiones += n(t.sessions)
    x.navegador += n(t.browserSessions)
    x.app += n(t.mobileAppSessions)
    x.visitas += visitas
    x.visitasBB += (visitas * n(t.buyBoxPercentage)) / 100
    x.unidades += n(s.unitsOrdered)
    x.pedidos += n(s.totalOrderItems)
    x.ventas += n(importe.amount)
    x.moneda = x.moneda ?? (typeof importe.currencyCode === 'string' ? importe.currencyCode : null)
    por.set(asin, x)
  }
  return [...por.values()]
}
