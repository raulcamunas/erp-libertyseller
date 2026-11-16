import type { LineaDePanel, RemesaDePanel, SkuDePanel } from '@/lib/fba/datos'
import { esEnvioDudoso } from '@/lib/fba/llegadas'
import { ESTADOS_AMAZON_MALOS } from '@/lib/fba/vista'

/**
 * LAS REGLAS DE LA PANTALLA DE ENVÍOS (puro: sin React, sin red, sin `Date.now()`). Se prueba con reglas.prueba.ts.
 *
 * API
 *   cuentasDeEnvio(remesa)                 enviadas, recibidas, VENDIDAS (solo ventas), retiradas y mermas aparte, devueltas, quedan…
 *   ventasDeLinea(linea)                   { ventas, retiradasYMermas } de una línea (vendidas = consumidas − retiradas − mermas)
 *   ventasPorSku(lineas)                   Map sku → { ventas, retiradasYMermas } (para las tablas)
 *   faltantesAlCerrar(remesa)              unidades que no llegaron si Amazon lo CERRÓ corto (D18: < 95 % o ≥ 5 ud); null si no
 *   esDudoso(remesa, hoy, transporte)      va de camino hace demasiado sin recibir nada (D3; regla de lib/fba/llegadas.ts)
 *   nacioDePropuesta(remesa)               lo que se sabe sin ir al servidor: ¿salió del flujo de propuestas (no importada)?
 *   nacioDePropuestaPorHistorial(eventos)  lo mismo, mirando el historial de la remesa ({ accion, hasta })
 *   esDelPlan(remesa)                      nació de un envío propuesto por el planificador (envio_propuesto_id, migración 316)
 *   ritmoDeReferencia(skus, ritmoPorSku)   ud/día de las referencias del envío, sumadas (el ritmo de la referencia, no del lote)
 *   ritmosDelPlan(lineas)                  Map sku → ud/día de las líneas del plan (previsto, o base si no hay)
 *
 * «VENDIDAS» SON SOLO VENTAS. El reparto FIFO apunta como salida de un lote lo vendido, lo retirado del almacén
 * y las mermas. Durante meses la pantalla lo llamó todo «vendidas». Desde remesas-pro (§8) se separan, como ya
 * hacían el informe PDF (informe-pedido.ts) y los lotes (lotes-envio.ts).
 */

export interface CuentasEnvio {
  enviadas: number
  /** Lo que Amazon dice que ha recibido; 0 si todavía no se ha preguntado (ver `sinPreguntar`) */
  recibidas: number
  sinPreguntar: boolean
  /** Solo ventas (en neto de devoluciones) */
  vendidas: number
  retiradas: number
  mermas: number
  retiradasYMermas: number
  devueltas: number
  quedan: number
  /** Lo que se reparte: lo recibido, o lo enviado si no se ha preguntado. Nunca 0 (para dividir) */
  base: number
  referencias: number
  agotadas: number
}

const no0 = (n: number) => (Number.isFinite(n) ? n : 0)

export function ventasDeLinea(l: Pick<LineaDePanel, 'consumidas' | 'retiradas' | 'mermas'>): { ventas: number; retiradasYMermas: number } {
  const retiradasYMermas = Math.max(0, no0(l.retiradas)) + Math.max(0, no0(l.mermas))
  return { ventas: Math.max(0, no0(l.consumidas) - retiradasYMermas), retiradasYMermas }
}

export function ventasPorSku(lineas: ReadonlyArray<Pick<LineaDePanel, 'sku' | 'consumidas' | 'retiradas' | 'mermas'>>): Map<string, { ventas: number; retiradasYMermas: number }> {
  const m = new Map<string, { ventas: number; retiradasYMermas: number }>()
  for (const l of lineas) {
    const v = ventasDeLinea(l)
    const ya = m.get(l.sku)
    m.set(l.sku, ya ? { ventas: ya.ventas + v.ventas, retiradasYMermas: ya.retiradasYMermas + v.retiradasYMermas } : v)
  }
  return m
}

export function cuentasDeEnvio(r: Pick<RemesaDePanel, 'lineas' | 'quedan'>): CuentasEnvio {
  const enviadas = r.lineas.reduce((s, l) => s + no0(l.enviadas), 0)
  const sinPreguntar = r.lineas.length > 0 && r.lineas.every((l) => l.recibidas === null)
  const recibidas = r.lineas.reduce((s, l) => s + no0(l.recibidas ?? 0), 0)
  let vendidas = 0
  let retiradasYMermas = 0
  for (const l of r.lineas) {
    const v = ventasDeLinea(l)
    vendidas += v.ventas
    retiradasYMermas += v.retiradasYMermas
  }
  const retiradas = r.lineas.reduce((s, l) => s + Math.max(0, no0(l.retiradas)), 0)
  const mermas = r.lineas.reduce((s, l) => s + Math.max(0, no0(l.mermas)), 0)
  const devueltas = r.lineas.reduce((s, l) => s + Math.max(0, no0(l.devueltas)), 0)
  return {
    enviadas,
    recibidas,
    sinPreguntar,
    vendidas,
    retiradas,
    mermas,
    retiradasYMermas,
    devueltas,
    quedan: Math.max(0, no0(r.quedan)),
    base: Math.max(1, sinPreguntar ? enviadas : recibidas),
    referencias: r.lineas.length,
    agotadas: r.lineas.filter((l) => l.quedan === 0).length,
  }
}

/**
 * CERRADO CON FALTANTES (D18, la misma regla que el Pendiente de lib/fba/trabajo-plan.ts): Amazon lo dio por CERRADO
 * con menos de lo que se mandó, y falta el 5 % o más, o 5 unidades o más. Devuelve cuántas no llegaron.
 */
export function faltantesAlCerrar(r: Pick<RemesaDePanel, 'estadoAmazon' | 'lineas'>): number | null {
  if ((r.estadoAmazon ?? '').toUpperCase() !== 'CLOSED') return null
  const contestadas = r.lineas.filter((l) => l.recibidas !== null)
  if (contestadas.length === 0) return null
  const enviadas = contestadas.reduce((s, l) => s + no0(l.enviadas), 0)
  const recibidas = contestadas.reduce((s, l) => s + no0(l.recibidas ?? 0), 0)
  const faltan = enviadas - recibidas
  if (enviadas <= 0 || faltan <= 0) return null
  return recibidas < 0.95 * enviadas || faltan >= 5 ? faltan : null
}

/** Estados de Amazon en los que el envío todavía «va de camino» (para el dudoso) */
const DE_CAMINO = new Set(['WORKING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CHECKED_IN'])

const aUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

/**
 * ENVÍO DUDOSO (D3): salió hace más de max(30, 2,5 × transporte mediano) días, Amazon no ha recibido nada y el libro
 * no ha visto la llegada. No cuenta para la cobertura del plan; aquí solo se avisa.
 */
export function esDudoso(
  r: Pick<RemesaDePanel, 'estadoAmazon' | 'fechaEnvio' | 'llegadaAt' | 'lineas' | 'referenciaEnvio'>,
  hoy: string,
  transporteMediano: number | null
): boolean {
  const e = (r.estadoAmazon ?? '').toUpperCase()
  if (!r.referenciaEnvio || !DE_CAMINO.has(e)) return false
  if (r.llegadaAt) return false
  if (!/^\d{4}-\d{2}-\d{2}/.test(r.fechaEnvio ?? '') || !/^\d{4}-\d{2}-\d{2}/.test(hoy)) return false
  const recibidas = r.lineas.reduce((s, l) => s + no0(l.recibidas ?? 0), 0)
  const edad = Math.round((aUtc(hoy) - aUtc(r.fechaEnvio)) / 86_400_000)
  return esEnvioDudoso(edad, recibidas, transporteMediano)
}

/** El id del envío propuesto si la remesa lo trae (llega con la migración 316; antes, nunca) */
export function envioPropuestoDe(r: object): string | null {
  const v = (r as { envioPropuestoId?: unknown; envio_propuesto_id?: unknown }).envioPropuestoId ?? (r as { envio_propuesto_id?: unknown }).envio_propuesto_id
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** ¿Nació de un envío propuesto del planificador? Por su enlace (316) o porque su análisis lo dice */
export function esDelPlan(r: Pick<RemesaDePanel, 'analisisIa'>): boolean {
  if (envioPropuestoDe(r)) return true
  const origen = (r.analisisIa as { origen?: unknown } | null)?.origen
  return origen === 'planificador'
}

/**
 * ¿SALIÓ DEL FLUJO DE PROPUESTAS? Lo que se sabe sin preguntar al servidor.
 *
 * Una remesa importada de Amazon («Importar pedidos» o «Traer envío») nace ya enviada (lib/fba/importar-envio.ts): sin
 * boceto reabierto, sin etiquetas impresas, sin aprobar y sin análisis. Cualquiera de esas huellas dice que pasó por
 * Propuestas. Si no hay ninguna, NO se concluye que sea importada: se mira el historial (nacioDePropuestaPorHistorial).
 */
export function nacioDePropuesta(r: Pick<RemesaDePanel, 'version' | 'ultimaImpresion' | 'aprobadaAt' | 'analisisIa'> & { propuesta?: unknown }): boolean {
  if (envioPropuestoDe(r)) return true
  if ((r.version ?? 1) > 1) return true
  if (r.ultimaImpresion) return true
  if (r.aprobadaAt) return true
  if (r.analisisIa) return true
  if (r.propuesta) return true
  return false
}

/** Acciones del historial que solo deja una remesa que se preparó en el ERP (fba_remesa_historial, migración 309) */
const ACCIONES_DE_PROPUESTA = new Set([
  'creada',
  'estado',
  'lineas',
  'cajas',
  'enlace_creado',
  'propuesta_enviada',
  'propuesta_cliente',
  'propuesta_aceptada',
  'propuesta_devuelta',
  'etiquetas',
  'manifiesto',
  'embalaje',
  'encaje_terminado',
])

/** Un cierre (enviada → cerrada) también lo puede tener una importada: no cuenta como huella de propuesta */
export function nacioDePropuestaPorHistorial(eventos: ReadonlyArray<{ accion: string; hasta?: string | null }>): boolean {
  return eventos.some((e) => ACCIONES_DE_PROPUESTA.has(e.accion) && !(e.accion === 'estado' && e.hasta === 'cerrada'))
}

/** Ritmo de las líneas del plan: el previsto que usa la frase (con estacionalidad) o, si no, el base. Solo los > 0 */
export function ritmosDelPlan(lineas: ReadonlyArray<{ sku: string; ritmoPrevisto?: number | null; ritmo: { previsto?: number | null; base?: number | null } }>): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lineas) {
    const r = Number(l.ritmoPrevisto ?? l.ritmo?.previsto ?? l.ritmo?.base)
    if (l.sku && Number.isFinite(r) && r > 0) m.set(l.sku, r)
  }
  return m
}

/**
 * EL RITMO DE LA REFERENCIA, AL LADO DEL DE ESTE ENVÍO.
 *
 * El ritmo de un envío es el de su lote FIFO: un envío que todavía no vende porque delante hay otro más antiguo sale a
 * 0, aunque sus referencias vendan mucho. Al lado va el de las referencias (lo que dice el planificador), sumado sobre
 * las del envío. Si el plan no trae una referencia, se usa la velocidad del panel (30 días) y `origen` lo dice.
 */
export function ritmoDeReferencia(
  skus: ReadonlyArray<string>,
  ritmoPlan: Map<string, number> | null,
  panel: ReadonlyArray<Pick<SkuDePanel, 'sku' | 'velocidad'>>
): { total: number | null; porSku: Map<string, number>; origen: 'plan' | 'panel' | 'mixto' | null } {
  const velocidad = new Map(panel.map((s) => [s.sku, s.velocidad]))
  const porSku = new Map<string, number>()
  let dePlan = 0
  let dePanel = 0
  for (const sku of new Set(skus)) {
    const p = ritmoPlan?.get(sku)
    if (p !== undefined && Number.isFinite(p)) {
      porSku.set(sku, p)
      dePlan++
      continue
    }
    const v = velocidad.get(sku)
    if (v !== undefined && Number.isFinite(v) && v > 0) {
      porSku.set(sku, v)
      dePanel++
    }
  }
  if (porSku.size === 0) return { total: null, porSku, origen: null }
  const total = Math.round([...porSku.values()].reduce((s, n) => s + n, 0) * 100) / 100
  return { total, porSku, origen: dePlan > 0 && dePanel > 0 ? 'mixto' : dePlan > 0 ? 'plan' : 'panel' }
}

/** ¿Va todavía con ventas por repartir? (Amazon dice que está mal: no cuenta) */
export function estaMal(r: Pick<RemesaDePanel, 'estadoAmazon'>): boolean {
  return !!r.estadoAmazon && ESTADOS_AMAZON_MALOS.includes(r.estadoAmazon)
}
