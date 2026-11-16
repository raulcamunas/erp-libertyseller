/**
 * REDACTAR CON IA DESDE UN BUZÓN AJENO DEJA RASTRO ANTES DE LEER — la regla de la ruta, sin Next ni IA (para poder probarla).
 * ===========================================================================================================================
 * Para redactar, la IA lee los correos que ya se cruzaron con el lead EN ESE BUZÓN (cargarCorreosDelLead). Si el buzón no es de quien pide (lo tiene
 * asignado con «Puede responder y enviar»), eso es leer un buzón ajeno y, como cualquier otra lectura, deja ANTES una fila `accion = 'busqueda'` en
 * correo_accesos. Si esa fila no se puede escribir, no se leen los correos ni se redacta (cierra en vez de abrir). El dueño no deja rastro: es su buzón.
 *
 * Prueba: redactar-ia/rastro.prueba.ts
 */

export const SIN_RASTRO_NO_SE_REDACTA =
  'No se ha podido dejar constancia de que se leen los correos de este buzón, así que no se ha redactado el borrador. Vuelve a intentarlo en un momento.'

export type LecturaConRastro<R> = { ok: true; resultado: R } | { ok: false; estado: 500; mensaje: string }

export async function leerConRastro<R>(e: {
  /** El buzón no es de quien pide (acceso.ts: porSupervision, también si lo tiene asignado) */
  porSupervision: boolean
  /** Escribe la fila de rastro; si lanza, no se lee */
  anotar: () => Promise<void>
  /** Lee de verdad los correos del buzón */
  leer: () => Promise<R>
  /** Dónde se apunta el fallo del rastro (sin contenido de correos) */
  alFallar?: (error: unknown) => void
}): Promise<LecturaConRastro<R>> {
  if (e.porSupervision) {
    try {
      await e.anotar()
    } catch (error) {
      e.alFallar?.(error)
      return { ok: false, estado: 500, mensaje: SIN_RASTRO_NO_SE_REDACTA }
    }
  }
  return { ok: true, resultado: await e.leer() }
}
