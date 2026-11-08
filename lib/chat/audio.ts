/**
 * EL AUDIO DE LAS JUNTAS — PURO. Lo que cada persona decide para ella y se guarda en su navegador: si se limpia su micrófono (supresión de ruido, eco y nivelación automática), qué micrófono
 * y qué altavoz usa, y cuánto oye a cada persona (el volumen de cada una; 0 = silenciada solo para ella). Nada de esto lo ven los demás. Se comprueba en audio.prueba.ts.
 */

export interface AjustesDeAudio {
  /** Quita el ruido de fondo (teclado, ventilador…) */
  supresion: boolean
  /** Evita que tu voz vuelva por los altavoces */
  eco: boolean
  /** Sube o baja tu micrófono solo para que se te oiga siempre parecido */
  nivelacion: boolean
  /** El micrófono elegido (vacío = el del sistema) */
  entrada: string
  /** El altavoz elegido (vacío = el del sistema) */
  salida: string
}

export const AJUSTES_DE_AUDIO_POR_DEFECTO: AjustesDeAudio = { supresion: true, eco: true, nivelacion: true, entrada: '', salida: '' }
export const CLAVE_DE_AUDIO = 'chat:audio'
export const CLAVE_DE_VOLUMENES = 'chat:volumenes'

const texto = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 200) : '')
const logico = (v: unknown, porDefecto: boolean): boolean => (typeof v === 'boolean' ? v : porDefecto)

/** Lo leído del almacenamiento, limpio: lo que falte o esté roto vuelve al valor de siempre */
export function limpiarAjustesDeAudio(bruto: unknown): AjustesDeAudio {
  const d = AJUSTES_DE_AUDIO_POR_DEFECTO
  if (!bruto || typeof bruto !== 'object') return { ...d }
  const b = bruto as Record<string, unknown>
  return { supresion: logico(b.supresion, d.supresion), eco: logico(b.eco, d.eco), nivelacion: logico(b.nivelacion, d.nivelacion), entrada: texto(b.entrada), salida: texto(b.salida) }
}

export function leerAjustesDeAudio(texto: string | null | undefined): AjustesDeAudio {
  if (!texto) return { ...AJUSTES_DE_AUDIO_POR_DEFECTO }
  try {
    return limpiarAjustesDeAudio(JSON.parse(texto))
  } catch {
    return { ...AJUSTES_DE_AUDIO_POR_DEFECTO }
  }
}

/** Las restricciones que se le piden al micrófono del navegador */
export const restriccionesDeMicro = (a: AjustesDeAudio) => ({ noiseSuppression: a.supresion, echoCancellation: a.eco, autoGainControl: a.nivelacion, ...(a.entrada ? { deviceId: a.entrada } : {}) })

/** Volumen de cada persona (su id → de 0 a 1). Lo no guardado se oye a tope */
export type Volumenes = Record<string, number>

export const limitarVolumen = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)

export function limpiarVolumenes(bruto: unknown): Volumenes {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {}
  const r: Volumenes = {}
  for (const [id, v] of Object.entries(bruto as Record<string, unknown>)) if (id.length <= 64 && typeof v === 'number') r[id] = limitarVolumen(v)
  return r
}

export function leerVolumenes(texto: string | null | undefined): Volumenes {
  if (!texto) return {}
  try {
    return limpiarVolumenes(JSON.parse(texto))
  } catch {
    return {}
  }
}

/** El volumen con el que se oye a esa persona: el suyo, o 0 si estás ensordecido (no oyes a nadie) */
export const volumenEfectivo = (volumenes: Volumenes, id: string, ensordecido: boolean): number => (ensordecido ? 0 : limitarVolumen(volumenes[id] ?? 1))
