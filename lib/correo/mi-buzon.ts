import type { BuzonVisible } from './tipos'

/**
 * CUÁL ES MI BUZÓN PARA ESCRIBIR. PURO. Se comprueba con mi-buzon.prueba.ts.
 *
 * Quien escribe un correo desde otra pantalla (la ventana rápida de Cold Calling) lo hace siempre desde SU buzón, conectado y con la
 * contraseña buena: nadie envía desde la dirección de otro. La lista de buzones que devuelve /api/correo/buzones trae los propios y, para
 * quien supervisa, los del equipo; aquí se elige el propio y se distingue por qué no se puede escribir, para decírselo a la persona.
 */

export type MiBuzon =
  | { tipo: 'listo'; buzon: BuzonVisible }
  /** No ha conectado ningún buzón */
  | { tipo: 'sin-buzon' }
  /** Lo conectó, pero el servidor rechazó la contraseña: hay que volver a ponerla */
  | { tipo: 'credenciales'; direccion: string }

export function elegirMiBuzon(buzones: readonly BuzonVisible[]): MiBuzon {
  const propios = buzones.filter((b) => b.esMio)
  const bueno = propios.find((b) => b.conectado && !b.credencialesInvalidas)
  if (bueno) return { tipo: 'listo', buzon: bueno }
  const roto = propios.find((b) => b.credencialesInvalidas)
  if (roto) return { tipo: 'credenciales', direccion: roto.direccion }
  return { tipo: 'sin-buzon' }
}
