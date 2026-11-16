/**
 * AMAZON ADS · EL AGENTE PPC: RITMO DE GASTO. PURO (nada de servidor).
 *
 * - `reglasDePresupuesto`: R1 (se agota pronto y rinde → sube el presupuesto), R1 financiada (si la suma de
 *   presupuestos no deja la subida entera, mueve dinero de campañas que no usan su presupuesto) y R4 (presupuesto
 *   sobredimensionado → baja). Corre en cada vigilar.
 * - `presionDelDia`: R2 (se agota antes de las 18:00 con ACoS malo → bajar pujas) y R3 (gasta poco con ACoS bueno →
 *   subir pujas). Una vez al día, con días cerrados.
 * - `ritmoDelMes`: proyección del mes contra el techo, una vez al día, con histéresis y un cambio cada 3 días.
 * - `recortePorRitmo`: en recorte, PRIMERO presión «bajar» en las campañas que peor rinden; el presupuesto −20 % solo
 *   tras 3 días en recorte si la proyección sigue por encima de 1,1 × techo.
 * - `posturaPorReglas`: la postura de un producto cuando no hay IA (o como respaldo).
 *
 * Todo lo que depende de la hora local o de la temporada entra YA CALCULADO. Solo importa de './tipos'.
 */

import {
  AGENTE,
  type CampanaParaRitmo,
  type EstadoDelMes,
  type FaseDeEvento,
  type FaseDeProducto,
  type Postura,
  type Presion,
  type PropuestaDeRitmo,
  type ResultadoDeRitmo,
  type RitmoDelMes,
} from './tipos'

// ───────────────────────────── auxiliares ─────────────────────────────

const redondear1 = (n: number) => Math.round(n * 10) / 10
const redondear2 = (n: number) => Math.round(n * 100) / 100
/** Hacia arriba a 2 decimales (para pisos: nunca por debajo de lo que hace falta) */
const techo2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100

const importe = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
/** Minuto del día → «13:40» */
const horaDeMinuto =(min: number) => {
  const m = Math.max(0, Math.round(min))
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const acosDe = (gasto: number, ventas: number): number | null => (ventas > 0 ? (gasto / ventas) * 100 : null)

/** ACoS con muestra: la ventana de 7 d si tiene ≥ 3 pedidos; si no, la de 14 d si tiene ≥ 3; si no, null */
function acosConMuestra(c: CampanaParaRitmo, pedidosMin: number): { acos: number; ventana: 7 | 14; clics: number; gasto: number; pedidos: number; ventas: number } | null {
  if (c.pedidos7 >= pedidosMin && c.ventas7 > 0) {
    return { acos: acosDe(c.gasto7, c.ventas7)!, ventana: 7, clics: c.clics7, gasto: c.gasto7, pedidos: c.pedidos7, ventas: c.ventas7 }
  }
  if (c.pedidos14 >= pedidosMin && c.ventas14 > 0) {
    return { acos: acosDe(c.gasto14, c.ventas14)!, ventana: 14, clics: c.clics14, gasto: c.gasto14, pedidos: c.pedidos14, ventas: c.ventas14 }
  }
  return null
}

/**
 * ¿Se ha agotado hoy antes de las 18:00? Solo con el MINUTO de la API (spec §4.2: `agotadaHoyMin < 18:00`). «Agotada por su estado» no tiene minuto, se fija a
 * cualquier hora y no se borra en el día: una campaña que se quedó sin presupuesto a las 22:00 contaría como temprana y R1 le subiría el presupuesto. No cuenta.
 */
const agotadaHoy = (c: CampanaParaRitmo) => c.agotadaHoyMin !== null && c.agotadaHoyMin < AGENTE.MINUTO_AGOTADO_TEMPRANO

/** ¿Se agota (hoy o en alguno de los 3 últimos días cerrados)? */
const agota = (c: CampanaParaRitmo) => c.agotadaDias3 > 0 || c.agotadaHoyMin !== null || c.agotadaHoyPorEstado

const enEventoOPrevio = (e: FaseDeEvento | null) => e === 'previo' || e === 'durante'

/** Uso medio de 14 d (0..n) frente al presupuesto actual */
const usoMedio14 = (c: CampanaParaRitmo) => (c.presupuesto > 0 ? c.mediaGasto14 / c.presupuesto : 1)

/** Lo que una campaña necesita de presupuesto según su gasto de 14 d (el piso de R4 y de un donante) */
const pisoPorGasto = (c: CampanaParaRitmo) =>
  Math.max(c.mediaGasto14 * AGENTE.HOLGURA_MEDIA, c.maxGasto14 * AGENTE.HOLGURA_MAXIMO)

const textoAgotada = (c: CampanaParaRitmo) =>
  c.agotadaHoyMin !== null ? `se agota a las ${horaDeMinuto(c.agotadaHoyMin)}` : 'se ha quedado sin presupuesto hoy (según su estado)'

// ───────────────────────────── R1 · R1 financiada · R4 ─────────────────────────────

interface Donante {
  c: CampanaParaRitmo
  /** Nuevo presupuesto si es R4 (se baja entero); null si es donante sin R4 */
  r4Nuevo: number | null
  /** Lo que puede dar en total */
  capacidad: number
  /** Lo que ya ha dado */
  tomado: number
  /** A qué campañas (nombre, texto) */
  para: string[]
}

/** ¿Bloqueada para BAJAR su presupuesto? Una subida pendiente (retenida o en espera) no lo impide: la bajada gana */
const bloqueadaParaBajar = (k: CampanaParaRitmo): boolean => k.bloqueadaPresupuesto && k.soloSubidaPendiente !== true

/** Lo que cuenta un presupuesto en la suma ÚTIL (el mismo cálculo que presupuestoUtil de guardarrailes-calculo; aquí solo se importa de './tipos') */
function utilDe(c: CampanaParaRitmo, presupuesto: number): number {
  if (!(presupuesto > 0)) return 0
  const max = c.maxGasto14Util
  if (max === undefined || max === null || !Number.isFinite(max)) return presupuesto
  return Math.min(presupuesto, Math.max(0, max) * AGENTE.PRESUPUESTO_UTIL_X)
}

/** Lo que libera un donante de la suma útil si baja `bajada` en total (desde su presupuesto) */
function liberaUtil(d: Donante, bajada: number): number {
  const total = redondear2(utilDe(d.c, d.c.presupuesto) - utilDe(d.c, d.c.presupuesto - Math.max(0, bajada)))
  const ya = redondear2(utilDe(d.c, d.c.presupuesto) - utilDe(d.c, d.c.presupuesto - Math.max(0, d.tomado)))
  return redondear2(Math.max(0, total - ya))
}

/** Lo que aún tiene que bajar un donante (sobre lo ya tomado) antes de que bajar libere suma útil: el tramo de su presupuesto por encima de 1,3 × su máximo de 14 días */
function sinEfectoUtil(d: Donante): number {
  const tope = utilDe(d.c, d.c.presupuesto)
  return redondear2(Math.max(0, d.c.presupuesto - tope - d.tomado))
}

/**
 * R1, R1 financiada y R4 (spec §4.2). Si `!usoDisponible` (la API de uso falla) no propone nada.
 * Orden de la lista: donantes (bajadas que financian una subida) → R1/R1_financiada → R4.
 * `huecoDeSuma(campaignId, nuevo, comprometido)` dice cuánto FALTA (en dinero) para que ese presupuesto quepa en la suma de la cuenta; 0 = cabe entero.
 * `comprometido` es lo ya subido sin financiar en esta pasada (en la suma ÚTIL y en la suma de HOY) para que dos subidas no usen el mismo hueco.
 * Puede devolver lo que falta por separado: `suma` frente al techo (se compara con la suma de presupuestos ÚTILES) y `semana` frente a 1,3 × la suma de hace 7 días
 * (se compara con la suma NOMINAL). Un número vale para las dos. Un donante libera de la suma de hoy lo que baja, pero de la suma útil solo
 * presupuestoUtil(antes) − presupuestoUtil(después): bajar un presupuesto que ya pasaba de 1,3 × su máximo de 14 días no libera techo hasta llegar a ese 1,3 ×.
 */
export function reglasDePresupuesto(
  campanas: readonly CampanaParaRitmo[],
  c: {
    ritmo: RitmoDelMes
    evento: FaseDeEvento | null
    sinSubidas: boolean
    sinPresupuestoSubir: boolean
    techoNulo: boolean
    cuentaPequena: boolean
    usoDisponible: boolean
    huecoDeSuma: (campaignId: string, nuevo: number, comprometido: { suma: number; semana: number }) => number | { suma: number; semana: number }
  },
): ResultadoDeRitmo {
  const avisos: ResultadoDeRitmo['avisos'] = []
  if (!c.usoDisponible) return { propuestas: [], avisos }

  // ¿Puede la CUENTA subir presupuestos hoy?
  const cuentaNoSube =
    c.ritmo === 'recorte' || c.sinSubidas || c.sinPresupuestoSubir || c.techoNulo || c.cuentaPequena || c.evento === 'posterior'

  // 1) Candidatas a R1
  type CandidataR1 = { c: CampanaParaRitmo; nuevo: number; s: number; muestra: NonNullable<ReturnType<typeof acosConMuestra>> }
  const candidatas: CandidataR1[] = []
  const conR1 = new Set<string>()
  for (const k of campanas) {
    if (!(k.presupuesto > 0)) continue
    if (!agotadaHoy(k)) continue
    if (k.agotadaDias3 + 1 < AGENTE.DIAS_AGOTADA_MINIMOS) continue
    const muestra = acosConMuestra(k, AGENTE.PEDIDOS_R1)
    if (!muestra || muestra.acos > k.acosParaSubir) continue
    // Desde aquí la campaña «merecería» subir: no puede ser donante ni R4
    conR1.add(k.campaignId)
    if (cuentaNoSube || k.bloqueadaPresupuesto || k.subidaVetada === true || k.soloDefensivo || k.esMarca || k.postura === 'recortar') continue
    if (k.portfolioTopado) {
      avisos.push({
        campaignId: k.campaignId,
        texto: `«${k.nombre}» ${textoAgotada(k)} con ACoS ${pct(redondear1(muestra.acos))}, pero su portfolio tiene tope de presupuesto: súbelo en Amazon si quieres que gaste más.`,
      })
      continue
    }
    const muyTemprano = k.agotadaHoyMin !== null && k.agotadaHoyMin < AGENTE.MINUTO_AGOTADO_MUY_TEMPRANO
    const s = muyTemprano && c.ritmo === 'crecer' && k.tieneEquilibrio ? AGENTE.SUBIDA_PRESUPUESTO_CRECER : AGENTE.SUBIDA_PRESUPUESTO
    let nuevo = redondear2(k.presupuesto * (1 + s))
    if (k.presupuestoAntesDelRecorte !== null) nuevo = Math.min(nuevo, redondear2(k.presupuestoAntesDelRecorte))
    if (nuevo <= k.presupuesto) continue
    candidatas.push({ c: k, nuevo, s, muestra })
  }
  // Primero las que se agotan antes (las agotadas solo por estado, al final)
  candidatas.sort((a, b) => (a.c.agotadaHoyMin ?? 24 * 60) - (b.c.agotadaHoyMin ?? 24 * 60) || a.muestra.acos - b.muestra.acos)

  // 2) R4 (no en campañas con R1: R1 gana)
  const r4 = new Map<string, Donante>()
  for (const k of campanas) {
    if (conR1.has(k.campaignId) || !(k.presupuesto > 0)) continue
    if (k.diasConDatos14 < AGENTE.DIAS_CON_DATOS_14) continue
    if (usoMedio14(k) >= AGENTE.USO_SOBREDIMENSIONADO) continue
    if (k.postura === 'crecer' || bloqueadaParaBajar(k)) continue
    if (enEventoOPrevio(c.evento) && agota(k)) continue
    const nuevo = Math.max(AGENTE.PRESUPUESTO_MINIMO, redondear1(pisoPorGasto(k)))
    if (nuevo > k.presupuesto * (1 - AGENTE.BAJADA_MINIMA)) continue
    r4.set(k.campaignId, { c: k, r4Nuevo: nuevo, capacidad: redondear2(k.presupuesto - nuevo), tomado: 0, para: [] })
  }

  // 3) Donantes sin R4: usan < 60 % de media en 14 d, con datos, que no se agotan ni están bloqueadas
  const otrosDonantes: Donante[] = []
  for (const k of campanas) {
    if (conR1.has(k.campaignId) || r4.has(k.campaignId) || !(k.presupuesto > 0)) continue
    if (k.diasConDatos14 < AGENTE.DIAS_CON_DATOS_14 || usoMedio14(k) >= AGENTE.USO_DONANTE) continue
    if (bloqueadaParaBajar(k) || k.postura === 'crecer' || agota(k)) continue
    const piso = Math.max(AGENTE.PRESUPUESTO_MINIMO, techo2(pisoPorGasto(k)))
    const capacidad = redondear2(k.presupuesto - piso)
    if (capacidad < AGENTE.PRESUPUESTO_MINIMO) continue
    otrosDonantes.push({ c: k, r4Nuevo: null, capacidad, tomado: 0, para: [] })
  }
  otrosDonantes.sort((a, b) => usoMedio14(a.c) - usoMedio14(b.c))
  // Las R4 primero (se bajan de todos modos), luego las demás de menos a más uso
  const bolsa: Donante[] = [...Array.from(r4.values()).sort((a, b) => b.capacidad - a.capacidad), ...otrosDonantes]
  const ordenDeUso: Donante[] = []

  // 4) Repartir el hueco
  const subidas: PropuestaDeRitmo[] = []
  // Subida neta ya usada en esta pasada sin financiar: en la suma útil y en la de hoy (nominal)
  let comprometidoSuma = 0
  let comprometidoSemana = 0
  for (const cand of candidatas) {
    const k = cand.c
    const delta = redondear2(cand.nuevo - k.presupuesto)
    const h = c.huecoDeSuma(k.campaignId, cand.nuevo, { suma: Math.max(0, comprometidoSuma), semana: Math.max(0, comprometidoSemana) })
    const faltaSuma = redondear2(Math.max(0, typeof h === 'number' ? h : h.suma))
    const faltaSemana = redondear2(Math.max(0, typeof h === 'number' ? h : h.semana))
    const falta = Math.max(faltaSuma, faltaSemana)
    const textoAcos = `ACoS ${pct(redondear1(cand.muestra.acos))} en ${cand.muestra.ventana} días con ${cand.muestra.pedidos} pedidos (para subir: ≤ ${pct(redondear1(k.acosParaSubir))})`
    const veces = `${k.agotadaDias3 + 1} de los 4 últimos días`
    const metricas = { clics: cand.muestra.clics, gasto: redondear2(cand.muestra.gasto), pedidos: cand.muestra.pedidos, ventas: redondear2(cand.muestra.ventas), acosPct: redondear1(cand.muestra.acos) }

    if (falta <= 0) {
      comprometidoSuma += delta
      comprometidoSemana += delta
      subidas.push({
        tipo: 'presupuesto', clase: 'presupuesto_subir', regla: 'R1', campaignId: k.campaignId, nombre: k.nombre, asin: k.asin,
        presupuestoActual: k.presupuesto, presupuestoNuevo: cand.nuevo,
        motivo: `Se agota y rinde: ${textoAgotada(k)} (${veces}) con ${textoAcos}. Presupuesto ${importe(k.presupuesto)} → ${importe(cand.nuevo)} (+${Math.round(cand.s * 100)} %).`,
        metricas,
      })
      continue
    }

    // Financiar con donantes: se toma lo que falta en las dos sumas, sin pasar de lo que cada uno puede dar. `tomado` es lo que bajan (suma de hoy) y
    // `tomadoUtil` lo que liberan de la suma útil (puede ser menos: ver liberaUtil)
    const tomas: Array<{ d: Donante; cuanto: number }> = []
    let tomado = 0
    let tomadoUtil = 0
    for (const d of bolsa) {
      const faltaS = redondear2(faltaSemana - tomado)
      const faltaU = redondear2(faltaSuma - tomadoUtil)
      if (faltaS <= 0 && faltaU <= 0) break
      const libre = redondear2(d.capacidad - d.tomado)
      if (libre <= 0) continue
      // Para liberar `faltaU` de suma útil hay que bajar primero lo que no cuenta (el tramo por encima de 1,3 × su máximo) y luego `faltaU`
      const paraUtil = faltaU > 0 ? redondear2(sinEfectoUtil(d) + faltaU) : 0
      let cuanto = redondear2(Math.min(libre, Math.max(faltaS, paraUtil)))
      let util = liberaUtil(d, d.tomado + cuanto)
      if (faltaU > 0 && util <= 0) {
        // No libera nada de suma útil: solo sirve para la de hoy (si falta)
        cuanto = redondear2(Math.min(libre, Math.max(0, faltaS)))
        util = 0
      }
      if (cuanto <= 0) continue
      tomas.push({ d, cuanto })
      tomado = redondear2(tomado + cuanto)
      tomadoUtil = redondear2(tomadoUtil + util)
    }
    const subidaPosible = redondear2(delta - Math.max(0, faltaSuma - tomadoUtil, faltaSemana - tomado))
    if (subidaPosible < k.presupuesto * AGENTE.SUBIDA_MINIMA_UTIL) {
      avisos.push({
        campaignId: k.campaignId,
        texto: `«${k.nombre}» ${textoAgotada(k)} con ${textoAcos}, pero la suma de presupuestos de la cuenta no deja subirla (faltan ${importe(falta)}) y no hay campañas de las que mover dinero.`,
      })
      continue
    }
    for (const t of tomas) {
      t.d.tomado = redondear2(t.d.tomado + t.cuanto)
      t.d.para.push(`${importe(t.cuanto)} a «${k.nombre}» (${textoAgotada(k)} con ACoS ${pct(redondear1(cand.muestra.acos))})`)
      if (!ordenDeUso.includes(t.d)) ordenDeUso.push(t.d)
    }
    const nuevo = redondear2(k.presupuesto + subidaPosible)
    comprometidoSuma += redondear2(subidaPosible - tomadoUtil)
    comprometidoSemana += redondear2(subidaPosible - tomado)
    const financiada = tomado > 0
    const deQuien = tomas.map((t) => `«${t.d.c.nombre}»`).join(', ')
    subidas.push({
      tipo: 'presupuesto', clase: 'presupuesto_subir', regla: financiada ? 'R1_financiada' : 'R1', campaignId: k.campaignId, nombre: k.nombre, asin: k.asin,
      presupuestoActual: k.presupuesto, presupuestoNuevo: nuevo,
      motivo:
        `Se agota y rinde: ${textoAgotada(k)} (${veces}) con ${textoAcos}. Presupuesto ${importe(k.presupuesto)} → ${importe(nuevo)}` +
        (financiada ? `, moviendo ${importe(tomado)} de ${deQuien}` : '') +
        (nuevo < cand.nuevo ? ` (la suma de presupuestos de la cuenta no deja llegar a ${importe(cand.nuevo)})` : '') +
        '.',
      metricas,
    })
  }

  // 5) Bajadas: primero las de los donantes, luego las R4 que no han financiado nada
  const donantes: PropuestaDeRitmo[] = ordenDeUso.map((d) => {
    const k = d.c
    const nuevo = d.r4Nuevo ?? redondear2(k.presupuesto - d.tomado)
    const uso = Math.round(usoMedio14(k) * 100)
    return {
      tipo: 'presupuesto', clase: 'presupuesto_bajar', regla: 'donante', campaignId: k.campaignId, nombre: k.nombre, asin: k.asin,
      presupuestoActual: k.presupuesto, presupuestoNuevo: nuevo,
      motivo:
        d.r4Nuevo !== null
          ? `Presupuesto sobredimensionado: «${k.nombre}» usa el ${uso} % de media en 14 días (gasta ${importe(k.mediaGasto14)} al día y como mucho ${importe(k.maxGasto14)}). ` +
            `Presupuesto ${importe(k.presupuesto)} → ${importe(nuevo)}; de lo que libera, muevo ${d.para.join('; ')}.`
          : `Muevo ${importe(d.tomado)} de «${k.nombre}» (usa el ${uso} % de media en 14 días): ${d.para.join('; ')}. Presupuesto ${importe(k.presupuesto)} → ${importe(nuevo)}.`,
      metricas: { clics: k.clics14, gasto: redondear2(k.gasto14), pedidos: k.pedidos14, ventas: redondear2(k.ventas14), acosPct: acosDe(k.gasto14, k.ventas14) === null ? null : redondear1(acosDe(k.gasto14, k.ventas14)!), usoPct: uso },
    }
  })
  const bajadasR4: PropuestaDeRitmo[] = []
  for (const d of Array.from(r4.values())) {
    if (ordenDeUso.includes(d)) continue
    const k = d.c
    const uso = Math.round(usoMedio14(k) * 100)
    const a14 = acosDe(k.gasto14, k.ventas14)
    bajadasR4.push({
      tipo: 'presupuesto', clase: 'presupuesto_bajar', regla: 'R4', campaignId: k.campaignId, nombre: k.nombre, asin: k.asin,
      presupuestoActual: k.presupuesto, presupuestoNuevo: d.r4Nuevo!,
      motivo: `Presupuesto sobredimensionado: en 14 días gasta de media ${importe(k.mediaGasto14)} al día (el ${uso} % de ${importe(k.presupuesto)}) y como mucho ${importe(k.maxGasto14)}. Presupuesto ${importe(k.presupuesto)} → ${importe(d.r4Nuevo!)}.`,
      metricas: { clics: k.clics14, gasto: redondear2(k.gasto14), pedidos: k.pedidos14, ventas: redondear2(k.ventas14), acosPct: a14 === null ? null : redondear1(a14), usoPct: uso },
    })
  }

  return { propuestas: [...donantes, ...subidas, ...bajadasR4], avisos }
}

// ───────────────────────────── R2 · R3 (presión del día) ─────────────────────────────

/** Presión del día por campaña (spec §4.2 R2/R3). Una vez al día, con los días cerrados. Solo aparecen las campañas con presión */
export function presionDelDia(campanas: readonly CampanaParaRitmo[], c: { ritmo: RitmoDelMes }): Record<string, Presion> {
  const presion: Record<string, Presion> = {}
  for (const k of campanas) {
    // R2: se agota antes de las 18:00 en ≥ 2 de los 3 últimos días cerrados con ACoS malo (o gasto sin ventas)
    const acos7 = acosDe(k.gasto7, k.ventas7)
    const acosMalo = (acos7 !== null && acos7 > k.acosParaBajar * AGENTE.ACOS_MALO_X) || (k.ventas7 === 0 && k.gasto7 > 0)
    if (k.agotadaAntes18Dias3 >= AGENTE.DIAS_AGOTADA_MINIMOS && acosMalo) {
      presion[k.campaignId] = 'bajar'
      continue
    }
    // R3: gasta poco con ACoS bueno y muestra suficiente
    if (k.soloDefensivo || k.esMarca || c.ritmo === 'recorte' || k.postura === 'recortar') continue
    if (k.diasConDatos7 < AGENTE.DIAS_CON_DATOS_7 || !(k.presupuesto > 0)) continue
    if (k.gasto7 / k.diasConDatos7 >= AGENTE.USO_BAJO * k.presupuesto) continue
    if (k.pedidos14 < AGENTE.PEDIDOS_R3 || k.clics14 < k.muestraMinima) continue
    const acos14 = acosDe(k.gasto14, k.ventas14)
    if (acos14 === null || acos14 > k.acosParaSubir * AGENTE.ACOS_BUENO_X) continue
    presion[k.campaignId] = 'subir'
  }
  return presion
}

// ───────────────────────────── ritmo del mes ─────────────────────────────

/**
 * Ritmo del mes (spec §4.3). Una vez al día con días cerrados. `gastoMesHastaAyer` ya viene rellenado con
 * `ads_presupuesto_dia` donde falte el día; `media7` ya viene sin días de evento si estamos fuera del evento.
 */
export function ritmoDelMes(e: {
  gastoMesHastaAyer: number
  techoMes: number | null
  dia: number
  diasDelMes: number
  media7: number
  ritmoAnterior: RitmoDelMes
  ritmoAnteriorEsDeEsteMes: boolean
  diasDesdeCambio: number | null
  acos30Cuenta: number | null
  acosObjetivoMedio: number | null
  tacos30: number | null
  tacosObjetivoPct: number | null
  ventasTotalesCrecen: boolean | null
  evento: FaseDeEvento | null
}): EstadoDelMes {
  const gastoMes = redondear2(e.gastoMesHastaAyer)
  const diasRestantes = Math.max(1, e.diasDelMes - e.dia + 1)
  const media7 = redondear2(e.media7)
  const proyeccion = redondear2(gastoMes + media7 * diasRestantes)
  const techo = e.techoMes !== null && e.techoMes > 0 ? e.techoMes : null
  const base: RitmoDelMes = e.ritmoAnteriorEsDeEsteMes ? e.ritmoAnterior : 'normal'
  const evento = enEventoOPrevio(e.evento)
  const fin = (ritmo: RitmoDelMes, motivo: string): EstadoDelMes => ({
    gastoMes, techo, proyeccion, media7, diasRestantes, ritmo, cambiado: ritmo !== e.ritmoAnterior, motivo,
  })

  if (techo === null) return fin('normal', 'Sin techo mensual de gasto: ritmo normal.')

  const ratio = proyeccion / techo
  const cifras = `proyección del mes ${importe(proyeccion)} (llevo ${importe(gastoMes)} y ${importe(media7)} al día × ${diasRestantes} días) frente a un techo de ${importe(techo)} (${Math.round(ratio * 100)} %)`
  const avisoEvento = ratio > 1 ? ' Va por encima del techo, pero estamos en temporada: no recorto.' : ''

  // Antes del día 4: se mantiene lo de este mes (o normal); nunca recorte en evento
  if (e.dia < AGENTE.RITMO_DIA_MINIMO) {
    if (evento && base === 'recorte') return fin('normal', `Temporada: sin recorte; ${cifras}.${avisoEvento}`)
    return fin(base, `Día ${e.dia} del mes: el ritmo no se recalcula hasta el día ${AGENTE.RITMO_DIA_MINIMO} (${base}); ${cifras}.`)
  }

  const ultimaSemana = diasRestantes <= 7
  const entraRecorte = ultimaSemana ? AGENTE.RITMO_RECORTE_ENTRA_ULTIMA_SEMANA : AGENTE.RITMO_RECORTE_ENTRA
  const acosOk = e.acos30Cuenta !== null && e.acosObjetivoMedio !== null && e.acos30Cuenta <= e.acosObjetivoMedio
  const tacosOk = e.tacos30 === null || e.tacosObjetivoPct === null || e.tacos30 <= e.tacosObjetivoPct
  const ventasOk = e.ventasTotalesCrecen !== false
  const puedeCrecer = acosOk && tacosOk && ventasOk

  let candidato: RitmoDelMes
  let porque: string
  if (base === 'recorte' && ratio >= AGENTE.RITMO_RECORTE_SALE) {
    candidato = 'recorte'
    porque = `sigue en recorte hasta bajar del ${Math.round(AGENTE.RITMO_RECORTE_SALE * 100)} %`
  } else if (ratio > entraRecorte) {
    candidato = 'recorte'
    porque = `pasa del ${Math.round(entraRecorte * 100)} %${ultimaSemana ? ' (última semana del mes)' : ''}`
  } else if (base === 'crecer' && ratio <= AGENTE.RITMO_CRECER_SALE && puedeCrecer) {
    candidato = 'crecer'
    porque = `sigue en crecer mientras no pase del ${Math.round(AGENTE.RITMO_CRECER_SALE * 100)} % y el ACoS, el TACoS y las ventas totales acompañen`
  } else if (ratio < AGENTE.RITMO_CRECER_ENTRA && puedeCrecer) {
    candidato = 'crecer'
    porque = `queda por debajo del ${Math.round(AGENTE.RITMO_CRECER_ENTRA * 100)} % con ACoS de 30 días ${pct(redondear1(e.acos30Cuenta!))} (objetivo medio ${pct(redondear1(e.acosObjetivoMedio!))})`
  } else {
    candidato = 'normal'
    porque =
      ratio < AGENTE.RITMO_CRECER_ENTRA && !puedeCrecer
        ? `hay margen de gasto, pero ${!acosOk ? 'el ACoS de 30 días no está en objetivo' : !tacosOk ? 'el TACoS de 30 días pasa del objetivo' : 'las ventas totales caen'}`
        : 'dentro del techo'
  }

  // Nunca recorte durante un evento ni sus 2 días previos (se avisa si se pasa)
  if (evento && candidato === 'recorte') {
    return fin('normal', `Temporada: sin recorte; ${cifras}.${avisoEvento}`)
  }

  // Como mucho un cambio cada 3 días
  if (candidato !== base && e.diasDesdeCambio !== null && e.diasDesdeCambio < AGENTE.RITMO_DIAS_ENTRE_CAMBIOS) {
    return fin(base, `Se queda en ${base} (cambió hace ${e.diasDesdeCambio} días; como mucho un cambio cada ${AGENTE.RITMO_DIAS_ENTRE_CAMBIOS}); ${cifras}.`)
  }

  return fin(candidato, `Ritmo ${candidato}: ${porque}; ${cifras}.`)
}

// ───────────────────────────── recorte por ritmo ─────────────────────────────

/**
 * Modo recorte (spec §4.3): PRIMERO presión «bajar» en las campañas que peor rinden (sin ventas con gasto o ACoS por
 * encima del de bajar), por gasto de 7 d, hasta cubrir el exceso diario estimando un 20 % de su gasto diario cada una;
 * si no basta, sigue con las demás de peor a mejor ACoS. SOLO tras 3 días en recorte y con la proyección aún
 * > 1,1 × techo: presupuesto −20 % en esas campañas (no bloqueadas).
 */
export function recortePorRitmo(
  campanas: readonly CampanaParaRitmo[],
  mes: EstadoDelMes,
  diasEnRecorte: number,
): { presionBajar: string[]; propuestas: PropuestaDeRitmo[] } {
  const vacio = { presionBajar: [] as string[], propuestas: [] as PropuestaDeRitmo[] }
  if (mes.ritmo !== 'recorte' || mes.techo === null || mes.proyeccion === null) return vacio
  const exceso = (mes.proyeccion - mes.techo) / Math.max(1, mes.diasRestantes)
  if (!(exceso > 0)) return vacio

  const gastoDiario = (k: CampanaParaRitmo) => k.gasto7 / Math.max(1, k.diasConDatos7 || 7)
  const acos7 = (k: CampanaParaRitmo) => acosDe(k.gasto7, k.ventas7)
  const malas = (k: CampanaParaRitmo) => {
    const a = acos7(k)
    return (k.ventas7 === 0 && k.gasto7 > 0) || (a !== null && a > k.acosParaBajar)
  }
  const conGasto = campanas.filter((k) => k.gasto7 > 0)
  const primeras = conGasto.filter(malas).sort((a, b) => b.gasto7 - a.gasto7)
  const resto = conGasto
    .filter((k) => !malas(k))
    .sort((a, b) => (acos7(b) ?? Infinity) / b.acosParaBajar - (acos7(a) ?? Infinity) / a.acosParaBajar || b.gasto7 - a.gasto7)

  const elegidas: CampanaParaRitmo[] = []
  let cubierto = 0
  for (const k of [...primeras, ...resto]) {
    if (cubierto >= exceso) break
    elegidas.push(k)
    cubierto += gastoDiario(k) * AGENTE.RECORTE_PUJAS_PCT_GASTO
  }
  const presionBajar = elegidas.map((k) => k.campaignId)

  const propuestas: PropuestaDeRitmo[] = []
  if (diasEnRecorte >= AGENTE.RECORTE_PRESUPUESTO_DIAS && mes.proyeccion > AGENTE.RECORTE_PRESUPUESTO_X * mes.techo) {
    for (const k of elegidas) {
      if (bloqueadaParaBajar(k) || !(k.presupuesto > 0)) continue
      const nuevo = Math.max(AGENTE.PRESUPUESTO_MINIMO, redondear2(k.presupuesto * (1 - AGENTE.RECORTE_PRESUPUESTO)))
      if (nuevo >= k.presupuesto) continue
      const a = acos7(k)
      propuestas.push({
        tipo: 'presupuesto', clase: 'presupuesto_bajar', regla: 'recorte', campaignId: k.campaignId, nombre: k.nombre, asin: k.asin,
        presupuestoActual: k.presupuesto, presupuestoNuevo: nuevo,
        motivo:
          `Recorte del mes: llevamos ${diasEnRecorte} días en recorte y la proyección (${importe(mes.proyeccion)}) sigue por encima de ${importe(AGENTE.RECORTE_PRESUPUESTO_X * mes.techo)} (1,1 × techo de ${importe(mes.techo)}). ` +
          `«${k.nombre}» gasta ${importe(gastoDiario(k))} al día con ${a === null ? 'ninguna venta' : `ACoS ${pct(redondear1(a))}`} en 7 días. Presupuesto ${importe(k.presupuesto)} → ${importe(nuevo)} (−${Math.round(AGENTE.RECORTE_PRESUPUESTO * 100)} %).`,
        metricas: { clics: k.clics7, gasto: redondear2(k.gasto7), pedidos: k.pedidos7, ventas: redondear2(k.ventas7), acosPct: a === null ? null : redondear1(a) },
      })
    }
  }
  return { presionBajar, propuestas }
}

// ───────────────────────────── postura por reglas ─────────────────────────────

/** Postura de un producto por reglas (spec §5.6): respaldo de la IA y base de `posturaFinal` */
export function posturaPorReglas(
  p: {
    acos14Pct: number | null
    clics14: number
    muestraMinima: number
    acosObjetivoPct: number | null
    tieneEquilibrio: boolean
    tacos30Pct: number | null
    tacosObjetivoPct: number | null
    ventasTotalesCrecen: boolean | null
    tacosBaja: boolean | null
    coberturaDias: number | null
    stock: number | null
    soloDefensivo: boolean
    esMarca: boolean
    fase: FaseDeProducto
  },
  ritmo: RitmoDelMes,
): { postura: Postura; motivo: string } {
  if (p.clics14 < p.muestraMinima) {
    return { postura: 'mantener', motivo: `Sin muestra: ${p.clics14} clics en 14 días (pide ${p.muestraMinima}).` }
  }

  // Recortar
  if (p.stock === 0) return { postura: 'recortar', motivo: 'Sin stock.' }
  if (p.coberturaDias !== null && p.coberturaDias < AGENTE.COBERTURA_RECORTAR_DIAS) {
    return { postura: 'recortar', motivo: `Cobertura de stock de ${redondear1(p.coberturaDias).toLocaleString('es-ES')} días (menos de ${AGENTE.COBERTURA_RECORTAR_DIAS}).` }
  }
  if (
    p.tacos30Pct !== null && p.tacosObjetivoPct !== null &&
    p.tacos30Pct > AGENTE.POSTURA_TACOS_MALO_X * p.tacosObjetivoPct && p.ventasTotalesCrecen !== true
  ) {
    return { postura: 'recortar', motivo: `TACoS de 30 días ${pct(redondear1(p.tacos30Pct))} (más de 1,2 × el objetivo del ${pct(p.tacosObjetivoPct)}) sin que crezcan las ventas totales.` }
  }
  if (
    p.fase !== 'lanzamiento' && p.acos14Pct !== null && p.acosObjetivoPct !== null &&
    p.acos14Pct > AGENTE.POSTURA_ACOS_MALO_X * p.acosObjetivoPct
  ) {
    return { postura: 'recortar', motivo: `ACoS de 14 días ${pct(redondear1(p.acos14Pct))} (más de 1,3 × el objetivo del ${pct(redondear1(p.acosObjetivoPct))}).` }
  }

  // Crecer: todo a favor
  const tacosAFavor = p.tacosBaja === true || (p.tacos30Pct !== null && p.tacosObjetivoPct !== null && p.tacos30Pct <= p.tacosObjetivoPct)
  if (
    p.tieneEquilibrio && !p.soloDefensivo && !p.esMarca && ritmo === 'crecer' &&
    p.acos14Pct !== null && p.acosObjetivoPct !== null && p.acos14Pct <= AGENTE.ACOS_BUENO_X * p.acosObjetivoPct &&
    tacosAFavor && p.ventasTotalesCrecen === true &&
    p.coberturaDias !== null && p.coberturaDias >= AGENTE.COBERTURA_MANTENER_DIAS
  ) {
    return {
      postura: 'crecer',
      motivo:
        `ACoS de 14 días ${pct(redondear1(p.acos14Pct))} (≤ 0,8 × objetivo del ${pct(redondear1(p.acosObjetivoPct))}), ` +
        `${p.tacos30Pct !== null ? `TACoS ${pct(redondear1(p.tacos30Pct))}` : 'TACoS a la baja'}, ventas totales al alza y ${Math.floor(p.coberturaDias)} días de stock; el mes deja crecer.`,
    }
  }

  // Mantener, con el porqué de no crecer
  const porque = !p.tieneEquilibrio
    ? 'sin coste del producto no se escala'
    : p.soloDefensivo
      ? 'solo defensivo'
      : p.esMarca
        ? 'producto de marca'
        : ritmo !== 'crecer'
          ? `el ritmo del mes es ${ritmo}`
          : p.acos14Pct === null || p.acosObjetivoPct === null || p.acos14Pct > AGENTE.ACOS_BUENO_X * p.acosObjetivoPct
            ? 'el ACoS no está claramente por debajo del objetivo'
            : !tacosAFavor
              ? 'el TACoS no baja ni está en objetivo'
              : p.ventasTotalesCrecen !== true
                ? 'las ventas totales no crecen'
                : 'poca cobertura de stock o stock desconocido'
  return { postura: 'mantener', motivo: `Mantener: ${porque}.` }
}
