import type { TipoDeCanal } from './tipos'

/**
 * A QUIÉN SE AVISA DE UN MENSAJE — PURO. La decisión de cada persona de un canal: ¿le llega algo a la campana (y al móvil)? y ¿qué? Se comprueba en avisos.prueba.ts.
 *
 *   · Cada persona elige por canal: `todo` (cada mensaje), `menciones` (solo si la nombran, le responden o hay movimiento en un hilo suyo) o `nada`.
 *   · Sin elegir: en un directo, todo; en un canal, menciones. Un canal que alguien silenció antes de existir esta opción cuenta como `nada`.
 */

export type NivelDeAvisos = 'todo' | 'menciones' | 'nada'
export const NIVELES: readonly NivelDeAvisos[] = ['todo', 'menciones', 'nada']
export const esNivel = (v: unknown): v is NivelDeAvisos => typeof v === 'string' && (NIVELES as readonly string[]).includes(v)

export function nivelDe(miembro: { avisos?: string | null; silenciado?: boolean }, tipo: TipoDeCanal): NivelDeAvisos {
  if (esNivel(miembro.avisos)) return miembro.avisos
  if (miembro.silenciado) return 'nada'
  return tipo === 'directo' ? 'todo' : 'menciones'
}

export type MotivoDeAviso = 'mencion' | 'respuesta' | 'hilo' | 'directo' | 'canal'

export interface EntradaDeAviso {
  tipoDeCanal: TipoDeCanal
  /** El mensaje es la respuesta de un hilo */
  esDeHilo: boolean
  /** Esta persona está en el hilo (escribió el mensaje de arriba o ya ha respondido) */
  estaEnElHilo: boolean
  /** El mensaje la nombra (o nombra a todos) */
  mencionada: boolean
  /** El mensaje cita uno suyo */
  citada: boolean
  nivel: NivelDeAvisos
}

/** El motivo por el que se le avisa, o null si no se le avisa */
export function motivoDeAviso(e: EntradaDeAviso): MotivoDeAviso | null {
  if (e.nivel === 'nada') return null
  if (e.mencionada) return 'mencion'
  if (e.citada && e.tipoDeCanal !== 'directo') return 'respuesta'
  if (e.esDeHilo && e.estaEnElHilo) return 'hilo'
  if (e.nivel === 'todo') return e.tipoDeCanal === 'directo' ? 'directo' : 'canal'
  return null
}
