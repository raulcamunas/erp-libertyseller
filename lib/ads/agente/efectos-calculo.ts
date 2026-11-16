/**
 * AMAZON ADS · EL AGENTE PPC: MEDIR EL EFECTO DE CADA CAMBIO APLICADO. PURO (nada de servidor).
 *
 * Cada cambio que el agente aplica de verdad abre una fila en `ads_efectos`. Aquí está la aritmética para medirla:
 *   · las ventanas (antes, rápida, provisional y final), con fechas LOCALES del marketplace y aritmética UTC;
 *   · la suma de una ventana, el grupo de control y la muestra mínima;
 *   · si la medición está «mezclada» con otro cambio de la misma unidad;
 *   · el veredicto (tabla de Ads + capa de NEGOCIO con las ventas totales del ASIN);
 *   · si toca deshacer solo (subidas que salen mal, y raras aplicadas por la IA en la medición rápida);
 *   · el valor al que vuelve un presupuesto al deshacer y el recuento por clase para el resumen.
 *
 * Fin último: vender más con menos publicidad. Una subida que solo trae ventas de Ads (y no totales) no ha mejorado nada:
 * «canibaliza orgánico». Una bajada que ahorra gasto sin que bajen las ventas totales sí ha mejorado, aunque bajen las de Ads.
 */

import { AGENTE, type ClaseDeCambio, type MedicionDeEfecto, type MetricasDeVentana, type Veredicto } from './tipos'

// ─── fechas ───────────────────────────────────────────────────────────────

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

/** Una fecha `YYYY-MM-DD` (ya LOCAL del marketplace) a milisegundos UTC de su medianoche. Lanza si no es una fecha válida. */
function aMs(fecha: string): number {
  const m = RE_FECHA.exec(fecha)
  if (!m) throw new Error(`Fecha no válida: «${fecha}» (se espera AAAA-MM-DD)`)
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (new Date(ms).toISOString().slice(0, 10) !== fecha) throw new Error(`Fecha no válida: «${fecha}»`)
  return ms
}

const DIA_MS = 86_400_000

/** Suma (o resta) días a una fecha `YYYY-MM-DD` con aritmética UTC: sin horarios de verano ni zonas de por medio */
function sumarDias(fecha: string, dias: number): string {
  return new Date(aMs(fecha) + dias * DIA_MS).toISOString().slice(0, 10)
}

/** Días de calendario entre dos fechas, ambas incluidas (0 si `hasta` es anterior a `desde`) */
function diasEntre(desde: string, hasta: string): number {
  return Math.max(0, Math.round((aMs(hasta) - aMs(desde)) / DIA_MS) + 1)
}

/**
 * LAS VENTANAS DE UN CAMBIO aplicado el día LOCAL `aplicadaDia` (d). El propio día d no entra en ninguna (es mitad y mitad).
 *   antes       = [d−14, d−1]
 *   rápida      = [d+1, d+3]   se mide desde d+6  (3 días sin cerrar: Amazon aún atribuye ventas)
 *   provisional = [d+1, d+7]   se mide desde d+10
 *   final       = [d+1, d+14]  se mide desde d+17
 */
export function ventanasDeEfecto(aplicadaDia: string): {
  antes: [string, string]
  rapida: [string, string]
  provisional: [string, string]
  despues: [string, string]
  medirRapidaDesde: string
  medirProvisionalDesde: string
  medirFinalDesde: string
} {
  const d = aplicadaDia
  const sinCerrar = AGENTE.EFECTOS_SIN_CERRAR
  return {
    antes: [sumarDias(d, -AGENTE.EFECTOS_VENTANA), sumarDias(d, -1)],
    rapida: [sumarDias(d, 1), sumarDias(d, AGENTE.RARA_RAPIDA_DIAS)],
    provisional: [sumarDias(d, 1), sumarDias(d, AGENTE.EFECTOS_PROVISIONAL)],
    despues: [sumarDias(d, 1), sumarDias(d, AGENTE.EFECTOS_VENTANA)],
    medirRapidaDesde: sumarDias(d, AGENTE.RARA_RAPIDA_DIAS + sinCerrar),
    medirProvisionalDesde: sumarDias(d, AGENTE.EFECTOS_PROVISIONAL + sinCerrar),
    medirFinalDesde: sumarDias(d, AGENTE.EFECTOS_VENTANA + sinCerrar),
  }
}

/**
 * SUMA de las filas diarias cuya fecha cae en [desde, hasta] (ambas incluidas).
 * `dias` = días de CALENDARIO de la ventana, no días con fila: `ads_objetivos_diario` solo trae las fechas con impresiones,
 * y para comparar ritmos (ventas por día) hay que dividir por la ventana entera.
 */
export function sumarVentana(
  filas: ReadonlyArray<{ fecha: string; clics: number; gasto: number; ventas: number; pedidos: number }>,
  desde: string,
  hasta: string,
): MetricasDeVentana {
  const m: MetricasDeVentana = { clics: 0, gasto: 0, ventas: 0, pedidos: 0, dias: diasEntre(desde, hasta) }
  for (const f of filas) {
    const fecha = f.fecha.slice(0, 10)
    if (fecha < desde || fecha > hasta) continue
    m.clics += num(f.clics)
    m.gasto += num(f.gasto)
    m.ventas += num(f.ventas)
    m.pedidos += num(f.pedidos)
  }
  m.gasto = redondear2(m.gasto)
  m.ventas = redondear2(m.ventas)
  return m
}

// ─── control y muestra ─────────────────────────────────────────────────────

/**
 * EL GRUPO DE CONTROL de una unidad tocada: las unidades parecidas que NO se tocaron en [d−14, d+14] (`tocados`, ids) y
 * tuvieron al menos 5 clics antes.
 *   · Segmentación: las de la misma campaña y tipo; si son menos de 3, las del mismo ASIN; si siguen siendo menos de 3, sin control.
 *   · Campaña (la unidad es la campaña: `id === campaignId`): las del mismo ASIN; si son menos de 3, toda la cuenta; si no, sin control.
 * Devuelve la lista elegida (vacía = sin control).
 */
export function elegirControl<T extends { id: string; campaignId: string; asin: string | null; tipo: string | null; clicsAntes: number }>(
  candidatos: readonly T[],
  tocado: { id: string; campaignId: string; asin: string | null; tipo: string | null },
  tocados: ReadonlySet<string>,
): T[] {
  const minimo = AGENTE.EFECTOS_CONTROL_MIN
  const validos = candidatos.filter((c) => c.id !== tocado.id && !tocados.has(c.id) && c.clicsAntes >= AGENTE.EFECTOS_CONTROL_CLICS)
  const mismoAsin = tocado.asin ? validos.filter((c) => c.asin === tocado.asin) : []
  const esCampana = tocado.id === tocado.campaignId
  if (esCampana) {
    if (mismoAsin.length >= minimo) return mismoAsin
    if (validos.length >= minimo) return validos
    return []
  }
  const mismaCampana = validos.filter((c) => c.campaignId === tocado.campaignId && c.tipo === tocado.tipo)
  if (mismaCampana.length >= minimo) return mismaCampana
  if (mismoAsin.length >= minimo) return mismoAsin
  return []
}

/** M = max(muestra mínima de la ficha, 12, ⌈2 ÷ CVR⌉): clics para esperar 2 pedidos. Un CVR ≤ 0 o desconocido no suma término. */
export function muestraMinima(muestraMinimaClics: number, cvr: number): number {
  const porCvr = Number.isFinite(cvr) && cvr > 0 ? Math.ceil(2 / cvr - 1e-9) : 0
  return Math.max(num(muestraMinimaClics), AGENTE.EFECTOS_CLICS_MIN, porCvr)
}

/** MEZCLADO: hubo OTRO cambio aplicado (agente, persona o log) en la misma unidad (o su campaña) en [d−14, d+14], ambos incluidos */
export function estaMezclado(aplicadaDia: string, otrosCambios: readonly string[]): boolean {
  const desde = sumarDias(aplicadaDia, -AGENTE.EFECTOS_VENTANA)
  const hasta = sumarDias(aplicadaDia, AGENTE.EFECTOS_VENTANA)
  return otrosCambios.some((dia) => {
    const f = dia.slice(0, 10)
    return f >= desde && f <= hasta
  })
}

// ─── aritmética de la medición ─────────────────────────────────────────────

function num(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}
function redondear2(n: number): number {
  return Math.round(n * 100) / 100
}
function redondear1(n: number): number {
  return Math.round(n * 10) / 10
}
/** Por día de la ventana (0 si la ventana no tiene días) */
function porDia(valor: number, dias: number): number {
  return dias > 0 ? valor / dias : 0
}
/** ACoS en % o null si no hay ventas */
function acos(m: MetricasDeVentana): number | null {
  return m.ventas > 0 ? (m.gasto / m.ventas) * 100 : null
}
/** Ventas por día después ÷ antes; sin ventas antes → 2 si ahora vende, 1 si tampoco */
function ratioDeVentas(a: MetricasDeVentana, d: MetricasDeVentana): number {
  const va = porDia(a.ventas, a.dias)
  const vd = porDia(d.ventas, d.dias)
  if (va <= 0) return vd > 0 ? 2 : 1
  return vd / va
}
/** Ratio del control; sin control (o con un control que se queda a 0) → 1, para no dividir por cero */
function ratioDelControl(m: MedicionDeEfecto): number {
  if (!m.controlAntes || !m.controlDespues) return 1
  const r = ratioDeVentas(m.controlAntes, m.controlDespues)
  return r > 0 ? r : 1
}
/** R = (ventasD/ventasA por día) ÷ ratio del control */
function ratioR(a: MetricasDeVentana, d: MetricasDeVentana, m: MedicionDeEfecto): number {
  return ratioDeVentas(a, d) / ratioDelControl(m)
}
/** ¿El ACoS de después es mayor que `limite`? Sin ventas con gasto cuenta como infinito; sin gasto ni ventas, no. */
function acosPasa(d: MetricasDeVentana, limite: number | null): boolean {
  if (limite === null) return false
  const a = acos(d)
  if (a === null) return d.gasto > 0
  return a > limite
}
function pct(n: number | null): string {
  return n === null ? 'sin ventas' : `${redondear1(n).toLocaleString('es-ES')} %`
}
function veces(n: number): string {
  return `${(Math.round(n * 100) / 100).toLocaleString('es-ES')}`
}

const SUBIDAS: ReadonlySet<ClaseDeCambio> = new Set(['puja_subir', 'presupuesto_subir', 'promover'])
const BAJADAS: ReadonlySet<ClaseDeCambio> = new Set(['puja_bajar', 'puja_bajar_sin_pedidos', 'pausar', 'negativizar', 'presupuesto_bajar'])

/** Las métricas de la CAMPAÑA para pausar y negativizar (si no vienen, las de la unidad) */
function deCampana(m: MedicionDeEfecto): { a: MetricasDeVentana; d: MetricasDeVentana } {
  return { a: m.campanaAntes ?? m.antes, d: m.campanaDespues ?? m.despues }
}

/** Gasto de Ads que mira la capa de negocio: la campaña para negativizar, la unidad para el resto */
function gastoDeNegocio(clase: ClaseDeCambio, m: MedicionDeEfecto): { a: MetricasDeVentana; d: MetricasDeVentana } {
  return clase === 'negativizar' ? deCampana(m) : { a: m.antes, d: m.despues }
}

/** Ventas totales del ASIN por día, antes y después; null si faltan o no tienen días */
function totalesPorDia(m: MedicionDeEfecto): { a: number; d: number } | null {
  const ta = m.ventasTotalesAntes
  const td = m.ventasTotalesDespues
  if (!ta || !td || ta.dias <= 0 || td.dias <= 0) return null
  return { a: porDia(num(ta.ventas), ta.dias), d: porDia(num(td.ventas), td.dias) }
}

// ─── tabla de Ads (§6.3) ───────────────────────────────────────────────────

function veredictoDeTabla(clase: ClaseDeCambio, m: MedicionDeEfecto): { veredicto: Veredicto; detalle: string } {
  const M = muestraMinima(m.muestraMinimaClics, m.cvr)
  const obj = m.acosObjetivoPct
  const a = m.antes
  const d = m.despues
  const acosA = acos(a)
  const acosD = acos(d)

  switch (clase) {
    case 'puja_subir': {
      if (a.clics < M || d.clics < M) return { veredicto: 'sin_muestra', detalle: `pocos clics (${a.clics} antes, ${d.clics} después; hacen falta ${M})` }
      const R = ratioR(a, d, m)
      const base = `R ${veces(R)} · ACoS ${pct(acosA)} → ${pct(acosD)} (objetivo ${pct(obj)})`
      if (R >= 1.1 && acosD !== null && acosD <= obj * 1.1) return { veredicto: 'mejoro', detalle: base }
      if (acosPasa(d, obj * AGENTE.DESHACER_ACOS_X) || (R < 0.95 && acosPeor(acosD, acosA, d))) return { veredicto: 'empeoro', detalle: base }
      return { veredicto: 'neutro', detalle: base }
    }
    case 'puja_bajar':
    case 'puja_bajar_sin_pedidos': {
      if (a.clics < M || d.clics < M) return { veredicto: 'sin_muestra', detalle: `pocos clics (${a.clics} antes, ${d.clics} después; hacen falta ${M})` }
      const R = ratioR(a, d, m)
      const gastoDiaA = porDia(a.gasto, a.dias)
      const gastoDiaD = porDia(d.gasto, d.dias)
      const base = `R ${veces(R)} · ACoS ${pct(acosA)} → ${pct(acosD)}`
      const bajaAcos = acosA !== null ? acosD !== null && acosD <= acosA * 0.9 : gastoDiaD < gastoDiaA * 0.8
      if (bajaAcos && R >= 0.75) return { veredicto: 'mejoro', detalle: base }
      if (R < 0.6 && acosPeorOIgual(acosD, acosA === null ? null : acosA * 0.95, d)) return { veredicto: 'empeoro', detalle: base }
      return { veredicto: 'neutro', detalle: base }
    }
    case 'pausar': {
      const c = deCampana(m)
      if (c.a.clics < M) return { veredicto: 'sin_muestra', detalle: `la campaña tenía ${c.a.clics} clics antes (hacen falta ${M})` }
      const Rc = ratioR(c.a, c.d, m)
      const ahorro = porDia(a.gasto, a.dias) - porDia(d.gasto, d.dias)
      const base = `R de la campaña ${veces(Rc)} · ahorro ${redondear2(ahorro).toLocaleString('es-ES')} al día`
      if (ahorro > 0 && Rc >= 0.9) return { veredicto: 'mejoro', detalle: base }
      if (Rc < 0.75) return { veredicto: 'empeoro', detalle: base }
      return { veredicto: 'neutro', detalle: base }
    }
    case 'negativizar': {
      const c = deCampana(m)
      if (c.a.clics < M) return { veredicto: 'sin_muestra', detalle: `la campaña tenía ${c.a.clics} clics antes (hacen falta ${M})` }
      const Rc = ratioR(c.a, c.d, m)
      const base = `R de la campaña ${veces(Rc)}`
      if (Rc >= 0.9) return { veredicto: 'mejoro', detalle: base }
      if (Rc < 0.75) return { veredicto: 'empeoro', detalle: base }
      return { veredicto: 'neutro', detalle: base }
    }
    case 'promover': {
      if (d.clics < M) return { veredicto: 'sin_muestra', detalle: `la segmentación nueva tiene ${d.clics} clics (hacen falta ${M})` }
      const base = `${d.pedidos} pedidos · ACoS ${pct(acosD)} (objetivo ${pct(obj)})`
      if (d.pedidos >= 1 && acosD !== null && acosD <= obj * 1.2) return { veredicto: 'mejoro', detalle: base }
      if (d.pedidos === 0) return { veredicto: 'empeoro', detalle: base }
      return { veredicto: 'neutro', detalle: base }
    }
    case 'presupuesto_subir': {
      if (d.dias < 7) return { veredicto: 'sin_muestra', detalle: `solo ${d.dias} días después (hacen falta 7)` }
      const R = ratioR(a, d, m)
      const base = `R ${veces(R)} · ACoS ${pct(acosA)} → ${pct(acosD)} (objetivo ${pct(obj)})`
      if (R >= 1.1 && acosD !== null && acosD <= obj * 1.1) return { veredicto: 'mejoro', detalle: base }
      if (acosPasa(d, obj * AGENTE.DESHACER_ACOS_X)) return { veredicto: 'empeoro', detalle: base }
      return { veredicto: 'neutro', detalle: base }
    }
    case 'presupuesto_bajar': {
      if (d.dias < 7) return { veredicto: 'sin_muestra', detalle: `solo ${d.dias} días después (hacen falta 7)` }
      const R = ratioR(a, d, m)
      const base = `R ${veces(R)} · gasto ${redondear2(porDia(a.gasto, a.dias)).toLocaleString('es-ES')} → ${redondear2(porDia(d.gasto, d.dias)).toLocaleString('es-ES')} al día`
      if (porDia(d.gasto, d.dias) < porDia(a.gasto, a.dias) && R >= 0.9) return { veredicto: 'mejoro', detalle: base }
      if (R < 0.75) return { veredicto: 'empeoro', detalle: base }
      return { veredicto: 'neutro', detalle: base }
    }
    case 'pausar_campana':
      return { veredicto: 'neutro', detalle: 'pausa de campaña (por stock): no se juzga' }
  }
}

/** ACoS después > ACoS antes (sin ventas después con gasto = peor; sin ventas antes = no se puede decir que empeore) */
function acosPeor(acosD: number | null, acosA: number | null, d: MetricasDeVentana): boolean {
  if (acosA === null) return false
  if (acosD === null) return d.gasto > 0
  return acosD > acosA
}
/** ACoS después ≥ límite (sin ventas después con gasto = sí) */
function acosPeorOIgual(acosD: number | null, limite: number | null, d: MetricasDeVentana): boolean {
  if (limite === null) return false
  if (acosD === null) return d.gasto > 0
  return acosD >= limite
}

// ─── veredicto ─────────────────────────────────────────────────────────────

/**
 * EL VEREDICTO de un cambio medido, por orden:
 *   1. alguna ventana toca un evento de temporada → `sin_muestra` («evento: Black Friday»);
 *   2. otro cambio en la misma unidad en [d−14, d+14] → `mezclado`;
 *   3. la tabla de Ads de §6.3;
 *   4. la capa de NEGOCIO con las ventas totales del ASIN (si las hay):
 *      · una subida que la tabla da por buena solo es `mejoro` si las ventas totales suben al menos el gasto extra × 100/objetivo;
 *        si no, `neutro` («canibaliza orgánico»);
 *      · una bajada que ahorra gasto y NO baja las ventas totales (≥ 0,95× por día) es `mejoro` aunque bajen las de Ads.
 *   Un `sin_muestra` de la tabla no lo cambia el negocio: sin muestra no se juzga.
 */
export function veredicto(clase: ClaseDeCambio, m: MedicionDeEfecto): { veredicto: Veredicto; detalle: string } {
  if (m.evento) return { veredicto: 'sin_muestra', detalle: `evento: ${m.evento}` }
  if (m.mezclado) return { veredicto: 'mezclado', detalle: 'otro cambio en la misma unidad (o su campaña) en los 14 días de antes o de después' }

  const tabla = veredictoDeTabla(clase, m)
  if (tabla.veredicto === 'sin_muestra' || clase === 'pausar_campana') return tabla

  const tot = totalesPorDia(m)
  if (!tot) return tabla
  const g = gastoDeNegocio(clase, m)
  const gastoDiaA = porDia(g.a.gasto, g.a.dias)
  const gastoDiaD = porDia(g.d.gasto, g.d.dias)

  if (SUBIDAS.has(clase) && tabla.veredicto === 'mejoro') {
    const deltaTotales = tot.d - tot.a
    const deltaGasto = gastoDiaD - gastoDiaA
    const obj = m.acosObjetivoPct > 0 ? m.acosObjetivoPct : null
    const necesario = obj === null ? 0 : deltaGasto * (100 / obj)
    if (deltaTotales < necesario) {
      return {
        veredicto: 'neutro',
        detalle: `canibaliza orgánico: ventas totales ${redondear2(tot.a).toLocaleString('es-ES')} → ${redondear2(tot.d).toLocaleString('es-ES')} al día (hacía falta +${redondear2(necesario).toLocaleString('es-ES')}) · ${tabla.detalle}`,
      }
    }
    return { veredicto: 'mejoro', detalle: `${tabla.detalle} · ventas totales +${redondear2(deltaTotales).toLocaleString('es-ES')} al día` }
  }

  if (BAJADAS.has(clase) && tabla.veredicto !== 'mejoro') {
    const ahorra = gastoDiaD < gastoDiaA
    const totalesAguantan = tot.d >= AGENTE.NEGOCIO_BAJADA_VENTAS_X * tot.a
    if (ahorra && totalesAguantan) {
      return {
        veredicto: 'mejoro',
        detalle: `ahorra ${redondear2(gastoDiaA - gastoDiaD).toLocaleString('es-ES')} al día sin bajar las ventas totales (${redondear2(tot.a).toLocaleString('es-ES')} → ${redondear2(tot.d).toLocaleString('es-ES')} al día) · ${tabla.detalle}`,
      }
    }
  }
  return tabla
}

// ─── deshacer ──────────────────────────────────────────────────────────────

/**
 * DESHACER SOLO una subida (`puja_subir`, `presupuesto_subir`) en la medición PROVISIONAL: con muestra (clics después ≥ M) y
 * ACoS después > objetivo × 1,30, o sin ventas con un gasto ≥ 2 × CPA objetivo. Nunca si está mezclado, si es de lanzamiento o
 * si la ventana toca un evento (esas mediciones no cuentan). Una negativa (y cualquier bajada) nunca se deshace sola.
 */
export function debeDeshacer(clase: ClaseDeCambio, m: MedicionDeEfecto): { deshacer: boolean; motivo: string | null } {
  if (clase !== 'puja_subir' && clase !== 'presupuesto_subir') return { deshacer: false, motivo: null }
  if (m.mezclado || m.fase === 'lanzamiento' || m.evento) return { deshacer: false, motivo: null }
  const M = muestraMinima(m.muestraMinimaClics, m.cvr)
  const d = m.despues
  if (d.clics < M) return { deshacer: false, motivo: null }
  const obj = m.acosObjetivoPct
  const acosD = acos(d)
  if (acosD !== null && acosD > obj * AGENTE.DESHACER_ACOS_X) {
    return { deshacer: true, motivo: `ACoS ${pct(acosD)} tras el cambio (objetivo ${pct(obj)}; el límite es ${pct(obj * AGENTE.DESHACER_ACOS_X)})` }
  }
  if (d.ventas <= 0 && m.cpaObjetivo !== null && m.cpaObjetivo > 0 && d.gasto >= 2 * m.cpaObjetivo) {
    return { deshacer: true, motivo: `${redondear2(d.gasto).toLocaleString('es-ES')} de gasto sin ninguna venta (más de 2 veces el CPA objetivo, ${redondear2(m.cpaObjetivo).toLocaleString('es-ES')})` }
  }
  return { deshacer: false, motivo: null }
}

/**
 * DESHACER una RARA aplicada por la IA, en la medición RÁPIDA de 3 días: si las ventas por día caen más de un 30 % frente al
 * control (`ventasD/ventasA < 0,70 × ratio del control`). Sin ventas antes no hay caída que medir. Nunca si está mezclado, si es
 * de lanzamiento o si toca un evento.
 */
export function debeDeshacerRara(m: MedicionDeEfecto): { deshacer: boolean; motivo: string | null } {
  if (m.mezclado || m.fase === 'lanzamiento' || m.evento) return { deshacer: false, motivo: null }
  const a = m.antes
  const d = m.despues
  if (a.ventas <= 0 || a.dias <= 0 || d.dias <= 0) return { deshacer: false, motivo: null }
  const ratio = ratioDeVentas(a, d)
  const control = ratioDelControl(m)
  const limite = (1 - AGENTE.RARA_CAIDA_VENTAS) * control
  if (ratio < limite) {
    return {
      deshacer: true,
      motivo: `las ventas han caído a ${redondear2(porDia(d.ventas, d.dias)).toLocaleString('es-ES')} al día desde ${redondear2(porDia(a.ventas, a.dias)).toLocaleString('es-ES')} (×${veces(ratio)}; el control ×${veces(control)})`,
    }
  }
  return { deshacer: false, motivo: null }
}

/** Al deshacer una subida de presupuesto: vuelve al valor anterior, sin pasar de lo que hoy permite el guardarraíl (null = sin límite). Nunca < 1. */
export function valorDeDeshacerPresupuesto(anterior: number, permitidoHoy: number | null): number {
  const valor = permitidoHoy === null || !Number.isFinite(permitidoHoy) ? anterior : Math.min(anterior, permitidoHoy)
  return Math.max(1, redondear2(valor))
}

/** Recuento de veredictos por clase (las filas sin veredicto todavía no cuentan) */
export function resumenDeVeredictos(
  filas: ReadonlyArray<{ clase: ClaseDeCambio; veredicto: Veredicto | null }>,
): Partial<Record<ClaseDeCambio, { mejoro: number; empeoro: number; neutro: number; sinMuestra: number; mezclado: number }>> {
  const r: Partial<Record<ClaseDeCambio, { mejoro: number; empeoro: number; neutro: number; sinMuestra: number; mezclado: number }>> = {}
  for (const f of filas) {
    if (!f.veredicto) continue
    const c = (r[f.clase] ??= { mejoro: 0, empeoro: 0, neutro: 0, sinMuestra: 0, mezclado: 0 })
    if (f.veredicto === 'sin_muestra') c.sinMuestra++
    else c[f.veredicto]++
  }
  return r
}

/**
 * PURO. Las subidas que NO se repiten: segmentaciones (puja_subir) y campañas (presupuesto_subir) con un efecto medido como «empeoró» o deshecho solo,
 * aplicado desde `desdeDia` (YYYY-MM-DD). Solo vetan SUBIR: bajar sigue permitido. Sin esto, la cuarentena de 7 días deja volver a proponer la misma
 * subida (con los mismos datos) y el agente la aplica otra vez: un bucle de subir y deshacer cada 2-3 semanas.
 */
export function subidasVetadasPorEfectos(
  filas: ReadonlyArray<{ clase: string; objetivo_id: string | null; campaign_id: string | null; veredicto: string | null; deshecho_auto: boolean | null; aplicada_dia: string }>,
  desdeDia: string,
): { objetivos: Set<string>; campanas: Set<string> } {
  const objetivos = new Set<string>()
  const campanas = new Set<string>()
  for (const f of filas) {
    if (f.aplicada_dia < desdeDia) continue
    if (!(f.veredicto === 'empeoro' || f.deshecho_auto === true)) continue
    if (f.clase === 'puja_subir' && f.objetivo_id) objetivos.add(String(f.objetivo_id))
    if (f.clase === 'presupuesto_subir' && f.campaign_id) campanas.add(String(f.campaign_id))
  }
  return { objetivos, campanas }
}
