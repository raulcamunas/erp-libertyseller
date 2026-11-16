/**
 * AGENTE PPC · CALIBRACIÓN MENSUAL DE LOS UMBRALES (§6.6 de la especificación). PURO.
 *
 * Con lo que el agente ha MEDIDO de sus propios cambios (veredictos de `ads_efectos`), se mueven los umbrales «estimados» de la cuenta un paso, y solo uno:
 *   · por clase de cambio, con ≥ 20 veredictos que cuenten (se ignoran `mezclado` y `sin_muestra`, incluidos los de evento);
 *   · si ≥ 60 % «mejoró» → un paso MÁS AGRESIVO; si ≥ 40 % «empeoró» → un paso MÁS PRUDENTE (si se cumplen las dos, gana la prudencia);
 *   · como mucho UN parámetro por clase y ciclo: el primero de su lista que se pueda mover;
 *   · el paso es el de DESCRIPCION_DE_UMBRALES, y el valor nuevo queda dentro de su min/max, dentro de ±50 % del valor de partida
 *     y, para subirPujaPct, pujaMaxBajadaPct y bajarSinPedidosPct, sin pasar de 25.
 * `presupuesto_subir` NO se calibra (los presupuestos los deciden R1–R4) y el ACoS objetivo nunca.
 */

import { AGENTE, type ClaseDeCambio, type Veredicto } from './tipos'
import { DESCRIPCION_DE_UMBRALES, UMBRALES_DE_PARTIDA, type UmbralesEstimados } from '../umbrales'

/** Qué parámetros mueve cada clase, por orden de preferencia, y en qué sentido es «más agresivo» (+1 = subir el valor, −1 = bajarlo) */
export const PARAMETROS_POR_CLASE: Partial<Record<ClaseDeCambio, ReadonlyArray<{ clave: keyof UmbralesEstimados; agresivo: 1 | -1 }>>> = {
  puja_subir: [
    { clave: 'subirPujaPct', agresivo: 1 },
    { clave: 'subirSiAcosBajoX', agresivo: 1 },
  ],
  puja_bajar: [
    { clave: 'pujaMaxBajadaPct', agresivo: 1 },
    { clave: 'bajarSiAcosSobreX', agresivo: -1 },
  ],
  puja_bajar_sin_pedidos: [{ clave: 'bajarSinPedidosPct', agresivo: 1 }],
  negativizar: [{ clave: 'negativizarClicsPorCvr', agresivo: -1 }],
}

/** Veredictos que hacen falta (sin contar mezclados ni sin muestra) para mover nada de una clase */
export const VEREDICTOS_MINIMOS = 20
/** Proporción de «mejoró» para dar un paso más agresivo */
export const PROPORCION_MEJORO = 0.6
/** Proporción de «empeoró» para dar un paso más prudente */
export const PROPORCION_EMPEORO = 0.4
/** Cuánto puede alejarse un umbral calibrado de su valor de partida (±50 %) */
export const DESVIO_MAXIMO_DE_PARTIDA = 0.5
/** Tope de los porcentajes de cambio de puja: más de un 25 % de golpe no lo decide la calibración */
export const TOPE_DE_PORCENTAJES = 25
const TOPADOS_A_25: ReadonlyArray<keyof UmbralesEstimados> = ['subirPujaPct', 'pujaMaxBajadaPct', 'bajarSinPedidosPct']

/** Redondeo al paso: enteros si el paso es entero; si no, a los decimales del paso (0,05 → 2), para que 0,7 + 0,05 dé 0,75 y no 0,7499999 */
function redondearAlPaso(valor: number, paso: number): number {
  if (Number.isInteger(paso)) return Math.round(valor)
  const decimales = Math.min(6, (String(paso).split('.')[1] ?? '').length)
  const f = 10 ** decimales
  return Math.round(valor * f) / f
}

/** Los límites que tiene el valor calibrado de un umbral: min/max de la ficha ∩ ±50 % del de partida ∩ (≤ 25 en los porcentajes de puja) */
export function limitesDeCalibracion(clave: keyof UmbralesEstimados): { min: number; max: number } {
  const d = DESCRIPCION_DE_UMBRALES[clave]
  const partida = UMBRALES_DE_PARTIDA[clave]
  let min = Math.max(d.min, partida * (1 - DESVIO_MAXIMO_DE_PARTIDA))
  let max = Math.min(d.max, partida * (1 + DESVIO_MAXIMO_DE_PARTIDA))
  if (TOPADOS_A_25.includes(clave)) max = Math.min(max, TOPE_DE_PORCENTAJES)
  // Tolerancia de coma flotante: 0,7 × 1,5 = 1,0499999…
  min = Math.round(min * 1e9) / 1e9
  max = Math.round(max * 1e9) / 1e9
  return { min, max }
}

const numero = (n: number): string => String(n).replace('.', ',')

/**
 * Un ciclo de calibración. No modifica `u`: devuelve unos umbrales nuevos y la lista de cambios con su motivo en español
 * («subirPujaPct 15 → 20 (14 de 20 mejoraron)»). Sin cambios, `umbrales` es una copia igual a `u`.
 */
export function calibrar(
  u: UmbralesEstimados,
  veredictos: ReadonlyArray<{ clase: ClaseDeCambio; veredicto: Veredicto }>
): { umbrales: UmbralesEstimados; cambios: Array<{ clave: keyof UmbralesEstimados; antes: number; despues: number; motivo: string }> } {
  const umbrales: UmbralesEstimados = { ...u }
  const cambios: Array<{ clave: keyof UmbralesEstimados; antes: number; despues: number; motivo: string }> = []

  // Recuento por clase, solo con los veredictos que cuentan
  const cuenta = new Map<ClaseDeCambio, { mejoro: number; empeoro: number; total: number }>()
  for (const v of veredictos) {
    if (v.veredicto === 'mezclado' || v.veredicto === 'sin_muestra') continue
    if (v.veredicto !== 'mejoro' && v.veredicto !== 'empeoro' && v.veredicto !== 'neutro') continue
    const c = cuenta.get(v.clase) ?? { mejoro: 0, empeoro: 0, total: 0 }
    c.total++
    if (v.veredicto === 'mejoro') c.mejoro++
    if (v.veredicto === 'empeoro') c.empeoro++
    cuenta.set(v.clase, c)
  }

  for (const clase of Object.keys(PARAMETROS_POR_CLASE) as ClaseDeCambio[]) {
    const parametros = PARAMETROS_POR_CLASE[clase]
    const c = cuenta.get(clase)
    if (!parametros || !c || c.total < VEREDICTOS_MINIMOS) continue

    // Prudencia primero: si a la vez hay ≥ 60 % de mejoras y ≥ 40 % de empeoramientos (12 + 8 de 20), no se arriesga
    let sentido: 'agresivo' | 'prudente' | null = null
    if (c.empeoro / c.total >= PROPORCION_EMPEORO) sentido = 'prudente'
    else if (c.mejoro / c.total >= PROPORCION_MEJORO) sentido = 'agresivo'
    if (!sentido) continue

    for (const p of parametros) {
      const d = DESCRIPCION_DE_UMBRALES[p.clave]
      const antes = umbrales[p.clave]
      const signo = sentido === 'agresivo' ? p.agresivo : -p.agresivo
      const despues = redondearAlPaso(antes + signo * d.paso, d.paso)
      const { min, max } = limitesDeCalibracion(p.clave)
      if (!Number.isFinite(despues) || despues < min - 1e-9 || despues > max + 1e-9 || despues === antes) continue
      umbrales[p.clave] = despues
      const porque = sentido === 'agresivo' ? `${c.mejoro} de ${c.total} mejoraron` : `${c.empeoro} de ${c.total} empeoraron`
      cambios.push({ clave: p.clave, antes, despues, motivo: `${p.clave} ${numero(antes)} → ${numero(despues)} (${porque})` })
      break // un parámetro por clase y ciclo
    }
  }

  return { umbrales, cambios }
}

/** PURO. Desde cuándo cuentan los veredictos: los últimos 60 días, pero nunca antes de la calibración anterior (ISO) */
export function desdeDeCalibrar(ahora: number, calibradoAnterior: string | null): string {
  const ventana = ahora - AGENTE.CALIBRAR_VENTANA_DIAS * 86_400_000
  const anterior = calibradoAnterior ? Date.parse(calibradoAnterior) : NaN
  return new Date(Number.isFinite(anterior) && anterior > ventana && anterior <= ahora ? anterior : ventana).toISOString()
}
