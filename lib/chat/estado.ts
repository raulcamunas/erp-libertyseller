import { finDeLaSemana, finDelDia } from './tiempo'

/**
 * EL ESTADO DE CADA PERSONA («En reunión», «De vacaciones»…) — PURO.
 */

export interface EstadoChat {
  emoji: string
  texto: string
  /** Cuándo se quita solo (ISO) o null si dura hasta que lo quite quien lo puso */
  hasta: string | null
}

export type Duracion = '30min' | '1h' | '4h' | 'hoy' | 'semana' | 'siempre'

export const DURACIONES: ReadonlyArray<{ id: Duracion; nombre: string }> = [
  { id: '30min', nombre: '30 minutos' },
  { id: '1h', nombre: '1 hora' },
  { id: '4h', nombre: '4 horas' },
  { id: 'hoy', nombre: 'Hasta hoy' },
  { id: 'semana', nombre: 'Esta semana' },
  { id: 'siempre', nombre: 'No borrar' },
]

export const ESTADOS_RAPIDOS: ReadonlyArray<{ emoji: string; texto: string; duracion: Duracion }> = [
  { emoji: '📅', texto: 'En reunión', duracion: '1h' },
  { emoji: '🍽️', texto: 'Comiendo', duracion: '1h' },
  { emoji: '🎧', texto: 'Concentrado', duracion: '4h' },
  { emoji: '🏠', texto: 'Trabajando desde casa', duracion: 'hoy' },
  { emoji: '🤒', texto: 'Enfermo', duracion: 'hoy' },
  { emoji: '🌴', texto: 'De vacaciones', duracion: 'siempre' },
]

/** Cuándo caduca un estado puesto ahora con esa duración (ISO) o null si no caduca */
export function caducidad(duracion: Duracion, ahora: number): string | null {
  switch (duracion) {
    case '30min':
      return new Date(ahora + 30 * 60_000).toISOString()
    case '1h':
      return new Date(ahora + 3_600_000).toISOString()
    case '4h':
      return new Date(ahora + 4 * 3_600_000).toISOString()
    case 'hoy':
      return new Date(finDelDia(ahora)).toISOString()
    case 'semana':
      return new Date(finDeLaSemana(ahora)).toISOString()
    case 'siempre':
      return null
  }
}

/** Un estado que ya ha caducado no se enseña */
export const estaVigente = (e: Pick<EstadoChat, 'hasta'> | null | undefined, ahora: number = Date.now()): boolean => Boolean(e) && (e!.hasta === null || Date.parse(e!.hasta) > ahora)

/** Lo que llega de la pantalla, limpio. null si no hay nada que guardar (sin emoji ni texto) */
export function limpiarEstado(emoji: unknown, texto: unknown, duracion: unknown, ahora: number): EstadoChat | null {
  const e = typeof emoji === 'string' ? Array.from(emoji.trim()).slice(0, 4).join('') : ''
  const t = typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  if (!e && !t) return null
  const d = DURACIONES.some((x) => x.id === duracion) ? (duracion as Duracion) : 'siempre'
  return { emoji: e, texto: t, hasta: caducidad(d, ahora) }
}
