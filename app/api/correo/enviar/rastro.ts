/**
 * ENVIAR DESDE UN BUZÓN AJENO DEJA RASTRO ANTES DE SALIR — la regla de la ruta, sin Next ni SMTP (para poder probarla).
 * =====================================================================================================================
 * Quien no es el dueño del buzón (alguien a quien un administrador se lo ha asignado con «Puede responder y enviar») escribe ANTES de enviar una fila
 * `accion = 'envio'` en correo_accesos, sin caché: una por envío. Si esa fila no se puede escribir, el correo NO sale (cierra en vez de abrir: nunca un
 * correo enviado como otra persona sin que quede anotado). El dueño no deja rastro: es su buzón.
 *
 * Prueba: enviar/rastro.prueba.ts (con un fallo de correo_accesos, 0 envíos SMTP).
 */

export const SIN_RASTRO_NO_SALE = 'No se ha podido dejar constancia de este envío, así que el correo no ha salido. Vuelve a intentarlo en un momento.'

export type ResultadoConRastro<R> = { ok: true; resultado: R } | { ok: false; estado: 500; mensaje: string }

export async function enviarConRastro<R>(e: {
  /** Es el dueño del buzón: no hace falta rastro */
  esDueno: boolean
  /** Escribe la fila de rastro; si lanza, no se envía */
  anotar: () => Promise<void>
  /** Envía de verdad (SMTP) */
  enviar: () => Promise<R>
  /** Dónde se apunta el fallo del rastro (sin el texto del correo) */
  alFallar?: (error: unknown) => void
}): Promise<ResultadoConRastro<R>> {
  if (!e.esDueno) {
    try {
      await e.anotar()
    } catch (error) {
      e.alFallar?.(error)
      return { ok: false, estado: 500, mensaje: SIN_RASTRO_NO_SALE }
    }
  }
  return { ok: true, resultado: await e.enviar() }
}
