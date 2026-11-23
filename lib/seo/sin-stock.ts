/**
 * SEO · LOS DÍAS SIN VENTAS DE UN PRODUCTO (probable rotura de stock). PURO: se prueba con lib/seo/sin-stock.prueba.ts.
 *
 * Lo pidió Raúl (23 nov 2026): si la cuota de compras de un producto se hunde, el ERP tiene que mirar SOLO el inventario del cliente y decir «del 7 al 22 de octubre
 * no hubo stock», en vez de mandar a alguien a preguntarlo. La fuente es el libro mayor de FBA (fba_movimientos, el mismo que usan Remesas): las salidas a
 * cliente (Shipments) de cada día y las recepciones (Receipts).
 *
 * LA REGLA. Un tramo de días seguidos con 0 ventas es una rotura probable cuando, al ritmo al que vendía el producto los 28 días de antes, quedarse a 0 tantos
 * días no puede ser casualidad: ritmo × días ≥ 4 (en un Poisson, menos de un 2 % de probabilidad) y al menos 3 días. Un producto que vende 10 al día y se queda
 * 2 días a 0 ya es raro, pero con 3 días de mínimo se evitan los fines de semana flojos. Si al acabar el tramo (o dentro) entra mercancía, se dice: es lo que
 * lo confirma.
 *
 * Lo que NO afirma: un tramo que llega hasta el último día leído del libro mayor no se cuenta (puede ser que todavía no se ha leído), y sin ventas en los 28
 * días de antes no hay ritmo con el que comparar.
 */

export interface TramoSinVentas {
  desde: string
  hasta: string
  dias: number
  /** Ventas al día de los 28 días de antes */
  ritmoAntes: number
  /** Unidades recibidas dentro del tramo o en los 3 días siguientes (la reposición que lo cierra) */
  entrada: number
}

const DIA = 86_400_000
export const RITMO_DIAS = 28
export const DIAS_MINIMOS = 3
export const ESPERADAS_MINIMAS = 4

const sumar = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10)

/**
 * Los tramos sin ventas entre `desde` y `leidoHasta` (inclusive). `ventas` y `entradas`: unidades por día (AAAA-MM-DD); un día que no está es 0.
 * `desde` debe dejar al menos 28 días por delante del periodo que interesa, para tener el ritmo.
 */
export function tramosSinVentas(ventas: Readonly<Record<string, number>>, entradas: Readonly<Record<string, number>>, desde: string, leidoHasta: string): TramoSinVentas[] {
  const dias: string[] = []
  for (let d = desde; d <= leidoHasta; d = sumar(d, 1)) dias.push(d)
  const v = (d: string) => Math.max(0, ventas[d] ?? 0)
  const salida: TramoSinVentas[] = []
  let i = 0
  while (i < dias.length) {
    if (v(dias[i]) > 0) {
      i++
      continue
    }
    let j = i
    while (j + 1 < dias.length && v(dias[j + 1]) === 0) j++
    // Llega al último día leído: puede ser que aún no se haya leído, no se afirma nada
    const abierto = j === dias.length - 1
    const previos = dias.slice(Math.max(0, i - RITMO_DIAS), i)
    if (!abierto && previos.length >= 14) {
      const ritmo = previos.reduce((s, d) => s + v(d), 0) / previos.length
      const n = j - i + 1
      if (n >= DIAS_MINIMOS && ritmo * n >= ESPERADAS_MINIMAS) {
        let entrada = 0
        for (let k = i; k <= Math.min(j + 3, dias.length - 1); k++) entrada += Math.max(0, entradas[dias[k]] ?? 0)
        salida.push({ desde: dias[i], hasta: dias[j], dias: n, ritmoAntes: Math.round(ritmo * 10) / 10, entrada })
      }
    }
    i = j + 1
  }
  return salida
}

/** Los días de los tramos que caen dentro de [desde, hasta] y el tramo más largo que lo toca */
export function sinVentasEnPeriodo(tramos: readonly TramoSinVentas[], desde: string, hasta: string): { dias: number; tramos: TramoSinVentas[] } {
  const dentro = tramos.filter((t) => t.hasta >= desde && t.desde <= hasta)
  let dias = 0
  for (const t of dentro) {
    const a = t.desde > desde ? t.desde : desde
    const b = t.hasta < hasta ? t.hasta : hasta
    dias += Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA) + 1
  }
  return { dias, tramos: dentro }
}

const fechaCorta = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const ent = (x: number) => Math.round(x).toLocaleString('es-ES')

/** «Del 7 al 22 de octubre (16 días) no se vendió ninguna unidad, cuando vendía 9,6 al día; el 21 entraron 1.004 uds.» */
export function frasesSinVentas(tramos: readonly TramoSinVentas[]): string {
  return tramos
    .map((t) => {
      const rango = t.desde === t.hasta ? `El ${fechaCorta(t.desde)}` : `Del ${fechaCorta(t.desde).replace(/ de [a-z]+$/, t.desde.slice(0, 7) === t.hasta.slice(0, 7) ? '' : '$&')} al ${fechaCorta(t.hasta)}`
      const ritmo = t.ritmoAntes.toLocaleString('es-ES', { maximumFractionDigits: 1 })
      return `${rango} (${t.dias} días) no se vendió ninguna unidad, cuando vendía ${ritmo} al día${t.entrada > 0 ? ` y después entraron ${ent(t.entrada)} uds en FBA` : ''}.`
    })
    .join(' ')
}
