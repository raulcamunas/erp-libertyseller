import type { Aviso } from './pila'

/**
 * LOS AVISOS DE EQUIPO: lo que un compañero hace y se celebra delante de todos.
 * =============================================================================
 * Llegan por el canal en tiempo real de la tabla `avisos_equipo` (migración 238), que rellenan dos disparadores:
 *
 *   · `hito_llamadas`  alguien ha llegado a 20, 40, 60, 80 o 100 llamadas HOY. Cuenta lo mismo que «llamadas hechas» de Mi rendimiento: CLIENTES distintos a los
 *                      que ha llamado hoy (varios intentos al mismo cliente son una llamada; migración 252).
 *   · `cita_agendada`  alguien ha agendado una cita.
 *
 * SE CELEBRA, NO SE COMPARA. Nunca dice quién va por delante ni quién por detrás, no hay marcador ni «te faltan»: el aviso es el mismo para
 * el que va primero que para el que va último. Una cifra que solo sirve para presionar al que va peor desmotiva más de lo que empuja al que
 * va mejor; un «¡Maoli lleva 40!» pone una meta al lado sin señalar a nadie. Y es PURO texto del equipo, sin sonido, que se va solo y que
 * cada persona puede silenciar (lib/avisos/preferencias.ts).
 *
 * PURO: se comprueba con equipo.prueba.ts.
 */

export interface FilaDeAvisoDeEquipo {
  id: string
  tipo: 'hito_llamadas' | 'cita_agendada'
  usuario_id: string
  usuario_nombre: string
  cifra: number | null
  detalle: string | null
}

/** Los hitos que existen. Solo el último de cada subida se avisa: si un lote cruza el 20 y el 40, avisa del 40 */
export const HITOS_DE_LLAMADAS: readonly number[] = [20, 40, 60, 80, 100]

const FRASE_DE_HITO: Record<number, string> = {
  20: 'Primer bloque hecho.',
  40: 'Buen ritmo.',
  60: 'Imparable.',
  80: 'Ya casi está.',
  100: '¡Cien llamadas en un día! Aplauso.',
}

export const DURACION_DE_AVISO_DE_EQUIPO_MS = 8_000

/** El aviso que se enseña de una fila del equipo; null si no es de un tipo que se conozca (un tipo nuevo no debe romper nada) */
export function avisoDeEquipo(f: FilaDeAvisoDeEquipo): Aviso | null {
  const nombre = f.usuario_nombre.trim() || 'Alguien del equipo'
  if (f.tipo === 'hito_llamadas') {
    if (f.cifra == null || !HITOS_DE_LLAMADAS.includes(f.cifra)) return null
    return { id: `equipo-${f.id}`, tipo: 'hito', titulo: `${nombre} lleva ${f.cifra} llamadas hoy`, texto: FRASE_DE_HITO[f.cifra], duracionMs: DURACION_DE_AVISO_DE_EQUIPO_MS }
  }
  if (f.tipo === 'cita_agendada') {
    const con = f.detalle?.trim()
    return { id: `equipo-${f.id}`, tipo: 'cita', titulo: `${nombre} ha agendado una cita`, texto: con ? `Con ${con}.` : '¡Una más para el equipo!', duracionMs: DURACION_DE_AVISO_DE_EQUIPO_MS }
  }
  return null
}
