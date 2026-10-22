/**
 * LO QUE LAS OTRAS APLICACIONES LE PIDEN AL CORREO, SIN RECARGAR NADA.
 * =====================================================================
 * Cold Calling y Correo se quedan montadas las dos mientras se cambia de una a otra (components/layout/AppsPersistentes.tsx). Para que una
 * le diga a la otra «abre un mensaje para esta persona» no hay una dirección con parámetros que recargar: se deja el encargo aquí, que
 * es un módulo del navegador y vive lo que dura la sesión, y se cambia de aplicación.
 *
 *   · `pedirAlCorreo` deja un encargo. Si la pantalla de Correo ya está montada lo recibe al momento; si todavía no (primera vez que se
 *     entra en ella en esta sesión) lo guarda y lo recibe al montarse.
 *   · `alEnviarseCorreoDeLead` es el camino contrario: cuando el correo ya ha salido, Cold Calling se entera para refrescar el historial.
 *
 * PURO Y SIN REACT: se comprueba con peticiones.prueba.ts.
 */

/** El lead desde el que se ha abierto el mensaje: para apuntar el correo en su historial y rellenar las plantillas */
export interface LeadDeOrigen {
  id: string
  /** El nombre con el que se le conoce: la tienda o la empresa */
  nombre: string
  empresa: string | null
  /** La persona con la que se habla, si se sabe (el decisor) */
  contacto: string | null
}

export type PeticionAlCorreo =
  /** Abrir el cuadro de «Nuevo mensaje» ya dirigido a alguien */
  | { tipo: 'redactar'; para: string; asunto?: string; texto?: string; lead?: LeadDeOrigen }
  /** Abrir una conversación concreta (el aviso de «correo nuevo») */
  | { tipo: 'hilo'; buzonId: string; hiloId: string }

type Oyente = (peticion: PeticionAlCorreo) => void

let pendiente: PeticionAlCorreo | null = null
const oyentes = new Set<Oyente>()

/** Deja un encargo para la pantalla de Correo. Con la pantalla montada se entrega ya; si no, se guarda hasta que se monte (solo el último) */
export function pedirAlCorreo(peticion: PeticionAlCorreo): void {
  if (oyentes.size === 0) {
    pendiente = peticion
    return
  }
  for (const oyente of [...oyentes]) oyente(peticion)
}

/** La pantalla de Correo se pone a escuchar. Si había un encargo esperando, lo recibe en el acto. Devuelve cómo dejar de escuchar */
export function escucharPeticiones(oyente: Oyente): () => void {
  oyentes.add(oyente)
  if (pendiente) {
    const p = pendiente
    pendiente = null
    oyente(p)
  }
  return () => {
    oyentes.delete(oyente)
  }
}

/* ------------------------------------------------------------------ */
/* El camino de vuelta: un correo salió desde un lead                  */
/* ------------------------------------------------------------------ */

export interface CorreoEnviadoALead {
  leadId: string
  asunto: string
  /** Cuándo se envió, para sellar el «último contacto» del lead con la misma hora */
  cuando: string
}

type OyenteDeEnvio = (envio: CorreoEnviadoALead) => void
const oyentesDeEnvio = new Set<OyenteDeEnvio>()

export function avisarCorreoEnviadoALead(envio: CorreoEnviadoALead): void {
  for (const oyente of [...oyentesDeEnvio]) oyente(envio)
}

export function alEnviarseCorreoDeLead(oyente: OyenteDeEnvio): () => void {
  oyentesDeEnvio.add(oyente)
  return () => {
    oyentesDeEnvio.delete(oyente)
  }
}

/** Solo para las pruebas: deja el módulo como recién cargado */
export function reiniciarPeticiones(): void {
  pendiente = null
  oyentes.clear()
  oyentesDeEnvio.clear()
}
