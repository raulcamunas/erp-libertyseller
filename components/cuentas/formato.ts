/** Formatos de las cifras de Cuentas, en español. Un null se pinta como un guion: «sin datos» no es un cero */

export const dinero = (n: number | null | undefined, moneda: string | null | undefined, decimales = 0): string => {
  if (n == null || Number.isNaN(n)) return '—'
  try {
    return n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR', minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  } catch {
    return `${n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} ${moneda ?? ''}`.trim()
  }
}

export const porcentaje = (n: number | null | undefined, decimales = 1): string =>
  n == null || Number.isNaN(n) ? '—' : `${(n * 100).toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} %`

export const entero = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('es-ES'))

/** '2026-11-10' → '10 nov' */
export const diaCorto = (d: string): string => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** La bandera de un país de dos letras (UK → GB) */
export function bandera(codigo: string | null | undefined): string {
  const c = (codigo === 'UK' ? 'GB' : codigo ?? '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

/** El país de los marketplaces de Amazon más comunes de la agencia (para Remesas, que guarda el id del marketplace) */
const PAIS_DE_MARKETPLACE: Record<string, string> = {
  A1RKKUPIHCS9HS: 'ES',
  A1PA6795UKMFR9: 'DE',
  A13V1IB3VIYZZH: 'FR',
  APJ6JRA9NG5V4: 'IT',
  A1F83G8C2ARO7P: 'UK',
  A1805IZSGTT6HS: 'NL',
  A2NODRKZP88ZB9: 'SE',
  A1C3SOZRARQ6R3: 'PL',
  AMEN7PMS3EDWL: 'BE',
  ATVPDKIKX0DER: 'US',
  A2EUQ1WTGCTBG2: 'CA',
  A1AM78C64UM0Y8: 'MX',
}
export const paisDeMarketplace = (id: string | null | undefined): string => (id && PAIS_DE_MARKETPLACE[id]) || ''
