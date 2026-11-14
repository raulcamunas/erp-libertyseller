/** Formatos de las cifras de Marketing Test, en español. Un null se pinta como un guion: «sin datos» no es un cero */

export const dinero = (n: number | null | undefined, moneda: string | null, decimales = 2): string => {
  if (n == null || Number.isNaN(n)) return '—'
  try {
    return n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR', minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  } catch {
    return `${n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} ${moneda ?? ''}`.trim()
  }
}

export const porcentaje = (n: number | null | undefined, decimales = 1): string => (n == null || Number.isNaN(n) ? '—' : `${(n * 100).toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} %`)

export const entero = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('es-ES'))

export const decimal = (n: number | null | undefined, decimales = 2): string => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }))

/** '2026-11-10' → '10 nov' */
export const diaCorto = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Cuánto hace de un instante, en palabras */
export const haceCuanto = (ms: number): string => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'hace unos segundos'
  const m = Math.round(s / 60)
  return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`
}
