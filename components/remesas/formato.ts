/**
 * FORMATOS DE REMESAS A FBA (puro: sin React ni navegador; se prueba con comun/piezas.prueba.ts).
 *
 * API
 *   fecha(iso)                    «03/12/26», o «—» sin fecha (la de siempre, la usan las pantallas viejas)
 *   colorDeCobertura(dias)        clase de texto: rojo ≤ 14 d, ámbar ≤ 30 d, verde con margen, gris sin dato
 *   fechaCorta(iso, hoy?)         «3 dic»; con `hoy` de otro año, «3 dic 2025»
 *   sumarDias(iso, n) / diasEntre(desde, hasta)   aritmética de días en UTC (sin husos ni horario de verano)
 *   entero(n)                     «1.900» (con punto de miles también en 4 cifras, que es-ES no pone)
 *   decimal(n, dec)               «2,1»
 *   dias(n)                       «1 día», «12 días», «—»
 *   unidades(n)                   «412 ud»
 *   ritmo(n)                      «2,1 ud/día» (dos decimales por debajo de 1: «0,35 ud/día»)
 *   simboloDe(moneda)             «€», «$», «£»…
 *   dinero(n, moneda?, dec?)      «1.900 €», «1.200 $», «—» con null
 *   dineroPorMoneda(lista)        «8.420 € + 1.200 $» (sin convertir, D34)
 *   porcentaje(n, dec?)           «13,6 %» (n en tanto por ciento, no en proporción)
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** dd/mm/aa, o un guion si no hay fecha */
export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

/** Verde con margen, ámbar cuando aprieta, rojo cuando ya no da tiempo (clases con los tokens de estado: siguen al tema) */
export function colorDeCobertura(diasCubiertos: number | null): string {
  if (diasCubiertos === null) return 'text-[var(--ls-t4)]'
  if (diasCubiertos <= 14) return 'text-[var(--ls-e-rojo)]'
  if (diasCubiertos <= 30) return 'text-[var(--ls-e-ambar)]'
  return 'text-[var(--ls-e-verde)]'
}

/** «3 dic». Si se da `hoy` y la fecha es de otro año, «3 dic 2025» */
export function fechaCorta(iso: string | null | undefined, hoy?: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—'
  const a = iso.slice(0, 4)
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  const base = `${d} ${MESES[m - 1] ?? '?'}`
  return hoy && hoy.slice(0, 4) !== a ? `${base} ${a}` : base
}

const aUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

/** El día `n` días después (o antes, con n negativo), en YYYY-MM-DD */
export function sumarDias(iso: string, n: number): string {
  return new Date(aUtc(iso) + Math.round(n) * 86_400_000).toISOString().slice(0, 10)
}

/** Días de `desde` a `hasta` (negativo si `hasta` va antes) */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86_400_000)
}

const miles = (t: string) => t.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** Entero con punto de miles siempre: «1.900», «12», «-3.400» */
export function entero(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const r = Math.round(n)
  return (r < 0 ? '-' : '') + miles(String(Math.abs(r)))
}

/** Decimal con coma y miles con punto, sin ceros de sobra: «2,1», «1.234,5», «3» */
export function decimal(n: number | null | undefined, decimales = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const f = Math.pow(10, decimales)
  const r = Math.round(n * f) / f
  const [ent, dec] = Math.abs(r).toFixed(decimales).split('.')
  const limpio = dec ? dec.replace(/0+$/, '') : ''
  return (r < 0 ? '-' : '') + miles(ent) + (limpio ? `,${limpio}` : '')
}

export function dias(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const r = Math.round(n)
  return `${entero(r)} ${Math.abs(r) === 1 ? 'día' : 'días'}`
}

export function unidades(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${entero(n)} ud`
}

export function ritmo(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${decimal(n, Math.abs(n) < 1 ? 2 : 1)} ud/día`
}

const SIMBOLOS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', SEK: 'kr', PLN: 'zł', CAD: 'CA$', MXN: 'MX$', TRY: '₺', JPY: '¥', AUD: 'A$' }

export function simboloDe(moneda: string | null | undefined): string {
  if (!moneda) return '€'
  return SIMBOLOS[moneda.toUpperCase()] ?? moneda.toUpperCase()
}

/** «1.900 €», «1.200 $»; con decimales, «34,90 €» (los céntimos siempre a dos cifras) */
export function dinero(n: number | null | undefined, moneda: string | null = 'EUR', decimales = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (decimales === 0) return `${entero(n)} ${simboloDe(moneda)}`
  const [ent, dec] = Math.abs(n).toFixed(decimales).split('.')
  return `${n < 0 ? '-' : ''}${miles(ent)},${dec} ${simboloDe(moneda)}`
}

/** Totales en varias monedas, sin convertir: «8.420 € + 1.200 $». Las de total 0 no salen; sin nada, «0 €» */
export function dineroPorMoneda(lista: ReadonlyArray<{ moneda: string; total: number }>): string {
  const conAlgo = lista.filter((x) => Number.isFinite(x.total) && Math.round(x.total) !== 0)
  if (conAlgo.length === 0) return dinero(0, lista[0]?.moneda ?? 'EUR')
  return conAlgo.map((x) => dinero(x.total, x.moneda)).join(' + ')
}

/** n en tanto por ciento: porcentaje(13.6) → «13,6 %» */
export function porcentaje(n: number | null | undefined, decimales = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${decimal(n, decimales)} %`
}
