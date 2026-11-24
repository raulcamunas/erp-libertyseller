/**
 * La rotura de una línea del plan, con UNA sola regla para los KPI (Hoy, Resumen, salud) y para el filtro «Rompen en 30 días» de
 * Reposición (D4 · D30): si no, la cifra y la lista no cuadran.
 *
 *   · Cuenta la rotura que decide (`fechaRotura`). El hueco inevitable antes de una llegada (`fechaPrimerHueco`) es un dato de la
 *     línea (`diasSinStockInevitables` y la frase), no una rotura: se cierra solo con lo que viene (D4).
 *   · No cuentan las líneas fuera del plan sin rotura que vigilar ni las de confianza `sin_datos`.
 *
 * Pura y sin dependencias: la usan el servidor y la pantalla.
 */
import type { LineaPlan, MotivoFuera } from './plan-tipos'

export const FUERA_SIN_ROTURA: readonly MotivoFuera[] = ['descatalogada', 'no_comprable', 'sin_ventas', 'sin_datos', 'agotado_largo', 'talla_sin_ventas', 'exceso', 'fuera_de_temporada']

type LineaRotura = Pick<LineaPlan, 'fuera' | 'fechaRotura'> & { ritmo: Pick<LineaPlan['ritmo'], 'confianza'> }

/** ¿Entra la línea en las cuentas de roturas? */
export function cuentaParaRotura(l: LineaRotura): boolean {
  return !(l.fuera && FUERA_SIN_ROTURA.includes(l.fuera)) && l.ritmo.confianza !== 'sin_datos'
}

/** La fecha de rotura que cuenta (null = no rompe en el horizonte o no cuenta) */
export function roturaDeLinea(l: LineaRotura): string | null {
  return cuentaParaRotura(l) ? l.fechaRotura : null
}

const sumar = (f: string, n: number) => new Date(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** ¿Rompe dentro de `dias` días desde `hoy`? (lo de antes de hoy también: ya está roto) */
export function rompeEn(l: LineaRotura, hoy: string, dias: number): boolean {
  const r = roturaDeLinea(l)
  return r !== null && r <= sumar(hoy, dias)
}
