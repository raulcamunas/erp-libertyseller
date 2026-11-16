/**
 * LO QUE SE MIDE DE CÓMO TRABAJA UN CLIENTE (spec remesas-pro §11 D10, D13, D14 y D20). PURO: se prueba con medidas-cliente.prueba.ts.
 * ==================================================================================================================================
 * La lectura de la base (remesas, Receipts del libro por número de envío) la hace el servidor (plan-datos). Aquí:
 *
 *   medirRecepcion    cuánto tarda Amazon en dejar a la venta un envío: del PRIMER Receipt al día en que lleva recibido el
 *                     90 % de lo enviado. p75 de los 6 últimos envíos que llegaron a ese 90 %. Creative Toys: +17, +31,
 *                     +11 y +10 días. (El transporte medido es envío → primer Receipt: no incluye esto.)
 *   medirTransporte   del envío al primer Receipt, mediana de los 6 últimos (ayuda para quien lea los Receipts).
 *   medirCadencia     cada cuánto envía el cliente y cuánto suele mandar: los ajustes lo usan para agrupar y para el
 *                     envío mínimo («medido: cada 9 días, ~110 ud»).
 *   cajaDeducida      la caja de una referencia sacada de las cantidades que ha mandado (90, 180, 270 → 90).
 *   mercadoDeRemesa   en qué mercado se crea una remesa nueva: el de su última remesa enviada y, si no hay, el de la
 *                     región de la conexión. NUNCA el de la lectura elegida (el libro se lee de cualquier país de la cuenta).
 */

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const DIA_MS = 86_400_000
const aMs = (f: string): number => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)
const esFecha = (f: unknown): f is string => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f) && !Number.isNaN(aMs(f))
const diasEntre = (desde: string, hasta: string): number => Math.round((aMs(hasta) - aMs(desde)) / DIA_MS)

function mediana(v: number[]): number | null {
  if (v.length === 0) return null
  const o = [...v].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

/** Percentil con interpolación lineal entre rangos (el de las hojas de cálculo) */
function percentil(v: number[], p: number): number | null {
  if (v.length === 0) return null
  const o = [...v].sort((a, b) => a - b)
  const pos = (o.length - 1) * p
  const i = Math.floor(pos)
  const resto = pos - i
  return i + 1 < o.length ? o[i] + resto * (o[i + 1] - o[i]) : o[i]
}

function mcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) [x, y] = [y, x % y]
  return x
}

/* ------------------------------------------------------------------ */
/* Recepción y transporte                                              */
/* ------------------------------------------------------------------ */

export const MEDIDAS = {
  /** Envíos que se miran (los más recientes) */
  ultimosEnvios: 6,
  /** % de lo enviado que tiene que estar recibido para dar la recepción por hecha */
  pctRecibido: 0.9,
  /** Percentil de la recepción: el p75, prudente sin irse al peor caso */
  percentilRecepcion: 0.75,
  /** Remesas que se miran para la cadencia */
  ultimasRemesasCadencia: 8,
  /** Un intervalo mayor que esto × la mediana es una pausa (verano, cierre), no la cadencia */
  intervaloAtipico: 3,
  /** Caja mínima que se cree */
  cajaMinima: 6,
  /** Caja máxima (la de fba_reposicion_sku) */
  cajaMaxima: 500,
} as const

export interface EnvioParaRecepcion {
  enviadas: number
  /** Receipts del libro con referencia = número del envío */
  receipts: Array<{ fecha: string; cantidad: number }>
}

/**
 * Días del primer Receipt al día en que lo recibido llega al 90 % de lo enviado; p75 de los 6 últimos envíos que llegaron
 * a ese 90 % (los más recientes por su primer Receipt). Solo cuenta lo recibido hasta `hoy`. null si no hay ninguno.
 * Los envíos que nunca llegan al 90 % (faltantes) no dicen cuánto tarda Amazon en recibir y no se miden.
 */
export function medirRecepcion(envios: EnvioParaRecepcion[], hoy: string): number | null {
  const medidos: Array<{ primero: string; dias: number }> = []
  for (const e of envios) {
    const enviadas = Number(e.enviadas)
    if (!(enviadas > 0)) continue
    const recibos = (e.receipts ?? [])
      .filter((r) => esFecha(r.fecha) && r.fecha.slice(0, 10) <= hoy && Number(r.cantidad) > 0)
      .map((r) => ({ fecha: r.fecha.slice(0, 10), cantidad: Number(r.cantidad) }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    if (recibos.length === 0) continue
    const objetivo = enviadas * MEDIDAS.pctRecibido
    let acumulado = 0
    for (const r of recibos) {
      acumulado += r.cantidad
      if (acumulado >= objetivo - 1e-9) {
        medidos.push({ primero: recibos[0].fecha, dias: Math.max(0, diasEntre(recibos[0].fecha, r.fecha)) })
        break
      }
    }
  }
  const ultimos = medidos.sort((a, b) => b.primero.localeCompare(a.primero)).slice(0, MEDIDAS.ultimosEnvios).map((m) => m.dias)
  const p = percentil(ultimos, MEDIDAS.percentilRecepcion)
  return p === null ? null : Math.round(p)
}

/**
 * Transporte medido: del día de envío al primer Receipt, mediana de los 6 envíos más recientes que ya tienen alguno.
 * Se descartan los negativos (una fecha de envío corregida a mano). null si no hay ninguno.
 */
export function medirTransporte(envios: Array<{ fechaEnvio: string | null; primerReceipt: string | null }>): number | null {
  const dias = envios
    .filter((e): e is { fechaEnvio: string; primerReceipt: string } => esFecha(e.fechaEnvio) && esFecha(e.primerReceipt))
    .sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio))
    .map((e) => diasEntre(e.fechaEnvio, e.primerReceipt))
    .filter((d) => d >= 0)
    .slice(0, MEDIDAS.ultimosEnvios)
  const m = mediana(dias)
  return m === null ? null : Math.round(m)
}

/* ------------------------------------------------------------------ */
/* Cadencia                                                            */
/* ------------------------------------------------------------------ */

/**
 * Cada cuánto envía el cliente y cuánto suele mandar, con sus últimas 8 remesas enviadas.
 *
 *   · Las remesas del mismo día son UN envío: Amazon parte un envío en varios números por almacén de destino.
 *   · Días entre envíos: la media de los intervalos sin las pausas (intervalos > 3 × la mediana: el verano o un cierre
 *     no son la cadencia). Se usa la media y no la mediana porque con 3-7 intervalos la mediana salta al valor de un
 *     solo intervalo (6, 21, 29 oct y 13 nov: intervalos 15, 8 y 15 → mediana 15 aunque envía cada ~13).
 *   · Tamaño típico: la mediana de unidades por envío.
 *
 * Con un solo envío no hay cadencia (null) pero sí tamaño.
 */
export function medirCadencia(remesas: Array<{ fechaEnvio: string; unidades: number }>): { cadenciaDias: number | null; tamanoTipico: number | null } {
  const porDia = new Map<string, number>()
  for (const r of remesas) {
    if (!esFecha(r.fechaEnvio)) continue
    const u = Number(r.unidades)
    const d = r.fechaEnvio.slice(0, 10)
    porDia.set(d, (porDia.get(d) ?? 0) + (Number.isFinite(u) && u > 0 ? u : 0))
  }
  const envios = [...porDia.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, MEDIDAS.ultimasRemesasCadencia)
    .reverse()
  if (envios.length === 0) return { cadenciaDias: null, tamanoTipico: null }

  const conUnidades = envios.map(([, u]) => u).filter((u) => u > 0)
  const tam = mediana(conUnidades)
  const tamanoTipico = tam === null ? null : Math.round(tam)

  const intervalos: number[] = []
  for (let i = 1; i < envios.length; i++) intervalos.push(diasEntre(envios[i - 1][0], envios[i][0]))
  const med = mediana(intervalos)
  if (med === null || med <= 0) return { cadenciaDias: null, tamanoTipico }
  const normales = intervalos.filter((d) => d <= MEDIDAS.intervaloAtipico * med)
  const media = normales.reduce((s, d) => s + d, 0) / normales.length
  return { cadenciaDias: Math.round(media), tamanoTipico }
}

/* ------------------------------------------------------------------ */
/* Caja deducida                                                       */
/* ------------------------------------------------------------------ */

/**
 * La caja de una referencia sacada de las cantidades que ha mandado en sus últimas remesas.
 *
 *   · Si el encaje dice cuántas van por caja, esa (es un dato, no una deducción).
 *   · Si no, el mayor divisor común ≥ 6 que se repite: divide al menos a 2 envíos y al 80 % o más de ellos, y no pasa de la
 *     menor cantidad enviada (un envío de 15 demuestra que no hay caja de 49: si no, se toma por caja el tamaño de un envío).
 *     Gana el que divide a más envíos y, a igualdad, el mayor. En la duda, null (se redondea a 1 con el «~»).
 *     90, 180, 270 → 90 · 18, 36 → 18 · 7, 11 → null · 49, 98, 15, 34 → null · 25, 162, 25, 50, 100, 74 → null.
 *   · Una sola cantidad no dice nada (podría ser cualquier cosa): null.
 */
export function cajaDeducida(cantidades: number[], cajaEncaje?: number | null): number | null {
  if (cajaEncaje !== null && cajaEncaje !== undefined && Number.isInteger(cajaEncaje) && cajaEncaje >= 1 && cajaEncaje <= MEDIDAS.cajaMaxima) return cajaEncaje

  const qs = cantidades.map((c) => Math.round(Number(c))).filter((c) => Number.isFinite(c) && c > 0)
  if (qs.length < 2) return null
  const minimoQueDivide = Math.max(2, Math.ceil(qs.length * 0.8))
  const menor = Math.min(...qs)

  // Candidatos: los divisores ≥ 6 de los MCD de cada pareja (así sale 6 aunque ninguna pareja tenga MCD 6 exacto)
  const candidatos = new Set<number>()
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      const g = mcd(qs[i], qs[j])
      if (g < MEDIDAS.cajaMinima) continue
      for (let d = MEDIDAS.cajaMinima; d <= Math.min(g, MEDIDAS.cajaMaxima); d++) if (g % d === 0) candidatos.add(d)
    }
  }

  let mejor: { caja: number; divide: number } | null = null
  for (const caja of candidatos) {
    const divide = qs.filter((q) => q % caja === 0).length
    if (divide < minimoQueDivide || caja > menor) continue
    if (!mejor || divide > mejor.divide || (divide === mejor.divide && caja > mejor.caja)) mejor = { caja, divide }
  }
  return mejor?.caja ?? null
}

/* ------------------------------------------------------------------ */
/* Mercado de una remesa nueva                                         */
/* ------------------------------------------------------------------ */

export const MERCADO_POR_REGION: Record<'eu' | 'na' | 'fe', string> = {
  eu: 'A1RKKUPIHCS9HS', // España
  na: 'ATVPDKIKX0DER', // Estados Unidos
  fe: 'A1VC38T7YXB528', // Japón
}

/**
 * El mercado con el que se crea una remesa: el de la última remesa enviada o cerrada del cliente; si no tiene, el de la
 * región de su conexión (UE → España, NA → Estados Unidos). Sin nada, España.
 */
export function mercadoDeRemesa(ultimaEnviada: string | null, region: 'eu' | 'na' | 'fe' | null): string {
  const u = typeof ultimaEnviada === 'string' ? ultimaEnviada.trim() : ''
  if (u) return u
  return MERCADO_POR_REGION[region ?? 'eu'] ?? MERCADO_POR_REGION.eu
}
