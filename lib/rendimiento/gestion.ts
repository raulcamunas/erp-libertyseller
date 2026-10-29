/**
 * QUIÉN PUEDE TOCAR LA CLAVE DE RINKEL DE QUIÉN.
 * ==============================================
 * PURO: no toca la base ni la red. Se comprueba con gestion.prueba.ts.
 *
 * Por defecto cada uno gestiona la suya: el usuario sale de la SESIÓN, nunca de lo que diga la petición.
 *
 * La excepción es un ADMINISTRADOR (role = 'admin'), que puede vincular, cambiar, sincronizar y desvincular la
 * clave de cualquier persona del equipo que se mide (comerciales y managers comerciales): es quien reparte las claves y quien responde de ellas. Ni
 * un socio (partner) ni quien supervisa con el permiso 'equipo-comercial' pueden: ven las llamadas y escuchan
 * las grabaciones, pero no ponen ni quitan claves. Una clave de Rinkel abre todas las grabaciones de su dueño,
 * y por eso la puerta es la del rol de administrador y no la de «puede ver al equipo».
 *
 * La persona se pide en el cuerpo (`usuario`). Se acepta solo si es un UUID, y solo la decide como «otra
 * persona» si no es la propia: pasar el id de uno mismo es lo mismo que no pasar nada.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DecisionDeObjetivo =
  | {
      ok: true
      /** De quién es la clave sobre la que se va a actuar */
      userId: string
      /** true = un administrador actuando sobre otra persona */
      deOtra: boolean
    }
  | { ok: false; estado: number; mensaje: string }

export function decidirObjetivo(sesion: { userId: string; role: string }, pedido: unknown): DecisionDeObjetivo {
  if (pedido === undefined || pedido === null || pedido === '') return { ok: true, userId: sesion.userId, deOtra: false }

  if (typeof pedido !== 'string' || !UUID.test(pedido)) {
    return { ok: false, estado: 400, mensaje: 'No se ha entendido de qué persona se habla.' }
  }

  const id = pedido.toLowerCase()
  if (id === sesion.userId.toLowerCase()) return { ok: true, userId: sesion.userId, deOtra: false }

  if (sesion.role !== 'admin') {
    return { ok: false, estado: 403, mensaje: 'Solo un administrador puede gestionar la clave de Rinkel de otra persona.' }
  }
  return { ok: true, userId: id, deOtra: true }
}
