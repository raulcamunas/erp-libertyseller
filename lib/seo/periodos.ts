/**
 * SEO · LOS PERIODOS DEL INFORME DE BRAND ANALYTICS. PURO.
 *
 * El informe «Search Query Performance» de Amazon se pide por SEMANA (de domingo a sábado, obligatorio) o por MES (natural). Siempre el último periodo COMPLETO: Amazon no da la semana en curso.
 * Además, Amazon tarda un par de días en publicar los datos: la semana que acabó ayer todavía no está. Se deja un margen de 3 días.
 */

export type PeriodoSqp = 'WEEK' | 'MONTH'

export interface RangoSqp {
  periodo: PeriodoSqp
  desde: string
  hasta: string
}

const dia = (t: number) => new Date(t).toISOString().slice(0, 10)
const DIA = 86_400_000
/** Lo que tarda Amazon en publicar un periodo cerrado */
export const MARGEN_DE_PUBLICACION_DIAS = 3

/** La última semana completa (domingo a sábado) que Amazon ya ha publicado, para `hoy` = 'YYYY-MM-DD' */
export function ultimaSemana(hoy: string): RangoSqp {
  const t = Date.parse(`${hoy}T00:00:00Z`) - MARGEN_DE_PUBLICACION_DIAS * DIA
  const d = new Date(t)
  // El sábado más reciente que sea ≤ t (getUTCDay: 0 = domingo … 6 = sábado)
  const sabado = t - ((d.getUTCDay() + 1) % 7) * DIA
  return { periodo: 'WEEK', desde: dia(sabado - 6 * DIA), hasta: dia(sabado) }
}

/** El último mes natural completo que Amazon ya ha publicado */
export function ultimoMes(hoy: string): RangoSqp {
  const t = new Date(Date.parse(`${hoy}T00:00:00Z`) - MARGEN_DE_PUBLICACION_DIAS * DIA)
  const primeroDeEsteMes = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)
  const ultimoDelAnterior = primeroDeEsteMes - DIA
  const a = new Date(ultimoDelAnterior)
  return { periodo: 'MONTH', desde: dia(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)), hasta: dia(ultimoDelAnterior) }
}

/**
 * Parte una lista de ASIN en tandas que quepan en una petición: Amazon admite los ASIN separados por espacios con un máximo de 200 caracteres (un ASIN son 10, así que caben 18).
 */
export function tandasDeAsins(asins: readonly string[], maxCaracteres = 200): string[][] {
  const limpios = [...new Set(asins.map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z0-9]{10}$/.test(a)))]
  const tandas: string[][] = []
  let actual: string[] = []
  for (const a of limpios) {
    const largo = [...actual, a].join(' ').length
    if (largo > maxCaracteres && actual.length > 0) {
      tandas.push(actual)
      actual = []
    }
    actual.push(a)
  }
  if (actual.length > 0) tandas.push(actual)
  return tandas
}
