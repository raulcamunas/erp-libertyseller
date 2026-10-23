import type { DiaDeUnaPersona } from './linea'

/**
 * LO QUE SE DICEN LAS RUTAS DE /api/actividad Y LA PANTALLA. Solo tipos.
 *
 * Todos los instantes van en milisegundos desde 1970 (UTC): quien pinta los pasa a la hora de su zona.
 */

export interface PersonaDelEquipo {
  id: string
  nombre: string
  email: string | null
  comercial: boolean
}

export interface FilaDelEquipo extends PersonaDelEquipo {
  primera: number | null
  ultima: number | null
  minutosActivos: number
  paginas: number
  clics: number
  sesiones: number
  logins: number
  /** El último inicio de sesión que anota Supabase (de cualquier día), que es la fuente de verdad del acceso */
  ultimoLogin: number | null
}

export interface RespuestaEquipo {
  desde: number
  hasta: number
  ahora: number
  filas: FilaDelEquipo[]
}

export interface RespuestaPersona {
  persona: PersonaDelEquipo
  desde: number
  hasta: number
  ahora: number
  ultimoLogin: number | null
  dia: DiaDeUnaPersona
  /** Había más eventos de los que se devuelven en el registro (se enseñan los últimos) */
  recortado: boolean
}

/** Lo que contesta la API cuando falta lanzar la migración */
export interface RespuestaSinMigracion {
  faltaMigracion: true
}
