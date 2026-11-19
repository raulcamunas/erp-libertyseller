/**
 * LOS TIPOS DE CAMBIO (euros por cada moneda) para enseñar en EUROS lo interno que viene en otra moneda (p. ej. la facturación en dólares de los vendedores
 * de Amazon México). SOLO SERVIDOR. Fuente: el Banco Central Europeo a través de la API pública de Frankfurter (sin clave, sin datos nuestros). Se guarda
 * 12 horas en memoria; si no contesta, se usa lo último que se tuvo o, la primera vez, unos valores de respaldo aproximados.
 */
export interface TiposDeCambio {
  /** Cuántas unidades de cada moneda vale 1 € (como lo da el BCE): USD 1,0992 = 1 € son 1,0992 $ */
  porEuro: Record<string, number>
  fecha: string
  respaldo: boolean
}

const RESPALDO: TiposDeCambio = { porEuro: { EUR: 1, USD: 1.1, MXN: 20.8 }, fecha: '2026-11-19', respaldo: true }
let guardado: { t: TiposDeCambio; en: number } | null = null

export async function tiposDeCambio(): Promise<TiposDeCambio> {
  if (guardado && Date.now() - guardado.en < 12 * 3_600_000) return guardado.t
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,MXN,GBP', { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    const j = (await r.json()) as { date?: string; rates?: Record<string, number> }
    if (!r.ok || !j.rates?.USD) throw new Error('sin datos')
    const t: TiposDeCambio = { porEuro: { EUR: 1, ...j.rates }, fecha: j.date ?? '', respaldo: false }
    guardado = { t, en: Date.now() }
    return t
  } catch {
    return guardado?.t ?? RESPALDO
  }
}
