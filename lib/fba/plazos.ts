/**
 * EL PLAZO DE REPOSICIÓN POR ETAPAS — PURO (se comprueba con plazos.prueba.ts). La lectura y escritura están en app/api/fba/alertas/config.
 * ====================================================================================================================================
 * Desde que se AVISA al cliente de que hay que reponer hasta que la mercancía está A LA VENTA en Amazon pasan cuatro cosas, y cada cliente las tiene distintas:
 *
 *   preparación   el cliente prepara, etiqueta y envía (desde que se le avisa)
 *   transporte    del envío al almacén de Amazon
 *   recepción     Amazon lo procesa (check-in, recepción) hasta que se puede vender
 *   margen        colchón para retrasos
 *
 * La suma es el plazo con el que calculan las alertas de «reponer ya / pronto» (lib/fba/alertas.ts): un cliente que tarda 3 semanas en enviar no puede avisarse igual que uno que
 * envía en 3 días. Aquí no se calcula nada de Amazon: lo MEDIDO que se enseña al lado de cada etapa sale de los envíos que ya hay en el ERP, solo como pista para rellenarlas.
 */

export interface EtapasDePlazo {
  preparacion: number
  transporte: number
  recepcion: number
  margen: number
}

export const CLAVES_DE_ETAPA: ReadonlyArray<keyof EtapasDePlazo> = ['preparacion', 'transporte', 'recepcion', 'margen']

/** Con el plazo de partida de 45 días de las alertas (lib/fba/alertas.ts) */
export const ETAPAS_DE_PARTIDA: EtapasDePlazo = { preparacion: 10, transporte: 18, recepcion: 7, margen: 10 }

export const MAX_DIAS_DE_ETAPA = 365

export const totalDeEtapas = (e: EtapasDePlazo): number => e.preparacion + e.transporte + e.recepcion + e.margen

/** Un número de días entero entre 0 y 365. null si no lo es (texto, negativo, decimales, vacío) */
export function diasValidos(v: unknown): number | null {
  if (typeof v === 'string' && v.trim() === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
  return Number.isInteger(n) && n >= 0 && n <= MAX_DIAS_DE_ETAPA ? n : null
}

/** Las cuatro etapas, o null si falta alguna o no es válida. El total tiene que quedar entre 1 y 365 (el plazo de las alertas) */
export function etapasValidas(v: unknown): EtapasDePlazo | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const e: Partial<EtapasDePlazo> = {}
  for (const k of CLAVES_DE_ETAPA) {
    const d = diasValidos(o[k])
    if (d === null) return null
    e[k] = d
  }
  const etapas = e as EtapasDePlazo
  const total = totalDeEtapas(etapas)
  return total >= 1 && total <= MAX_DIAS_DE_ETAPA ? etapas : null
}

/**
 * Un cliente que solo tiene el total (45 días) abre el panel con las etapas ya repartidas en la proporción de las de partida, para que sumen lo mismo y no cambie nada hasta que se toque.
 * El resto del redondeo va a la última (margen).
 */
export function repartirTotal(total: number): EtapasDePlazo {
  const t = Math.max(1, Math.min(MAX_DIAS_DE_ETAPA, Math.round(total)))
  const base = totalDeEtapas(ETAPAS_DE_PARTIDA)
  const preparacion = Math.round((t * ETAPAS_DE_PARTIDA.preparacion) / base)
  const transporte = Math.round((t * ETAPAS_DE_PARTIDA.transporte) / base)
  const recepcion = Math.round((t * ETAPAS_DE_PARTIDA.recepcion) / base)
  return { preparacion, transporte, recepcion, margen: Math.max(0, t - preparacion - transporte - recepcion) }
}

/** El día en que estaría a la venta lo que se pide hoy (YYYY-MM-DD, en UTC: son días, no horas) */
export function diaALaVenta(hoy: string, plazo: number): string {
  const d = new Date(`${hoy}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + plazo)
  return d.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* Lo medido en los envíos que ya hay                                  */
/* ------------------------------------------------------------------ */

export interface Medida {
  /** Media en días, redondeada */
  dias: number
  /** Con cuántos envíos se ha calculado */
  envios: number
}

export interface RemesaParaMedir {
  /** Cuándo se aprobó la propuesta (null = no pasó por propuesta: es un envío traído de Amazon) */
  aprobadaAt: string | null
  /** 'YYYY-MM-DD' */
  fechaEnvio: string
  /** Cuándo confirmó Amazon la llegada, si la ha confirmado */
  llegadaAt: string | null
}

const dia = (iso: string): string => iso.slice(0, 10)
const entreDias = (a: string, b: string): number => Math.round((Date.parse(`${dia(b)}T00:00:00Z`) - Date.parse(`${dia(a)}T00:00:00Z`)) / 86_400_000)

const media = (valores: number[]): Medida | null => (valores.length === 0 ? null : { dias: Math.round(valores.reduce((s, v) => s + v, 0) / valores.length), envios: valores.length })

/**
 * Lo que han tardado de verdad los últimos `ultimos` envíos del cliente:
 *   · `preparacion`: de que se aprobó la propuesta a que salió el envío (solo los que pasaron por propuesta),
 *   · `envioALlegada`: del envío a la llegada confirmada por Amazon (transporte y recepción JUNTOS: no se pueden separar con lo que se guarda).
 * Se descartan los valores absurdos (negativos: una fecha corregida a mano) y se miran los más recientes, que son los que reflejan cómo se trabaja hoy.
 */
export function medirPlazos(remesas: readonly RemesaParaMedir[], ultimos = 6): { preparacion: Medida | null; envioALlegada: Medida | null } {
  const recientes = [...remesas].sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio))
  const preparacion = recientes
    .filter((r) => r.aprobadaAt)
    .slice(0, ultimos)
    .map((r) => entreDias(r.aprobadaAt as string, r.fechaEnvio))
    .filter((d) => d >= 0)
  const envioALlegada = recientes
    .filter((r) => r.llegadaAt)
    .slice(0, ultimos)
    .map((r) => entreDias(r.fechaEnvio, r.llegadaAt as string))
    .filter((d) => d >= 0)
  return { preparacion: media(preparacion), envioALlegada: media(envioALlegada) }
}
