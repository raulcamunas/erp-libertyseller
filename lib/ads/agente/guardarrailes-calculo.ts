/**
 * AMAZON ADS · EL AGENTE PPC: GUARDARRAÍLES, RAMPA, RAREZA, ERRORES DE AMAZON Y FRENO. PURO (nada de servidor; solo importa de ./tipos).
 *
 * Lo que el agente comprueba ANTES de escribir en Amazon y lo que le hace parar:
 *
 *   CLASE      cada propuesta (negativizar, promover, puja, presupuesto, pausar, pausar-campana) se convierte en una clase de cambio (puja que sube, que baja, que baja sin pedidos…).
 *   TOPES      cuántos cambios de cada clase al día (TOPES_DE_PARTIDA, configurables 0–200). Tras el ensayo, una RAMPA de 7 días: el primer día solo bajadas al 25 % de los topes,
 *              días 2–3 al 50 % y sin subir presupuestos, días 4–6 al 75 %, y desde el 7.º completos. Con errores de Amazon en los 7 días anteriores, nunca más del 75 %.
 *              Cuenta pequeña (gasto 30 d < 300): como mucho 3 subidas de puja al día y ninguna de presupuesto.
 *   PUJA       nunca más de un ±25 % de golpe, nunca por debajo de 0,02 y una subida nunca por encima de la puja máxima. Una subida que, recortada, ya no sube, se descarta.
 *   PRESUPUESTO  la suma de presupuestos ÚTILES no pasa de techo ÷ 30,4 × 1,1 × 1,3; la suma REAL no pasa de techo ÷ 30,4 × 1,1 (o de la que había al encender, si era mayor)
 *              ni de 1,3 × la de hace 7 días. Lo que no cabe es el «hueco» (R1 lo intenta financiar moviendo dinero de campañas que no lo usan).
 *   RAREZA     lo que puede cortar ventas que ya existen (pausar algo que gasta mucho, bajar una puja que vende…) pasa por la IA y, si lo aprueba, se aplica en FORMA REDUCIDA.
 *   ERRORES    transporte (429, 5xx, tiempo agotado: se reintenta y no cuenta), autorización (401/403: cuenta para el freno), validación (400/422, duplicado: no cuenta).
 *   FRENO      gasto disparado, ACoS de la cuenta que empeora, errores seguidos, datos viejos o ventas totales hundidas → el agente se para y avisa.
 *   TÉRMINOS   qué hacer con un término REVISAR según la etiqueta de la IA, y si la IA ya está validada por las personas (50 resueltas y ≥ 80 % de acuerdo).
 */

import { esReintentoDeTransporte } from '../motor-calculo'
import {
  AGENTE,
  RAMPA,
  TOPES_DE_PARTIDA,
  type ClaseDeCambio,
  type ClaseDeTope,
  type EtiquetaDeTermino,
  type FaseDeEvento,
  type MotivoDeFreno,
  type TipoDeErrorDeAmazon,
  type TopesDelAgente,
} from './tipos'

// ---------------------------------------------------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------------------------------------------------

const EPS = 1e-9
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
/** Redondeo a céntimos hacia abajo / arriba (para no pasarse de un límite por redondear) */
const abajo2 = (n: number) => Math.floor(n * 100 + EPS) / 100
const arriba2 = (n: number) => Math.ceil(n * 100 - EPS) / 100
const finito = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

const num = (n: number, dec = 2) => n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: dec })
const pct = (n: number) => `${num(n, 1)} %`

const CLASES_DE_TOPE: readonly ClaseDeTope[] = ['negativizar', 'promover', 'puja_subir', 'puja_bajar', 'pausar', 'presupuesto_subir', 'presupuesto_bajar', 'pausar_campana']
/** Clases que SUBEN (gasto o alcance): fuera el primer día de rampa */
const CLASES_QUE_SUBEN: readonly ClaseDeTope[] = ['promover', 'puja_subir', 'presupuesto_subir']
const TOPE_MAXIMO = 200

// ---------------------------------------------------------------------------------------------------------------------
// Clases
// ---------------------------------------------------------------------------------------------------------------------

/**
 * La clase de una propuesta. Una puja o un presupuesto sin los dos valores (no se sabe si sube o baja) se trata como SUBIDA: es la clase más vigilada (rampa, topes, postura).
 * Un tipo desconocido también cae en la más vigilada (puja_subir) para que nunca se cuele fuera de los topes.
 */
export function claseDeCambio(p: { tipo: string; valorActual: number | null; valorNuevo: number | null; metricas: { pedidos: number } }): ClaseDeCambio {
  const sube = !(finito(p.valorActual) && finito(p.valorNuevo)) || p.valorNuevo! > p.valorActual!
  switch (p.tipo) {
    case 'negativizar':
      return 'negativizar'
    case 'promover':
      return 'promover'
    case 'pausar':
      return 'pausar'
    case 'pausar-campana':
    case 'pausar_campana':
      return 'pausar_campana'
    case 'presupuesto':
      return sube ? 'presupuesto_subir' : 'presupuesto_bajar'
    case 'puja':
      if (sube) return 'puja_subir'
      return (p.metricas?.pedidos ?? 0) > 0 ? 'puja_bajar' : 'puja_bajar_sin_pedidos'
    default:
      return 'puja_subir'
  }
}

/** Las bajadas sin pedidos comparten tope con las demás bajadas de puja */
export const claseDeTope = (c: ClaseDeCambio): ClaseDeTope => (c === 'puja_bajar_sin_pedidos' ? 'puja_bajar' : c)

// ---------------------------------------------------------------------------------------------------------------------
// Topes y rampa
// ---------------------------------------------------------------------------------------------------------------------

/** Los topes guardados (jsonb) ya limpios: enteros de 0 a 200; lo que falte o no sea un número, el de partida */
export function topesValidos(crudo: unknown): TopesDelAgente {
  const fuente = crudo && typeof crudo === 'object' && !Array.isArray(crudo) ? (crudo as Record<string, unknown>) : {}
  const r = { ...TOPES_DE_PARTIDA }
  for (const c of CLASES_DE_TOPE) {
    const v = fuente[c]
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    if (finito(n)) r[c] = Math.min(TOPE_MAXIMO, Math.max(0, Math.round(n)))
  }
  return r
}

/**
 * Los topes de HOY. En ensayo, completos (no escribe). Activo: el factor de la RAMPA según el día (0 = primer día activo), con redondeo hacia arriba y mínimo 1 (un tope 0 sigue en 0);
 * con errores de Amazon recientes el factor no pasa de 0,75. Sin fecha de rampa (null) = rampa terminada. Cuenta pequeña: puja_subir ≤ 3 y ningún presupuesto que suba.
 */
export function topesDelDia(
  topes: TopesDelAgente,
  e: { enEnsayo: boolean; diaRampa: number | null; cuentaPequena: boolean; erroresRecientes: boolean },
): { topes: TopesDelAgente; soloBajadas: boolean; sinPresupuestoSubir: boolean; factor: number } {
  let factor = 1
  let soloBajadas = false
  let sinPresupuestoSubir = false

  if (!e.enEnsayo) {
    if (e.diaRampa !== null && finito(e.diaRampa)) {
      const dia = Math.max(0, Math.floor(e.diaRampa))
      let tramo = RAMPA[0]
      for (const t of RAMPA) if (dia >= t.desdeDia) tramo = t
      factor = tramo.factor
      soloBajadas = tramo.soloBajadas
      sinPresupuestoSubir = tramo.sinPresupuestoSubir
    }
    if (e.erroresRecientes) factor = Math.min(factor, 0.75)
  }

  const r = { ...TOPES_DE_PARTIDA }
  for (const c of CLASES_DE_TOPE) {
    const base = finito(topes?.[c]) ? Math.max(0, Math.round(topes[c])) : TOPES_DE_PARTIDA[c]
    r[c] = base === 0 || factor >= 1 ? base : Math.max(1, Math.ceil(Math.round(base * factor * 1e6) / 1e6))
  }
  if (soloBajadas) for (const c of CLASES_QUE_SUBEN) r[c] = 0
  if (e.cuentaPequena) {
    r.puja_subir = Math.min(r.puja_subir, AGENTE.CUENTA_PEQUENA_TOPE_SUBIR)
    r.presupuesto_subir = 0
    sinPresupuestoSubir = true
  }
  if (sinPresupuestoSubir) r.presupuesto_subir = 0
  return { topes: r, soloBajadas, sinPresupuestoSubir, factor }
}

/** ¿Queda sitio hoy para otro cambio de esta clase? */
export function quedaTope(clase: ClaseDeCambio, hechosHoy: Partial<Record<ClaseDeTope, number>>, topes: TopesDelAgente): boolean {
  const c = claseDeTope(clase)
  return (hechosHoy[c] ?? 0) < (topes[c] ?? 0)
}

// ---------------------------------------------------------------------------------------------------------------------
// Puja
// ---------------------------------------------------------------------------------------------------------------------

/**
 * La puja que se puede poner: como mucho ±25 % de la actual (redondeando HACIA DENTRO para no pasarse), nunca < 0,02 y, si sube, nunca > pujaMax.
 * Una subida que tras recortarla ya no sube (≤ actual) se DESCARTA (no merece la pena). Con la puja actual desconocida o ≤ 0 tampoco se toca.
 */
export function limitarPuja(actual: number, nueva: number, pujaMax: number | null): { valor: number; recortada: boolean; descartar: boolean } {
  if (!finito(actual) || actual <= 0 || !finito(nueva)) return { valor: finito(actual) ? actual : 0, recortada: false, descartar: true }
  const pedida = round2(nueva)
  const sube = nueva > actual
  const maximo = abajo2(actual * (1 + AGENTE.PUJA_CAMBIO_MAX))
  const minimo = arriba2(actual * (1 - AGENTE.PUJA_CAMBIO_MAX))
  let valor = Math.min(Math.max(pedida, minimo), maximo)
  if (sube && pujaMax !== null && finito(pujaMax) && valor > pujaMax) valor = abajo2(pujaMax)
  valor = Math.max(AGENTE.PUJA_MINIMA, round2(valor))
  // una subida que ya no sube, o una bajada que ya no baja (p. ej. en el mínimo de 0,02), no merece la pena
  const descartar = sube ? valor <= actual + EPS : valor >= actual - EPS
  return { valor, recortada: Math.abs(valor - pedida) > EPS, descartar }
}

// ---------------------------------------------------------------------------------------------------------------------
// Presupuestos
// ---------------------------------------------------------------------------------------------------------------------

/** Lo que una campaña puede gastar de verdad: su presupuesto, o 1,3 × su máximo de 14 días si es menor (sin 14 días de datos, el presupuesto entero) */
export function presupuestoUtil(presupuesto: number, maxGasto14: number | null): number {
  if (!finito(presupuesto) || presupuesto <= 0) return 0
  if (maxGasto14 === null || !finito(maxGasto14)) return round2(presupuesto)
  return round2(Math.min(presupuesto, Math.max(0, maxGasto14) * AGENTE.PRESUPUESTO_UTIL_X))
}

/**
 * Los topes de la suma de presupuestos de la cuenta (diarios). Tres, y una subida tiene que caber en los tres:
 *   topeUtil   = techoMes ÷ 30,4 × 1,1 × 1,3, contra la suma de presupuestos ÚTILES (sumaUtil). La suma útil ya cuenta cada campaña con un 30 % de margen sobre su
 *              máximo de 14 días (PRESUPUESTO_UTIL_X), así que el tope lleva el mismo 1,3: si no, comparar «máximos con margen» con el gasto medio del techo dejaría la
 *              cuenta sin subidas aunque rinda (la suma útil pasa casi siempre del gasto medio diario).
 *   topeBruto  = max(techoMes ÷ 30,4 × 1,1, suma de presupuestos al encender), contra la suma REAL de presupuestos de hoy (sumaActual). Es el tope de exposición:
 *              el agente nunca deja la suma real por encima de techo ÷ 30,4 × 1,1, salvo que la persona ya la tuviera más alta al encender (entonces no la sube de ahí:
 *              para crecer tiene que MOVER dinero de campañas que no lo usan). Sin la suma al encender, solo el techo.
 *   topeSemana = suma de hace 7 días × 1,3, contra la suma real de hoy. Sin suma de hace 7 días, no aplica.
 * Sin techo → null (nada sube).
 */
export function topesDeSuma(e: { techoMes: number | null; suma7: number | null; sumaInicio?: number | null }): { topeUtil: number; topeBruto: number; topeSemana: number } | null {
  if (e.techoMes === null || !finito(e.techoMes) || e.techoMes <= 0) return null
  const diario = (e.techoMes / AGENTE.DIAS_MES_MEDIO) * AGENTE.HOLGURA_SUMA_PRESUPUESTOS
  const inicio = finito(e.sumaInicio) && e.sumaInicio > 0 ? e.sumaInicio : 0
  const haySemana = e.suma7 !== null && finito(e.suma7) && e.suma7 > 0
  return {
    topeUtil: diario * AGENTE.PRESUPUESTO_UTIL_X,
    topeBruto: Math.max(diario, inicio),
    topeSemana: haySemana ? e.suma7! * AGENTE.SUBIDA_MAX_7_DIAS : Infinity,
  }
}

/**
 * Una subida de presupuesto acotada por los topes de cuenta de `topesDeSuma` (útil contra el techo; real contra el techo o la suma al encender; real contra 1,3 × hace 7 días).
 * Si lo que cabe es menos del 5 % del presupuesto actual → { valor: null } y todo el Δ es hueco. Si cabe parte, el hueco es lo que falta. Sin techo → nada sube (hueco 0: no hay nada que financiar).
 */
export function limitarSubidaDePresupuesto(e: {
  actual: number
  nuevo: number
  sumaUtil: number
  sumaActual: number
  techoMes: number | null
  suma7: number | null
  sumaInicio?: number | null
}): { valor: number | null; hueco: number; motivo: string | null } {
  const delta = round2(e.nuevo - e.actual)
  if (!(delta > 0)) return { valor: round2(e.nuevo), hueco: 0, motivo: null }
  const t = topesDeSuma(e)
  if (!t) return { valor: null, hueco: 0, motivo: 'Sin techo de gasto del mes: no se sube ningún presupuesto' }
  const margenUtil = t.topeUtil - e.sumaUtil
  const margenBruto = t.topeBruto - e.sumaActual
  const margenSemana = t.topeSemana - e.sumaActual
  const cabe = abajo2(Math.max(0, Math.min(delta, margenUtil, margenBruto, margenSemana)))

  if (cabe >= delta - EPS) return { valor: round2(e.nuevo), hueco: 0, motivo: null }

  const menor = Math.min(margenUtil, margenBruto, margenSemana)
  const quien =
    menor === margenUtil
      ? `la suma de presupuestos útiles (${num(e.sumaUtil)}) no puede pasar de ${num(t.topeUtil)} al día (techo ${num(e.techoMes!)} ÷ 30,4 × ${num(AGENTE.HOLGURA_SUMA_PRESUPUESTOS, 1)} × ${num(AGENTE.PRESUPUESTO_UTIL_X, 1)})`
      : menor === margenBruto
        ? `la suma de presupuestos de hoy (${num(e.sumaActual)}) no puede pasar de ${num(t.topeBruto)} al día (techo ${num(e.techoMes!)} ÷ 30,4 × ${num(AGENTE.HOLGURA_SUMA_PRESUPUESTOS, 1)}, o la suma al encender si era mayor)`
        : `la suma de presupuestos de hoy (${num(e.sumaActual)}) no puede pasar de ${num(t.topeSemana)} (1,3 × la de hace 7 días, ${num(e.suma7!)})`

  if (cabe < e.actual * AGENTE.SUBIDA_MINIMA_UTIL - EPS) {
    return { valor: null, hueco: delta, motivo: `No cabe la subida de ${num(delta)}: ${quien}` }
  }
  return { valor: round2(e.actual + cabe), hueco: round2(delta - cabe), motivo: `Subida recortada de ${num(delta)} a ${num(cabe)}: ${quien}` }
}

/**
 * Lo que FALTA para que una subida de presupuesto quepa entera, por separado en cada suma (para financiarla con donantes, R1 financiada):
 *   suma   = lo que pasa del tope útil la suma de presupuestos ÚTILES (un donante libera aquí presupuestoUtil(antes) − presupuestoUtil(después));
 *   semana = lo que pasa la suma REAL de hoy del menor de sus dos topes (topeBruto y 1,3 × la de hace 7 días) (un donante libera aquí lo que baja).
 * Puede pasar de Δ: si la cuenta ya está por encima de un tope (p. ej. la suma real de hoy pasa del techo ÷ 30,4 × 1,1 y no hay suma al encender), para subir hay
 * que bajar antes a otras lo que sobra Y el Δ (la cuenta queda por debajo de como estaba). Sin techo, todo el Δ en las dos (nada sube).
 * Los mismos topes que `limitarSubidaDePresupuesto`, sin el mínimo del 5 % (eso lo mira quien financia).
 */
export function faltaEnSumas(e: { actual: number; nuevo: number; sumaUtil: number; sumaActual: number; techoMes: number | null; suma7: number | null; sumaInicio?: number | null }): { suma: number; semana: number } {
  const delta = round2(e.nuevo - e.actual)
  if (!(delta > 0)) return { suma: 0, semana: 0 }
  const t = topesDeSuma(e)
  if (!t) return { suma: delta, semana: delta }
  const suma = Math.max(0, delta - (t.topeUtil - e.sumaUtil))
  const semana = Math.max(0, delta - (Math.min(t.topeBruto, t.topeSemana) - e.sumaActual))
  return { suma: arriba2(suma), semana: arriba2(semana) }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rareza y forma reducida
// ---------------------------------------------------------------------------------------------------------------------

/**
 * ¿Es «rara» (puede cortar ventas que ya existen o es poco habitual)? Entonces decide la IA y, si aprueba, va en forma reducida.
 *   (a) pausar con gasto ≥ 10 % del gasto del producto en 30 d; (b) puja que baja con ≥ 5 pedidos; (c) promover una sola palabra (no ASIN); (d) negativizar un ASIN;
 *   (e) presupuesto que sube con cobertura < 14 días o stock desconocido; (f) presupuesto que cambia > 30 %; (g) puja que sube en una campaña con ajuste de ubicación > 100 %.
 * Pausar una campaña (por stock) nunca es rara.
 */
export function esRara(
  p: { tipo: string; termino: string; esAsin: boolean; valorActual: number | null; valorNuevo: number | null; metricas: { gasto: number; pedidos: number }; campaignId: string },
  ctx: { gastoProducto30: number; stock: number | null; coberturaDias: number | null; campanasConUbicacionAlta: readonly string[] },
): { rara: boolean; porque: string | null } {
  const porque: string[] = []
  const tieneValores = finito(p.valorActual) && finito(p.valorNuevo)
  const sube = tieneValores && p.valorNuevo! > p.valorActual!
  const baja = tieneValores && p.valorNuevo! < p.valorActual!
  const gasto = finito(p.metricas?.gasto) ? p.metricas.gasto : 0
  const pedidos = finito(p.metricas?.pedidos) ? p.metricas.pedidos : 0

  switch (p.tipo) {
    case 'pausar-campana':
    case 'pausar_campana':
      return { rara: false, porque: null }
    case 'pausar': {
      const gp = finito(ctx.gastoProducto30) ? Math.max(0, ctx.gastoProducto30) : 0
      if (gasto > 0 && gasto >= gp * AGENTE.RARA_PAUSA_GASTO_X) {
        porque.push(gp > 0 ? `pausa algo que gasta el ${pct((gasto / gp) * 100)} del producto en 30 días` : 'pausa algo con gasto en un producto sin gasto conocido')
      }
      break
    }
    case 'puja':
      if (baja && pedidos >= AGENTE.RARA_BAJADA_PEDIDOS) porque.push(`baja la puja de algo con ${pedidos} pedidos`)
      if (sube && ctx.campanasConUbicacionAlta.includes(p.campaignId)) porque.push(`sube la puja en una campaña con ajuste de ubicación de más del ${AGENTE.UBICACION_RARA_PCT} %`)
      break
    case 'promover':
      if (!p.esAsin && (p.termino ?? '').trim().split(/\s+/).filter(Boolean).length === 1) porque.push('promueve un término de una sola palabra')
      break
    case 'negativizar':
      if (p.esAsin) porque.push('negativiza un ASIN')
      break
    case 'presupuesto':
      if (sube) {
        if (ctx.stock === null) porque.push('sube el presupuesto sin saber el stock')
        else if (ctx.coberturaDias !== null && ctx.coberturaDias < AGENTE.COBERTURA_MANTENER_DIAS) porque.push(`sube el presupuesto con ${num(ctx.coberturaDias, 0)} días de stock`)
        else if (ctx.stock <= 0) porque.push('sube el presupuesto sin stock')
      }
      if (tieneValores && p.valorActual! > 0 && Math.abs(p.valorNuevo! / p.valorActual! - 1) > AGENTE.RARA_PRESUPUESTO_CAMBIO + EPS) {
        porque.push(`cambia el presupuesto un ${pct(Math.abs(p.valorNuevo! / p.valorActual! - 1) * 100)}`)
      }
      break
  }
  return porque.length ? { rara: true, porque: porque.join(' · ') } : { rara: false, porque: null }
}

/**
 * La forma REDUCIDA de una rara que la IA aprueba:
 *   · pausar → bajar la puja un 25 % (tipo «puja»); si no se sabe la puja actual, valorNuevo null: el orquestador la lee en Amazon y aplica × 0,75.
 *   · puja que baja con ≥ 5 pedidos → como mucho −10 %.
 *   · presupuesto que cambia > 30 % → ±30 % (la subida a +30 %; la bajada, por prudencia, a −30 %).
 * null = no tiene forma reducida: se aplica tal cual (promover de una palabra, negativizar un ASIN, subida con poca cobertura o en campaña con ubicación alta).
 */
export function formaReducida(p: { tipo: string; valorActual: number | null; valorNuevo: number | null; metricas: { pedidos: number } }): { tipo: string; valorNuevo: number | null; nota: string } | null {
  const a = p.valorActual
  const n = p.valorNuevo
  const tieneValores = finito(a) && finito(n) && a > 0

  if (p.tipo === 'pausar') {
    const factor = 1 - AGENTE.RARA_PAUSA_A_BAJADA
    if (finito(a) && a > 0) {
      const v = Math.max(AGENTE.PUJA_MINIMA, round2(a * factor))
      return { tipo: 'puja', valorNuevo: v, nota: `Forma reducida: en vez de pausar, bajo la puja un 25 % (${num(a)} → ${num(v)})` }
    }
    return { tipo: 'puja', valorNuevo: null, nota: 'Forma reducida: en vez de pausar, bajo la puja un 25 % (leer la puja actual en Amazon y aplicar × 0,75)' }
  }
  if (p.tipo === 'puja' && tieneValores && n! < a! && (p.metricas?.pedidos ?? 0) >= AGENTE.RARA_BAJADA_PEDIDOS) {
    const suelo = arriba2(a! * (1 - AGENTE.RARA_BAJADA_MAX))
    const v = Math.max(AGENTE.PUJA_MINIMA, n! >= suelo ? round2(n!) : suelo)
    return { tipo: 'puja', valorNuevo: v, nota: v === round2(n!) ? 'Forma reducida: la bajada ya era del 10 % o menos' : `Forma reducida: bajo la puja como mucho un 10 % (${num(a!)} → ${num(v)})` }
  }
  if (p.tipo === 'presupuesto' && tieneValores) {
    const cambio = n! / a! - 1
    if (cambio > AGENTE.RARA_PRESUPUESTO_CAMBIO + EPS) {
      const v = abajo2(a! * (1 + AGENTE.RARA_PRESUPUESTO_CAMBIO))
      return { tipo: 'presupuesto', valorNuevo: v, nota: `Forma reducida: subo el presupuesto un 30 % (${num(a!)} → ${num(v)}) en vez de a ${num(n!)}` }
    }
    if (cambio < -AGENTE.RARA_PRESUPUESTO_CAMBIO - EPS) {
      const v = Math.max(AGENTE.PRESUPUESTO_MINIMO, arriba2(a! * (1 - AGENTE.RARA_PRESUPUESTO_CAMBIO)))
      return { tipo: 'presupuesto', valorNuevo: v, nota: `Forma reducida: bajo el presupuesto un 30 % (${num(a!)} → ${num(v)}) en vez de a ${num(n!)}` }
    }
  }
  return null
}

/**
 * Orden de aplicación (menor primero): pausar campaña, negativizar, pausar, bajar pujas, bajar presupuestos (los DONANTES de una R1 financiada antes que los demás),
 * subir pujas, promover, subir presupuestos. Así el dinero se libera antes de gastarlo.
 */
export function ordenDeAplicar(clase: ClaseDeCambio, regla?: string): number {
  switch (clase) {
    case 'pausar_campana': return 10
    case 'negativizar': return 20
    case 'pausar': return 30
    case 'puja_bajar':
    case 'puja_bajar_sin_pedidos': return 40
    case 'presupuesto_bajar': return regla === 'donante' ? 50 : 51
    case 'puja_subir': return 60
    case 'promover': return 70
    case 'presupuesto_subir': return 80
    default: return 99
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Errores de Amazon
// ---------------------------------------------------------------------------------------------------------------------

const RE_TRANSPORTE = /THROTTL|TOO_MANY|RATE.?LIMIT|TIMEOUT|TIMED.?OUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|SOCKET|ABORT|FETCH FAILED|NETWORK|TIEMPO/i
const RE_AUTORIZACION = /UNAUTHORIZED|FORBIDDEN|ACCESS_?DENIED|INVALID_TOKEN|EXPIRED_TOKEN|NOT_AUTHORIZED|PERMISSION/i
const RE_VALIDACION = /DUPLICATE|INVALID_ARGUMENT|INVALID|MALFORMED|BAD_REQUEST|VALIDATION|NOT_FOUND|OBSOLET|ALREADY_EXISTS|UNPROCESSABLE|OUT_OF_RANGE/i

/**
 * Qué clase de error es:
 *   transporte   429, 5xx, o sin respuesta por tiempo agotado / red caída — se reintenta en la siguiente pasada; NO cuenta para el freno.
 *   autorizacion 401/403 (o un código de autorización), y también un multi-status (207) con un error que no sea de validación — CUENTA para el freno.
 *   validacion   400/422 y demás 4xx, DUPLICATE, INVALID_ARGUMENT, obsoleta — la propuesta queda en error u obsoleta; NO cuenta.
 */
export function clasificarErrorDeAmazon(httpStatus: number | null, codigo: string | null, mensaje: string | null): TipoDeErrorDeAmazon {
  const cod = codigo ?? ''
  const texto = `${cod} ${mensaje ?? ''}`
  if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500)) return 'transporte'
  if (httpStatus === 401 || httpStatus === 403) return 'autorizacion'
  if (httpStatus === null) {
    // sin respuesta HTTP: casi siempre red o tiempo agotado
    if (RE_TRANSPORTE.test(texto)) return 'transporte'
    if (RE_AUTORIZACION.test(texto)) return 'autorizacion'
    if (RE_VALIDACION.test(texto)) return 'validacion'
    return 'transporte'
  }
  if (RE_AUTORIZACION.test(cod)) return 'autorizacion'
  if (httpStatus >= 400 && httpStatus < 500) return 'validacion'
  // 2xx / 207 con un error dentro: de validación no cuenta; cualquier otro, sí (que el freno lo vea)
  if (RE_VALIDACION.test(texto)) return 'validacion'
  return 'autorizacion'
}

// ---------------------------------------------------------------------------------------------------------------------
// Freno
// ---------------------------------------------------------------------------------------------------------------------

/**
 * El freno automático (cada vigilar, en ensayo y en activo). Devuelve el PRIMER motivo que salta y no está ignorado, o null:
 *   1. gasto_disparado  desde las 10:00 locales, con media de 7 d ≥ 5 y gasto de hoy ≥ max(20, media/2): min(proyección, máximo posible) > 1,6 × media (2,5 en evento);
 *                       o la suma de presupuestos de hoy > 1,6 × la de hace 7 días (2,5 en evento).
 *   2. acos_cuenta      gasto 7 d ≥ max(15, 3 × CPA objetivo) y (sin ventas o ACoS 7 d > 1,5 × objetivo medio). En ensayo y los 7 primeros días de activo, con ACoS al
 *                       encender, se tolera el arranque malo: umbral max(1,5 × objetivo, 1,25 × ACoS al encender) y además peor que al encender.
 *   3. errores_amazon   3 errores que cuentan seguidos, o 5 en 24 h.
 *   4. datos_viejos     rendimiento o términos > 36 h, objetivos diarios > 36 h de retraso, stock > 48 h (null = no se sabe: no frena).
 *   5. ventas_caidas    media diaria de ventas TOTALES de los 7 últimos días cerrados < 0,7 × la de los 23 anteriores, con gasto normal (gasto de los 3 últimos
 *                       días cerrados / 3 ≥ 0,7 × media 7). Las ventas totales solo existen como ventanas de 7/14/30 días que acaban ayer (no día a día): no se
 *                       pueden mirar 3 días cerrados, así que se mira la semana con un umbral más alto (0,7 en vez del 0,5 de 3 días). Una ficha suprimida hace 3
 *                       días: (4 normales + 3 a cero) / 7 = 0,57 → frena.
 * Un motivo ignorado (lo pone un admin al reanudar, 24 h) no frena hasta su «hasta».
 */
export function evaluarFreno(e: EntradaDeFreno): { motivo: MotivoDeFreno; detalle: string } | null {
  return evaluarFrenos(e)[0] ?? null
}

/**
 * PURO. TODOS los motivos de freno que se cumplen ahora y no están ignorados, en el orden de `evaluarFreno` (el primero es el que frena).
 * Al reanudar hay que mirarlos todos: ignorar uno no puede dejar pasar otro que también se cumple.
 */
export function evaluarFrenos(e: EntradaDeFreno): Array<{ motivo: MotivoDeFreno; detalle: string }> {
  return candidatosDeFreno(e).filter((c) => !motivoIgnorado(e, c.motivo))
}

/**
 * PURO. Las ventas del freno «ventas_caidas». Las ventas TOTALES solo existen como ventanas de 7 y 30 días que acaban ayer (ads_ventas_asin), no día a día:
 * media diaria de los 7 últimos días cerrados frente a la de los 23 anteriores. Se llama por lo que es (no «3 días»); el umbral es más alto para compensar.
 */
export function ventasParaFreno(v7: number | null, v30: number | null): { ventasDiaRecientes: number | null; ventasDiaAnteriores: number | null } {
  if (v7 == null || v30 == null) return { ventasDiaRecientes: null, ventasDiaAnteriores: null }
  const anteriores = v30 - v7
  if (!(anteriores > 0)) return { ventasDiaRecientes: null, ventasDiaAnteriores: null }
  return { ventasDiaRecientes: r2(v7 / 7), ventasDiaAnteriores: r2(anteriores / 23) }
}

const r2 = (x: number) => Math.round(x * 100) / 100

/**
 * PURO. ¿Se puede reanudar con los motivos que siguen (`evaluarFrenos`)? Ninguno → sí. Uno → solo si el administrador pide ignorarlo (24 h).
 * Dos o más → no: solo se puede ignorar un motivo y el otro seguiría vigente (aplicar escribiría con un freno que se cumple).
 */
export function decisionDeReanudar(
  frenos: ReadonlyArray<{ motivo: MotivoDeFreno; detalle: string }>,
  pideIgnorar: boolean,
): { reanudar: true; ignorar: MotivoDeFreno | null } | { reanudar: false; error: string; puedeIgnorar: boolean; motivo: MotivoDeFreno; detalle: string } {
  if (frenos.length === 0) return { reanudar: true, ignorar: null }
  const primero = frenos[0]
  const sin = (d: string) => d.replace(/\.$/, '')
  if (frenos.length > 1) {
    return {
      reanudar: false,
      puedeIgnorar: false,
      motivo: primero.motivo,
      detalle: frenos.map((f) => f.detalle).join(' '),
      error: `No reanudo: siguen ${frenos.length} motivos de freno (${frenos.map((f) => sin(f.detalle)).join(' · ')}). Solo se puede ignorar uno: arregla los demás y vuelve a intentarlo.`,
    }
  }
  if (pideIgnorar) return { reanudar: true, ignorar: primero.motivo }
  return { reanudar: false, puedeIgnorar: true, motivo: primero.motivo, detalle: primero.detalle, error: `No reanudo: ${sin(primero.detalle)}. Si quieres, reanuda ignorando este motivo 24 h.` }
}

function motivoIgnorado(e: Pick<EntradaDeFreno, 'ignorar' | 'ahora'>, m: MotivoDeFreno): boolean {
  if (!e.ignorar || e.ignorar.motivo !== m) return false
  const hasta = Date.parse(e.ignorar.hasta)
  return Number.isFinite(hasta) && hasta > e.ahora
}

/** Lo que pide el freno */
export type EntradaDeFreno = {
  minutoLocal: number
  gastoHoy: number
  proyeccionHoy: number
  maximoPosible: number
  media7: number
  sumaPresupuestosHoy: number
  suma7: number | null
  evento: FaseDeEvento | null
  gasto7Cerrado: number
  ventas7Cerrado: number
  acosObjetivoMedio: number | null
  cpaObjetivoMedio: number | null
  acos7Inicio: number | null
  /** Días desde que el agente pasó a activo (null en ensayo o sin dato): tras 7, el freno de ACoS ya no tolera el ACoS malo de partida */
  diasActivo?: number | null
  erroresQueCuentan: ReadonlyArray<{ at: string; ok: boolean }>
  ahora: number
  horasDesdeRendimiento: number | null
  horasDesdeTerminos: number | null
  horasRetrasoObjetivosDiario: number | null
  horasDesdeStock: number | null
  /** Media diaria de ventas TOTALES de los 7 últimos días cerrados (null sin dato fresco) */
  ventasDiaRecientes: number | null
  /** Media diaria de ventas TOTALES de los 23 días anteriores a esos 7 (null sin dato) */
  ventasDiaAnteriores: number | null
  /** Gasto en publicidad de los 3 últimos días CERRADOS (de verdad, no 3/7 del de la semana) */
  gasto3: number
  ignorar: { motivo: MotivoDeFreno; hasta: string } | null
}

/** PURO. Todos los motivos que se cumplen, ignorados o no, en orden */
function candidatosDeFreno(e: EntradaDeFreno): Array<{ motivo: MotivoDeFreno; detalle: string }> {
  const candidatos: Array<{ motivo: MotivoDeFreno; detalle: string }> = []
  const enEvento = e.evento === 'previo' || e.evento === 'durante'

  // 1. Gasto disparado
  {
    const x = enEvento ? AGENTE.FRENO_GASTO_EVENTO_X : AGENTE.FRENO_GASTO_X
    const xSuma = enEvento ? AGENTE.FRENO_GASTO_EVENTO_X : AGENTE.FRENO_SUMA_PRESUPUESTOS_X
    const esperable = Math.min(e.proyeccionHoy, e.maximoPosible)
    if (
      e.minutoLocal >= AGENTE.FRENO_MINUTO_DESDE &&
      e.media7 >= AGENTE.FRENO_MEDIA7_MIN &&
      e.gastoHoy >= Math.max(AGENTE.FRENO_GASTO_MIN, 0.5 * e.media7) &&
      esperable > x * e.media7
    ) {
      candidatos.push({
        motivo: 'gasto_disparado',
        detalle: `El gasto de hoy va a ${num(e.proyeccionHoy)} proyectados (máximo posible ${num(e.maximoPosible)}) y la media de 7 días es ${num(e.media7)}: más de ${num(x, 1)} veces.`,
      })
    } else if (e.suma7 !== null && e.suma7 > 0 && e.sumaPresupuestosHoy > xSuma * e.suma7) {
      candidatos.push({
        motivo: 'gasto_disparado',
        detalle: `La suma de presupuestos de hoy es ${num(e.sumaPresupuestosHoy)} y hace 7 días era ${num(e.suma7)}: más de ${num(xSuma, 1)} veces.`,
      })
    }
  }

  // 2. ACoS de la cuenta
  if (e.acosObjetivoMedio !== null && e.acosObjetivoMedio > 0) {
    const gastoMin = Math.max(AGENTE.FRENO_GASTO7_MIN, AGENTE.FRENO_GASTO7_CPA_X * (e.cpaObjetivoMedio ?? 0))
    if (e.gasto7Cerrado >= gastoMin) {
      const sinVentas = !(e.ventas7Cerrado > 0)
      const acos7 = sinVentas ? Infinity : (e.gasto7Cerrado / e.ventas7Cerrado) * 100
      // La tolerancia con una cuenta que ya iba mal al encender (umbral 1,25 × el ACoS de entonces y «que empeore») dura solo los primeros 7 días de activo: después
      // los 7 días cerrados son ya del agente y vale la regla de la spec, ACoS 7 d > 1,5 × objetivo (o sin ventas). En ensayo (diasActivo null) sigue la tolerancia.
      const tolerar = e.acos7Inicio !== null && (e.diasActivo == null || e.diasActivo < AGENTE.FRENO_ACOS_TOLERANCIA_DIAS)
      const umbral = tolerar ? Math.max(AGENTE.FRENO_ACOS_X * e.acosObjetivoMedio, AGENTE.FRENO_ACOS_INICIO_X * e.acos7Inicio!) : AGENTE.FRENO_ACOS_X * e.acosObjetivoMedio
      const empeora = !tolerar || acos7 > e.acos7Inicio!
      if ((sinVentas || acos7 > umbral) && empeora) {
        candidatos.push({
          motivo: 'acos_cuenta',
          detalle: sinVentas
            ? `7 días cerrados con ${num(e.gasto7Cerrado)} de gasto y ninguna venta (objetivo medio ${pct(e.acosObjetivoMedio)}).`
            : `ACoS de 7 días cerrados ${pct(acos7)} (objetivo medio ${pct(e.acosObjetivoMedio)}${e.acos7Inicio !== null ? `, ${pct(e.acos7Inicio)} al encender` : ''}).`,
        })
      }
    }
  }

  // 3. Errores de Amazon que cuentan
  {
    const orden = [...e.erroresQueCuentan].filter((x) => Number.isFinite(Date.parse(x.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    let seguidos = 0
    for (const x of orden) {
      if (x.ok) break
      seguidos++
    }
    const en24 = orden.filter((x) => !x.ok && e.ahora - Date.parse(x.at) <= 24 * 3600_000 && Date.parse(x.at) <= e.ahora).length
    if (seguidos >= AGENTE.FRENO_ERRORES_SEGUIDOS) candidatos.push({ motivo: 'errores_amazon', detalle: `${seguidos} errores seguidos de Amazon.` })
    else if (en24 >= AGENTE.FRENO_ERRORES_24H) candidatos.push({ motivo: 'errores_amazon', detalle: `${en24} errores de Amazon en 24 horas.` })
  }

  // 4. Datos viejos
  {
    const viejos: string[] = []
    const h = AGENTE.FRENO_DATOS_HORAS
    if (e.horasDesdeRendimiento !== null && e.horasDesdeRendimiento > h) viejos.push(`rendimiento sin sincronizar hace ${num(e.horasDesdeRendimiento, 0)} h`)
    if (e.horasDesdeTerminos !== null && e.horasDesdeTerminos > h) viejos.push(`términos de búsqueda sin sincronizar hace ${num(e.horasDesdeTerminos, 0)} h`)
    if (e.horasRetrasoObjetivosDiario !== null && e.horasRetrasoObjetivosDiario > h) viejos.push(`datos por segmentación con ${num(e.horasRetrasoObjetivosDiario, 0)} h de retraso`)
    if (e.horasDesdeStock !== null && e.horasDesdeStock > AGENTE.FRENO_STOCK_HORAS) viejos.push(`stock sin actualizar hace ${num(e.horasDesdeStock, 0)} h`)
    // El uso de presupuesto con error NO frena (spec §6.4.4): solo desactiva las subidas y R1–R4 (vigilar, usoDisponible / sinSubidas) y se avisa una vez
    if (viejos.length) candidatos.push({ motivo: 'datos_viejos', detalle: `Datos viejos: ${viejos.join(' · ')}.` })
  }

  // 5. Ventas totales caídas con gasto normal
  if (e.ventasDiaRecientes !== null && e.ventasDiaAnteriores !== null && e.ventasDiaAnteriores > 0 && e.media7 > 0) {
    const porDia = e.ventasDiaRecientes
    if (porDia < AGENTE.FRENO_VENTAS_CAIDAS_X * e.ventasDiaAnteriores && e.gasto3 / 3 >= AGENTE.FRENO_VENTAS_GASTO_NORMAL_X * e.media7) {
      candidatos.push({
        motivo: 'ventas_caidas',
        detalle: `Ventas totales de los últimos 7 días cerrados a ${num(porDia)}/día frente a ${num(e.ventasDiaAnteriores)}/día en los 23 anteriores, con el gasto en publicidad normal (${num(e.gasto3 / 3)}/día en los 3 últimos días). Puede ser una ficha suprimida, la Buy Box o el precio.`,
      })
    }
  }

  return candidatos
}

// ---------------------------------------------------------------------------------------------------------------------
// Términos REVISAR con etiqueta de la IA
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Qué hacer con un término REVISAR:
 *   · ha vendido alguna vez (30 d o 90 d) → retener (lo decide una persona);
 *   · sin etiqueta → esperar hasta 30 h; luego retener;
 *   · la IA aún no está validada por las personas → retener («Revísala para enseñar al agente»);
 *   · otro_producto / intencion_mala con confianza ≥ 0,85 → aplicar (negativa exacta);
 *   · relevante ≥ 0,85 → descartar;
 *   · el resto (marca_ajena, dudoso, poca confianza) → esperar hasta 30 h; luego retener.
 */
export function decisionDeTermino(
  t: { etiqueta: EtiquetaDeTermino; confianza: number } | null,
  horasDesdeCreada: number,
  c: { pedidosHistoricos: number; validacionOk: boolean },
): 'aplicar' | 'descartar' | 'retener' | 'esperar' {
  const pasada = horasDesdeCreada > AGENTE.IA_HORAS_ESPERA
  if (c.pedidosHistoricos > 0) return 'retener'
  if (!t) return pasada ? 'retener' : 'esperar'
  if (!c.validacionOk) return 'retener'
  const segura = finito(t.confianza) && t.confianza >= AGENTE.IA_CONFIANZA - EPS
  if (segura && (t.etiqueta === 'otro_producto' || t.etiqueta === 'intencion_mala')) return 'aplicar'
  if (segura && t.etiqueta === 'relevante') return 'descartar'
  return pasada ? 'retener' : 'esperar'
}

/**
 * Acuerdo persona-IA en los REVISAR retenidos con la etiqueta de la IA y resueltos por una persona: aplicada = de acuerdo si la IA decía negativizar (otro_producto / intencion_mala);
 * descartada = de acuerdo si decía relevante. Validada con ≥ 50 resueltas y ≥ 80 % de acuerdo.
 */
export function acuerdoIaPersona(filas: ReadonlyArray<{ etiqueta: EtiquetaDeTermino; resultado: 'aplicada' | 'descartada' }>): { resueltas: number; deAcuerdo: number; ok: boolean } {
  const resueltas = filas.length
  let deAcuerdo = 0
  for (const f of filas) {
    const deciaNegativizar = f.etiqueta === 'otro_producto' || f.etiqueta === 'intencion_mala'
    if ((f.resultado === 'aplicada' && deciaNegativizar) || (f.resultado === 'descartada' && f.etiqueta === 'relevante')) deAcuerdo++
  }
  const ok = resueltas >= AGENTE.IA_VALIDACION_MUESTRA && deAcuerdo / resueltas >= AGENTE.IA_VALIDACION_ACUERDO - EPS
  return { resueltas, deAcuerdo, ok }
}

/** Quita las subidas de presupuesto (frenado, o el freno salta en esta pasada): solo quedan bajadas y pausas */
export function sinSubidasDePresupuesto<T extends { tipo: string; valorActual: number | null; valorNuevo: number | null }>(propuestas: readonly T[]): T[] {
  return propuestas.filter((p) => !(p.tipo === 'presupuesto' && p.valorActual != null && p.valorNuevo != null && p.valorNuevo > p.valorActual))
}

/**
 * PURO. Las pendientes que hay que CADUCAR al cambiar de mano (reanudar, encender, saltar el ensayo, frenar): todo lo que SUBE (puja que sube, presupuesto
 * que sube, promover) y cualquier presupuesto que no haya creado el agente (en modo agente los presupuestos solo los decide R1/R4). Se crearon con otras
 * reglas (el motor en «Aprueba y aplica» no pasa subidaPermitida ni R1) o con datos de otro momento: el agente no las aplica. Las bajadas, negativas y
 * pausas se quedan (son prudentes). Una puja o presupuesto sin valores no se sabe si sube: se caduca (falla cerrado).
 */
export function subidasACaducar(filas: ReadonlyArray<FilaDeSubidaPendiente>): string[] {
  return clasificarSubidasPendientes(filas).caducar
}

/** Una pendiente que puede haber que caducar al cambiar de mano. `error`: el de la fila (un reintento por transporte lleva PREFIJO_REINTENTO) */
export type FilaDeSubidaPendiente = { id: string; tipo: string; origen?: string | null; valor_actual: number | string | null; valor_nuevo: number | string | null; error?: string | null }

/**
 * PURO. Como subidasACaducar, pero separa las que vienen de un REINTENTO por transporte (Amazon no contestó al escribirla: el cambio PUEDE estar ya en Amazon).
 * Esas nunca se caducan (quedarían fuera de todo control: ni el deshacer del freno ni la medición ven una caducada): van a `retener`, para una persona.
 */
export function clasificarSubidasPendientes(filas: ReadonlyArray<FilaDeSubidaPendiente>): { caducar: string[]; retener: string[] } {
  const caducar: string[] = []
  const retener: string[] = []
  const errorDe = new Map(filas.map((f) => [f.id, f.error ?? null]))
  for (const id of subidasQueCambianDeMano(filas)) {
    if (esReintentoDeTransporte(errorDe.get(id))) retener.push(id)
    else caducar.push(id)
  }
  return { caducar, retener }
}

function subidasQueCambianDeMano(filas: ReadonlyArray<FilaDeSubidaPendiente>): string[] {
  const ids: string[] = []
  for (const f of filas) {
    if (f.tipo === 'promover') {
      ids.push(f.id)
      continue
    }
    if (f.tipo !== 'puja' && f.tipo !== 'presupuesto') continue
    const antes = f.valor_actual == null ? NaN : Number(f.valor_actual)
    const despues = f.valor_nuevo == null ? NaN : Number(f.valor_nuevo)
    const sube = !Number.isFinite(antes) || !Number.isFinite(despues) || despues > antes
    if (sube || (f.tipo === 'presupuesto' && f.origen !== 'agente')) ids.push(f.id)
  }
  return ids
}
