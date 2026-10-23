import type { LeadDeOrigen } from './peticiones'

/**
 * EL ENCARGO «ESCRIBE A ESTE LEAD» PARA LA VENTANA RÁPIDA DE COLD CALLING, SIN SALIR DE LA PANTALLA.
 * =====================================================================================================
 * Antes pulsar el correo de un lead (o «Correo con IA») llevaba a la aplicación de Correo, con lo que el comercial se salía de la ficha,
 * esperaba, escribía y volvía. Ahora se abre el cuadro de escribir ENCIMA de la ficha (components/cold-calling/CorreoRapido.tsx) y Correo
 * queda para lo que es: revisar bandejas, enviados y conversaciones.
 *
 * Es un módulo del navegador con un solo oyente (la ventana de Cold Calling, montada una vez en su tablero). `pedirCorreoRapido`
 * devuelve false si no hay nadie escuchando, para que quien llama pueda hacer lo de siempre (llevar a Correo) en vez de no hacer nada.
 *
 * PURO Y SIN REACT: se comprueba con correo-rapido.prueba.ts.
 */

export interface PeticionDeCorreoRapido {
  /** La dirección a la que va */
  para: string
  /** Abrirlo ya pidiéndole el borrador a la IA */
  ia: boolean
  /** El lead desde el que se escribe: el correo que salga se apunta en su historial */
  lead: LeadDeOrigen
}

type Oyente = (peticion: PeticionDeCorreoRapido) => void

const oyentes = new Set<Oyente>()

/** Deja el encargo. Devuelve true si alguien lo ha recibido */
export function pedirCorreoRapido(peticion: PeticionDeCorreoRapido): boolean {
  if (oyentes.size === 0) return false
  for (const oyente of [...oyentes]) oyente(peticion)
  return true
}

/** La ventana se pone a escuchar. Devuelve cómo dejar de escuchar */
export function escucharCorreoRapido(oyente: Oyente): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/** ¿Hay una ventana rápida montada? */
export function hayCorreoRapido(): boolean {
  return oyentes.size > 0
}
