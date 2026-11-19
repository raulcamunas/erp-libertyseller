/** Cómo se escriben las cifras en la página de tráfico (español de España) */

export const entero = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('es-ES', { useGrouping: 'always' } as Intl.NumberFormatOptions))
export const decimal = (n: number | null | undefined, d = 1): string => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' } as Intl.NumberFormatOptions))
export const dinero = (n: number | null | undefined, moneda = 'EUR', d = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: moneda, minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' } as Intl.NumberFormatOptions)
/** 0,0563 → «5,63 %» */
export const pct = (n: number | null | undefined, d = 2): string => (n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })} %`)
/** Diferencia en puntos: 0,0056 − 0,0232 → «−1,75 p.» */
export const puntos = (a: number | null, b: number | null): string | null => {
  if (a == null || b == null) return null
  const d = (a - b) * 100
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.`
}
/** Variación relativa: «+58 %», «−12 %» */
export const variacion = (a: number | null, b: number | null): string | null => {
  if (a == null || b == null || b === 0) return null
  const v = (a / b - 1) * 100
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('es-ES', { maximumFractionDigits: v > -10 && v < 10 ? 1 : 0 })} %`
}
