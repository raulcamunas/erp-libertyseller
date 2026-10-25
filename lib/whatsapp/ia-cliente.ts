import type { SituacionDeWhatsapp } from './mensajes'

/**
 * LO QUE LA FICHA NECESITA PARA PEDIRLE UN WHATSAPP A LA IA — NAVEGADOR.
 * PURO (salvo la llamada a `fetch`, que se puede sustituir). Se comprueba con ia-cliente.prueba.ts.
 */

export const RUTA_DE_WHATSAPP_IA = '/api/cold-calling/whatsapp-ia'
/** Un mensaje cabe en unos segundos incluso razonando; más que esto es que algo va mal y es mejor seguir con los de siempre */
export const ESPERA_MAXIMA_MS = 60_000

export interface PeticionDeMensajeConIa {
  leadId: string
  situacion: SituacionDeWhatsapp
  /** Lo que el comercial quiere que cambie o diga */
  indicaciones?: string
  /** El mensaje de antes, si quiere cambiarlo */
  anterior?: string
}

export type RespuestaDeMensajeConIa = { ok: true; mensaje: string; base: string; aviso: string | null } | { ok: false; error: string }

/** Atajos para cambiar el mensaje con un clic: la etiqueta es lo que se ve y la indicación, lo que se le pide a la IA */
export const SUGERENCIAS_DE_CAMBIO_DE_WHATSAPP: ReadonlyArray<{ etiqueta: string; indicacion: string }> = [
  { etiqueta: 'Más corto', indicacion: 'Más corto: una o dos frases como mucho.' },
  { etiqueta: 'Más cercano', indicacion: 'Más cercano y menos comercial, como hablaría con alguien con quien ya hay confianza.' },
  { etiqueta: 'Más directo', indicacion: 'Más directo: ve al grano y propón una llamada.' },
  { etiqueta: 'Otra versión', indicacion: 'Escríbelo de otra forma, con otro enfoque y otras palabras, sin repetir lo anterior.' },
]

const NO_SE_HA_PODIDO = 'No se ha podido escribir el mensaje. Vuelve a probar.'

export async function pedirMensajeConIa(peticion: PeticionDeMensajeConIa, opciones: { fetcher?: typeof fetch; esperaMaximaMs?: number } = {}): Promise<RespuestaDeMensajeConIa> {
  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.esperaMaximaMs ?? ESPERA_MAXIMA_MS)
  try {
    const respuesta = await (opciones.fetcher ?? fetch)(RUTA_DE_WHATSAPP_IA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(peticion),
      signal: control.signal,
    })
    let datos: Record<string, unknown> = {}
    try {
      datos = ((await respuesta.json()) ?? {}) as Record<string, unknown>
    } catch {
      // Una respuesta sin JSON (un 502 del servidor de delante, por ejemplo) se cuenta igual que un fallo
    }
    if (!respuesta.ok || datos.ok !== true) {
      const dicho = typeof datos.error === 'string' && datos.error.trim() !== '' ? datos.error : null
      return { ok: false, error: dicho ?? (respuesta.status === 401 ? 'Se ha cerrado tu sesión: vuelve a entrar.' : NO_SE_HA_PODIDO) }
    }
    if (typeof datos.mensaje !== 'string' || datos.mensaje.trim() === '') return { ok: false, error: NO_SE_HA_PODIDO }
    return { ok: true, mensaje: datos.mensaje, base: typeof datos.base === 'string' ? datos.base : '', aviso: typeof datos.aviso === 'string' && datos.aviso !== '' ? datos.aviso : null }
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') return { ok: false, error: 'La IA ha tardado demasiado en contestar. Vuelve a probar.' }
    return { ok: false, error: 'No hay conexión con el servidor. Vuelve a probar.' }
  } finally {
    clearTimeout(temporizador)
  }
}
