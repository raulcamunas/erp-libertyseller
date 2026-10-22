import { etiquetaDePersona, type Persona } from './direcciones'
import { asuntoDeReenvio, asuntoDeRespuesta } from './hilos'
import type { MensajeDeHilo } from './tipos'

/**
 * QUÉ SE PONE EN EL BORRADOR AL RESPONDER, RESPONDER A TODOS O REENVIAR.
 * ======================================================================
 * PURO y sin dependencias del servidor: lo usa la pantalla. Se comprueba con redactar.prueba.ts.
 *
 *   · Responder: a quien hay que contestar. Si el correo trae Reply-To (los avisos de un formulario web llegan «de» la
 *     web y se contestan al cliente que lo rellenó), a esa dirección; si no, a quien lo envía. Si el mensaje lo enviamos
 *     nosotros, «responder» es volver a escribir a sus destinatarios.
 *   · Responder a todos: lo mismo, más todos los demás del correo en copia, sin la propia dirección.
 *   · Reenviar: sin destinatarios y con «Fwd:». El texto original lo cita el servidor.
 *
 * La firma del buzón entra ya escrita en el cuerpo, para que quien escribe la vea y pueda cambiarla.
 */

export type ModoDeRedactar = 'nuevo' | 'responder' | 'responder-todos' | 'reenviar'

export interface BorradorDeCorreo {
  modo: ModoDeRedactar
  para: string
  cc: string
  asunto: string
  texto: string
  /** Id del mensaje al que se contesta o que se reenvía (el servidor cita su texto y cuelga el hilo de él) */
  respondeA: string | null
  /** Citar el mensaje original debajo. Solo tiene sentido al responder */
  conCita: boolean
}

const lista = (personas: Persona[]): string => personas.map(etiquetaDePersona).join(', ')

const sinMia = (personas: Persona[], miDireccion: string): Persona[] => personas.filter((p) => p.direccion !== miDireccion.toLowerCase())

export function borradorDe(modo: ModoDeRedactar, mensaje: MensajeDeHilo | null, opciones: { miDireccion: string; firma: string | null }): BorradorDeCorreo {
  const texto = opciones.firma ? `\n\n${opciones.firma}` : ''
  if (modo === 'nuevo' || !mensaje) return { modo: 'nuevo', para: '', cc: '', asunto: '', texto, respondeA: null, conCita: false }

  if (modo === 'reenviar') {
    return { modo, para: '', cc: '', asunto: asuntoDeReenvio(mensaje.asunto), texto, respondeA: mensaje.id, conCita: true }
  }

  // A quién se contesta: a lo que dice Reply-To, o a quien lo envió; si lo enviamos nosotros, a sus destinatarios
  const origen: Persona[] =
    mensaje.direccion === 'saliente'
      ? mensaje.para
      : mensaje.responderA.length > 0
        ? mensaje.responderA
        : [{ nombre: mensaje.deNombre, direccion: mensaje.deDireccion }]
  const destinatarios = sinMia(origen, opciones.miDireccion)
  const para = destinatarios.length > 0 ? destinatarios : origen

  let cc: Persona[] = []
  if (modo === 'responder-todos') {
    const yaEnPara = new Set(para.map((p) => p.direccion))
    const vistos = new Set<string>()
    for (const p of sinMia([...mensaje.para, ...mensaje.cc], opciones.miDireccion)) {
      if (yaEnPara.has(p.direccion) || vistos.has(p.direccion)) continue
      vistos.add(p.direccion)
      cc.push(p)
    }
  } else {
    cc = []
  }

  return { modo, para: lista(para), cc: lista(cc), asunto: asuntoDeRespuesta(mensaje.asunto), texto, respondeA: mensaje.id, conCita: true }
}
