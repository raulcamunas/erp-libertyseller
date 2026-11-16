/**
 * EL PLANIFICADOR POR REFERENCIA — PURO (spec remesas-pro §2.4-§2.6 corregidos por §11: D1, D3, D4, D5.3-4, D7, D9, D10, D11, D12, D13, D16).
 * ====================================================================================================================================
 * Una referencia entra con su stock, sus llegadas ya preparadas (lib/fba/llegadas.ts) y su ritmo ya calculado (lib/fba/ritmo.ts), y sale
 * una `LineaPlan`: cuándo se queda sin stock, antes de qué fecha hay que decidir y enviar, cuánto mandar y por qué; o por qué NO se propone.
 *
 * Reglas que no se negocian:
 *   · Nada de `Date.now()`: `hoy` entra siempre de fuera (Europe/Madrid, `diaEnEspana`). Las fechas son días 'YYYY-MM-DD' en UTC.
 *   · Las llegadas dudosas NO cuentan para la cobertura (D3): ante una rotura, lo prudente es no contar con ellas.
 *   · Dos fechas (D4): `fechaPrimerHueco` (informativa) y `fechaRotura` (la que decide), que es el primer hueco a partir de H + L o el primero
 *     a partir del cual ya no llega nada. Los huecos de antes de H + L no los arregla un envío nuevo: solo deciden «tarde» si suman ≥ 3 días.
 *   · La simulación consume a diario `consumoDia(fecha)`: perfil semanal (D7) topado con el tope estacional del cliente y consumo NETO (D12).
 *   · La cantidad cubre [A, A + Tef + M] con el perfil de esas semanas (no se usa el ritmo de diciembre para cubrir enero) y
 *     `Tef = max(T, transporte + recepción + cadencia)` (D9): cubrir hasta que pueda llegar el siguiente envío.
 * Este fichero no importa ritmo.ts: recibe el `RitmoSku` hecho.
 */

import { repartirTotal } from './plazos'
import { costeMensual, mesDe } from './almacenaje'
import type {
  AjustesReposicion,
  AvisoLinea,
  Confianza,
  EntradaSku,
  FnPlanificarSku,
  FnPlazoDelCliente,
  FnSimularStock,
  LineaPlan,
  LlegadaPrevista,
  MedidasCliente,
  MotivoFuera,
  OrigenEtapa,
  PlazoEtapas,
  Prioridad,
  RemesaSinSalirDeLinea,
  RitmoSku,
} from './plan-tipos'

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Plazo de partida del planificador (§2.4): la preparación y el margen bajan a 7 frente a los 10 de las alertas */
export const PLAZO_DE_PARTIDA = { preparacion: 7, transporte: 18, recepcion: 7, margen: 7 } as const

/** En oct-dic Amazon recibe más despacio: la recepción sin medir se multiplica por 1,5 (D10) */
export const FACTOR_RECEPCION_Q4 = 1.5

/** Los huecos inevitables solo deciden la prioridad («tarde») si suman al menos esto (D4) */
export const DIAS_HUECO_QUE_DECIDEN = 3

export const ORDEN_PRIORIDAD: readonly Prioridad[] = ['tarde', 'urgente', 'esta_semana', 'proximas_2', 'este_mes', 'mas_adelante']
/** D8 · Más de estos días agotada (desde el último día con stock) es «agotado largo»: se pregunta si se repone */
export const DIAS_AGOTADO_LARGO = 76

export const rangoPrioridad = (p: Prioridad): number => ORDEN_PRIORIDAD.indexOf(p)

/* ------------------------------------------------------------------ */
/* Fechas (días en UTC)                                                */
/* ------------------------------------------------------------------ */

const MS_DIA = 86_400_000
const aMs = (f: string): number => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)

export function sumarDias(fecha: string, dias: number): string {
  return new Date(aMs(fecha) + Math.round(dias) * MS_DIA).toISOString().slice(0, 10)
}

/** Días de `a` a `b` (b − a) */
export function diasEntre(a: string, b: string): number {
  return Math.round((aMs(b) - aMs(a)) / MS_DIA)
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «3 dic» */
export function fechaCorta(fecha: string): string {
  return `${Number(fecha.slice(8, 10))} ${MESES_CORTOS[Number(fecha.slice(5, 7)) - 1]}`
}

/** Semana ISO (1..53) de un día */
export function semanaIso(fecha: string): number {
  const d = new Date(aMs(fecha))
  const diaSemana = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana)
  const inicioAno = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - inicioAno) / MS_DIA + 1) / 7)
}

const maxFecha = (a: string, b: string): string => (a >= b ? a : b)

/* ------------------------------------------------------------------ */
/* Formato de las frases                                               */
/* ------------------------------------------------------------------ */

/** Miles con punto siempre («1.900»; Intl en es-ES no agrupa los de 4 cifras) y decimales con coma */
export function numero(n: number, decimales = 0): string {
  const fijo = Math.abs(n).toFixed(decimales)
  const [entero, dec] = fijo.split('.')
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '−' : ''}${conPuntos}${dec ? `,${dec}` : ''}`
}

const ritmoTexto = (d: number): string => {
  const s = numero(d, d >= 10 ? 0 : d >= 1 ? 1 : 2)
  return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s
}

export function simboloMoneda(moneda: string): string {
  switch ((moneda || 'EUR').toUpperCase()) {
    case 'EUR': return '€'
    case 'USD': case 'CAD': case 'MXN': return '$'
    case 'GBP': return '£'
    case 'SEK': case 'NOK': case 'DKK': return 'kr'
    case 'PLN': return 'zł'
    default: return moneda
  }
}

export const dinero = (n: number, moneda: string): string => `${numero(Math.round(n))} ${simboloMoneda(moneda)}`

/* ------------------------------------------------------------------ */
/* No comprable (D1)                                                   */
/* ------------------------------------------------------------------ */

/**
 * La misma regla que la alerta `sin_comprar` (alertas-datos.ts `noComprables`):
 *   · `activo_manual = false` o suprimido → no se puede comprar;
 *   · con stock (V > 0) y sin BUYABLE → no se puede comprar, pero SOLO si algún listing del cliente trae BUYABLE (si no, el dato no existe y
 *     acusar a todos sería una avalancha de falsas alarmas);
 *   · V = 0 sin BUYABLE es AGOTADO (Amazon quita BUYABLE al quedarse sin stock): se planifica y suele ser lo más urgente.
 *   · Sin fila de listing o sin estado (`listingStatus = null` o `[]`) no se afirma nada.
 */
export function esNoComprable(p: {
  vendibles: number
  listingStatus: readonly string[] | null
  hayBuyableEnCliente: boolean
  suprimido: boolean
  activoManual: boolean | null
}): boolean {
  if (p.activoManual === false) return true
  if (p.suprimido) return true
  if (!p.hayBuyableEnCliente) return false
  if (p.vendibles <= 0) return false
  // `[]` es lo que Amazon deja cuando no informa del estado en ese mercado (ShoesF: [] en IT y BUYABLE en ES del mismo SKU con el
  // mismo stock): es «sin dato», como null, no «no se puede comprar»
  if (p.listingStatus === null || p.listingStatus.length === 0) return false
  return !p.listingStatus.includes('BUYABLE')
}

/* ------------------------------------------------------------------ */
/* Plazo por etapas (§2.4 + D10)                                       */
/* ------------------------------------------------------------------ */

type Etapa = 'preparacion' | 'transporte' | 'recepcion' | 'margen'
const ETAPAS: readonly Etapa[] = ['preparacion', 'transporte', 'recepcion', 'margen']

const esTrimestreAlto = (hoy: string): boolean => mesDe(hoy) >= 10

/**
 * Por etapa, en este orden: manual (`fba_alertas_config.dias_*`) > medido (≥ 2 envíos medidos) > de partida.
 *   · Transporte medido = mediana envío → primer Receipt. Recepción medida = p75 del primer Receipt al 90 % (D10).
 *   · Preparación y margen no se miden: manual o de partida (7 y 7).
 *   · En oct-dic la recepción de partida (sin medida) × 1,5.
 *   · Solo total sin etapas → `repartirTotal` (origen manual).
 *   · Plazo por SKU: sustituye a L + M y se reparte en la proporción de las etapas del cliente (origen manual).
 *   · `sinConfirmar` = alguna etapa sigue de partida: la banda «Confirmar plazos» sale hasta que alguien los guarde.
 */
export const plazoDelCliente: FnPlazoDelCliente = (config, medido, hoy, ajustes, plazoSku) => {
  const valores: Record<Etapa, number> = { preparacion: 0, transporte: 0, recepcion: 0, margen: 0 }
  const origen: Record<Etapa, OrigenEtapa> = { preparacion: 'partida', transporte: 'partida', recepcion: 'partida', margen: 'partida' }

  const manual: Partial<Record<Etapa, number>> = {}
  if (config) {
    const sueltas: Record<Etapa, number | null> = {
      preparacion: config.diasPreparacion,
      transporte: config.diasTransporte,
      recepcion: config.diasRecepcion,
      margen: config.diasMargen,
    }
    const algunaEtapa = ETAPAS.some((k) => sueltas[k] !== null && sueltas[k] !== undefined)
    if (algunaEtapa) {
      for (const k of ETAPAS) {
        const v = sueltas[k]
        if (v !== null && v !== undefined && Number.isFinite(v) && v >= 0) manual[k] = Math.round(v)
      }
    } else if (config.total !== null && config.total !== undefined && config.total > 0) {
      const r = repartirTotal(config.total)
      for (const k of ETAPAS) manual[k] = r[k]
    }
  }

  const medidoValido = !!medido && medido.enviosMedidos >= 2
  for (const k of ETAPAS) {
    if (manual[k] !== undefined) {
      valores[k] = manual[k] as number
      origen[k] = 'manual'
      continue
    }
    if (k === 'transporte' && medidoValido && medido!.transporteMediano !== null && medido!.transporteMediano >= 0) {
      valores[k] = Math.round(medido!.transporteMediano)
      origen[k] = 'medido'
      continue
    }
    if (k === 'recepcion' && medidoValido && medido!.recepcionP75 !== null && medido!.recepcionP75 >= 0) {
      valores[k] = Math.round(medido!.recepcionP75)
      origen[k] = 'medido'
      continue
    }
    valores[k] = PLAZO_DE_PARTIDA[k]
    origen[k] = 'partida'
    if (k === 'recepcion' && esTrimestreAlto(hoy)) valores[k] = Math.ceil(PLAZO_DE_PARTIDA.recepcion * FACTOR_RECEPCION_Q4)
  }

  if (plazoSku !== null && plazoSku !== undefined && plazoSku > 0) {
    const total = Math.round(plazoSku)
    const base = ETAPAS.reduce((s, k) => s + valores[k], 0)
    if (base <= 0) {
      const r = repartirTotal(total)
      for (const k of ETAPAS) valores[k] = r[k]
    } else {
      const p = Math.round((total * valores.preparacion) / base)
      const t = Math.round((total * valores.transporte) / base)
      const r = Math.round((total * valores.recepcion) / base)
      valores.preparacion = p
      valores.transporte = t
      valores.recepcion = r
      valores.margen = Math.max(0, total - p - t - r)
    }
    for (const k of ETAPAS) origen[k] = 'manual'
  }

  return {
    preparacion: valores.preparacion,
    transporte: valores.transporte,
    recepcion: valores.recepcion,
    margen: valores.margen,
    origen: { ...origen },
    hastaLaVenta: valores.preparacion + valores.transporte + valores.recepcion,
    sinConfirmar: ETAPAS.some((k) => origen[k] === 'partida'),
    transporteUrgente: ajustes.transporteUrgenteDias ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Simulación (Paso 1 + D4)                                            */
/* ------------------------------------------------------------------ */

interface SimulacionInterna {
  fechas: string[]
  /** Stock al empezar el día, ya con las llegadas de ese día */
  inicio: number[]
  consumo: number[]
  /** Fracción del consumo del día que no se pudo servir (0..1) */
  falta: number[]
  /** Unidades que faltaron ese día (consumo no servido) */
  faltaUd: number[]
  hueco: boolean[]
  primerHueco: number | null
  rotura: number | null
  stockFinal: number
}

function simularInterno(
  v: number,
  llegadas: readonly LlegadaPrevista[],
  consumoDia: (fecha: string) => number,
  hoy: string,
  horizonte: number,
  hastaLaVenta: number,
): SimulacionInterna {
  const n = Math.max(1, Math.ceil(horizonte))
  const porDia = new Map<number, number>()
  let ultimaLlegada = -1
  for (const l of llegadas) {
    if (l.dudoso || !(l.unidades > 0)) continue
    const i = Math.max(0, diasEntre(hoy, l.fecha))
    if (i >= n) continue
    porDia.set(i, (porDia.get(i) ?? 0) + l.unidades)
    if (i > ultimaLlegada) ultimaLlegada = i
  }
  const fechas: string[] = []
  const inicio: number[] = []
  const consumo: number[] = []
  const falta: number[] = []
  const faltaUd: number[] = []
  const hueco: boolean[] = []
  let primerHueco: number | null = null
  let rotura: number | null = null
  let s = Math.max(0, v)
  for (let i = 0; i < n; i++) {
    const f = sumarDias(hoy, i)
    s += porDia.get(i) ?? 0
    const c = Math.max(0, consumoDia(f) || 0)
    const sinServir = Math.max(0, c - s)
    const esHueco = c > 0 && s < c / 2
    fechas.push(f)
    inicio.push(s)
    consumo.push(c)
    falta.push(c > 0 ? sinServir / c : 0)
    faltaUd.push(sinServir)
    hueco.push(esHueco)
    if (esHueco) {
      if (primerHueco === null) primerHueco = i
      if (rotura === null && (i >= hastaLaVenta || i >= ultimaLlegada)) rotura = i
    }
    s = Math.max(0, s - c)
  }
  return { fechas, inicio, consumo, falta, faltaUd, hueco, primerHueco, rotura, stockFinal: s }
}

/**
 * Cada día: entran las llegadas de ese día (las dudosas no), se consume `consumoDia(fecha)` y lo que no se sirve se pierde (no se recupera).
 *   · Hueco = día que empieza con menos de medio día de consumo.
 *   · `fechaPrimerHueco`: el primero, aunque sea inevitable.
 *   · `fechaRotura` (D4): el primer hueco ≥ H + L, o el primero a partir del cual ya no llega nada que reponga.
 *   · `diasSinStock(desde, hasta)`: días (fraccionarios) de consumo no servido en [desde, hasta).
 */
export const simularStock: FnSimularStock = (v, llegadas, consumoDia, hoy, horizonte, hastaLaVenta) => {
  const sim = simularInterno(v, llegadas, consumoDia, hoy, horizonte, hastaLaVenta)
  const n = sim.fechas.length
  return {
    fechaRotura: sim.rotura === null ? null : sim.fechas[sim.rotura],
    fechaPrimerHueco: sim.primerHueco === null ? null : sim.fechas[sim.primerHueco],
    stockEn(f: string): number {
      const i = diasEntre(hoy, f)
      if (i <= 0) return sim.inicio[0]
      if (i >= n) return sim.stockFinal
      return sim.inicio[i]
    },
    diasSinStock(desde: string, hasta: string): number {
      const a = Math.max(0, diasEntre(hoy, desde))
      const b = Math.min(n, diasEntre(hoy, hasta))
      let t = 0
      for (let i = a; i < b; i++) t += sim.falta[i]
      return t
    },
    proyeccion: sim.fechas.map((fecha, i) => ({ fecha, stock: Math.round(sim.inicio[i] * 10) / 10 })),
  }
}

/* ------------------------------------------------------------------ */
/* Redondeo a la caja (Paso 3)                                         */
/* ------------------------------------------------------------------ */

/**
 * Al múltiplo k: si `bruta mod k ≥ k/2` se sube, si no se baja. Si sale 0 pero `bruta ≥ k/3` y corre prisa (tarde, urgente o esta semana),
 * se queda en una caja.
 */
export function redondearACaja(bruta: number, k: number | null, prisa: boolean): number {
  const b = Math.max(0, bruta)
  if (!k || k <= 1) return Math.round(b)
  const resto = b % k
  let r = resto >= k / 2 ? b - resto + k : b - resto
  r = Math.round(r)
  if (r === 0 && prisa && b >= k / 3) r = k
  return r
}

const PRIORIDADES_CON_PRISA: readonly Prioridad[] = ['tarde', 'urgente', 'esta_semana']

/** Prioridad por `decidirAntesDe` (Paso 5) */
export function prioridadPorDecidir(decidirAntesDe: string, hoy: string, vaTarde: boolean): Prioridad {
  if (vaTarde) return 'tarde'
  const d = diasEntre(hoy, decidirAntesDe)
  if (d <= 3) return 'urgente'
  if (d <= 7) return 'esta_semana'
  if (d <= 14) return 'proximas_2'
  if (d <= 30) return 'este_mes'
  return 'mas_adelante'
}

/* ------------------------------------------------------------------ */
/* Ritmo día a día (D7 + D12)                                          */
/* ------------------------------------------------------------------ */

/** Demanda bruta del día (lo que se vendería) con el perfil semanal topado */
function demandaBrutaDe(ritmo: RitmoSku, topeEstacional: number, factorIa: number): (fecha: string) => number {
  const base = ritmo.base ?? ritmo.previsto ?? 0
  const plano = (ritmo.previsto ?? ritmo.base ?? 0) * factorIa
  const perfil = ritmo.perfilSemanal
  if (!perfil || perfil.length === 0 || base <= 0) return () => plano
  const tope = topeEstacional > 0 ? topeEstacional : Infinity
  return (fecha: string) => {
    const f = perfil[semanaIso(fecha)]
    const factor = typeof f === 'number' && Number.isFinite(f) && f >= 0 ? Math.min(f, tope) : 1
    return base * factor * factorIa
  }
}

/** Consumo neto (D12): lo que vuelve vendible no se repone; lo que se rompe o se retira, sí */
function consumoDe(ritmo: RitmoSku, demanda: (f: string) => number): (fecha: string) => number {
  const tasa = Math.min(0.3, Math.max(0, ritmo.tasaDevolucionVendible || 0))
  const merma = Math.max(0, ritmo.mermaDiaria || 0)
  return (fecha: string) => {
    const d = demanda(fecha)
    return d > 0 ? d * (1 - tasa) + merma : 0
  }
}

function mediaEntre(fn: (f: string) => number, desde: string, dias: number): number {
  if (dias <= 0) return fn(desde)
  let t = 0
  for (let i = 0; i < dias; i++) t += fn(sumarDias(desde, i))
  return t / dias
}

/* ------------------------------------------------------------------ */
/* planificarSku                                                       */
/* ------------------------------------------------------------------ */

const fraccion = (v: number | null): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : v > 1 ? v / 100 : v)

const BAJAR_CONFIANZA: Record<Confianza, Confianza> = { alta: 'media', media: 'baja', baja: 'baja', sin_datos: 'sin_datos' }

/** La caja de la referencia: la suya > la deducida de sus envíos > la del cliente > ninguna («~») (D13) */
export function cajaDeLaReferencia(e: Pick<EntradaSku, 'cajaSku' | 'cajaDeducida'>, ajustes: Pick<AjustesReposicion, 'multiploCaja'>): LineaPlan['caja'] {
  if (e.cajaSku && e.cajaSku > 0) return { unidades: Math.round(e.cajaSku), origen: 'sku' }
  if (e.cajaDeducida && e.cajaDeducida > 0) return { unidades: Math.round(e.cajaDeducida), origen: 'deducida' }
  if (ajustes.multiploCaja && ajustes.multiploCaja > 1) return { unidades: Math.round(ajustes.multiploCaja), origen: 'cliente' }
  return null
}

function fechaCampana(hoy: string, mmdd: string | null): string | null {
  if (!mmdd || !/^\d{2}-\d{2}$/.test(mmdd)) return null
  const f = `${hoy.slice(0, 4)}-${mmdd}`
  return f >= hoy ? f : null
}

export const planificarSku: FnPlanificarSku = (e, hoy, plazo, ajustes, medidas, opciones) => {
  const factorIa = opciones?.factorIa && opciones.factorIa > 0 ? opciones.factorIa : 1
  const llegadaForzada = opciones?.llegadaForzada ?? null
  const ritmoEntrada = e.ritmo
  const avisos = new Set<AvisoLinea>()
  const frases: string[] = []

  // Ritmo de la línea (con stock viejo la confianza baja un nivel, D11)
  const ritmo: RitmoSku = e.stockViejoDias !== null && e.stockViejoDias !== undefined
    ? { ...ritmoEntrada, confianza: BAJAR_CONFIANZA[ritmoEntrada.confianza] }
    : ritmoEntrada
  if (e.stockViejoDias !== null && e.stockViejoDias !== undefined) avisos.add('stock_viejo')

  // Llegadas
  const cuentan = e.llegadas.filter((l) => !l.dudoso && l.unidades > 0)
  const suma = (ls: readonly LlegadaPrevista[]) => ls.reduce((s, l) => s + Math.max(0, l.unidades), 0)
  const caminoErp = suma(cuentan.filter((l) => l.origen === 'camino'))
  const entranteSinRemesa = suma(cuentan.filter((l) => l.origen === 'amazon_sin_remesa'))
  const deCamino = caminoErp + entranteSinRemesa
  const comprometido = suma(cuentan.filter((l) => l.origen === 'comprometido' || l.origen === 'envio_hablado'))
  const dudosoLlegadas = suma(e.llegadas.filter((l) => l.dudoso))
  const dudosoDescartadas = e.llegadasDescartadas.filter((d) => d.motivo === 'dudoso').reduce((s, d) => s + Math.max(0, d.unidades), 0)
  const dudoso = Math.max(dudosoLlegadas, dudosoDescartadas)
  const paradas = e.llegadasDescartadas.filter((d) => d.motivo === 'propuesta_parada')
  if (entranteSinRemesa > 0) avisos.add('entrante_sin_remesa')
  if (dudoso > 0) avisos.add('envio_dudoso')
  if (paradas.length > 0) avisos.add('comprometido_parado')
  if (e.precio === null || e.precio === undefined) avisos.add('sin_precio')
  if (ritmo.pedidoGrande) avisos.add('pedido_grande')
  if (e.provisional) avisos.add('provisional')
  if (plazo.origen.preparacion === 'partida' || plazo.origen.transporte === 'partida' || plazo.origen.recepcion === 'partida' || plazo.origen.margen === 'partida') {
    avisos.add('plazo_de_partida')
  }

  const H = hoy
  const L = plazo.hastaLaVenta
  const M = plazo.margen
  const tr = plazo.transporte + plazo.recepcion

  // Ritmo día a día
  const demanda = demandaBrutaDe(ritmo, ajustes.topeEstacional, factorIa)
  const consumo = consumoDe(ritmo, demanda)
  const Dref = mediaEntre(demanda, H, 30)

  // Cobertura objetivo: T (×0,75 si baja; ≤ 30 en oct-dic si rota poco), y Tef = max(T, transporte + recepción + cadencia) (D9)
  let T = e.coberturaSku && e.coberturaSku > 0 ? e.coberturaSku : ajustes.coberturaObjetivo
  if (ritmo.tendencia === 'baja') T = T * 0.75
  if (esTrimestreAlto(H) && Dref > 0 && Dref < 0.5) T = Math.min(T, 30)
  T = Math.round(T)
  const Tef = Math.max(T, medidas.cadenciaDias !== null && medidas.cadenciaDias !== undefined && medidas.cadenciaDias > 0 ? tr + Math.round(medidas.cadenciaDias) : 0)
  let Tmax = Math.max(ajustes.coberturaMaxima, Tef + M)

  const caja = cajaDeLaReferencia(e, ajustes)

  const base: LineaPlan = {
    sku: e.sku, asin: e.asin, fnsku: e.fnsku, nombre: e.nombre,
    modelo: e.modelo, talla: e.talla, precio: e.precio, moneda: e.moneda,
    vendibles: e.vendibles, deCamino, comprometido, reservadas: e.reservadas,
    entranteSinRemesa, dudoso,
    ritmo,
    ritmoPrevisto: Dref > 0 ? Math.round(Dref * 10000) / 10000 : null,
    coberturaDias: Dref > 0 ? Math.round((e.vendibles / Dref) * 10) / 10 : null,
    coberturaConLoQueViene: null,
    fechaRotura: null, fechaPrimerHueco: null,
    aLaVentaObjetivo: null, salirAntesDe: null, decidirAntesDe: null,
    vaTarde: false, diasSinStockInevitables: 0,
    coberturaEfectiva: Tef,
    necesidad: 0, tope: 0, cantidad: 0,
    caja, cajas: null,
    eurosEnRiesgo: null, eurosSiVaTarde: null,
    prioridad: 'mas_adelante',
    fuera: null,
    avisos: [],
    adelantada: false,
    aLaVentaUrgente: null,
    porque: '',
    ...(() => {
      const porRemesa = new Map<string, RemesaSinSalirDeLinea>()
      for (const l of e.llegadas) {
        if (l.origen !== 'comprometido' || !l.remesaId || !(l.unidades > 0)) continue
        const x = porRemesa.get(l.remesaId) ?? { remesaId: l.remesaId, nombre: l.nombre, estado: l.estadoRemesa ?? null, fechaEnvio: l.fechaEnvio, unidades: 0 }
        x.unidades += Math.round(l.unidades)
        porRemesa.set(l.remesaId, x)
      }
      return porRemesa.size ? { remesasSinSalir: [...porRemesa.values()] } : {}
    })(),
    ajusteIa: factorIa !== 1 ? { tipo: 'factor_ritmo', valor: factorIa, motivo: '' } : null,
  }

  const cerrar = (fuera: MotivoFuera | null, porque: string): LineaPlan => {
    const l: LineaPlan = { ...base, fuera, avisos: [...avisos], porque: porque.trim() }
    if (fuera) { l.cantidad = 0; l.cajas = null }
    return l
  }

  // Exclusiones que no necesitan la simulación
  if (e.descatalogada || e.excluida) {
    const motivo = e.excluida?.motivo ? ` (${e.excluida.motivo})` : ''
    return cerrar('descatalogada', `El cliente no la repone${motivo}: descatalogada o excluida de la reposición.`)
  }
  if (!e.comprable) {
    return cerrar('no_comprable', `Tiene ${numero(e.vendibles)} ud en Amazon pero el listing no se puede comprar: enviar más es pagar almacenaje por algo que no se vende.`)
  }
  // D8 · Solo es «agotado largo» si de verdad lleva más de 76 días agotada. Si el último stock es reciente (pocos días con stock en
  // las ventanas de 14/30/90), se planifica normal con el ritmo de ese periodo (confianza baja) y la frase lo dice
  const agotadaHace = ritmo.origen === 'ultimo_periodo' && ritmo.ultimoPeriodoHasta ? diasEntre(ritmo.ultimoPeriodoHasta, hoy) : null
  if (ritmo.origen === 'ultimo_periodo' && (agotadaHace === null || agotadaHace > DIAS_AGOTADO_LARGO)) {
    const hasta = ritmo.ultimoPeriodoHasta ? ` hasta el ${fechaCorta(ritmo.ultimoPeriodoHasta)}` : ''
    const ud = ritmo.base ?? ritmo.previsto
    const vendia = ud !== null && ud !== undefined && ud > 0 ? `vendía ${ritmoTexto(ud)} ud/día en el último periodo con stock${hasta}` : `sin ventas recientes`
    // Si ya viene algo (de camino, en una remesa o hablado), el cliente ya ha contestado que se repone: no se pregunta
    const vienen = cuentan.filter((l) => l.origen === 'camino' || l.origen === 'amazon_sin_remesa' || l.origen === 'comprometido' || l.origen === 'envio_hablado')
    if (vienen.length > 0) {
      const ud = suma(vienen)
      const primera = [...vienen].sort((a, b) => a.fecha.localeCompare(b.fecha))[0]
      return cerrar('sin_datos', `Llegan ${numero(ud)} ud el ${fechaCorta(maxFecha(primera.fecha, hoy))} tras mucho tiempo agotada (${vendia}): se planifica cuando haya ventas nuevas.`)
    }
    return cerrar('agotado_largo', `Lleva mucho tiempo agotada (${vendia}). ¿Se repone? Pregúntalo al cliente antes de mandar nada.`)
  }
  if (e.modelo && (ritmo.ventas180 ?? 0) === 0 && (ritmo.ventas90 ?? 0) === 0) {
    return cerrar('talla_sin_ventas', `La talla ${e.talla ?? e.sku} no ha vendido nada en 180 días: no entra en el reparto del modelo ${e.modelo}.`)
  }
  if ((ritmo.ventas90 ?? 0) === 0 && ritmo.origen === 'sku' && !(ritmo.base && ritmo.base > 0)) {
    return cerrar('sin_ventas', `No ha vendido nada en 90 días${e.vendibles > 0 ? ` y tiene ${numero(e.vendibles)} ud` : ''}: no hay demanda que cubrir.`)
  }
  const soloR14 = ritmo.confianza === 'baja' && ritmo.r14 !== null && ritmo.r30 === null && ritmo.r90 === null
  if (ritmo.confianza === 'sin_datos' || !(Dref > 0) || (soloR14 && ritmo.origen === 'sku' && !e.modelo)) {
    return cerrar('sin_datos', `Sin datos suficientes para planificar (${ritmo.ventas90 ?? 0} ventas en 90 días con ${ritmo.diasConStock90 ?? 0} días con stock): no se inventa.`)
  }
  if (e.vendibles > 0 && e.diasSinVenta !== null && e.diasSinVenta !== undefined && e.diasSinVenta >= 45) {
    return cerrar('parado', `Tiene ${numero(e.vendibles)} ud y lleva ${e.diasSinVenta} días sin vender: no rota, no se manda más.`)
  }

  // Simulación sin enviar nada
  const horizonte = Math.max(L + Tef + M + 60, 365)
  const sim = simularInterno(e.vendibles, e.llegadas, consumo, H, horizonte, L)
  const iDe = (f: string) => Math.max(0, Math.min(sim.fechas.length, diasEntre(H, f)))
  const perdidasEn = (desde: string, hasta: string) => {
    let t = 0
    for (let i = iDe(desde); i < iDe(hasta); i++) t += sim.falta[i] * demanda(sim.fechas[i])
    return t
  }
  const diasSinStockEn = (desde: string, hasta: string) => {
    let t = 0
    for (let i = iDe(desde); i < iDe(hasta); i++) t += sim.falta[i]
    return t
  }
  const faltaEn = (desde: string, hasta: string) => {
    let t = 0
    for (let i = iDe(desde); i < iDe(hasta); i++) t += sim.faltaUd[i]
    return t
  }

  const fechaRotura = sim.rotura === null ? null : sim.fechas[sim.rotura]
  base.fechaRotura = fechaRotura
  base.fechaPrimerHueco = sim.primerHueco === null ? null : sim.fechas[sim.primerHueco]
  base.coberturaConLoQueViene = fechaRotura ? diasEntre(H, fechaRotura) : null

  const HL = sumarDias(H, L)
  const inevitables = diasSinStockEn(H, HL)
  base.diasSinStockInevitables = Math.round(inevitables)
  // «Tarde» solo si la rotura que decide no se evita: llega antes (o el mismo día) que un envío que saliera ya. Los huecos
  // anteriores que se cierran con lo que viene quedan como dato (`diasSinStockInevitables` y la frase), sin decidir la prioridad.
  const vaTarde = fechaRotura !== null && fechaRotura <= HL
  base.vaTarde = vaTarde

  if (e.precio !== null && e.precio !== undefined) {
    base.eurosEnRiesgo = Math.round(e.precio * perdidasEn(H, sumarDias(H, L + 30)))
    base.eurosSiVaTarde = Math.round(e.precio * perdidasEn(H, HL))
  }

  // Frases comunes
  const caminoTexto = (() => {
    const proximas = cuentan.filter((l) => l.origen === 'camino' || l.origen === 'amazon_sin_remesa').sort((a, b) => a.fecha.localeCompare(b.fecha))
    if (deCamino <= 0) return 'nada de camino'
    return `${numero(deCamino)} de camino (llegan el ${fechaCorta(maxFecha(proximas[0].fecha, H))})`
  })()
  // Lo comprometido (remesas sin salir) y los envíos hablados, con su nombre: si no, parece que no hay nada y se crea otra remesa encima
  const comprometidas = cuentan.filter((l) => l.origen === 'comprometido' || l.origen === 'envio_hablado')
  const comprometidoTexto = (() => {
    if (comprometidas.length === 0) return ''
    const grupos = new Map<string, { nombre: string; ud: number; fecha: string; hablado: boolean }>()
    for (const l of comprometidas) {
      const hablado = l.origen === 'envio_hablado'
      const nombre = l.nombre ?? (hablado ? 'un envío hablado con el cliente' : 'una remesa sin salir')
      const clave = l.remesaId ?? l.envioPropuestoId ?? nombre
      const g = grupos.get(clave) ?? { nombre, ud: 0, fecha: l.fecha, hablado }
      g.ud += Math.max(0, l.unidades)
      if (l.fecha < g.fecha) g.fecha = l.fecha
      grupos.set(clave, g)
    }
    return [...grupos.values()].map((g) => {
      const quien = /^un[a]? /.test(g.nombre) ? g.nombre : `«${g.nombre}»`
      return ` y ${numero(g.ud)} en ${quien} (${g.hablado ? 'hablado' : 'sin salir'}, llegarían ~${fechaCorta(maxFecha(g.fecha, H))})`
    }).join(',')
  })()
  const tieneTexto = comprometidoTexto
    ? `tiene ${numero(e.vendibles)}, ${caminoTexto}${comprometidoTexto}`
    : `tiene ${numero(e.vendibles)} y ${caminoTexto}`
  const consumoTexto = (() => {
    const tasa = Math.min(0.3, Math.max(0, ritmo.tasaDevolucionVendible || 0))
    const merma = Math.max(0, ritmo.mermaDiaria || 0)
    if (tasa <= 0 && merma <= 0) return ''
    const neto = Dref * (1 - tasa) + merma
    const partes: string[] = []
    if (tasa > 0) partes.push(`vuelve vendible el ${numero(tasa * 100)} %`)
    if (merma > 0) partes.push(`se pierden ${ritmoTexto(merma)} ud/día por daños o retiradas`)
    return ` (consume ${ritmoTexto(neto)} netas: ${partes.join(' y ')})`
  })()
  // Una sola cifra tras «Vende»: lo vendido de verdad (la base, con su ventana). Lo previsto con la temporada va aparte y se dice
  // como previsión; es el mismo número que enseña la pantalla (`ritmoPrevisto`)
  const ritmoVendido = ritmo.base !== null && ritmo.base !== undefined && ritmo.base > 0 ? ritmo.base : null
  const ventanasBase = [ritmo.r14 !== null ? '14' : null, ritmo.r30 !== null ? '30' : null, ritmo.r90 !== null ? '90' : null].filter(Boolean).join('/')
  const origenVendido = ritmo.origen === 'modelo' && e.modelo
    ? ` (ritmo del modelo ${e.modelo} repartido por tallas)`
    : ritmo.origen === 'ultimo_periodo'
      ? ` (pocos días con stock en 90: ritmo del periodo hasta el ${fechaCorta(ritmo.ultimoPeriodoHasta ?? hoy)})`
      : ventanasBase ? ` (últimos ${ventanasBase} días con stock)` : ''
  const previstoTexto = ritmoVendido !== null && Math.abs(Dref / ritmoVendido - 1) >= 0.05
    ? `; ${Dref > ritmoVendido ? 'con la temporada ' : ''}se prevén ~${ritmoTexto(Dref)} ud/día las próximas 4 semanas`
    : ''
  const ritmoFrase = `Vende ${ritmoTexto(ritmoVendido ?? Dref)} ud/día${origenVendido}${previstoTexto}${consumoTexto}`

  // Paso 2 · Fechas
  const roturaEf = fechaRotura ?? sumarDias(H, sim.fechas.length)
  let aLaVentaObjetivo = sumarDias(roturaEf, -M)
  let salirAntesDe = sumarDias(aLaVentaObjetivo, -tr)
  let decidirAntesDe = sumarDias(salirAntesDe, -plazo.preparacion)
  if (vaTarde || decidirAntesDe < H) {
    decidirAntesDe = H
    salirAntesDe = sumarDias(H, plazo.preparacion)
    aLaVentaObjetivo = maxFecha(aLaVentaObjetivo, HL)
  }
  let prioridad = prioridadPorDecidir(decidirAntesDe, H, vaTarde)

  // A: cuándo llegaría
  let A = maxFecha(aLaVentaObjetivo, HL)
  if (llegadaForzada) {
    A = maxFecha(llegadaForzada, HL)
    salirAntesDe = maxFecha(sumarDias(A, -tr), H)
    decidirAntesDe = maxFecha(sumarDias(salirAntesDe, -plazo.preparacion), H)
  }
  aLaVentaObjetivo = A
  base.aLaVentaObjetivo = A
  base.salirAntesDe = salirAntesDe
  base.decidirAntesDe = decidirAntesDe

  // Provisional: la prioridad máxima es «este mes» salvo los agotados que venden
  const agotadoQueVende = e.vendibles <= 0 && (ritmo.ventas30 ?? 0) > 0
  if (e.provisional && !agotadoQueVende && rangoPrioridad(prioridad) < rangoPrioridad('este_mes')) prioridad = 'este_mes'
  base.prioridad = prioridad

  // Exceso (D16): con lo que hay y lo que viene pasa de la cobertura máxima. Se decide con la misma simulación que la rotura (con el
  // consumo neto), no con vendibles / ritmo: así nunca dice a la vez «sobran» y «se rompe el …»
  const coberturaV = Dref > 0 ? e.vendibles / Dref : 0
  // Solo con lo que ya está en Amazon (lo de camino no se promociona ni se retira), con el mismo consumo neto
  const simV = simularInterno(e.vendibles, [], consumo, H, horizonte, 0)
  const coberturaSim = simV.rotura !== null ? simV.rotura : simV.fechas.length
  if (coberturaSim > Tmax) {
    const sobran = Math.max(0, Math.round(simV.inicio[Math.min(Tmax, simV.inicio.length - 1)] ?? 0))
    const coste = (e.moneda || 'EUR').toUpperCase() === 'EUR' ? costeMensual(sobran, mesDe(H)) : null
    const hasta = simV.rotura !== null ? `~${numero(coberturaSim)} días` : `más de ${numero(simV.fechas.length)} días`
    base.prioridad = 'mas_adelante'
    base.vaTarde = false
    // Por 3 unidades no se aconseja una promoción ni una retirada: el grupo Exceso pide algo que de verdad pese
    const pesa = sobran >= Math.max(10, Math.ceil(30 * Dref)) || (coste !== null && coste >= 5)
    if (!pesa) {
      return cerrar('stock_de_sobra', `${ritmoFrase}, ${tieneTexto}: le llega para ${hasta}. No hace falta mandar nada todavía.`)
    }
    const costeTexto = coste !== null && coste >= 1 ? ` Guardar lo que sobra cuesta ~${dinero(coste, 'EUR')} al mes.` : ''
    const vienenTexto = deCamino + comprometido > 0 ? `, y aún vienen ${numero(deCamino + comprometido)},` : ''
    return cerrar('exceso', `Tiene ${numero(e.vendibles)} ud en Amazon${vienenTexto} para ${hasta} (máximo ${Tmax}): sobran ~${numero(sobran)} ud. No envíes más; valora una promoción o una retirada.${costeTexto}`)
  }

  // Stock de sobra: con lo que hay y lo que viene llega a la siguiente ventana
  if (!llegadaForzada && (fechaRotura === null || diasEntre(H, fechaRotura) >= L + M + Tef)) {
    const hasta = fechaRotura ? `hasta el ${fechaCorta(fechaRotura)}` : `más de ${numero(sim.fechas.length)} días`
    const huecoTexto = inevitables > 0 && base.fechaPrimerHueco
      ? ` Ojo: ~${numero(Math.max(1, inevitables))} días sin stock desde el ${fechaCorta(base.fechaPrimerHueco)} hasta que llegue lo de camino; un envío nuevo ya no llega antes.`
      : ''
    return cerrar('stock_de_sobra', `${ritmoFrase}, ${tieneTexto}: le llega ${hasta}. No hace falta mandar nada todavía.${huecoTexto}`)
  }

  // Cuarentena: descartada hace poco y la prioridad no ha subido
  if (e.enCuarentena && rangoPrioridad(prioridad) >= rangoPrioridad(e.enCuarentena.prioridad)) {
    return cerrar('en_cuarentena', `Se descartó hace poco con prioridad «${e.enCuarentena.prioridad.replace('_', ' ')}» y no ha subido: no se insiste.`)
  }

  // Antigüedad mala: excluye salvo que corra mucha prisa; entonces limita Tmax a 45
  const pct180 = fraccion(e.pctMasDe180)
  if (pct180 !== null && pct180 >= 0.3 && coberturaV > 60) {
    avisos.add('antiguo')
    if (prioridad === 'tarde' || prioridad === 'urgente') {
      Tmax = 45
    } else {
      return cerrar('antiguo', `El ${numero(pct180 * 100)} % del stock lleva más de 180 días y cubre ${numero(coberturaV)} días: no se manda más hasta que rote (recargo por antigüedad).`)
    }
  }

  // Aún no toca (sale en la previsión con su fecha)
  if (!llegadaForzada && prioridad === 'mas_adelante') {
    base.fuera = 'aun_no_toca'
  }

  // Devoluciones altas: se propone con aviso
  const tasaDev = fraccion(e.tasaDevolucion90)
  if (tasaDev !== null && tasaDev > 0.25 && (ritmo.ventas90 ?? 0) >= 8) avisos.add('devoluciones_altas')

  // Merma alta
  if ((ritmo.mermaDiaria ?? 0) > 0 && Dref > 0 && ritmo.mermaDiaria / Dref > 0.05) avisos.add('merma_alta')

  // Estacionalidad topada
  if (ritmo.picoAnoPasado !== null && ritmo.picoAnoPasado !== undefined && ritmo.picoAnoPasado > ajustes.topeEstacional && ritmo.perfilSemanal) {
    const fin = sumarDias(A, Tef)
    let topado = false
    for (let f = H; f <= fin && !topado; f = sumarDias(f, 7)) {
      const factor = ritmo.perfilSemanal[semanaIso(f)]
      if (typeof factor === 'number' && factor > ajustes.topeEstacional) topado = true
    }
    if (topado) avisos.add('tope_estacional')
  }

  // Campaña: lo que llega después de `campanaHasta` ya no la pilla
  const campana = fechaCampana(H, ajustes.campanaHasta)
  if (campana && A > campana) avisos.add('llega_tarde_campana')

  // Paso 3 · Cantidad: lo que falta en [A, A + Tef + M) con el perfil de esas semanas, y el tope en [A, A + Tmax)
  const necesidad = faltaEn(A, sumarDias(A, Tef + M))
  let tope = faltaEn(A, sumarDias(A, Tmax))
  if (soloR14) {
    avisos.add('solo_r14')
    const r14 = ritmo.r14 ?? 0
    const repartido = ritmo.origen === 'modelo' ? (ritmo.base ?? r14) : r14
    tope = Math.min(tope, 30 * r14, repartido * Tef)
  }
  const bruta = Math.min(Math.max(0, necesidad), Math.max(0, tope))
  base.necesidad = Math.round(necesidad * 10) / 10
  base.tope = Math.round(Math.max(0, tope) * 10) / 10

  const prisa = PRIORIDADES_CON_PRISA.includes(prioridad)
  let cantidad: number
  if (e.modelo) {
    // Por talla se permite 1 ud: el mínimo útil y la caja se miran por modelo (ajustarPorModelo)
    cantidad = bruta >= 0.5 ? Math.max(1, Math.round(bruta)) : 0
  } else {
    cantidad = redondearACaja(bruta, caja?.unidades ?? null, prisa)
  }
  if (cantidad > 0 && tope > 0 && soloR14) cantidad = Math.min(cantidad, Math.max(1, Math.floor(tope)))

  // Alternativa en avión (D9)
  if (plazo.transporteUrgente !== null && plazo.transporteUrgente > 0 && (vaTarde || prioridad === 'urgente')) {
    base.aLaVentaUrgente = sumarDias(H, plazo.preparacion + plazo.transporteUrgente + plazo.recepcion)
  }

  // Frase
  const roturaTexto = fechaRotura ? `se queda sin stock el ${fechaCorta(fechaRotura)}` : 'aguanta todo el horizonte'
  if (vaTarde) {
    frases.push(`${ritmoFrase}, ${tieneTexto}. Ya vas tarde: si sale esta semana llega el ${fechaCorta(HL)}; ${numero(inevitables)} días sin stock${e.precio !== null && e.precio !== undefined && base.eurosSiVaTarde ? ` (~${dinero(base.eurosSiVaTarde, e.moneda)})` : ''}.`)
  } else {
    frases.push(`${ritmoFrase}, ${tieneTexto}: ${roturaTexto}.`)
    if (inevitables >= 0.5 && base.fechaPrimerHueco && base.fechaPrimerHueco < HL) {
      const n = Math.max(1, Math.round(inevitables))
      const dias = `~${numero(n)} día${n === 1 ? '' : 's'} sin stock`
      const evita = n === 1 ? 'no se evita' : 'no se evitan'
      frases.push(fechaRotura && base.fechaPrimerHueco < fechaRotura
        ? `Antes, ${dias} desde el ${fechaCorta(base.fechaPrimerHueco)} que ya ${evita}.`
        : `Aunque salga ya, ${dias} que ${evita}.`)
    }
  }
  if (cantidad > 0) {
    // Hasta cuándo cubre lo que se manda
    const conEnvio = simularInterno(e.vendibles, [...e.llegadas, { fecha: A, unidades: cantidad, origen: 'comprometido', remesaId: null, envioPropuestoId: null, nombre: null, dudoso: false, fechaEnvio: null }], consumo, H, horizonte, diasEntre(H, A) + 1)
    let cubre: string | null = null
    for (let i = Math.max(0, diasEntre(H, A)); i < conEnvio.fechas.length; i++) {
      if (conEnvio.hueco[i]) { cubre = conEnvio.fechas[i]; break }
    }
    const cubreTexto = cubre ? ` cubres hasta el ${fechaCorta(cubre)}` : ' cubres más allá del horizonte'
    frases.push(`Mandando ${numero(cantidad)} ud antes del ${fechaCorta(salirAntesDe)}${cubreTexto}.`)
    // Antes: «añádelo ahí en vez de crear otra remesa». La pantalla no lo permite (convertir crea otra remesa, y una remesa
    // aprobada o encajando ya no admite líneas): el aviso va en el envío (`avisoRemesasSinSalir`, envios-propuestos.ts)
  }
  if (base.aLaVentaUrgente) frases.push(`En avión, ${plazo.transporteUrgente} días: llegaría el ${fechaCorta(base.aLaVentaUrgente)}.`)
  if (avisos.has('llega_tarde_campana') && campana) frases.push(`Lo que salga ahora está a la venta el ${fechaCorta(A)}: la campaña (hasta el ${fechaCorta(campana)}) ya no llega.`)
  if (avisos.has('tope_estacional') && ritmo.picoAnoPasado) frases.push(`El año pasado ×${numero(ritmo.picoAnoPasado, 1)} en la semana pico: el plan usa ×${numero(ajustes.topeEstacional, 1)} (tope del cliente).`)
  if (dudoso > 0) {
    const d = e.llegadas.find((l) => l.dudoso) ?? null
    const desc = e.llegadasDescartadas.find((x) => x.motivo === 'dudoso') ?? null
    const desde = d?.fechaEnvio ?? desc?.desde ?? null
    const quien = desde ? `el envío del ${fechaCorta(desde)}` : 'el envío dudoso'
    frases.push(cantidad > 0 && dudoso < cantidad
      ? `Si llega ${quien} (${numero(dudoso)} ud), sobran ${numero(dudoso)} de lo propuesto.`
      : `Si llega ${quien} (${numero(dudoso)} ud), esto sobra.`)
  }
  for (const p of paradas) {
    frases.push(`Hay ${numero(p.unidades)} ud en una propuesta parada${p.nombre ? ` («${p.nombre}»)` : ''}${p.desde ? ` desde el ${fechaCorta(p.desde)}` : ''}; no se cuentan.`)
  }
  if (entranteSinRemesa > 0) frases.push(`Amazon tiene ${numero(entranteSinRemesa)} ud entrantes que no están en el ERP: importa el envío.`)
  if (avisos.has('antiguo') && !base.fuera) frases.push(`Ojo: más del 30 % del stock lleva más de 180 días; se limita a 45 días de cobertura.`)
  if (avisos.has('devoluciones_altas')) frases.push(`Devoluciones altas (${numero((tasaDev ?? 0) * 100)} %): revísalo antes de mandar.`)
  if (e.stockViejoDias !== null && e.stockViejoDias !== undefined) frases.push(`El stock es de otro mercado y de hace ${e.stockViejoDias} días.`)
  if (soloR14) frases.push(`Solo hay ritmo de 14 días: la cantidad se limita.`)
  if (e.almacenCliente !== null && e.almacenCliente !== undefined) {
    if (cantidad > 0 && e.almacenCliente < cantidad) avisos.add('almacen_cliente_corto')
    frases.push(`El cliente tiene ${numero(e.almacenCliente)} en su almacén.`)
  }

  base.cantidad = base.fuera ? 0 : cantidad
  base.cajas = base.cantidad > 0 && caja ? Math.ceil(base.cantidad / caja.unidades) : null

  if (base.fuera === 'aun_no_toca') {
    return cerrar('aun_no_toca', `${frases[0]} Aún no toca: decide antes del ${fechaCorta(decidirAntesDe)}.`)
  }

  // Mínimo útil (las tallas lo miran por modelo)
  if (!e.modelo) {
    const minimo = Math.max(ajustes.minLinea, Math.ceil(Dref * 7))
    if (cantidad < minimo) {
      const motivo = cantidad <= 0 && necesidad <= 0
        ? `${frases[0]} Con lo que hay y lo que viene no hace falta mandar nada.`
        : `${frases[0]} Haría falta ${numero(Math.max(0, Math.round(bruta)))} ud: menos de una semana de ventas (mínimo ${minimo}); saldrá cuando de verdad haga falta.`
      return cerrar(cantidad <= 0 && necesidad <= 0 ? 'stock_de_sobra' : 'cantidad_ridicula', motivo)
    }
  } else if (cantidad <= 0) {
    return cerrar(necesidad <= 0 ? 'stock_de_sobra' : 'cantidad_ridicula', `${frases[0]} No hace falta mandar de esta talla.`)
  }

  return cerrar(null, frases.join(' '))
}

/* ------------------------------------------------------------------ */
/* Recalcular con otra salida (para agruparEnvios)                     */
/* ------------------------------------------------------------------ */

export interface ContextoPlan {
  hoy: string
  plazo: PlazoEtapas
  ajustes: AjustesReposicion
  medidas: MedidasCliente
}

/**
 * La misma referencia si sale el `nuevaSalida` (el día del envío al que se suma): llega `nuevaSalida + transporte + recepción` y la cantidad
 * se recalcula para cubrir desde ahí. No se excluye por «aún no toca» ni por «stock de sobra» con fecha (la decisión de adelantar es de
 * agruparEnvios), pero sí por cantidad: si no hace falta nada sale con cantidad 0.
 */
export function recalcularConLlegada(linea: LineaPlan, e: EntradaSku, nuevaSalida: string, contexto: ContextoPlan): LineaPlan {
  const { hoy, plazo, ajustes, medidas } = contexto
  const factorIa = linea.ajusteIa?.tipo === 'factor_ritmo' && linea.ajusteIa.valor ? linea.ajusteIa.valor : undefined
  const llegada = sumarDias(maxFecha(nuevaSalida, hoy), plazo.transporte + plazo.recepcion)
  const nueva = planificarSku(e, hoy, plazo, ajustes, medidas, { llegadaForzada: llegada, factorIa })
  return {
    ...nueva,
    adelantada: linea.adelantada,
    ajusteIa: linea.ajusteIa,
    avisos: linea.adelantada && !nueva.avisos.includes('adelantada') ? [...nueva.avisos, 'adelantada'] : nueva.avisos,
  }
}

/* ------------------------------------------------------------------ */
/* Ajustar por modelo (D5.3)                                           */
/* ------------------------------------------------------------------ */

const ritmoDeLinea = (l: LineaPlan): number => Math.max(0, l.ritmo.previsto ?? l.ritmo.base ?? 0)

/**
 * Calzado: la talla suelta casi nunca llega al mínimo, el modelo sí. Por modelo:
 *   · Σ tallas ≥ max(minLinea, 7 días del modelo); si no, todas las tallas fuera (`cantidad_ridicula`).
 *   · Redondeo a la caja (la más repetida entre sus tallas) del total del modelo; la diferencia se reparte por ritmo (sube a las que más
 *     venden, baja de las que más llevan, nunca por debajo de 1 salvo que haya que quitar tallas enteras).
 * Las líneas sin modelo y las que ya están fuera no se tocan. Devuelve las líneas en el mismo orden.
 */
export function ajustarPorModelo(lineas: LineaPlan[], ajustes: AjustesReposicion): LineaPlan[] {
  const salida = lineas.map((l) => ({ ...l }))
  const grupos = new Map<string, number[]>()
  salida.forEach((l, i) => {
    if (!l.modelo || l.fuera || l.cantidad <= 0) return
    const g = grupos.get(l.modelo) ?? []
    g.push(i)
    grupos.set(l.modelo, g)
  })

  for (const [modelo, idx] of grupos) {
    const ls = idx.map((i) => salida[i])
    const dModelo = ls.reduce((s, l) => s + ritmoDeLinea(l), 0)
    const minimo = Math.max(ajustes.minLinea, Math.ceil(dModelo * 7))
    const total = ls.reduce((s, l) => s + l.cantidad, 0)

    // Caja del modelo: la más repetida
    const cuenta = new Map<number, number>()
    for (const l of ls) if (l.caja && l.caja.unidades > 1) cuenta.set(l.caja.unidades, (cuenta.get(l.caja.unidades) ?? 0) + 1)
    const k = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null
    const prisa = ls.some((l) => PRIORIDADES_CON_PRISA.includes(l.prioridad))
    // El redondeo a la caja no puede pasar del tope del modelo (la cobertura máxima): si lo pasa, se baja a la caja de abajo
    // y, si esa no llega al mínimo, se deja sin redondear (caja «~»)
    const topeModelo = Math.floor(ls.reduce((s, l) => s + Math.max(0, l.tope || 0), 0))
    let objetivo = k ? redondearACaja(total, k, prisa) : total
    let sinRedondear = false
    if (k && topeModelo > 0 && objetivo > topeModelo && objetivo > total) {
      const abajo = Math.floor(total / k) * k
      if (abajo >= minimo && abajo > 0) objetivo = abajo
      else { objetivo = total; sinRedondear = true }
    }

    if (objetivo < minimo || objetivo <= 0) {
      const motivo = total >= minimo && k
        ? `El modelo ${modelo} suma ${numero(total)} ud entre tallas: no llega a una caja de ${k} y aún no corre prisa; saldrá cuando haga falta.`
        : `El modelo ${modelo} suma ${numero(total)} ud entre tallas: menos de una semana de ventas del modelo (mínimo ${minimo}); saldrá cuando haga falta.`
      for (const i of idx) {
        const l = salida[i]
        // Sin envío, el «Mandando N ud…» de la talla ya no vale
        const sinMandar = l.porque.replace(/ ?Mandando [\d.,]+ ud antes del [^.]*\./, '')
        salida[i] = { ...l, cantidad: 0, cajas: null, fuera: 'cantidad_ridicula', porque: `${sinMandar} ${motivo}`.trim() }
      }
      continue
    }

    // Repartir la diferencia del redondeo
    let delta = objetivo - total
    const porRitmo = [...idx].sort((a, b) => ritmoDeLinea(salida[b]) - ritmoDeLinea(salida[a]))
    let vuelta = 0
    while (delta > 0) {
      const i = porRitmo[vuelta % porRitmo.length]
      salida[i] = { ...salida[i], cantidad: salida[i].cantidad + 1 }
      delta--
      vuelta++
    }
    while (delta < 0) {
      const vivos = idx.filter((i) => salida[i].cantidad > 1).sort((a, b) => salida[b].cantidad - salida[a].cantidad)
      if (vivos.length > 0) {
        salida[vivos[0]] = { ...salida[vivos[0]], cantidad: salida[vivos[0]].cantidad - 1 }
      } else {
        const conUna = idx.filter((i) => salida[i].cantidad === 1).sort((a, b) => ritmoDeLinea(salida[a]) - ritmoDeLinea(salida[b]))
        if (conUna.length === 0) break
        const i = conUna[0]
        salida[i] = { ...salida[i], cantidad: 0, cajas: null, fuera: 'cantidad_ridicula', porque: `${salida[i].porque} Se quita al redondear el modelo ${modelo} a cajas de ${k}.`.trim() }
      }
      delta++
    }
    for (const i of idx) {
      const l = salida[i]
      if (l.fuera) continue
      const original = lineas[i].cantidad
      let porque = l.porque
      if (l.cantidad !== original) {
        // La frase tiene que decir lo que se manda: el «cubres hasta» de la cantidad suelta ya no vale
        const nota = k && !sinRedondear ? ` (el modelo ${modelo} se redondea a cajas de ${k}: ${numero(objetivo)} ud entre tallas)` : ` (ajustado al reparto del modelo ${modelo})`
        const re = /Mandando [\d.,]+ ud antes del ([^.]*?)(?: cubres [^.]*)?\./
        porque = re.test(porque)
          ? porque.replace(re, (_m, fecha: string) => `Mandando ${numero(l.cantidad)} ud antes del ${fecha}${nota}.`)
          : `${porque} Se mandan ${numero(l.cantidad)} ud${nota}.`.trim()
      }
      salida[i] = { ...l, porque, cajas: l.caja && !sinRedondear ? Math.ceil(l.cantidad / l.caja.unidades) : null }
    }
  }
  return salida
}

/** Para pruebas y para el panel: el mínimo útil de una línea suelta */
export const minimoUtil = (d: number, ajustes: Pick<AjustesReposicion, 'minLinea'>): number => Math.max(ajustes.minLinea, Math.ceil(d * 7))
