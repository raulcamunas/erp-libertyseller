/**
 * VENTAS (EL «SELLERBOARD» PROPIO) · LAS CUENTAS DEL PANEL, PURAS (valen en el navegador). Se comprueba con panel.prueba.ts.
 * ======================================================================================================================
 * Los periodos de las baldosas (como Sellerboard: Hoy / Ayer / Este mes / Pronóstico / Mes pasado, y las otras tandas), con qué se comparan, y de las
 * filas del resumen diario (`ventas_dia`) el beneficio:
 *
 *   ventas  − promociones + tarifas de Amazon (negativas) + coste de los reembolsos − publicidad − IVA − coste de los productos + ajustes  = ganancia neta
 *
 *   · coste de los reembolsos = − lo devuelto al comprador + lo que Amazon devuelve o cobra de comisiones por el reembolso
 *   · IVA = (ventas − promociones − lo devuelto) × iva / (100 + iva)   (las ventas de Amazon llevan el IVA dentro)
 *   · ajustes = lo que Amazon reembolsa (inventario perdido o dañado, cargos al comprador): suma
 *
 * LAS TARIFAS DE AMAZON, SIN SU IVA (26 nov 2026, cuadrando con Sellerboard): Amazon da las comisiones, la tarifa FBA, la suscripción y las comisiones de los
 * reembolsos CON el IVA dentro (3,73 € de comisión de un juego de 19,99 € = 15 % + IVA), y ese IVA el vendedor lo recupera. Se guardan como vienen y aquí
 * se quitan: tarifa / (1 + IVA). Con IVA 0 (una cuenta de fuera de la UE) no cambia nada.
 */

export const DIA_MS = 86_400_000

/** El IVA estándar de cada país de Amazon (para el interruptor «IVA de cada país», OSS). Fuera de la UE (EE. UU., Canadá, México), 0 */
export const IVA_DE_PAIS: Readonly<Record<string, number>> = {
  A1RKKUPIHCS9HS: 21, // España
  A13V1IB3VIYZZH: 20, // Francia
  A1PA6795UKMFR9: 19, // Alemania
  APJ6JRA9NG5V4: 22, // Italia
  A1F83G8C2ARO7P: 20, // Reino Unido
  A1805IZSGTT6HS: 21, // Países Bajos
  AMEN7PMS3EDWL: 21, // Bélgica
  A28R8C7NBKEWEA: 23, // Irlanda
  A1C3SOZRARQ6R3: 23, // Polonia
  A2NODRKZP88ZB9: 25, // Suecia
  A33AVAJ2PDY3EV: 20, // Turquía
  ATVPDKIKX0DER: 0,
  A2EUQ1WTGCTBG2: 0,
  A1AM78C64UM0Y8: 0,
}

/** El IVA de una cuenta: un número (el mismo para todo, como hasta ahora) o, con «IVA de cada país», el de cada mercado para las ventas */
export type Iva = number | { pct: number; porPais: boolean }
export const ivaDeLaCuenta = (iva: Iva): number => (typeof iva === 'number' ? iva : iva.pct)
/** El IVA que se quita a las ventas de un mercado */
export const ivaDeVentas = (iva: Iva, mkt: string): number => (typeof iva !== 'number' && iva.porPais ? (IVA_DE_PAIS[mkt] ?? iva.pct) : ivaDeLaCuenta(iva))

/** Una fila del resumen tal y como viaja al navegador (compacta) */
export interface FilaPanel {
  dia: string
  mkt: string
  sku: string
  asin: string | null
  unidades: number
  pedidos: number
  ventas: number
  promo: number
  referral: number
  fba: number
  otras: number
  estimadas: number
  reembolsos: number
  reembolsado: number
  comisionReembolso: number
  ajustes: number
  publicidad: number
  ventasPpc: number
  unidadesPpc: number
}

export interface Totales {
  ventas: number
  unidades: number
  pedidos: number
  reembolsos: number
  promo: number
  publicidad: number
  ventasPpc: number
  unidadesPpc: number
  tarifas: number
  referral: number
  fba: number
  otras: number
  estimadas: number
  costeReembolso: number
  reembolsado: number
  ajustes: number
  iva: number
  cogs: number
  /** Unidades vendidas de SKU sin coste puesto: el beneficio está inflado por ellas */
  unidadesSinCoste: number
  bruto: number
  neto: number
  /** Lo que Amazon pagará por esto: ventas − promociones + tarifas CON su IVA ± reembolsos + ajustes (el «Pago estimado» de Sellerboard) */
  pago: number
  margen: number | null
  roi: number | null
  tacos: number | null
  tasaReembolso: number | null
  precioMedio: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function vacios(): Totales {
  return { ventas: 0, unidades: 0, pedidos: 0, reembolsos: 0, promo: 0, publicidad: 0, ventasPpc: 0, unidadesPpc: 0, tarifas: 0, referral: 0, fba: 0, otras: 0, estimadas: 0, costeReembolso: 0, reembolsado: 0, ajustes: 0, iva: 0, cogs: 0, unidadesSinCoste: 0, bruto: 0, neto: 0, pago: 0, margen: null, roi: null, tacos: null, tasaReembolso: null, precioMedio: null }
}

/** Suma unas filas y saca el beneficio. `costes` = coste por unidad de cada SKU (euros) */
export function totalizar(filas: readonly FilaPanel[], ivaPct: Iva, costes: Readonly<Record<string, number>>, escala = 1): Totales {
  const t = vacios()
  const sinIva = 1 / (1 + Math.max(0, ivaDeLaCuenta(ivaPct)) / 100)
  // El IVA de las ventas, fila a fila (con «IVA de cada país» cada mercado lleva el suyo)
  let iva = 0
  for (const f of filas) {
    t.ventas += f.ventas
    t.unidades += f.unidades
    t.pedidos += f.pedidos
    t.reembolsos += f.reembolsos
    t.promo += f.promo
    t.publicidad += f.publicidad
    t.ventasPpc += f.ventasPpc
    t.unidadesPpc += f.unidadesPpc
    t.referral += f.referral * sinIva
    t.fba += f.fba * sinIva
    t.otras += f.otras * sinIva
    t.estimadas += f.estimadas * sinIva
    t.reembolsado += f.reembolsado
    t.costeReembolso += f.comisionReembolso * sinIva - f.reembolsado
    t.ajustes += f.ajustes
    t.pago += f.ventas - f.promo + f.referral + f.fba + f.otras + f.comisionReembolso - f.reembolsado + f.ajustes
    const r = ivaDeVentas(ivaPct, f.mkt)
    iva += Math.max(0, f.ventas - f.promo - f.reembolsado) * (r / (100 + r))
    if (f.sku && f.unidades) {
      const c = costes[f.sku]
      if (c != null && c > 0) t.cogs += c * f.unidades
      else t.unidadesSinCoste += f.unidades
    }
  }
  t.tarifas = t.referral + t.fba + t.otras
  t.iva = Math.max(0, iva)
  t.bruto = t.ventas - t.promo + t.tarifas + t.costeReembolso - t.publicidad - t.iva - t.cogs + t.ajustes
  t.neto = t.bruto
  if (escala !== 1) {
    for (const k of ['ventas', 'unidades', 'pedidos', 'reembolsos', 'promo', 'publicidad', 'ventasPpc', 'unidadesPpc', 'tarifas', 'referral', 'fba', 'otras', 'estimadas', 'costeReembolso', 'reembolsado', 'ajustes', 'iva', 'cogs', 'unidadesSinCoste', 'bruto', 'neto', 'pago'] as const) {
      t[k] = t[k] * escala
    }
    t.unidades = Math.round(t.unidades)
    t.pedidos = Math.round(t.pedidos)
    t.reembolsos = Math.round(t.reembolsos)
  }
  for (const k of ['ventas', 'promo', 'publicidad', 'ventasPpc', 'tarifas', 'referral', 'fba', 'otras', 'estimadas', 'costeReembolso', 'reembolsado', 'ajustes', 'iva', 'cogs', 'bruto', 'neto', 'pago'] as const) t[k] = r2(t[k])
  t.margen = t.ventas > 0 ? t.neto / t.ventas : null
  // El ROI solo con TODOS los costes puestos: con la mitad sale disparado (beneficio de todo entre el coste de unos pocos)
  t.roi = t.cogs > 0 && t.unidadesSinCoste === 0 ? t.neto / t.cogs : null
  t.tacos = t.ventas > 0 ? t.publicidad / t.ventas : null
  t.tasaReembolso = t.unidades > 0 ? t.reembolsos / t.unidades : null
  t.precioMedio = t.unidades > 0 ? t.ventas / t.unidades : null
  return t
}

/* ------------------------------------------------------------------ */
/* Periodos                                                            */
/* ------------------------------------------------------------------ */

export interface Rango {
  desde: string
  hasta: string
}

export interface Periodo extends Rango {
  id: string
  titulo: string
  /** Pronóstico: lo de `desde`–`hasta` (hasta hoy) multiplicado por esto; `hastaPronostico` es el final del mes */
  escala?: number
  hastaPronostico?: string
}

export type Tanda = 'clasica' | 'dias' | 'semanas' | 'meses' | 'trimestres' | 'rango'
export type Comparar = 'anio' | 'anterior' | 'no'

export const TANDAS: Array<{ id: Tanda; texto: string }> = [
  { id: 'clasica', texto: 'Hoy · Ayer · Este mes · Pronóstico · Mes pasado' },
  { id: 'dias', texto: 'Hoy · Ayer · 7 · 14 · 30 días' },
  { id: 'semanas', texto: 'Esta semana y las 3 anteriores' },
  { id: 'meses', texto: 'Este mes y los 3 anteriores' },
  { id: 'trimestres', texto: 'Este trimestre y los 3 anteriores' },
]

export const sumarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)
const inicioMes = (dia: string, menos = 0) => {
  const d = new Date(`${dia}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - menos, 1)).toISOString().slice(0, 10)
}
const finMes = (dia: string, menos = 0) => {
  const d = new Date(`${dia}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - menos + 1, 0)).toISOString().slice(0, 10)
}
const nombreMes = (dia: string) => new Date(`${dia}T00:00:00Z`).toLocaleDateString('es-ES', { month: 'long', timeZone: 'UTC' })
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Las baldosas de una tanda. `hoy` = 'YYYY-MM-DD' (en Madrid) y `fraccionDeHoy` = cuánto del día de hoy ha pasado (0–1), para el pronóstico.
 */
export function periodosDe(tanda: Tanda, hoy: string, fraccionDeHoy: number): Periodo[] {
  const ayer = sumarDias(hoy, -1)
  if (tanda === 'dias') {
    return [
      { id: 'hoy', titulo: 'Hoy', desde: hoy, hasta: hoy },
      { id: 'ayer', titulo: 'Ayer', desde: ayer, hasta: ayer },
      { id: '7', titulo: '7 días', desde: sumarDias(hoy, -6), hasta: hoy },
      { id: '14', titulo: '14 días', desde: sumarDias(hoy, -13), hasta: hoy },
      { id: '30', titulo: '30 días', desde: sumarDias(hoy, -29), hasta: hoy },
    ]
  }
  if (tanda === 'semanas') {
    const dow = (new Date(`${hoy}T00:00:00Z`).getUTCDay() + 6) % 7 // lunes = 0
    const lunes = sumarDias(hoy, -dow)
    return [0, 1, 2, 3].map((n) => ({
      id: `s${n}`,
      titulo: n === 0 ? 'Esta semana' : n === 1 ? 'La semana pasada' : `Hace ${n} semanas`,
      desde: sumarDias(lunes, -7 * n),
      hasta: n === 0 ? hoy : sumarDias(lunes, -7 * n + 6),
    }))
  }
  if (tanda === 'meses') {
    return [0, 1, 2, 3].map((n) => ({ id: `m${n}`, titulo: n === 0 ? 'Este mes' : mayus(nombreMes(inicioMes(hoy, n))), desde: inicioMes(hoy, n), hasta: n === 0 ? hoy : finMes(hoy, n) }))
  }
  if (tanda === 'trimestres') {
    const d = new Date(`${hoy}T00:00:00Z`)
    const q = Math.floor(d.getUTCMonth() / 3)
    return [0, 1, 2, 3].map((n) => {
      const desde = new Date(Date.UTC(d.getUTCFullYear(), (q - n) * 3, 1)).toISOString().slice(0, 10)
      const hasta = n === 0 ? hoy : new Date(Date.UTC(d.getUTCFullYear(), (q - n) * 3 + 3, 0)).toISOString().slice(0, 10)
      const qq = new Date(`${desde}T00:00:00Z`)
      return { id: `q${n}`, titulo: n === 0 ? 'Este trimestre' : `T${Math.floor(qq.getUTCMonth() / 3) + 1} ${qq.getUTCFullYear()}`, desde, hasta }
    })
  }
  // La de Sellerboard
  const im = inicioMes(hoy)
  const diasMes = Number(finMes(hoy).slice(8, 10))
  const transcurridos = Number(hoy.slice(8, 10)) - 1 + Math.min(Math.max(fraccionDeHoy, 0.05), 1)
  return [
    { id: 'hoy', titulo: 'Hoy', desde: hoy, hasta: hoy },
    { id: 'ayer', titulo: 'Ayer', desde: ayer, hasta: ayer },
    { id: 'mes', titulo: 'Este mes', desde: im, hasta: hoy },
    { id: 'pronostico', titulo: 'Este mes (pronóstico)', desde: im, hasta: hoy, escala: diasMes / transcurridos, hastaPronostico: finMes(hoy) },
    { id: 'pasado', titulo: 'El mes pasado', desde: inicioMes(hoy, 1), hasta: finMes(hoy, 1) },
  ]
}

/** El rango con el que se compara un periodo: el mismo del año anterior o el inmediatamente anterior de la misma duración */
export function rangoAComparar(p: Periodo, como: Comparar): Rango | null {
  if (como === 'no') return null
  const hasta = p.hastaPronostico ?? p.hasta
  if (como === 'anio') {
    const menosUnAnio = (dia: string) => {
      const d = new Date(`${dia}T00:00:00Z`)
      const x = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()))
      // 29 de febrero → 28
      if (x.getUTCMonth() !== d.getUTCMonth()) x.setUTCDate(0)
      return x.toISOString().slice(0, 10)
    }
    // El pronóstico se compara con el mes ENTERO del año anterior; el resto, con los mismos días
    return { desde: menosUnAnio(p.desde), hasta: menosUnAnio(hasta) }
  }
  const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${p.desde}T00:00:00Z`)) / DIA_MS) + 1
  const esMesEntero = p.desde.endsWith('-01') && hasta === finMes(p.desde)
  // Un mes entero (o el pronóstico) se compara con el mes anterior entero; el mes en curso, con los mismos días del mes anterior
  if (esMesEntero) return { desde: inicioMes(p.desde, 1), hasta: finMes(p.desde, 1) }
  if (p.desde.endsWith('-01') && (p.id === 'mes' || p.id === 'm0')) {
    const fin = sumarDias(inicioMes(p.desde, 1), dias - 1)
    return { desde: inicioMes(p.desde, 1), hasta: fin > finMes(p.desde, 1) ? finMes(p.desde, 1) : fin }
  }
  return { desde: sumarDias(p.desde, -dias), hasta: sumarDias(p.desde, -1) }
}

export const enRango = (dia: string, r: Rango) => dia >= r.desde && dia <= r.hasta

/** El día de hoy en Madrid y cuánto ha pasado de él */
export function hoyEnMadrid(ahora = new Date()): { hoy: string; fraccion: number } {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(ahora)
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '0'
  const hora = Number(v('hour')) % 24
  return { hoy: `${v('year')}-${v('month')}-${v('day')}`, fraccion: (hora * 60 + Number(v('minute'))) / 1440 }
}

/** Variación entre dos cifras (null si no se puede comparar) */
export function variacion(actual: number, anterior: number | null | undefined): number | null {
  if (anterior == null || !Number.isFinite(anterior) || anterior === 0) return null
  return (actual - anterior) / Math.abs(anterior)
}
